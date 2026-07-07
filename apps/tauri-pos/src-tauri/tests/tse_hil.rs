//! Hardware-in-the-loop: TSE fiscal signing via the Fiskaly Cloud HTTP API.
//!
//! NO FACADE. These tests drive the production commands `tse_start_transaction`
//! / `tse_finish_transaction` (mock mode OFF) against an in-repo HTTP server
//! that VALIDATES the actual request before answering:
//!   - non-empty `Authorization: Bearer …` and a non-empty TSS-ID in the path
//!   - PUT carries `state: ACTIVE`
//!   - PATCH carries `state: FINISHED`, an `amount > 0`, and a
//!     `payment_type ∈ {Bar, Unbar}`
//!
//! and returns a signature block with a MONOTONIC counter. The empty-config
//! path is asserted against the REAL `validate_config` (NotConfigured).
//!
//! `WAREHOUSE14_FISKALY_BASE_URL` + `WAREHOUSE14_MOCK_HARDWARE` are global, so
//! every test holds `SERIAL` for its whole body. The TseConfig always carries a
//! non-empty api_key + api_secret so the real keychain is never touched.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex as AsyncMutex;

use warehouse14_tauri_pos_lib::commands::tse::{
    tse_finish_transaction, tse_start_transaction, TseConfig, TseFinishParams, TseStartParams,
};
use warehouse14_tauri_pos_lib::error::HardwareError;

static SERIAL: AsyncMutex<()> = AsyncMutex::const_new(());

#[derive(Default)]
struct State {
    sig_counter: AtomicU64,
    tx_number: AtomicU64,
    /// Last PATCH's (amount, payment_type) — ground truth for assertions.
    last_finish: Mutex<Option<(String, String)>>,
}

fn header_value<'a>(headers: &'a str, name: &str) -> Option<&'a str> {
    headers.lines().find_map(|l| {
        let (k, v) = l.split_once(':')?;
        if k.trim().eq_ignore_ascii_case(name) {
            Some(v.trim())
        } else {
            None
        }
    })
}

fn find_subslice(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}

/// Validate one request and produce `(status_line, json_body)`.
fn route(headers: &str, body: &[u8], state: &State) -> (&'static str, String) {
    let mut lines = headers.lines();
    let request_line = lines.next().unwrap_or("");
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");

    // Auth: non-empty bearer token.
    let bearer_ok = header_value(headers, "authorization")
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|t| !t.trim().is_empty())
        .unwrap_or(false);
    if !bearer_ok {
        return ("401 Unauthorized", r#"{"error":"missing bearer"}"#.into());
    }

    // Path: /tss/{tss}/tx/{tx} with a non-empty tss.
    let segs: Vec<&str> = path.split('/').collect();
    let tss = segs.get(2).copied().unwrap_or("");
    let tx = segs.get(4).copied().unwrap_or("");
    if tss.is_empty() {
        return ("400 Bad Request", r#"{"error":"empty tss id"}"#.into());
    }

    let json: Value = serde_json::from_slice(body).unwrap_or(Value::Null);

    match method {
        "PUT" => {
            if json.get("state").and_then(Value::as_str) != Some("ACTIVE") {
                return (
                    "400 Bad Request",
                    r#"{"error":"state must be ACTIVE"}"#.into(),
                );
            }
            ("200 OK", format!(r#"{{"_id":"fiskaly-tx-{tx}"}}"#))
        }
        "PATCH" => {
            if json.get("state").and_then(Value::as_str) != Some("FINISHED") {
                return (
                    "400 Bad Request",
                    r#"{"error":"state must be FINISHED"}"#.into(),
                );
            }
            let leg = json
                .pointer("/schema/standard_v1/receipt/amounts_per_payment_type/0")
                .cloned()
                .unwrap_or(Value::Null);
            let payment_type = leg
                .get("payment_type")
                .and_then(Value::as_str)
                .unwrap_or("");
            let amount = leg.get("amount").and_then(Value::as_str).unwrap_or("");
            if payment_type != "Bar" && payment_type != "Unbar" {
                return (
                    "400 Bad Request",
                    format!(r#"{{"error":"bad payment_type {payment_type}"}}"#),
                );
            }
            if amount.parse::<f64>().map(|a| a > 0.0) != Ok(true) {
                return (
                    "400 Bad Request",
                    format!(r#"{{"error":"amount not > 0: {amount}"}}"#),
                );
            }
            *state.last_finish.lock().unwrap() =
                Some((amount.to_string(), payment_type.to_string()));
            let counter = state.sig_counter.fetch_add(1, Ordering::SeqCst) + 1;
            let number = state.tx_number.fetch_add(1, Ordering::SeqCst) + 1;
            (
                "200 OK",
                format!(
                    r#"{{"number":{number},"time_start":"2026-06-05T12:00:00Z","time_end":"2026-06-05T12:00:02Z","qr_code_data":"DE-TSE-QR;c={counter}","signature":{{"value":"c2lnLXt9","counter":{counter},"algorithm":"ecdsa-plain-SHA256"}}}}"#
                ),
            )
        }
        _ => ("405 Method Not Allowed", r#"{"error":"method"}"#.into()),
    }
}

async fn spawn_fiskaly(state: Arc<State>) -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (mut sock, _) = match listener.accept().await {
                Ok(c) => c,
                Err(_) => break,
            };
            let st = state.clone();
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut tmp = [0u8; 2048];
                // Read headers, then the Content-Length body.
                loop {
                    let n = sock.read(&mut tmp).await.unwrap_or(0);
                    if n == 0 {
                        return;
                    }
                    buf.extend_from_slice(&tmp[..n]);
                    if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
                        let head_end = pos + 4;
                        let headers = String::from_utf8_lossy(&buf[..pos]).to_string();
                        let clen = header_value(&headers, "content-length")
                            .and_then(|v| v.parse::<usize>().ok())
                            .unwrap_or(0);
                        while buf.len() < head_end + clen {
                            let n = sock.read(&mut tmp).await.unwrap_or(0);
                            if n == 0 {
                                break;
                            }
                            buf.extend_from_slice(&tmp[..n]);
                        }
                        let body = &buf[head_end..(head_end + clen).min(buf.len())];
                        let (status, json) = route(&headers, body, &st);
                        let resp = format!(
                            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{json}",
                            json.len()
                        );
                        let _ = sock.write_all(resp.as_bytes()).await;
                        let _ = sock.flush().await;
                        return;
                    }
                }
            });
        }
    });
    addr
}

fn cfg(tss_id: &str) -> TseConfig {
    TseConfig {
        tss_id: tss_id.to_string(),
        client_id: "client-1".into(),
        // Non-empty so hydrate_secrets_from_keyring never reads the OS keychain.
        api_key: "test-bearer-key".into(),
        api_secret: "test-secret".into(),
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn start_then_finish_carries_correct_amount_and_payment_type() {
    let _g = SERIAL.lock().await;
    let state = Arc::new(State::default());
    let addr = spawn_fiskaly(state.clone()).await;
    std::env::set_var("WAREHOUSE14_MOCK_HARDWARE", "0");
    std::env::set_var("WAREHOUSE14_FISKALY_BASE_URL", format!("http://{addr}"));

    let intention = tse_start_transaction(TseStartParams {
        config: cfg("tss-1"),
        intention_id: "intent-1".into(),
        process_type: "Kassenbeleg-V1".into(),
    })
    .await
    .expect("start should open an intention");
    assert_eq!(intention.fiskaly_transaction_id, "fiskaly-tx-intent-1");

    let sig = tse_finish_transaction(TseFinishParams {
        config: cfg("tss-1"),
        intention_id: "intent-1".into(),
        fiskaly_transaction_id: intention.fiskaly_transaction_id.clone(),
        amount_cents: 12_345,
        payment_kind: "Bar".into(),
        process_data_base64: String::new(),
        process_type: "Kassenbeleg-V1".into(),
        amounts_per_vat_id: Vec::new(),
    })
    .await
    .expect("finish should sign");

    assert_eq!(sig.signature_algorithm, "ecdsa-plain-SHA256");
    assert!(sig.signature_counter >= 1);
    assert!(sig.transaction_number >= 1);
    assert!(sig.qr_code_payload.contains("DE-TSE-QR"));

    // GROUND TRUTH: the request actually carried 123.45 / Bar.
    let (amount, payment_type) = state.last_finish.lock().unwrap().clone().expect("a finish");
    assert_eq!(amount, "123.45", "format_cents(12345) must be 123.45");
    assert_eq!(payment_type, "Bar");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn signature_counter_is_monotonic_across_two_sales() {
    let _g = SERIAL.lock().await;
    let state = Arc::new(State::default());
    let addr = spawn_fiskaly(state.clone()).await;
    std::env::set_var("WAREHOUSE14_MOCK_HARDWARE", "0");
    std::env::set_var("WAREHOUSE14_FISKALY_BASE_URL", format!("http://{addr}"));

    let mk = |id: &str| TseFinishParams {
        config: cfg("tss-1"),
        intention_id: id.into(),
        fiskaly_transaction_id: format!("fiskaly-tx-{id}"),
        amount_cents: 5_000,
        payment_kind: "Unbar".into(),
        process_data_base64: String::new(),
        process_type: "Kassenbeleg-V1".into(),
        amounts_per_vat_id: Vec::new(),
    };

    let first = tse_finish_transaction(mk("a")).await.expect("sign a");
    let second = tse_finish_transaction(mk("b")).await.expect("sign b");
    assert!(
        second.signature_counter > first.signature_counter,
        "counter must advance: {} !> {}",
        second.signature_counter,
        first.signature_counter
    );
    assert!(second.transaction_number > first.transaction_number);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn empty_tss_id_is_rejected_as_not_configured() {
    let _g = SERIAL.lock().await;
    std::env::set_var("WAREHOUSE14_MOCK_HARDWARE", "0");
    std::env::set_var("WAREHOUSE14_FISKALY_BASE_URL", "http://127.0.0.1:1"); // never reached

    let err = tse_start_transaction(TseStartParams {
        config: cfg(""), // empty TSS-ID
        intention_id: "intent-x".into(),
        process_type: "Kassenbeleg-V1".into(),
    })
    .await
    .expect_err("empty config must NOT silently sign");
    assert!(
        matches!(err, HardwareError::NotConfigured(_)),
        "expected NotConfigured, got {err:?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn server_rejected_request_surfaces_as_device_error() {
    let _g = SERIAL.lock().await;
    let state = Arc::new(State::default());
    let addr = spawn_fiskaly(state.clone()).await;
    std::env::set_var("WAREHOUSE14_MOCK_HARDWARE", "0");
    std::env::set_var("WAREHOUSE14_FISKALY_BASE_URL", format!("http://{addr}"));

    // payment_kind the TSE doesn't recognise → server 400 → command Device error.
    let err = tse_finish_transaction(TseFinishParams {
        config: cfg("tss-1"),
        intention_id: "intent-1".into(),
        fiskaly_transaction_id: "fiskaly-tx-intent-1".into(),
        amount_cents: 100,
        payment_kind: "Krypto".into(),
        process_data_base64: String::new(),
        process_type: "Kassenbeleg-V1".into(),
        amounts_per_vat_id: Vec::new(),
    })
    .await
    .expect_err("an out-of-spec payment_type must surface an error");
    assert!(
        matches!(err, HardwareError::Device(_)),
        "expected Device(4xx), got {err:?}"
    );
}
