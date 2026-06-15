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
