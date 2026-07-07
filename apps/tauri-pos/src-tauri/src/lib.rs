// warehouse14-tauri-pos library entry.
//
// The Rust side owns the native bridges (printer, card terminal, TSE).
// Every command goes through `commands/*` and respects mock mode
// (env `WAREHOUSE14_MOCK_HARDWARE=1`). See memory.md §18 for the
// architecture-of-record.

// `pub` so the in-repo hardware-in-the-loop integration tests (src-tauri/tests/)
// can drive the REAL command paths (commands::zvt / commands::tse) and match on
// `error::HardwareError`. Widening visibility only — no runtime behaviour change.
pub mod commands;
pub mod config;
pub mod error;
pub mod mock;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // ADR-0044 Phase 3 — forward-only outbox migrations, applied on startup
    // before any UI mounts. NEVER edit a shipped migration (§25a UStG bars a
    // destructive rollback on financial-record tables); add 0002+ instead.
    let outbox_migrations = vec![
        tauri_plugin_sql::Migration {
            version: 1,
            description: "create offline outbox tables",
            sql: include_str!("../migrations/0001_outbox.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        // Epic C Part 2 — local KYC document index (offline preview).
        tauri_plugin_sql::Migration {
            version: 2,
            description: "create customer_kyc table",
            sql: include_str!("../migrations/0002_kyc.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
        // Phase 1.3 — durable TSE signature replay queue (STRICT). Replaces the
        // volatile localStorage queue; fiscal records, never dropped.
        tauri_plugin_sql::Migration {
            version: 3,
            description: "create TSE signature replay queue",
            sql: include_str!("../migrations/0003_tse_queue.sql"),
            kind: tauri_plugin_sql::MigrationKind::Up,
        },
    ];

    // DSGVO boot-time sweep (Phase 3.8): purge any stale invoice/preview temp PDFs
    // — each carries a customer name + §25a data — left behind by a previous
    // session (a crash mid-print, or a preview whose external viewer held the
    // file open so it couldn't be deleted inline). Off the main thread so it never
    // delays the UI; a temp-dir scan is fast and failures are swallowed.
    std::thread::spawn(commands::pdf::sweep_stale_pdf_temp_files);

    tauri::Builder::default()
        // Plugins — order doesn't matter, registration is idempotent.
        // V1 only needs `shell` (for the PDF preview opener); store +
        // dialog land in V1.1 if the operator asks for a save dialog.
        .plugin(tauri_plugin_shell::init())
        // ADR-0044 — local SQLite outbox. Path is relative to the app data
        // dir; the JS TauriSqlOutboxStore loads the same `sqlite:warehouse14.db`.
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:warehouse14.db", outbox_migrations)
                .build(),
        )
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
            // TSE credentials — OS-keychain backed (never in localStorage)
            commands::tse::tse_store_credentials,
            commands::tse::tse_credentials_present,
            commands::tse::tse_clear_credentials,
            // Mandate 2-B — ZVT card terminal
            commands::zvt::zvt_check_connection,
            commands::zvt::zvt_authorize_payment,
            commands::zvt::zvt_reverse_payment,
            // Mandate 3-A — ESC/POS thermal
            commands::thermal::print_thermal_receipt,
            commands::thermal::thermal_check_connection,
            commands::thermal::detect_receipt_printer,
            // Epic B — product sticker labels (ZPL / ESC-POS)
            commands::label::print_label,
            commands::label::label_check_connection,
            // Mandate 3-B — A4 PDF
            commands::pdf::generate_invoice_pdf,
            commands::pdf::print_a4,
            commands::pdf::open_pdf_preview,
            commands::pdf::sweep_temp_pdfs,
            // Mandate 4 — system probe
            commands::system::list_system_printers,
            // Epic C — encrypted local KYC vault
            commands::kyc::encrypt_and_save_kyc_document,
            commands::kyc::decrypt_and_load_kyc_document,
            commands::kyc::delete_kyc_document,
            // USB digital scale (MT-SICS over serial)
            commands::scale::read_scale_weight,
            commands::scale::tare_scale,
            commands::scale::list_scale_ports,
        ])
        .run(tauri::generate_context!())
        .expect("error while running warehouse14-tauri-pos");
}
