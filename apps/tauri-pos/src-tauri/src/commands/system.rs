//! Mandate 4 — List OS print queues for the Gerätemanager dropdown.
//!
//! macOS / Linux: `lpstat -p`. Windows: `wmic printer list brief` (V1
//! ships macOS only; the salon Mac is the target). The shape returned
//! is intentionally minimal — just the queue name — because the Hardware
//! tab uses it for a dropdown, nothing more.

use serde::Serialize;

use crate::error::HwResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPrinter {
    pub name: String,
    /// Best-effort: "idle" / "printing" / "stopped" / "unknown".
    pub status: String,
}

#[tauri::command]
pub async fn list_system_printers() -> HwResult<Vec<SystemPrinter>> {
    list_system_printers_impl().await
}

/// Open the OS "Microphone" privacy pane so the owner can grant Vierzehn the
/// microphone from inside the app when a capture was denied. Opened from Rust
/// (not the JS shell plugin) because the JS shell scope validator rejects the
/// `x-apple.systempreferences:` / `ms-settings:` schemes. The URL is a fixed
/// per-OS constant — never interpolated from anything the web layer sends.
#[tauri::command]
pub async fn open_microphone_settings(app_handle: tauri::AppHandle) -> HwResult<()> {
    #[cfg(target_os = "macos")]
    let url = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
    #[cfg(target_os = "windows")]
    let url = "ms-settings:privacy-microphone";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let url = "";

    if url.is_empty() {
        return Ok(());
    }

    #[allow(deprecated)]
    {
        use tauri_plugin_shell::ShellExt;
        app_handle
            .shell()
            .open(url.to_string(), None)
            .map_err(|e| crate::error::HardwareError::Internal(format!("shell::open failed: {e}")))?;
    }
    Ok(())
}

/// Open an external URL in the OS default browser.
///
/// Used by the Google sign-in flow: the staff OAuth consent page MUST open in a
/// real browser (the in-app WKWebView cannot complete Google OAuth), and a bare
/// `window.open` does not reach the OS browser in the packaged app — it just
/// hangs. This mirrors `open_microphone_settings`: the opener runs from Rust via
/// the shell plugin, which is the reliable path in the built binary.
///
/// Only `https://` (and loopback `http://localhost` / `http://127.0.0.1` for the
/// dev server) are accepted, so the web layer can never coax the OS into
/// launching a custom-scheme handler.
#[tauri::command]
pub async fn open_url(app_handle: tauri::AppHandle, url: String) -> HwResult<()> {
    let allowed = url.starts_with("https://")
        || url.starts_with("http://localhost")
        || url.starts_with("http://127.0.0.1");
    if !allowed {
        return Err(crate::error::HardwareError::Internal(
            "refused to open a non-http(s) URL".to_string(),
        ));
    }

    #[allow(deprecated)]
    {
        use tauri_plugin_shell::ShellExt;
        app_handle
            .shell()
            .open(url, None)
            .map_err(|e| crate::error::HardwareError::Internal(format!("shell::open failed: {e}")))?;
    }
    Ok(())
}

/// The loopback path the staff Google callback redirects to. It is never
/// actually loaded — the sign-in window intercepts the navigation, reads the
/// token from the fragment, and closes. Must match the `returnTo` the frontend
/// hands to `/api/admin/auth/google/start`.
const AUTH_DONE_PREFIXES: [&str; 2] = [
    "http://localhost/__w14_auth_done",
    "http://127.0.0.1/__w14_auth_done",
];

/// A desktop-Safari user agent for the sign-in window. Google refuses OAuth in
/// an agent it recognises as an embedded webview (`disallowed_useragent`); a
/// normal browser UA lets the account chooser render inside the app instead of
/// forcing an external browser.
const SIGNIN_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) \
AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

const SIGNIN_WINDOW_LABEL: &str = "google-signin";

/// Open the staff Google sign-in as an IN-APP window (no external browser).
///
/// Flow: build a webview window at `start_url` (which is
/// `…/api/admin/auth/google/start?returnTo=http://localhost/__w14_auth_done`).
/// The operator picks their Google account and consents inside that window; the
/// server callback finally redirects to the loopback `returnTo` with the session
/// token in the URL fragment. We intercept THAT navigation in `on_navigation`,
/// emit the fragment to the frontend as `google-auth-result`, close the window,
/// and cancel the (dead) loopback load. The frontend turns the token into a
/// session — no polling, no browser hand-off.
#[tauri::command]
pub async fn start_google_login(app: tauri::AppHandle, start_url: String) -> HwResult<()> {
    if !start_url.starts_with("https://") {
        return Err(crate::error::HardwareError::Internal(
            "sign-in URL must be https".to_string(),
        ));
    }

    // Window creation must run on the main (UI) thread on macOS.
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let app_main = app.clone();
    app.run_on_main_thread(move || {
        let _ = tx.send(build_signin_window(&app_main, &start_url));
    })
    .map_err(|e| crate::error::HardwareError::Internal(format!("main-thread dispatch: {e}")))?;

    rx.recv()
        .map_err(|e| crate::error::HardwareError::Internal(format!("window build: {e}")))?
        .map_err(crate::error::HardwareError::Internal)
}

fn build_signin_window(app: &tauri::AppHandle, start_url: &str) -> Result<(), String> {
    use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

    // If a stale sign-in window is still around, close it first.
    if let Some(existing) = app.get_webview_window(SIGNIN_WINDOW_LABEL) {
        let _ = existing.close();
    }

    let url = start_url
        .parse::<tauri::Url>()
        .map_err(|e| format!("bad sign-in URL: {e}"))?;

    let app_nav = app.clone();
    let win = WebviewWindowBuilder::new(app, SIGNIN_WINDOW_LABEL, WebviewUrl::External(url))
        .title("Mit Google anmelden")
        .inner_size(460.0, 660.0)
        .min_inner_size(380.0, 520.0)
        .focused(true)
        .user_agent(SIGNIN_USER_AGENT)
        .on_navigation(move |target| {
            let s = target.as_str();
            let is_done = AUTH_DONE_PREFIXES.iter().any(|p| s.starts_with(p));
            if is_done {
                // token=…&expiresAt=…  (or  error=…)
                let payload = target.fragment().unwrap_or("").to_string();
                let _ = app_nav.emit("google-auth-result", payload);
                if let Some(w) = app_nav.get_webview_window(SIGNIN_WINDOW_LABEL) {
                    let _ = w.close();
                }
                return false; // never actually load the dead loopback
            }
            true
        })
        .build()
        .map_err(|e| format!("build sign-in window: {e}"))?;

    // If the operator closes the window without finishing, tell the frontend so
    // its await resolves (cancelled) instead of hanging. A successful sign-in
    // emits the token FIRST, so the frontend's one-shot guard ignores this.
    let app_evt = app.clone();
    win.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            use tauri::Emitter;
            let _ = app_evt.emit("google-auth-result", "cancelled=1".to_string());
        }
    });

    Ok(())
}

/// Windows: enumerate spooler queues via `EnumPrinters` (status best-effort
/// "unknown" — the Gerätemanager dropdown only needs the names).
#[cfg(target_os = "windows")]
async fn list_system_printers_impl() -> HwResult<Vec<SystemPrinter>> {
    let names = tokio::task::spawn_blocking(crate::commands::win_print::list_printer_names)
        .await
        .unwrap_or_default();
    Ok(names
        .into_iter()
        .map(|name| SystemPrinter {
            name,
            status: "unknown".to_string(),
        })
        .collect())
}

/// macOS / Linux: `lpstat -p`.
#[cfg(not(target_os = "windows"))]
async fn list_system_printers_impl() -> HwResult<Vec<SystemPrinter>> {
    // No mock branch — `lpstat -p` exits with code 1 when no printers are
    // configured, which is a perfectly valid state to surface to the UI
    // (the dropdown then says "Keine Drucker konfiguriert").
    let output = tokio::process::Command::new("lpstat")
        .arg("-p")
        .output()
        .await;

    let stdout = match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(_) => return Ok(Vec::new()),
    };

    let mut printers = Vec::new();
    for line in stdout.lines() {
        // Format: "printer XEROX_C405 is idle.  enabled since ..."
        if let Some(rest) = line.strip_prefix("printer ") {
            let mut iter = rest.split_whitespace();
            let name = iter.next().unwrap_or("").to_string();
            if name.is_empty() {
                continue;
            }
            let status = if line.contains("is idle") {
                "idle"
            } else if line.contains("now printing") {
                "printing"
            } else if line.contains("disabled") || line.contains("stopped") {
                "stopped"
            } else {
                "unknown"
            };
            printers.push(SystemPrinter {
                name,
                status: status.to_string(),
            });
        }
    }
    Ok(printers)
}
