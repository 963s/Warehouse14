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
    ];

    // Local P2P terminal discovery — shared peer registry, advertised + browsed
    // by a background mDNS thread spawned in `.setup()` below.
    let peer_registry = commands::mdns::PeerRegistry::new();

    tauri::Builder::default()
        .manage(peer_registry.clone())
        // Spawn the mDNS daemon once the app is up. It advertises this terminal
        // as `_w14pos._tcp.local.` and discovers peers; it is fail-safe (logs and
        // exits if mDNS is unavailable) and never blocks or crashes startup.
        .setup(move |app| {
            commands::mdns::start_mdns_daemon(app.handle().clone(), peer_registry.clone());
            Ok(())
        })
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
            // Epic B — product sticker labels (ZPL / ESC-POS)
            commands::label::print_label,
            // Mandate 3-B — A4 PDF
            commands::pdf::generate_invoice_pdf,
            commands::pdf::print_a4,
            commands::pdf::open_pdf_preview,
            // Mandate 4 — system probe
            commands::system::list_system_printers,
            // Epic C — encrypted local KYC vault
            commands::kyc::encrypt_and_save_kyc_document,
            commands::kyc::decrypt_and_load_kyc_document,
            // USB digital scale (MT-SICS over serial)
            commands::scale::read_scale_weight,
            commands::scale::list_scale_ports,
            // Local P2P — discovered LAN peers
            commands::mdns::get_local_peers,
        ])
        .run(tauri::generate_context!())
        .expect("error while running warehouse14-tauri-pos");
}
