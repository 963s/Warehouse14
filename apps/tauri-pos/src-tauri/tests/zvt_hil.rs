//! Hardware-in-the-loop: ZVT card-terminal authorisation over a REAL TCP socket.
//!
//! NO FACADE. These tests drive the production command `zvt_authorize_payment`
//! (mock mode OFF) against an in-repo TCP server that VALIDATES the on-wire
//! bytes against the ZVT spec before answering:
//!   - byte0 == 0x06 (CLASS), byte1 == 0x01 (INS, Authorisation)
//!   - the 0x04 amount TLV is a 6-byte BCD == the cents we asked to charge
//!   - the trailing CRC-CCITT is valid over the frame body
//!
//! and only then returns a realistic `04 0F` completion (approved/declined) or
//! exercises the error paths (peer EOF, silent hang → read timeout).
//!
//! Env (`WAREHOUSE14_MOCK_HARDWARE`, `WAREHOUSE14_ZVT_READ_TIMEOUT_MS`) is
//! process-global, so every test holds `SERIAL` for its whole body.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex as AsyncMutex;

use warehouse14_tauri_pos_lib::commands::zvt::{
    parse_auth_frame_amount, zvt_authorize_payment, ZvtEndpoint,
};
use warehouse14_tauri_pos_lib::error::HardwareError;

static SERIAL: AsyncMutex<()> = AsyncMutex::const_new(());

#[derive(Clone, Copy)]
enum Mode {
    Approved,
    Declined,
    Eof,
    Hang,
}

/// What the server actually received off the wire, for ground-truth assertions.
struct Captured {
    frame: Vec<u8>,
    decoded: Result<u64, String>,
}

fn tlv(tag: u8, val: &[u8]) -> Vec<u8> {
    let mut v = vec![tag, val.len() as u8];
    v.extend_from_slice(val);
    v
}

/// A realistic approved `04 0F` completion the production parser can read:
/// status `00 00` then TLVs 0x60 (auth code), 0x22 (masked PAN), 0x8A (brand),
/// 0x3C (receipt). The four leading zero bytes are the status field that the
/// parser reads at offsets 4-5 and walks past as empty TLVs.
fn approved_response() -> Vec<u8> {
    let mut payload = vec![0x00u8, 0x00, 0x00, 0x00];
    payload.extend(tlv(0x60, &[0xAB, 0xCD, 0xEF]));
    payload.extend(tlv(0x22, b"1234********5678"));
    payload.extend(tlv(0x8A, b"VISA"));
    payload.extend(tlv(0x3C, b"Zahlung genehmigt"));
    let mut frame = vec![0x04, 0x0F, payload.len() as u8];
    frame.extend(payload);
    frame
}

/// Declined: a non-`00 00` status (here 0x05 0x6C).
fn declined_response() -> Vec<u8> {
    vec![0x04, 0x0F, 0x03, 0x00, 0x05, 0x6C]
}

async fn spawn_server(mode: Mode) -> (SocketAddr, Arc<Mutex<Option<Captured>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let captured: Arc<Mutex<Option<Captured>>> = Arc::new(Mutex::new(None));
    let cap = captured.clone();
    tokio::spawn(async move {
        if let Ok((mut sock, _)) = listener.accept().await {
            let mut buf = vec![0u8; 512];
            let n = sock.read(&mut buf).await.unwrap_or(0);
            buf.truncate(n);
            let decoded = parse_auth_frame_amount(&buf);
            *cap.lock().unwrap() = Some(Captured {
                frame: buf,
                decoded,
            });
            match mode {
                Mode::Approved => {
                    let _ = sock.write_all(&approved_response()).await;
                    let _ = sock.flush().await;
                }
                Mode::Declined => {
                    let _ = sock.write_all(&declined_response()).await;
                    let _ = sock.flush().await;
                }
                Mode::Eof => {
                    drop(sock); // close without answering → peer reads 0 bytes
                }
                Mode::Hang => {
                    tokio::time::sleep(Duration::from_secs(30)).await; // never answer
                }
            }
        }
    });
    (addr, captured)
}

fn endpoint(addr: SocketAddr) -> ZvtEndpoint {
    ZvtEndpoint {
        ip: addr.ip().to_string(),
        port: addr.port(),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn approval_sends_spec_correct_frame_and_parses_completion() {
    let _g = SERIAL.lock().await;
    std::env::set_var("WAREHOUSE14_MOCK_HARDWARE", "0");
    std::env::set_var("WAREHOUSE14_ZVT_READ_TIMEOUT_MS", "5000");

    let (addr, captured) = spawn_server(Mode::Approved).await;
    let res = zvt_authorize_payment(endpoint(addr), 12_345)
        .await
        .expect("authorisation should resolve Ok");

    // Parsed completion carries the terminal's data.
    assert!(res.success, "expected approval, got {res:?}");
    assert_eq!(res.authorization_code.as_deref(), Some("ABCDEF"));
    assert_eq!(res.card_pan_masked.as_deref(), Some("****5678"));
    assert_eq!(res.card_brand.as_deref(), Some("VISA"));
    assert_eq!(res.receipt_text.as_deref(), Some("Zahlung genehmigt"));

    // GROUND TRUTH: the server validated a spec-correct frame carrying 12345.
    let cap = captured
        .lock()
        .unwrap()
        .take()
        .expect("server captured a frame");
    assert_eq!(
        cap.decoded,
        Ok(12_345),
        "server rejected the frame: {:02X?}",
        cap.frame
    );
    assert_eq!(cap.frame[0], 0x06, "CLASS");
    assert_eq!(cap.frame[1], 0x01, "INS auth");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn decline_surfaces_a_clean_unsuccessful_result() {
    let _g = SERIAL.lock().await;
    std::env::set_var("WAREHOUSE14_MOCK_HARDWARE", "0");
    std::env::set_var("WAREHOUSE14_ZVT_READ_TIMEOUT_MS", "5000");

    let (addr, captured) = spawn_server(Mode::Declined).await;
    let res = zvt_authorize_payment(endpoint(addr), 4_200)
        .await
        .expect("a decline is still a resolved command, not an Err");

    assert!(!res.success);
    assert!(res.error_message.is_some(), "decline must carry a message");
    assert!(res.authorization_code.is_none());
    // The frame the terminal saw was still spec-correct.
    let cap = captured.lock().unwrap().take().expect("captured");
    assert_eq!(cap.decoded, Ok(4_200));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn peer_eof_surfaces_a_device_error_without_panic() {
    let _g = SERIAL.lock().await;
    std::env::set_var("WAREHOUSE14_MOCK_HARDWARE", "0");
    std::env::set_var("WAREHOUSE14_ZVT_READ_TIMEOUT_MS", "5000");

    let (addr, _cap) = spawn_server(Mode::Eof).await;
    let err = zvt_authorize_payment(endpoint(addr), 100)
        .await
        .expect_err("a peer that closes must surface an error, not Ok");
    assert!(
        matches!(err, HardwareError::Device(_)),
        "expected Device(too short), got {err:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn silent_terminal_times_out_cleanly() {
    let _g = SERIAL.lock().await;
    std::env::set_var("WAREHOUSE14_MOCK_HARDWARE", "0");
    // Shrink the 75 s cardholder read-timeout so the hang path is provable fast.
    std::env::set_var("WAREHOUSE14_ZVT_READ_TIMEOUT_MS", "700");

    let (addr, _cap) = spawn_server(Mode::Hang).await;
    let start = Instant::now();
    let err = zvt_authorize_payment(endpoint(addr), 100)
        .await
        .expect_err("a silent terminal must time out, not hang forever");
    let elapsed = start.elapsed();

    assert!(
        matches!(err, HardwareError::Timeout(_)),
        "expected Timeout, got {err:?}"
    );
    assert!(
        elapsed < Duration::from_secs(5),
        "timeout hook did not apply (took {elapsed:?})"
    );
}
