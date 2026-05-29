//! Warehouse14 Owner Control Desktop — Tauri 2 shell (ADR-0009, Decisions
//! #30/#41). The back-office command center: a single-window app with a native
//! system tray, OS notifications, and a single-instance guard so a second
//! launch focuses the running window instead of opening a duplicate.

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

/// Bring the main window to the foreground (used by the tray + single-instance).
fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // single-instance MUST be registered first (Tauri requirement). A second
        // launch attempt focuses the existing window + posts a notification.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
            let _ = app
                .notification()
                .builder()
                .title("Warehouse14 Control")
                .body("Bereits geöffnet — Fenster in den Vordergrund geholt.")
                .show();
        }))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // ── Native system tray with a minimal Öffnen / Beenden menu ──────
            let show = MenuItem::with_id(app, "show", "Öffnen", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let mut tray = TrayIconBuilder::new()
                .tooltip("Warehouse14 Control")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => focus_main_window(app),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // ── Launch greeting notification ─────────────────────────────────
            let _ = app
                .notification()
                .builder()
                .title("Warehouse14 Control")
                .body("Kommandozentrale bereit.")
                .show();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Warehouse14 Control");
}
