//! Epic B — product sticker label printing (ZPL + ESC/POS).
//!
//! Prints compact inventory stickers: a QR code carrying the SKU (for scanner
//! lookups) on the left, human-readable SKU / name / weight / karat / storage
//! location on the right.
//!
//! Two transports, mirroring the receipt printer:
//!   • TCP 9100 (AppSocket / JetDirect) — stream bytes to a network label printer.
//!   • System queue — write a temp file and hand it to CUPS via
//!     `lpr -P <printer> -o raw <file>` (the `-o raw` keeps CUPS from trying to
//!     re-render our ZPL/ESC-POS as a document).
//!
//! Two dialects: ZPL (Zebra/compatible) and ESC/POS (Epson-style label mode).
//! `print_label` takes a batch so "Alle Etiketten drucken" is one IPC call.

use serde::Deserialize;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tokio::time::{Duration, timeout};

use crate::config::{self, DEFAULT_TCP_TIMEOUT_MS};
use crate::error::{HardwareError, HwResult};
use crate::mock::printer_mock;

/// One product's sticker payload.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelData {
    pub sku: String,
    pub product_name: String,
    /// Decimal grams as a string (e.g. "14.5000"); None when not a metal item.
    pub weight_grams: Option<String>,
    /// Karat or fineness, e.g. "750" or "18K".
    pub karat: Option<String>,
    /// Lagerort coordinates, e.g. "Tresor-1 / Fach-3".
    pub storage_location: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum LabelPrinterType {
    Zpl,
    Escpos,
}

/// Printer configuration sent from the hardware store.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelConfig {
    /// "tcp" | "system".
    pub mode: String,
    pub ip: Option<String>,
    pub port: Option<u16>,
    pub printer_name: Option<String>,
    pub printer_type: LabelPrinterType,
}

/// Print a batch of labels. Returns the number of labels dispatched.
#[tauri::command]
pub async fn print_label(config: LabelConfig, labels: Vec<LabelData>) -> HwResult<u32> {
    if labels.is_empty() {
        return Err(HardwareError::InvalidArgument("no labels to print".into()));
    }

    let bytes = match config.printer_type {
        LabelPrinterType::Zpl => build_zpl(&labels),
        LabelPrinterType::Escpos => build_escpos(&labels),
    };

    if config::is_mock_mode() {
        printer_mock::print_label(&config, labels.len(), &bytes).await?;
        return Ok(labels.len() as u32);
    }

    match config.mode.as_str() {
        "tcp" => {
            let ip = config
                .ip
                .ok_or_else(|| HardwareError::NotConfigured("label printer IP not set".into()))?;
            let port = config.port.unwrap_or(9100);
            send_tcp(&ip, port, &bytes).await?;
        }
        "system" => {
            let printer = config
                .printer_name
                .ok_or_else(|| HardwareError::NotConfigured("label printer name not set".into()))?;
            send_system(&printer, &bytes).await?;
        }
        other => {
            return Err(HardwareError::InvalidArgument(format!(
                "unknown label printer mode: {other}"
            )));
        }
    }

    Ok(labels.len() as u32)
}

// ────────────────────────────────────────────────────────────────────────
// Transports
// ────────────────────────────────────────────────────────────────────────

async fn send_tcp(ip: &str, port: u16, bytes: &[u8]) -> HwResult<()> {
    let addr = format!("{ip}:{port}");
    let mut stream = timeout(
        Duration::from_millis(DEFAULT_TCP_TIMEOUT_MS),
        TcpStream::connect(&addr),
    )
    .await
    .map_err(HardwareError::from)??;
    stream.write_all(bytes).await?;
    stream.flush().await?;
    Ok(())
}

async fn send_system(printer_name: &str, bytes: &[u8]) -> HwResult<()> {
    // CUPS reads from a path; `-o raw` stops it re-rendering our control bytes.
    let tmp = std::env::temp_dir().join(format!("warehouse14-label-{}.bin", uuid::Uuid::new_v4()));
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
        return Err(HardwareError::Device(format!("lpr exited with {:?}", status.code())));
    }
    Ok(())
}

// ────────────────────────────────────────────────────────────────────────
// ZPL builder (Zebra)
// ────────────────────────────────────────────────────────────────────────

/// `^` and `~` are ZPL control prefixes — strip them from user data.
fn zpl_sanitize(s: &str) -> String {
    s.replace(['^', '~'], " ")
}

fn build_zpl(labels: &[LabelData]) -> Vec<u8> {
    let mut out = String::with_capacity(labels.len() * 320);
    for label in labels {
        let sku = zpl_sanitize(&label.sku);
        let name = zpl_sanitize(&truncate(&label.product_name, 24));
        let weight = label.weight_grams.as_deref().unwrap_or("-");
        let karat = label.karat.as_deref().unwrap_or("-");
        let location = zpl_sanitize(label.storage_location.as_deref().unwrap_or("-"));

        // ~50 mm x ~30 mm sticker at 8 dots/mm. QR left, text right.
        out.push_str("^XA\n");
        out.push_str("^CI28\n"); // UTF-8 input
        // QR with the SKU (M error correction, Automatic input mode).
        out.push_str(&format!("^FO20,20^BQN,2,5^FDMA,{sku}^FS\n"));
        // Text column.
        out.push_str(&format!("^FO180,20^A0N,30,30^FD{sku}^FS\n"));
        out.push_str(&format!("^FO180,58^A0N,26,26^FD{name}^FS\n"));
        out.push_str(&format!("^FO180,90^A0N,24,24^FD{weight} g · {karat}^FS\n"));
        out.push_str(&format!("^FO180,120^A0N,22,22^FDLager: {location}^FS\n"));
        out.push_str("^XZ\n");
    }
    out.into_bytes()
}

// ────────────────────────────────────────────────────────────────────────
// ESC/POS builder (Epson-style label mode) — feeds lines, never full-cuts.
// ────────────────────────────────────────────────────────────────────────

const ESC: u8 = 0x1B;
const GS: u8 = 0x1D;

fn build_escpos(labels: &[LabelData]) -> Vec<u8> {
    let mut b = Vec::with_capacity(labels.len() * 256);
    b.extend_from_slice(&[ESC, b'@']); // init
    b.extend_from_slice(&[ESC, b't', 19]); // PC858 (Euro + umlauts)

    for label in labels {
        // QR (SKU) centred, then left-aligned text rows.
        b.extend_from_slice(&[ESC, b'a', 1]); // center
        qr_code(&mut b, &label.sku);
        b.extend_from_slice(&[ESC, b'a', 0]); // left

        b.extend_from_slice(&[ESC, b'E', 1]); // bold on
        text_line(&mut b, &label.sku);
        b.extend_from_slice(&[ESC, b'E', 0]); // bold off
        text_line(&mut b, &truncate(&label.product_name, 32));

        let weight = label.weight_grams.as_deref().unwrap_or("-");
        let karat = label.karat.as_deref().unwrap_or("-");
        text_line(&mut b, &format!("{weight} g  ·  {karat}"));
        text_line(
            &mut b,
            &format!("Lager: {}", label.storage_location.as_deref().unwrap_or("-")),
        );

        // Feed past the label gap — NO cut (sticker rolls aren't cut per label).
        b.extend_from_slice(&[ESC, b'd', 4]);
    }
    b
}

fn text_line(out: &mut Vec<u8>, s: &str) {
    out.extend_from_slice(s.as_bytes());
    out.push(b'\n');
}

/// QR via the GS ( k ESC/POS extension (same encoding the receipt printer uses).
fn qr_code(out: &mut Vec<u8>, payload: &str) {
    let p = payload.as_bytes();
    out.extend_from_slice(&[GS, b'(', b'k', 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]); // model 2
    out.extend_from_slice(&[GS, b'(', b'k', 0x03, 0x00, 0x31, 0x43, 0x05]); // module size 5
    out.extend_from_slice(&[GS, b'(', b'k', 0x03, 0x00, 0x31, 0x45, 0x31]); // ECC level M
    let plen = p.len() + 3;
    out.extend_from_slice(&[GS, b'(', b'k', (plen & 0xFF) as u8, ((plen >> 8) & 0xFF) as u8, 0x31, 0x50, 0x30]);
    out.extend_from_slice(p);
    out.extend_from_slice(&[GS, b'(', b'k', 0x03, 0x00, 0x31, 0x51, 0x30]); // print
    out.push(b'\n');
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max - 1).chain(std::iter::once('…')).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> LabelData {
        LabelData {
            sku: "W14-AU-750-0012".into(),
            product_name: "Ring Gelbgold mit Brillant".into(),
            weight_grams: Some("14.5000".into()),
            karat: Some("750".into()),
            storage_location: Some("Tresor-1 / Fach-3".into()),
        }
    }

    #[test]
    fn zpl_has_required_commands_and_sku() {
        let zpl = String::from_utf8(build_zpl(&[sample()])).unwrap();
        assert!(zpl.contains("^XA") && zpl.contains("^XZ"));
        assert!(zpl.contains("^BQN")); // QR block
        assert!(zpl.contains("^A0N")); // font
        assert!(zpl.contains("^FDMA,W14-AU-750-0012")); // QR carries the SKU
        assert!(zpl.contains("Lager: Tresor-1 / Fach-3"));
    }

    #[test]
    fn zpl_strips_control_prefixes_from_data() {
        let mut s = sample();
        s.product_name = "Evil^~Name".into();
        let zpl = String::from_utf8(build_zpl(&[s])).unwrap();
        assert!(!zpl.contains("Evil^~"));
    }

    #[test]
    fn escpos_inits_and_feeds_without_cut() {
        let bytes = build_escpos(&[sample()]);
        assert_eq!(&bytes[0..2], &[ESC, b'@']); // init
        // No full-cut sequence (GS V).
        assert!(!bytes.windows(2).any(|w| w == [GS, b'V']));
        // Contains the SKU text.
        assert!(bytes.windows(15).any(|w| w == b"W14-AU-750-0012"));
    }

    #[test]
    fn batch_emits_one_block_per_label() {
        let zpl = String::from_utf8(build_zpl(&[sample(), sample(), sample()])).unwrap();
        assert_eq!(zpl.matches("^XA").count(), 3);
    }
}
