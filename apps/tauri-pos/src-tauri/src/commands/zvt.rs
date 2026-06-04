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
    // Default 75 s; `WAREHOUSE14_ZVT_READ_TIMEOUT_MS` lets the HIL tests shrink it.
    let mut buf = vec![0u8; 1024];
    let n = timeout(
        Duration::from_millis(config::zvt_read_timeout_ms()),
        stream.read(&mut buf),
    )
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
///
/// `pub` so the HIL test server + the hardened mock validate against the SAME
/// canonical frame (no mock-vs-real divergence).
pub fn build_authorisation_frame(amount_cents: u64) -> Vec<u8> {
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

/// CRC-CCITT-16 (XModem polynomial 0x1021), seed 0x0000. `pub` for HIL tests.
pub fn crc_ccitt(data: &[u8]) -> u16 {
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

/// Independently validate + decode the amount from a `06 01` authorisation
/// frame produced by [`build_authorisation_frame`]. Used by the HIL test server
/// and the mock self-check — it re-derives everything (header, the 0x04 6-byte
/// BCD amount TLV, and the trailing CRC-CCITT) so it catches a builder
/// regression instead of rubber-stamping it. Returns the decoded cents, or a
/// human-readable description of the first protocol violation.
pub fn parse_auth_frame_amount(frame: &[u8]) -> Result<u64, String> {
    if frame.len() < 5 {
        return Err(format!("frame too short: {}b", frame.len()));
    }
    if frame[0] != 0x06 {
        return Err(format!("bad CLASS {:#04x} (want 0x06)", frame[0]));
    }
    if frame[1] != 0x01 {
        return Err(format!("bad INS {:#04x} (want 0x01)", frame[1]));
    }
    let declared = frame[2] as usize;
    // Layout: [06][01][LEN][..payload(LEN)..][crc_lo][crc_hi]
    if frame.len() != 3 + declared + 2 {
        return Err(format!(
            "length mismatch: header declares {declared}b payload, frame carries {}b",
            frame.len().saturating_sub(5)
        ));
    }
    let body = &frame[..frame.len() - 2];
    let got_crc = u16::from(frame[frame.len() - 2]) | (u16::from(frame[frame.len() - 1]) << 8);
    let want_crc = crc_ccitt(body);
    if got_crc != want_crc {
        return Err(format!("CRC mismatch: got {got_crc:#06x}, want {want_crc:#06x}"));
    }
    // Scan the payload TLVs (after the 3-byte header) for the amount tag 0x04.
    let payload = &frame[3..3 + declared];
    let mut i = 0;
    while i + 2 <= payload.len() {
        let tag = payload[i];
        let len = payload[i + 1] as usize;
        if i + 2 + len > payload.len() {
            return Err("truncated TLV in payload".into());
        }
        if tag == 0x04 {
            let val = &payload[i + 2..i + 2 + len];
            if val.len() != 6 {
                return Err(format!("amount TLV is {}b BCD (want 6)", val.len()));
            }
            return Ok(bcd_to_u64(val));
        }
        i += 2 + len;
    }
    Err("amount TLV (tag 0x04) not found".into())
}

/// Decode big-endian packed BCD into an integer (inverse of `bcd_amount`).
fn bcd_to_u64(bcd: &[u8]) -> u64 {
    let mut n = 0u64;
    for &b in bcd {
        n = n * 100 + u64::from((b >> 4) * 10 + (b & 0x0F));
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Published CRC-CCITT/XMODEM check value for "123456789" is 0x31C3.
    /// Pins our `crc_ccitt` against an INDEPENDENT reference vector (not the
    /// builder), so a CRC regression can't hide.
    #[test]
    fn crc_ccitt_matches_xmodem_reference_vector() {
        assert_eq!(crc_ccitt(b"123456789"), 0x31C3);
    }

    #[test]
    fn auth_frame_has_correct_header_and_bcd_amount() {
        let frame = build_authorisation_frame(12_345);
        // [CLASS 06][INS 01][LEN 0x0B][04 06 <000000012345 BCD>][cur 49 09 78][crc lo hi]
        assert_eq!(
            &frame[..14],
            &[0x06, 0x01, 0x0B, 0x04, 0x06, 0x00, 0x00, 0x00, 0x01, 0x23, 0x45, 0x49, 0x09, 0x78]
        );
        let crc = crc_ccitt(&frame[..14]);
        assert_eq!(frame[14], (crc & 0xFF) as u8);
        assert_eq!(frame[15], ((crc >> 8) & 0xFF) as u8);
    }

    #[test]
    fn independent_decoder_roundtrips_amounts() {
        for cents in [1u64, 99, 100, 12_345, 999_999_999_999] {
            let frame = build_authorisation_frame(cents);
            assert_eq!(parse_auth_frame_amount(&frame), Ok(cents), "cents={cents}");
        }
    }

    #[test]
    fn decoder_rejects_corrupted_crc() {
        let mut frame = build_authorisation_frame(5_000);
        let last = frame.len() - 1;
        frame[last] ^= 0xFF; // corrupt the CRC high byte
        assert!(parse_auth_frame_amount(&frame).unwrap_err().contains("CRC"));
    }

    /// mock-vs-real PARITY: the hardened mock builds its on-wire frame via the
    /// SAME canonical builder, so the two cannot drift apart.
    #[test]
    fn mock_and_real_agree_on_the_frame() {
        for cents in [1u64, 4_200, 12_345] {
            assert_eq!(
                crate::mock::zvt_mock::authorisation_frame_for_test(cents),
                build_authorisation_frame(cents),
                "cents={cents}"
            );
        }
    }
}
