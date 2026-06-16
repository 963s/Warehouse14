//! Mandate 3-A — ESC/POS thermal receipt over TCP.
//!
//! ESC/POS is Epson's de-facto standard; Star / Bixolon / generic Chinese
//! receipt printers all speak a compatible dialect. The control codes are
//! short enough (init, align, bold, cut, feed) that pulling in a crate
//! buys us nothing — we hand-write the bytes here.
//!
//! Transport: TCP port 9100 (the standard "AppSocket / JetDirect" port).
//! No TLS — receipt printers on a shop LAN are trusted devices.

use serde::Deserialize;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

use crate::config::{self, DEFAULT_TCP_TIMEOUT_MS};
use crate::error::{HardwareError, HwResult};
use crate::mock::printer_mock;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalEndpoint {
    pub ip: String,
    pub port: u16,
    /// USB / local mode. When set (non-empty), the receipt is printed as raw
    /// ESC/POS to this OS print queue (CUPS `lpr -o raw`) instead of opening a
    /// TCP socket — so a USB receipt printer needs no IP, just plug it in.
    /// Optional + defaulted so existing network-mode callers keep working.
    #[serde(default)]
    pub printer_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalLineItem {
    pub name: String,
    pub quantity: u32,
    pub unit_price_eur: String,
    pub line_total_eur: String,
    pub vat_label: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalReceiptData {
    // Shop header
    pub shop_name: String,
    pub shop_address: Vec<String>,
    pub shop_vat_id: String,
    pub shop_phone: Option<String>,

    // Receipt meta
    pub receipt_locator: String,
    pub printed_at: String, // already-localised "27.05.2026 16:43"
    pub cashier_name: String,
    pub shift_id: Option<String>,

    // Body
    pub items: Vec<ThermalLineItem>,
    pub subtotal_eur: String,
    pub vat_eur: String,
    pub total_eur: String,
    pub payment_method_label: String,
    pub cash_received_eur: Option<String>,
    pub change_eur: Option<String>,

    // TSE block (KassenSichV-mandatory on every receipt)
    pub tse_signature_value: String,
    pub tse_signature_counter: String,
    pub tse_transaction_number: String,
    pub tse_qr_payload: String,

    // Footer
    pub footer_lines: Vec<String>,
}

/// One-tap reachability probe for the receipt printer — open a TCP connection
/// to the configured `ip:port` (AppSocket 9100) and close it. Drives the green/
/// red "verbunden / nicht erreichbar" badge and the app-start auto-connect sweep
/// WITHOUT sending any bytes, so probing never wakes the cutter or feeds paper.
///
/// Returns `Ok(true)` when the socket opened, `Ok(false)` on refusal/timeout —
/// an unreachable printer is a normal state to surface, not a hard error.
#[tauri::command]
pub async fn thermal_check_connection(endpoint: ThermalEndpoint) -> HwResult<bool> {
    if config::is_mock_mode() {
        return printer_mock::check_connection(&endpoint.ip, endpoint.port).await;
    }
    // USB / local mode: "reachable" means the OS print queue still exists.
    if let Some(name) = endpoint.printer_name.as_deref().filter(|n| !n.is_empty()) {
        return Ok(system_queue_exists(name).await);
    }
    Ok(probe_tcp(&endpoint.ip, endpoint.port).await)
}

/// True iff a print queue with this exact name is installed. Lets the USB-mode
/// reachability badge confirm the printer is present WITHOUT dispatching a job
/// (never feeds paper). macOS/Linux: `lpstat -p`. Windows: the spooler list.
#[cfg(not(target_os = "windows"))]
async fn system_queue_exists(printer_name: &str) -> bool {
    let Ok(output) = tokio::process::Command::new("lpstat")
        .arg("-p")
        .output()
        .await
    else {
        return false;
    };
    String::from_utf8_lossy(&output.stdout).lines().any(|line| {
        line.strip_prefix("printer ")
            .and_then(|rest| rest.split_whitespace().next())
            .map(|name| name == printer_name)
            .unwrap_or(false)
    })
}

#[cfg(target_os = "windows")]
async fn system_queue_exists(printer_name: &str) -> bool {
    let name = printer_name.to_string();
    tokio::task::spawn_blocking(move || crate::commands::win_print::queue_exists(&name))
        .await
        .unwrap_or(false)
}

/// Auto-detect the most likely USB receipt printer among the OS queues so the
/// operator just plugs it in — no IP, no manual pick. Reads each queue's
/// device-uri (`lpstat -v`), prefers a USB queue whose name/uri looks like a
/// receipt printer, else the only USB queue, else `None`. Returns the CUPS
/// queue name to store as `printerName`.
#[tauri::command]
pub async fn detect_receipt_printer() -> HwResult<Option<String>> {
    if config::is_mock_mode() {
        return Ok(Some("Mock-Bondrucker".to_string()));
    }
    detect_receipt_printer_impl().await
}

/// macOS/Linux: parse each CUPS queue's device-uri (`lpstat -v`), prefer a USB
/// queue whose name reads like a receipt printer, else the only USB queue.
#[cfg(not(target_os = "windows"))]
async fn detect_receipt_printer_impl() -> HwResult<Option<String>> {
    let Ok(output) = tokio::process::Command::new("lpstat")
        .arg("-v")
        .output()
        .await
    else {
        return Ok(None);
    };
    let text = String::from_utf8_lossy(&output.stdout);
    // Lines look like: "device for Warehouse14-Bon: usb://SAMSUNG/SRP-350?..."
    let mut usb_queues: Vec<String> = Vec::new();
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("device for ") {
            if let Some((name, uri)) = rest.split_once(": ") {
                if uri.trim().to_lowercase().starts_with("usb:") {
                    usb_queues.push(name.trim().to_string());
                }
            }
        }
    }
    // A USB queue whose name reads like a receipt printer wins.
    const HINTS: [&str; 12] = [
        "bon", "receipt", "beleg", "srp", "thermal", "pos", "tm-", "tm_", "star", "bixolon",
        "epson", "kasse",
    ];
    if let Some(name) = usb_queues
        .iter()
        .find(|n| HINTS.iter().any(|h| n.to_lowercase().contains(h)))
    {
        return Ok(Some(name.clone()));
    }
    // Otherwise, if exactly one USB printer is present, it must be the one.
    if usb_queues.len() == 1 {
        return Ok(Some(usb_queues.remove(0)));
    }
    Ok(None)
}

/// Windows: enumerate spooler queues + auto-pick the USB receipt printer by
/// port + name keyword (same heuristic as macOS). Blocking spooler call → off-thread.
#[cfg(target_os = "windows")]
async fn detect_receipt_printer_impl() -> HwResult<Option<String>> {
    Ok(
        tokio::task::spawn_blocking(crate::commands::win_print::detect_receipt)
            .await
            .unwrap_or(None),
    )
}

/// Shared TCP reachability probe — connect, then drop. `true` iff the socket
/// opened within [`DEFAULT_TCP_TIMEOUT_MS`]. Never errors; the caller maps a
/// `false` into a calm "nicht erreichbar" state.
pub(crate) async fn probe_tcp(ip: &str, port: u16) -> bool {
    let addr = format!("{ip}:{port}");
    matches!(
        timeout(
            Duration::from_millis(DEFAULT_TCP_TIMEOUT_MS),
            TcpStream::connect(&addr),
        )
        .await,
        Ok(Ok(_))
    )
}

/// Send a receipt to the thermal printer. Idempotent — if the operator
/// re-prints (e.g. the paper jammed), we just re-fire the same bytes.
#[tauri::command]
pub async fn print_thermal_receipt(
    endpoint: ThermalEndpoint,
    data: ThermalReceiptData,
) -> HwResult<()> {
    if config::is_mock_mode() {
        return printer_mock::print_thermal(endpoint, data).await;
    }

    let bytes = build_escpos(&data);

    // USB / local mode — raw ESC/POS to the OS print queue (no network).
    if let Some(name) = endpoint.printer_name.as_deref().filter(|n| !n.is_empty()) {
        return send_to_system_printer(name, &bytes).await;
    }

    // Network mode — AppSocket / JetDirect on TCP 9100.
    let addr = format!("{}:{}", endpoint.ip, endpoint.port);
    let mut stream = timeout(
        Duration::from_millis(DEFAULT_TCP_TIMEOUT_MS),
        TcpStream::connect(&addr),
    )
    .await
    .map_err(HardwareError::from)??;

    let write_fut = async {
        stream.write_all(&bytes).await?;
        stream.flush().await?;
        Ok::<(), std::io::Error>(())
    };
    timeout(Duration::from_millis(DEFAULT_TCP_TIMEOUT_MS), write_fut)
        .await
        .map_err(HardwareError::from)??;

    Ok(())
}

/// Send raw ESC/POS bytes to an OS print queue. The USB receipt printer is owned
/// by the OS spooler; we hand it the bytes with raw passthrough so the driver
/// does NOT re-render our control codes.
///
/// macOS/Linux: `lpr -P <name> -o raw <tmpfile>` (mirrors the label printer's
/// proven system path). Windows has no `lpr`, so we drive the Win32 spooler
/// directly (`win_print::print_raw`, "RAW" datatype) on a blocking thread.
#[cfg(not(target_os = "windows"))]
async fn send_to_system_printer(printer_name: &str, bytes: &[u8]) -> HwResult<()> {
    let tmp = std::env::temp_dir().join(format!("warehouse14-bon-{}.bin", uuid::Uuid::new_v4()));
    std::fs::write(&tmp, bytes).map_err(HardwareError::from)?;

    let status = tokio::process::Command::new("lpr")
        .arg("-P")
        .arg(printer_name)
        .arg("-o")
        .arg("raw")
        .arg(&tmp)
        .status()
        .await
        .map_err(HardwareError::from)?;

    let _ = std::fs::remove_file(&tmp);

    if !status.success() {
        return Err(HardwareError::Device(format!(
            "lpr exited with {:?} (Drucker '{printer_name}')",
            status.code()
        )));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
async fn send_to_system_printer(printer_name: &str, bytes: &[u8]) -> HwResult<()> {
    let name = printer_name.to_string();
    let data = bytes.to_vec();
    tokio::task::spawn_blocking(move || crate::commands::win_print::print_raw(&name, &data))
        .await
        .map_err(|e| HardwareError::Device(format!("Druckauftrag-Thread fehlgeschlagen: {e}")))?
        .map_err(HardwareError::Device)
}

// ────────────────────────────────────────────────────────────────────────
// ESC/POS byte builder — handcrafted, the spec is small enough.
// ────────────────────────────────────────────────────────────────────────

// Control sequences we use.
const ESC: u8 = 0x1B;
const GS: u8 = 0x1D;

/// The shop logo as a ready-made ESC/POS raster (`GS v 0` command), generated
/// from the brand asset (`assets/logo-escpos.bin`, 384 px wide, 1-bit). Printed
/// centred at the top of every receipt. Regenerate with scripts that pack the
/// PNG into `GS v 0` if the logo changes.
const LOGO_ESCPOS: &[u8] = include_bytes!("../../assets/logo-escpos.bin");

fn build_escpos(data: &ThermalReceiptData) -> Vec<u8> {
    let mut b = Vec::with_capacity(16384);

    // Initialize + set codepage to PC858 (Euro + German umlauts).
    b.extend_from_slice(&[ESC, b'@']);
    b.extend_from_slice(&[ESC, b't', 19]); // PC858

    // Engraved shop logo (GS v 0 raster from the brand asset), centred. The
    // logo already carries the shop NAME + tagline, so we do NOT reprint a
    // double-size "WAREHOUSE 14" under it (that redundant text header was the
    // "patchwork name below the logo" the owner asked to remove). The address +
    // USt-IdNr below are the legal Pflichtangaben the logo doesn't show.
    align_center(&mut b);
    b.extend_from_slice(LOGO_ESCPOS);
    feed(&mut b, 1);

    // Tagline + address (centred, normal size) — the human-readable contact +
    // legal block under the brand mark.
    for line in &data.shop_address {
        text_line(&mut b, line);
    }
    if let Some(phone) = &data.shop_phone {
        text_line(&mut b, &format!("Tel.: {phone}"));
    }
    text_line(&mut b, &format!("USt-IdNr.: {}", data.shop_vat_id));
    feed(&mut b, 1);

    // Meta block: left-aligned, small font.
    align_left(&mut b);
    text_line(&mut b, &format!("Beleg-Nr.: {}", data.receipt_locator));
    text_line(&mut b, &format!("Datum:     {}", data.printed_at));
    text_line(&mut b, &format!("Kassierer: {}", data.cashier_name));
    if let Some(shift) = &data.shift_id {
        text_line(&mut b, &format!("Schicht:   {shift}"));
    }
    rule(&mut b);

    // Line items.
    for item in &data.items {
        text_line(
            &mut b,
            &truncate(&format!("{} x  {}", item.quantity, item.name), 32),
        );
        text_line(
            &mut b,
            &format!(
                "  @ {:>8} EUR        {:>8} EUR  {}",
                item.unit_price_eur, item.line_total_eur, item.vat_label
            ),
        );
    }
    rule(&mut b);

    // Totals — right-aligned via padding, easier than ESC/POS column splits.
    text_line(
        &mut b,
        &kv_row("Zwischensumme:", &format!("{} EUR", data.subtotal_eur)),
    );
    text_line(&mut b, &kv_row("MwSt.:", &format!("{} EUR", data.vat_eur)));
    bold_on(&mut b);
    text_line(
        &mut b,
        &kv_row("SUMME:", &format!("{} EUR", data.total_eur)),
    );
    bold_off(&mut b);
    feed(&mut b, 1);

    text_line(&mut b, &format!("Zahlung: {}", data.payment_method_label));
    if let Some(cash) = &data.cash_received_eur {
        text_line(&mut b, &kv_row("Bar erhalten:", &format!("{cash} EUR")));
    }
    if let Some(change) = &data.change_eur {
        text_line(&mut b, &kv_row("Wechselgeld:", &format!("{change} EUR")));
    }
    rule(&mut b);

    // TSE block (KassenSichV-mandatory). When the TSE is in Ausfall / not yet
    // configured (test mode), the app sends the "TSE Ausfall" sentinel for every
    // field. Print ONE clean, legally-required Ausfall note then — NOT the same
    // "TSE Ausfall" four times plus a meaningless QR of that text (the messy
    // block the owner flagged). Only a real signature gets the full block + QR.
    let tse_down = is_tse_down(&data.tse_signature_value)
        || is_tse_down(&data.tse_qr_payload)
        || data.tse_qr_payload.trim().is_empty();
    if tse_down {
        align_center(&mut b);
        bold_on(&mut b);
        text_line(&mut b, "TSE-Ausfall");
        bold_off(&mut b);
        text_line(&mut b, "Sicherheitseinrichtung nicht verfügbar");
        align_left(&mut b);
    } else {
        text_line(&mut b, "TSE-Signatur:");
        text_line(&mut b, &truncate(&data.tse_signature_value, 32));
        text_line(
            &mut b,
            &format!("Signatur-Zähler: {}", data.tse_signature_counter),
        );
        text_line(
            &mut b,
            &format!("Trans-Nr.: {}", data.tse_transaction_number),
        );
        // QR with the TSE payload (centred under the signature).
        align_center(&mut b);
        qr_code(&mut b, &data.tse_qr_payload);
        align_left(&mut b);
    }
    feed(&mut b, 1);

    // Footer (Danke / Rückgabe / etc.)
    align_center(&mut b);
    for line in &data.footer_lines {
        text_line(&mut b, line);
    }
    feed(&mut b, 3);

    // Full cut.
    b.extend_from_slice(&[GS, b'V', 0x00]);
    b
}

/// Encode a UTF-8 string to PC858 (CP858) bytes — the code page the printer was
/// put into (`ESC t 19`). Sending raw UTF-8 is what garbled the umlauts / middle
/// dot / Euro on the receipt (`ä` = UTF-8 `C3 A4` rendered as two PC858 glyphs).
/// ASCII passes through; the German + receipt glyphs map to their PC858 byte;
/// typographic punctuation degrades to ASCII; anything else becomes `?` so a
/// stray character can never desync the fixed-width column layout.
fn encode_pc858(s: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '\u{0}'..='\u{7F}' => out.push(ch as u8),
            'Ç' => out.push(0x80),
            'ü' => out.push(0x81),
            'é' => out.push(0x82),
            'â' => out.push(0x83),
            'ä' => out.push(0x84),
            'à' => out.push(0x85),
            'å' => out.push(0x86),
            'ç' => out.push(0x87),
            'ê' => out.push(0x88),
            'ë' => out.push(0x89),
            'è' => out.push(0x8A),
            'ï' => out.push(0x8B),
            'î' => out.push(0x8C),
            'ì' => out.push(0x8D),
            'Ä' => out.push(0x8E),
            'Å' => out.push(0x8F),
            'É' => out.push(0x90),
            'æ' => out.push(0x91),
            'Æ' => out.push(0x92),
            'ô' => out.push(0x93),
            'ö' => out.push(0x94),
            'ò' => out.push(0x95),
            'û' => out.push(0x96),
            'ù' => out.push(0x97),
            'ÿ' => out.push(0x98),
            'Ö' => out.push(0x99),
            'Ü' => out.push(0x9A),
            '£' => out.push(0x9C),
            '€' => out.push(0xD5), // PC858's distinguishing code point
            'á' => out.push(0xA0),
            'í' => out.push(0xA1),
            'ó' => out.push(0xA2),
            'ú' => out.push(0xA3),
            'ñ' => out.push(0xA4),
            'Ñ' => out.push(0xA5),
            'ß' => out.push(0xE1),
            '°' => out.push(0xF8),
            '·' => out.push(0xFA), // middle dot (the tagline separator)
            // Typographic punctuation Word/macOS love to insert → ASCII.
            '–' | '—' => out.push(b'-'),
            '“' | '”' | '„' | '«' | '»' => out.push(b'"'),
            '‘' | '’' | '‚' => out.push(b'\''),
            '…' => out.extend_from_slice(b"..."),
            '\u{00A0}' => out.push(b' '), // non-breaking space
            _ => out.push(b'?'),
        }
    }
    out
}

fn text_line(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(&encode_pc858(s));
    out.push(b'\n');
}

/// True when a TSE field carries the "no TSE / Ausfall" sentinel the app sends in
/// test mode (empty or "TSE Ausfall"). A real signature/QR payload is long opaque
/// data and never matches, so this only fires when there is genuinely no TSE.
fn is_tse_down(field: &str) -> bool {
    let t = field.trim();
    t.is_empty() || t.eq_ignore_ascii_case("tse ausfall") || t.eq_ignore_ascii_case("ausfall")
}

fn feed(out: &mut Vec<u8>, lines: u8) {
    out.extend_from_slice(&[ESC, b'd', lines]);
}

fn align_left(out: &mut Vec<u8>) {
    out.extend_from_slice(&[ESC, b'a', 0]);
}
fn align_center(out: &mut Vec<u8>) {
    out.extend_from_slice(&[ESC, b'a', 1]);
}

fn bold_on(out: &mut Vec<u8>) {
    out.extend_from_slice(&[ESC, b'E', 1]);
}
fn bold_off(out: &mut Vec<u8>) {
    out.extend_from_slice(&[ESC, b'E', 0]);
}

fn rule(out: &mut Vec<u8>) {
    // 32 dashes — fits the typical 80 mm paper width at default font.
    text_line(out, "--------------------------------");
}

fn kv_row(key: &str, value: &str) -> String {
    let width = 32usize;
    let total_used = key.chars().count() + value.chars().count();
    if total_used >= width {
        format!("{key} {value}")
    } else {
        let padding = " ".repeat(width - total_used);
        format!("{key}{padding}{value}")
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        // `saturating_sub` so a (today unreachable) `max == 0` can never panic.
        s.chars()
            .take(max.saturating_sub(1))
            .chain(std::iter::once('…'))
            .collect()
    }
}

/// Emit a QR code via the GS ( k ESC/POS extension. Most modern printers
/// support it; older ones will print garbage, which is acceptable for V1
/// (the QR is supplementary — the human-readable TSE block above carries
/// the same data).
fn qr_code(out: &mut Vec<u8>, payload: &str) {
    let p = payload.as_bytes();
    // Set model: GS ( k 4 0 49 65 50 0
    out.extend_from_slice(&[GS, b'(', b'k', 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
    // Set size: GS ( k 3 0 49 67 4 (module = 4 dots, a sane default)
    out.extend_from_slice(&[GS, b'(', b'k', 0x03, 0x00, 0x31, 0x43, 0x04]);
    // Set error correction: M
    out.extend_from_slice(&[GS, b'(', b'k', 0x03, 0x00, 0x31, 0x45, 0x31]);
    // Store data: GS ( k (len + 3) 0 49 80 48 <payload>
    let plen = p.len() + 3;
    out.extend_from_slice(&[
        GS,
        b'(',
        b'k',
        (plen & 0xFF) as u8,
        ((plen >> 8) & 0xFF) as u8,
        0x31,
        0x50,
        0x30,
    ]);
    out.extend_from_slice(p);
    // Print: GS ( k 3 0 49 81 48
    out.extend_from_slice(&[GS, b'(', b'k', 0x03, 0x00, 0x31, 0x51, 0x30]);
    out.push(b'\n');
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pc858_maps_german_glyphs_and_euro_not_raw_utf8() {
        // The bug: raw UTF-8 sent to a PC858 printer garbled umlauts/·/€.
        // ä=0x84, ü=0x81, ö=0x94, ß=0xE1, ·=0xFA, €=0xD5 in PC858.
        assert_eq!(
            encode_pc858("Antiquitäten · Münzen ß €"),
            vec![
                b'A', b'n', b't', b'i', b'q', b'u', b'i', b't', 0x84, b't', b'e', b'n', b' ',
                0xFA, b' ', b'M', 0x81, b'n', b'z', b'e', b'n', b' ', 0xE1, b' ', 0xD5,
            ],
        );
        // Pure ASCII is byte-identical.
        assert_eq!(encode_pc858("Beleg-Nr.: RCP-1"), b"Beleg-Nr.: RCP-1".to_vec());
        // Typographic junk degrades to ASCII, never multi-byte garbage.
        assert_eq!(encode_pc858("„x“ — y…"), b"\"x\" - y...".to_vec());
        // An unmappable char becomes a single '?', never desyncing columns.
        assert_eq!(encode_pc858("☃"), vec![b'?']);
    }

    #[test]
    fn tse_down_detects_the_ausfall_sentinel_not_a_real_signature() {
        assert!(is_tse_down("TSE Ausfall"));
        assert!(is_tse_down("tse ausfall"));
        assert!(is_tse_down("Ausfall"));
        assert!(is_tse_down("   "));
        assert!(is_tse_down(""));
        // A real (long, opaque) TSE signature/QR payload is NOT "down".
        assert!(!is_tse_down(
            "1.0,2026-06-16T18:11:24Z,ecdsa-plain-SHA256,Aj8kP9q...base64..."
        ));
    }

    fn sample(tse_qr: &str, tse_sig: &str) -> ThermalReceiptData {
        ThermalReceiptData {
            shop_name: "WAREHOUSE 14".into(),
            shop_address: vec![
                "Antiquitäten · Briefmarken · Münzen".into(),
                "Kirchgasse 14".into(),
                "73614 Schorndorf".into(),
            ],
            shop_vat_id: "DE123456789".into(),
            shop_phone: Some("+49 7181 0".into()),
            receipt_locator: "RCP-1".into(),
            printed_at: "16.06.2026 18:11".into(),
            cashier_name: "Roman".into(),
            shift_id: None,
            items: vec![ThermalLineItem {
                name: "Münze".into(),
                quantity: 1,
                unit_price_eur: "0,95".into(),
                line_total_eur: "0,95".into(),
                vat_label: "A".into(),
            }],
            subtotal_eur: "0,95".into(),
            vat_eur: "0,00".into(),
            total_eur: "0,95".into(),
            payment_method_label: "Bar".into(),
            cash_received_eur: Some("5,00".into()),
            change_eur: Some("4,05".into()),
            tse_signature_value: tse_sig.into(),
            tse_signature_counter: "5".into(),
            tse_transaction_number: "60".into(),
            tse_qr_payload: tse_qr.into(),
            footer_lines: vec!["Danke für Ihren Einkauf".into()],
        }
    }

    #[test]
    fn build_escpos_pc858_encodes_tagline_drops_name_and_cleans_ausfall() {
        let out = build_escpos(&sample("TSE Ausfall", "TSE Ausfall"));
        // The umlaut tagline is PC858-encoded into the byte stream …
        let tagline = encode_pc858("Antiquitäten · Briefmarken · Münzen");
        assert!(
            out.windows(tagline.len()).any(|w| w == tagline.as_slice()),
            "the tagline is PC858-encoded in the receipt bytes"
        );
        // … and NO raw UTF-8 ä (C3 A4) ever reaches the PC858 printer.
        assert!(
            !out.windows(2).any(|w| w == [0xC3, 0xA4]),
            "no raw-UTF-8 umlaut leaked to the printer"
        );
        // The duplicate double-size text name is gone (logo carries it). The
        // name only survives inside the logo raster, never as ASCII text.
        let ascii = String::from_utf8_lossy(&out);
        assert!(
            !ascii.contains("WAREHOUSE 14"),
            "the redundant text shop name was removed"
        );
        // Ausfall → ONE clean note, NOT the four-line signature block.
        assert!(ascii.contains("Sicherheitseinrichtung nicht verf"));
        assert!(!ascii.contains("TSE-Signatur:"));
        assert!(!ascii.contains("Signatur-Z"));
    }

    #[test]
    fn build_escpos_real_tse_prints_signature_block_and_qr() {
        let payload = "1.0,2026-06-16T18:11:24Z,ecdsa-plain-SHA256,Aj8kP9qVeryLongOpaqueBase64";
        let out = build_escpos(&sample(payload, "Aj8kP9qVeryLongOpaqueBase64Signature"));
        let ascii = String::from_utf8_lossy(&out);
        assert!(ascii.contains("TSE-Signatur:"), "a real TSE prints the block");
        // The QR store-data command (GS ( k … 49 80 48) is emitted for a real payload.
        assert!(
            out.windows(3).any(|w| w == [0x31, 0x50, 0x30]),
            "the QR data command is emitted for a real payload"
        );
    }
}
