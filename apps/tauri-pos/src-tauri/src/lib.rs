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
    ];

    // Local P2P terminal discovery — shared peer registry, advertised + browsed
    // by a background mDNS thread spawned in `.setup()` below.
    let peer_registry = commands::mdns::PeerRegistry::new();

    // Companion LAN hub — the embedded axum server's lifecycle handle. It is
    // AUTO-STARTED in `.setup()` below (frictionless phone link: persisted
    // pairings reconnect without re-scanning the QR); the explicit
    // companion_start from "Geräte koppeln" then only mints a fresh pairing
    // code. See commands/companion.rs and docs/companion-architecture.md.
    let companion_state = commands::companion::CompanionState::new();
    let companion_autostart_state = companion_state.clone();

    tauri::Builder::default()
        .manage(peer_registry.clone())
        .manage(companion_state)
        // Spawn the mDNS daemon once the app is up. It advertises this terminal
        // as `_w14pos._tcp.local.` and discovers peers; it is fail-safe (logs and
        // exits if mDNS is unavailable) and never blocks or crashes startup.
        .setup(move |app| {
            commands::mdns::start_mdns_daemon(app.handle().clone(), peer_registry.clone());
            // Auto-start the companion hub so it is ALWAYS up at :8714 without
            // opening "Geräte koppeln". Idempotent + fail-safe (a bind failure
            // — e.g. AddrInUse on both the fixed and fallback port — is logged
            // and never blocks startup). No pairing code is issued here; the
            // mother's Bearer arrives later via companion_set_auth, and until
            // then companions get a clear "Mutter noch nicht angemeldet".
            // The app data dir anchors the persisted pairing registry.
            use tauri::Manager as _;
            let companion_data_dir = app.path().app_data_dir().ok();
            // Phase B — wire the app handle so an inbound phone scan can be
            // re-emitted to the mother React cart. Set before the spawn moves the
            // state; the hub Arc is shared with the Tauri-managed instance.
            companion_autostart_state.set_app_handle(app.handle().clone());
            tauri::async_runtime::spawn(async move {
                commands::companion::companion_autostart(
                    companion_autostart_state,
                    companion_data_dir,
                )
                .await;
            });
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
            commands::thermal::thermal_check_connection,
            commands::thermal::detect_receipt_printer,
            // Epic B — product sticker labels (ZPL / ESC-POS)
            commands::label::print_label,
            commands::label::label_check_connection,
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
            // Companion LAN hub — embedded server lifecycle (mother-as-server)
            commands::companion::companion_start,
            commands::companion::companion_stop,
            commands::companion::companion_status,
            // Companion LAN hub — auth injection + live cart publish + scanner command
            commands::companion::companion_set_auth,
            commands::companion::companion_publish_cart,
            commands::companion::companion_send_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running warehouse14-tauri-pos");
}
