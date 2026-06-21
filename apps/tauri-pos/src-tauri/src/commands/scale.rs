//! USB digital scale over serial (Mettler-Toledo MT-SICS protocol).
//!
//! `read_scale_weight` opens the serial port, sends the `S` stable-weight
//! request, reads the ASCII reply, and parses the grams value. `list_scale_ports`
//! enumerates the available serial ports for the Gerätemanager dropdown.
//!
//! MT-SICS stable-weight reply shape (response to the `S` command):
//!   `S S      14.50 g`   → status1=S, status2=S (Stable), value, unit
//!   `S D      14.50 g`   → D = Dynamic (not yet settled)
//!   `S I` / `S +` / `S -`→ command not executable / over- / under-load
//!
//! The serial I/O runs on a blocking thread (`spawn_blocking`) so it never
//! stalls the async runtime. Parsing is split into a pure `parse_mt_sics`
//! function so it is unit-testable without hardware.

use std::io::{BufRead, BufReader, Write};
use std::time::Duration;

use serde::Serialize;

use crate::error::{HardwareError, HwResult};

/// Default baud rate for MT-SICS scales.
const DEFAULT_BAUD: u32 = 9600;
/// How long to wait for the scale to answer before giving up.
const READ_TIMEOUT: Duration = Duration::from_millis(2000);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeightReading {
    /// Weight in grams, as the scale reported it (string preserves trailing zeros).
    pub grams: String,
}

/// Parse a single MT-SICS `S` reply line into a [`WeightReading`].
///
/// Pure + total — never panics. Returns a `Device` error on any out-of-protocol
/// line (dynamic/unsettled weight, over/underload, garbage).
pub fn parse_mt_sics(raw: &str) -> HwResult<WeightReading> {
    let line = raw.trim();
    let mut tokens = line.split_whitespace();

    // Token 0 must be the `S` response identifier.
    if tokens.next() != Some("S") {
        return Err(HardwareError::Device(format!(
            "unexpected MT-SICS response (no 'S' identifier): {line:?}"
        )));
    }

    // Token 1 is the weight status: S = stable, D = dynamic, else an error code.
    match tokens.next() {
        Some("S") | Some("D") => {}
        Some("I") => {
            return Err(HardwareError::Device(
                "scale: command not executable (S I)".to_string(),
            ));
        }
        Some("+") => return Err(HardwareError::Device("scale: overload (S +)".to_string())),
        Some("-") => return Err(HardwareError::Device("scale: underload (S -)".to_string())),
        other => {
            return Err(HardwareError::Device(format!(
                "scale: unexpected status token {other:?} in {line:?}"
            )));
        }
    }

    // Token 2 is the numeric weight; validate it parses, but return the original
    // string so we keep the scale's exact precision (e.g. "14.50", not "14.5").
    let value = tokens
        .next()
        .ok_or_else(|| HardwareError::Device(format!("scale: no weight value in {line:?}")))?;
    if value.parse::<f64>().is_err() {
        return Err(HardwareError::Device(format!(
            "scale: non-numeric weight {value:?} in {line:?}"
        )));
    }

    Ok(WeightReading {
        grams: value.to_string(),
    })
}

/// Blocking serial round-trip: open, send `S`, read one line, parse.
fn read_scale_blocking(port_path: &str, baud: u32) -> HwResult<WeightReading> {
    let port = serialport::new(port_path, baud)
        .timeout(READ_TIMEOUT)
        .open()
        .map_err(|e| HardwareError::Device(format!("open serial port {port_path:?}: {e}")))?;

    // Clone a writer handle, then wrap the port in a buffered reader for the line.
    let mut writer = port
        .try_clone()
        .map_err(|e| HardwareError::Device(format!("clone serial handle: {e}")))?;
    writer
        .write_all(b"S\r\n")
        .map_err(|e| HardwareError::Device(format!("write MT-SICS request: {e}")))?;
    writer
        .flush()
        .map_err(|e| HardwareError::Device(format!("flush serial port: {e}")))?;

    let mut reader = BufReader::new(port);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .map_err(|e| HardwareError::Timeout(format!("read scale reply: {e}")))?;
    if line.trim().is_empty() {
        return Err(HardwareError::Timeout(
            "scale: no reply within timeout".to_string(),
        ));
    }
    parse_mt_sics(&line)
}

/// Read a stable weight from the scale at `port_path` (baud configurable).
#[tauri::command]
pub async fn read_scale_weight(
    port_path: String,
    baud_rate: Option<u32>,
) -> HwResult<WeightReading> {
    if crate::config::is_mock_mode() {
        return Ok(WeightReading {
            grams: "14.50".to_string(),
        });
    }
    let baud = baud_rate.unwrap_or(DEFAULT_BAUD);
    tokio::task::spawn_blocking(move || read_scale_blocking(&port_path, baud))
        .await
        .map_err(|e| HardwareError::Internal(format!("scale task join: {e}")))?
}

/// Enumerate available serial ports (paths) for the operator to choose from.
#[tauri::command]
pub async fn list_scale_ports() -> HwResult<Vec<String>> {
    if crate::config::is_mock_mode() {
        return Ok(vec!["/dev/tty.mock-scale".to_string()]);
    }
    let ports = serialport::available_ports()
        .map_err(|e| HardwareError::Device(format!("enumerate serial ports: {e}")))?;
    Ok(ports.into_iter().map(|p| p.port_name).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_stable_mt_sics_reply() {
        let reading = parse_mt_sics("S S      14.50 g\r\n").expect("should parse");
        assert_eq!(reading.grams, "14.50");
    }

    #[test]
    fn parses_dynamic_reply_too() {
        let reading = parse_mt_sics("S D      3.20 g").expect("should parse");
        assert_eq!(reading.grams, "3.20");
    }

    #[test]
    fn rejects_overload_and_garbage() {
        assert!(parse_mt_sics("S +").is_err());
        assert!(parse_mt_sics("S I").is_err());
        assert!(parse_mt_sics("garbage line").is_err());
        assert!(parse_mt_sics("S S not_a_number g").is_err());
    }
}
