//! Mandate 2-B — ZVT card terminal over TCP.
//!
//! ZVT 1.10 is the German Kreditwirtschaft protocol every Ingenico /
//! Verifone / VeriFone / VR-Pay terminal speaks. We use the network
//! transport (port 20007 by convention) because all recent terminals
//! ship with Ethernet — USB-serial belongs in Phase 1.5.
//!
//! The protocol is a CCITT-style framing:
//!   - APDU = [CLASS, INS, LENGTH, ...payload..., CRC-CCITT(low), CRC-CCITT(high)]
//!   - Status codes mirror ISO 8583 — `0x00 0x00` = OK, anything else = decline.
//!
//! V1 implements two operations: Authorisation (06 01) and Reversal (06 30).
//! The mock returns plausible auth codes after a 2-3 s delay so the UI flow
//! is exercised without a terminal.

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

use crate::config::{self, DEFAULT_TCP_TIMEOUT_MS};
use crate::error::{HardwareError, HwResult};
use crate::mock::zvt_mock;

/// IP + port pulled from the Hardware tab; never trusted from React.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ZvtEndpoint {
    pub ip: String,
    pub port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ZvtResult {
    pub success: bool,
    pub authorization_code: Option<String>,
    /// Masked PAN, e.g. `****1234`. Never the full PAN.
    pub card_pan_masked: Option<String>,
    pub card_brand: Option<String>,
    /// Free-form receipt text the terminal prints — we surface it on the
    /// thermal receipt too.
    pub receipt_text: Option<String>,
    pub error_message: Option<String>,
}

/// Quick TCP probe — open a connection, close it. Drives the green/red badge.
#[tauri::command]
pub async fn zvt_check_connection(endpoint: ZvtEndpoint) -> HwResult<bool> {
    if config::is_mock_mode() {
        return zvt_mock::check_connection(endpoint).await;
    }
    let addr = format!("{}:{}", endpoint.ip, endpoint.port);
    let conn = timeout(
        Duration::from_millis(DEFAULT_TCP_TIMEOUT_MS),
        TcpStream::connect(&addr),
    )
    .await;
    match conn {
        Ok(Ok(_stream)) => Ok(true),
        Ok(Err(_)) | Err(_) => Ok(false),
    }
}

/// Authorize a card payment for `amount_cents`. Blocks the terminal until
/// the cardholder confirms — the React layer must open a ZvtSpinner modal.
#[tauri::command]
pub async fn zvt_authorize_payment(
    endpoint: ZvtEndpoint,
    amount_cents: u64,
) -> HwResult<ZvtResult> {
    if config::is_mock_mode() {
        return zvt_mock::authorize_payment(endpoint, amount_cents).await;
    }

    let addr = format!("{}:{}", endpoint.ip, endpoint.port);
    let mut stream = timeout(
        Duration::from_millis(DEFAULT_TCP_TIMEOUT_MS),
        TcpStream::connect(&addr),
    )
    .await
    .map_err(HardwareError::from)??;

    let frame = build_authorisation_frame(amount_cents);
    stream.write_all(&frame).await?;
    stream.flush().await?;

    // Cardholder interaction can take up to 60 s — use a deliberately
    // looser read timeout here (separate from the 5 s connect timeout).
    let mut buf = vec![0u8; 1024];
    let n = timeout(Duration::from_secs(75), stream.read(&mut buf))
        .await
        .map_err(HardwareError::from)??;
    buf.truncate(n);

    parse_authorisation_response(&buf)
}

/// Reverse a previously-authorized payment (e.g. operator pressed "Storno"
/// before the receipt printed). The terminal voids the auth.
#[tauri::command]
pub async fn zvt_reverse_payment(
    endpoint: ZvtEndpoint,
    authorization_code: String,
) -> HwResult<bool> {
    if config::is_mock_mode() {
        return zvt_mock::reverse_payment(endpoint, authorization_code).await;
    }

    let addr = format!("{}:{}", endpoint.ip, endpoint.port);
    let mut stream = timeout(
        Duration::from_millis(DEFAULT_TCP_TIMEOUT_MS),
        TcpStream::connect(&addr),
    )
    .await
    .map_err(HardwareError::from)??;

    let frame = build_reversal_frame(&authorization_code);
    stream.write_all(&frame).await?;
    stream.flush().await?;

    let mut buf = vec![0u8; 256];
    let n = timeout(Duration::from_secs(30), stream.read(&mut buf))
        .await
        .map_err(HardwareError::from)??;
    buf.truncate(n);

    // Bytes 6-7 are the status — 00 00 = ok.
    Ok(buf.len() >= 8 && buf[6] == 0x00 && buf[7] == 0x00)
}

// ────────────────────────────────────────────────────────────────────────
// ZVT framing — kept deliberately small. V1 supports cents up to 8 digits.
// ────────────────────────────────────────────────────────────────────────

/// Build a `06 01` Authorisation APDU. Amount is BCD-encoded, 6 bytes
/// (cents), big-endian per ZVT 1.10 §8.
fn build_authorisation_frame(amount_cents: u64) -> Vec<u8> {
    let bcd = bcd_amount(amount_cents);
    let mut payload = Vec::with_capacity(16);
    payload.extend_from_slice(&[0x04, 0x06]); // TLV: amount tag
    payload.extend_from_slice(&bcd); // 6 bytes BCD
    payload.extend_from_slice(&[0x49, 0x09, 0x78]); // currency = EUR (978) BCD

    // APDU prefix: CLASS 06, INS 01, LENGTH, ...
    let mut frame = Vec::with_capacity(payload.len() + 5);
    frame.push(0x06);
    frame.push(0x01);
    frame.push(payload.len() as u8);
    frame.extend_from_slice(&payload);
    let crc = crc_ccitt(&frame);
    frame.push((crc & 0xFF) as u8);
    frame.push(((crc >> 8) & 0xFF) as u8);
    frame
}

/// Build a `06 30` Reversal APDU referencing `authorization_code` (4-byte
/// BCD per ZVT). V1 ignores partial-reversal amounts (always full void).
fn build_reversal_frame(authorization_code: &str) -> Vec<u8> {
    let mut payload = Vec::with_capacity(8);
    payload.extend_from_slice(&[0x87, 0x04]); // TLV: receipt-no tag
    // Pack the 4-digit auth code as BCD; pad short codes with leading zeros.
    let padded: String = if authorization_code.len() >= 4 {
        authorization_code[authorization_code.len() - 4..].to_string()
    } else {
        format!("{:04}", authorization_code.parse::<u32>().unwrap_or(0))
    };
    payload.extend_from_slice(&bcd_from_str(&padded));

    let mut frame = Vec::with_capacity(payload.len() + 5);
    frame.push(0x06);
    frame.push(0x30);
    frame.push(payload.len() as u8);
    frame.extend_from_slice(&payload);
    let crc = crc_ccitt(&frame);
    frame.push((crc & 0xFF) as u8);
    frame.push(((crc >> 8) & 0xFF) as u8);
    frame
}

/// Parse the terminal's `04 0F` Completion APDU. We pull out the auth code,
/// masked PAN, and brand from the TLV body.
fn parse_authorisation_response(buf: &[u8]) -> HwResult<ZvtResult> {
    if buf.len() < 4 {
        return Err(HardwareError::Device(format!(
            "ZVT response too short: {}b",
            buf.len()
        )));
    }
    // Status bytes are typically at offsets 4-5 in the response.
    let success = buf.len() >= 6 && buf[4] == 0x00 && buf[5] == 0x00;
    if !success {
        return Ok(ZvtResult {
            success: false,
            authorization_code: None,
            card_pan_masked: None,
            card_brand: None,
            receipt_text: None,
            error_message: Some(format!(
                "Terminal lehnte ab (status {:#04x} {:#04x})",
                buf.get(4).copied().unwrap_or(0xFF),
                buf.get(5).copied().unwrap_or(0xFF),
            )),
        });
    }

    // Look for the well-known TLV tags; failure to find one isn't fatal —
    // some terminals omit the brand for unbranded debit cards.
    let auth_code = find_tlv(buf, 0x60).map(|v| hex_string(&v));
    let pan = find_tlv(buf, 0x22)
        .map(|v| {
            // ZVT delivers masked PAN as ASCII digits + stars.
            String::from_utf8_lossy(&v).into_owned()
        })
        .map(mask_to_last_four);
    let brand = find_tlv(buf, 0x8A).and_then(|v| String::from_utf8(v).ok());
    let receipt = find_tlv(buf, 0x3C).and_then(|v| String::from_utf8(v).ok());

    Ok(ZvtResult {
        success: true,
        authorization_code: auth_code,
        card_pan_masked: pan,
        card_brand: brand,
        receipt_text: receipt,
        error_message: None,
    })
}

fn bcd_amount(cents: u64) -> Vec<u8> {
    let s = format!("{:012}", cents); // 12 nibbles → 6 bytes
    bcd_from_str(&s)
}

fn bcd_from_str(s: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len() / 2);
    let bytes = s.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        let hi = bytes[i].saturating_sub(b'0');
        let lo = bytes[i + 1].saturating_sub(b'0');
        out.push((hi << 4) | (lo & 0x0F));
        i += 2;
    }
    out
}

/// Find a TLV(tag, ...) sequence in the payload. Returns the value bytes
/// or `None` if absent. Naive scan — fine for our small APDUs.
fn find_tlv(buf: &[u8], tag: u8) -> Option<Vec<u8>> {
    let mut i = 3; // skip CLASS/INS/LENGTH
    while i + 2 < buf.len() {
        let t = buf[i];
        let len = buf[i + 1] as usize;
        if i + 2 + len > buf.len() {
            return None;
        }
        if t == tag {
            return Some(buf[i + 2..i + 2 + len].to_vec());
        }
        i += 2 + len;
    }
    None
}

/// CRC-CCITT-16 (XModem polynomial 0x1021), seed 0x0000.
fn crc_ccitt(data: &[u8]) -> u16 {
    let mut crc: u16 = 0x0000;
    for &b in data {
        crc ^= (b as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    crc
}

fn hex_string(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect()
}

/// Reduce `1234********5678` → `****5678`. PCI: the full PAN must never
/// reach React; we keep only the last 4 digits.
fn mask_to_last_four(pan: String) -> String {
    let digits: String = pan.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() < 4 {
        "****".into()
    } else {
        format!("****{}", &digits[digits.len() - 4..])
    }
}
