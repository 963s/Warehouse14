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

    let addr = format!("{}:{}", endpoint.ip, endpoint.port);
    let mut stream = timeout(
        Duration::from_millis(DEFAULT_TCP_TIMEOUT_MS),
        TcpStream::connect(&addr),
    )
    .await
    .map_err(HardwareError::from)??;

    let bytes = build_escpos(&data);
    let write_fut = async {
        stream.write_all(&bytes).await?;
        stream.flush().await?;
        Ok::<(), std::io::Error>(())
    };
    timeout(
        Duration::from_millis(DEFAULT_TCP_TIMEOUT_MS),
        write_fut,
    )
    .await
    .map_err(HardwareError::from)??;

    Ok(())
}

// ────────────────────────────────────────────────────────────────────────
// ESC/POS byte builder — handcrafted, the spec is small enough.
// ────────────────────────────────────────────────────────────────────────

// Control sequences we use.
const ESC: u8 = 0x1B;
const GS: u8 = 0x1D;

fn build_escpos(data: &ThermalReceiptData) -> Vec<u8> {
    let mut b = Vec::with_capacity(2048);

    // Initialize + set codepage to PC858 (Euro + German umlauts).
    b.extend_from_slice(&[ESC, b'@']);
    b.extend_from_slice(&[ESC, b't', 19]); // PC858

    // Header: centred, bold, double height.
    align_center(&mut b);
    bold_on(&mut b);
    double_size(&mut b);
    text_line(&mut b, &data.shop_name);
    double_off(&mut b);
    bold_off(&mut b);
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
            &truncate(
                &format!("{} x  {}", item.quantity, item.name),
                32,
            ),
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
    text_line(&mut b, &kv_row("Zwischensumme:", &format!("{} EUR", data.subtotal_eur)));
    text_line(&mut b, &kv_row("MwSt.:",         &format!("{} EUR", data.vat_eur)));
    bold_on(&mut b);
    text_line(&mut b, &kv_row("SUMME:",         &format!("{} EUR", data.total_eur)));
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

    // TSE block (mandatory).
    text_line(&mut b, "TSE-Signatur:");
    text_line(&mut b, &truncate(&data.tse_signature_value, 32));
    text_line(&mut b, &format!("Signatur-Zähler: {}", data.tse_signature_counter));
    text_line(&mut b, &format!("Trans-Nr.: {}", data.tse_transaction_number));

    // QR with the TSE payload.
    align_center(&mut b);
    qr_code(&mut b, &data.tse_qr_payload);
    align_left(&mut b);
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

fn text_line(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(s.as_bytes());
    out.push(b'\n');
}

fn feed(out: &mut Vec<u8>, lines: u8) {
    out.extend_from_slice(&[ESC, b'd', lines]);
}

fn align_left(out: &mut Vec<u8>)   { out.extend_from_slice(&[ESC, b'a', 0]); }
fn align_center(out: &mut Vec<u8>) { out.extend_from_slice(&[ESC, b'a', 1]); }

fn bold_on(out: &mut Vec<u8>)  { out.extend_from_slice(&[ESC, b'E', 1]); }
fn bold_off(out: &mut Vec<u8>) { out.extend_from_slice(&[ESC, b'E', 0]); }

fn double_size(out: &mut Vec<u8>) { out.extend_from_slice(&[GS, b'!', 0x11]); }
fn double_off(out: &mut Vec<u8>)  { out.extend_from_slice(&[GS, b'!', 0x00]); }

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
        s.chars().take(max - 1).chain(std::iter::once('…')).collect()
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
    out.extend_from_slice(&[GS, b'(', b'k', (plen & 0xFF) as u8, ((plen >> 8) & 0xFF) as u8, 0x31, 0x50, 0x30]);
    out.extend_from_slice(p);
    // Print: GS ( k 3 0 49 81 48
    out.extend_from_slice(&[GS, b'(', b'k', 0x03, 0x00, 0x31, 0x51, 0x30]);
    out.push(b'\n');
}
