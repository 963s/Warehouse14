// warehouse14-tauri-pos library entry.
//
// The Rust side owns the native bridges (printer, card terminal, TSE).
// Every command goes through `commands/*` and respects mock mode
// (env `WAREHOUSE14_MOCK_HARDWARE=1`). See memory.md §18 for the
// architecture-of-record.

mod commands;
mod config;
mod error;
mod mock;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Plugins — order doesn't matter, registration is idempotent.
        // V1 only needs `shell` (for the PDF preview opener); store +
        // dialog land in V1.1 if the operator asks for a save dialog.
        .plugin(tauri_plugin_shell::init())
        // Auto-update plugin reads tauri.conf.json plugins.updater.*
        // (endpoint URL + minisign public key). The frontend calls
        // `check()` + `download_and_install()` via @tauri-apps/plugin-updater.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Process plugin exposes `exit()` and `relaunch()` to the
        // frontend — the updater calls relaunch() after install lands.
        .plugin(tauri_plugin_process::init())
        // Every hardware command registers here. The macro stitches them
        // into the invoke handler; if a command moves or is renamed, this
        // is the single point that needs to change.
        .invoke_handler(tauri::generate_handler![
            // Mandate 1 — image compression
            commands::image::compress_to_webp,
            // Mandate 2-A — TSE (Fiskaly Cloud)
            commands::tse::tse_start_transaction,
            commands::tse::tse_finish_transaction,
            commands::tse::tse_status,
            // Mandate 2-B — ZVT card terminal
            commands::zvt::zvt_check_connection,
            commands::zvt::zvt_authorize_payment,
            commands::zvt::zvt_reverse_payment,
            // Mandate 3-A — ESC/POS thermal
            commands::thermal::print_thermal_receipt,
            // Mandate 3-B — A4 PDF
            commands::pdf::generate_invoice_pdf,
            commands::pdf::print_a4,
            commands::pdf::open_pdf_preview,
            // Mandate 4 — system probe
            commands::system::list_system_printers,
        ])
        .run(tauri::generate_context!())
        .expect("error while running warehouse14-tauri-pos");
}
