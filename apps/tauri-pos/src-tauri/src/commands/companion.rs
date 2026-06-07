//! Companion LAN hub — the mother POS as a local server (foundation phase).
//!
//! # The model
//!
//! The mother POS terminal embeds a small [`axum`] HTTP server bound to the
//! LAN. Companion devices on the same network — a second-cashier tablet, an
//! iPad facing the customer, a phone — point their browser at the mother and
//! pair with it. The mother is the only device that holds the authenticated
//! cloud session; companions ride on it through a server-side proxy (a later
//! phase). See `docs/companion-architecture.md` for the full plan.
//!
//! # What THIS foundation ships
//!
//! - Three IPC commands (`companion_start` / `companion_stop` /
//!   `companion_status`) matching the shared contract.
//! - An embedded axum server bound to `0.0.0.0:8714` (ephemeral fallback if
//!   8714 is taken), with `GET /` (a German landing page) and `GET /health`.
//! - A pairing QR (the LAN URL rendered as SVG via the `qrcode` crate) plus a
//!   fresh 6-digit pairing code on every start.
//! - Idempotent lifecycle: a second `companion_start` returns the already
//!   running info; `companion_stop` is a no-op when nothing runs.
//!
//! # What later phases add
//!
//! Pairing-code handshake + device registry, the authenticated cloud proxy
//! that injects the mother's `Authorization: Bearer` token, the role model
//! (Warehouse / Second-Cashier / Customer-Display), and the realtime
//! WebSocket feed that drives the customer display. None of that is wired
//! here — this is the foundation those phases build on.
//!
//! # Pairing code RNG
//!
//! The 6-digit code is generated with the non-cryptographic `fastrand` (already
//! a dependency for mock-mode fail injection). It is **display only** for now —
//! nothing authenticates against it yet — so a non-CSPRNG is acceptable. When
//! the pairing handshake lands (next phase) this MUST move to a CSPRNG.

use std::net::{Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};

use axum::{routing::get, Router};
use serde::Serialize;
use tauri::State;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

/// Fixed LAN port for the companion hub. Picked from the IANA dynamic range so
/// it is unlikely to collide; falls back to an OS-assigned ephemeral port if
/// 8714 is already bound.
const COMPANION_PORT: u16 = 8714;

/// Snapshot of the companion server returned to the React layer over IPC.
///
/// Serializes `camelCase` to match the shared TS contract:
/// `{ running, url, port, pairingCode, qrSvg }`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompanionInfo {
    /// Whether the embedded server is currently bound and serving.
    pub running: bool,
    /// LAN URL of the server, e.g. `http://192.168.1.20:8714`. `""` when down.
    pub url: String,
    /// The bound TCP port. `0` when down.
    pub port: u16,
    /// Fresh 6-digit numeric pairing code (display only for now). `""` when down.
    pub pairing_code: String,
    /// SVG of a QR code encoding `url`. `""` when down.
    pub qr_svg: String,
}

impl CompanionInfo {
    /// The "not running" snapshot — every field empty/zero.
    fn stopped() -> Self {
        Self {
            running: false,
            url: String::new(),
            port: 0,
            pairing_code: String::new(),
            qr_svg: String::new(),
        }
    }
}

/// Live handle to a running companion server. Held inside [`CompanionState`].
struct RunningCompanion {
    info: CompanionInfo,
    /// Fires the graceful-shutdown signal when dropped/taken on stop.
    shutdown: oneshot::Sender<()>,
    /// The spawned serve task. Awaited best-effort on stop.
    task: JoinHandle<()>,
}

/// Tauri-managed state: `Some` while the server runs, `None` otherwise.
///
/// Wrapped in a `Mutex` (not async) — every access is a quick lock to read the
/// snapshot or swap the handle; no `.await` is held across the guard.
#[derive(Clone, Default)]
pub struct CompanionState(Arc<Mutex<Option<RunningCompanion>>>);

impl CompanionState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(None)))
    }
}

/// Resolve the primary LAN IPv4 for the pairing URL. Falls back to loopback
/// when no LAN address is available (offline / link-down).
fn lan_ip() -> Ipv4Addr {
    match local_ip_address::local_ip() {
        Ok(std::net::IpAddr::V4(v4)) => v4,
        // IPv6-only or error — companions reach us reliably only over v4 here,
        // so degrade to loopback (still serves on this machine).
        _ => Ipv4Addr::LOCALHOST,
    }
}

/// Generate a fresh 6-digit numeric pairing code (zero-padded, display only).
fn fresh_pairing_code() -> String {
    format!("{:06}", fastrand::u32(0..1_000_000))
}

/// Render `url` as an SVG QR code (black on white). Returns `""` on the
/// vanishingly-rare encode failure so the caller never has to handle an error.
fn qr_svg_for(url: &str) -> String {
    use qrcode::render::svg;
    match qrcode::QrCode::new(url.as_bytes()) {
        Ok(code) => code
            .render::<svg::Color>()
            .min_dimensions(220, 220)
            .dark_color(svg::Color("#000000"))
            .light_color(svg::Color("#ffffff"))
            .build(),
        Err(_) => String::new(),
    }
}

/// `GET /` — a minimal German landing page so scanning the pairing QR from a
/// phone/iPad on the LAN actually loads a page served BY the mother.
async fn landing() -> axum::response::Html<&'static str> {
    axum::response::Html(
        r#"<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Warehouse14 Begleiter</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
         background:#0b0d12; color:#f3f4f6; }
  .card { max-width:32rem; padding:2.5rem; text-align:center; }
  h1 { font-size:1.6rem; margin:0 0 .75rem; }
  p  { font-size:1.05rem; line-height:1.5; color:#9ca3af; margin:.5rem 0; }
  .badge { display:inline-block; margin-top:1.5rem; padding:.4rem .9rem;
           border:1px solid #374151; border-radius:999px; font-size:.85rem;
           color:#9ca3af; }
</style>
</head>
<body>
  <main class="card">
    <h1>Warehouse14 Begleiter</h1>
    <p>Verbindung mit der Hauptkasse.</p>
    <p>Die Kopplung folgt in K&uuml;rze.</p>
    <span class="badge">Verbunden mit dem lokalen Netzwerk</span>
  </main>
</body>
</html>"#,
    )
}

/// `GET /health` — liveness probe for companions / diagnostics.
async fn health() -> &'static str {
    "ok"
}

/// Build the companion router. Kept tiny on purpose — routes grow in the
/// pairing/proxy/websocket phases.
fn build_router() -> Router {
    Router::new()
        .route("/", get(landing))
        .route("/health", get(health))
}

/// Bind the TCP listener, preferring [`COMPANION_PORT`] and falling back to an
/// OS-assigned ephemeral port if it is already taken. Returns the bound
/// listener plus its actual port.
async fn bind_listener() -> std::io::Result<(tokio::net::TcpListener, u16)> {
    let preferred = SocketAddr::from((Ipv4Addr::UNSPECIFIED, COMPANION_PORT));
    match tokio::net::TcpListener::bind(preferred).await {
        Ok(listener) => {
            let port = listener.local_addr().map(|a| a.port()).unwrap_or(COMPANION_PORT);
            Ok((listener, port))
        }
        Err(_) => {
            // Port busy — let the OS pick a free one.
            let any = SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0));
            let listener = tokio::net::TcpListener::bind(any).await?;
            let port = listener.local_addr()?.port();
            Ok((listener, port))
        }
    }
}

/// Start the companion hub. Idempotent: if it is already running, returns the
/// existing snapshot untouched. On bind failure returns the `stopped()`
/// snapshot (the POS keeps working — companions just stay unavailable).
#[tauri::command]
pub async fn companion_start(state: State<'_, CompanionState>) -> Result<CompanionInfo, ()> {
    // Fast path: already running → return the live snapshot.
    {
        let guard = state.0.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(running) = guard.as_ref() {
            return Ok(running.info.clone());
        }
    }

    let (listener, port) = match bind_listener().await {
        Ok(bound) => bound,
        Err(err) => {
            eprintln!("warehouse14-pos: companion server bind failed: {err}");
            return Ok(CompanionInfo::stopped());
        }
    };

    let ip = lan_ip();
    let url = format!("http://{ip}:{port}");
    let pairing_code = fresh_pairing_code();
    let qr_svg = qr_svg_for(&url);

    let info = CompanionInfo {
        running: true,
        url,
        port,
        pairing_code,
        qr_svg,
    };

    // Graceful-shutdown channel: `companion_stop` fires this; axum stops
    // accepting and drains in-flight requests.
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let app = build_router();
    let task = tokio::spawn(async move {
        let server = axum::serve(listener, app).with_graceful_shutdown(async move {
            // Resolves on stop OR when the sender drops (state cleared).
            let _ = shutdown_rx.await;
        });
        if let Err(err) = server.await {
            eprintln!("warehouse14-pos: companion server exited with error: {err}");
        }
    });

    let snapshot = info.clone();
    {
        let mut guard = state.0.lock().unwrap_or_else(|p| p.into_inner());
        // Re-check under the lock to avoid a double-start race: if another call
        // beat us to it, drop our freshly-bound server and return theirs.
        if let Some(running) = guard.as_ref() {
            drop(shutdown_tx); // triggers graceful shutdown of our redundant server
            task.abort();
            return Ok(running.info.clone());
        }
        *guard = Some(RunningCompanion {
            info,
            shutdown: shutdown_tx,
            task,
        });
    }

    Ok(snapshot)
}

/// Stop the companion hub. Idempotent — a no-op when nothing is running.
#[tauri::command]
pub async fn companion_stop(state: State<'_, CompanionState>) -> Result<(), ()> {
    let running = {
        let mut guard = state.0.lock().unwrap_or_else(|p| p.into_inner());
        guard.take()
    };
    if let Some(running) = running {
        // Fire graceful shutdown, then await the serve task best-effort.
        let _ = running.shutdown.send(());
        let _ = running.task.await;
    }
    Ok(())
}

/// Return the current companion snapshot (running or stopped).
#[tauri::command]
pub async fn companion_status(state: State<'_, CompanionState>) -> Result<CompanionInfo, ()> {
    let guard = state.0.lock().unwrap_or_else(|p| p.into_inner());
    Ok(guard
        .as_ref()
        .map(|r| r.info.clone())
        .unwrap_or_else(CompanionInfo::stopped))
}
