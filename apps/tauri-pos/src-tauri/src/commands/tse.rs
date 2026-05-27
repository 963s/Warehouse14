//! Mandate 2-A — TSE (Technische Sicherheitseinrichtung) via Fiskaly Cloud.
//!
//! KassenSichV requires every fiscal record in a German POS to be signed by
//! a certified TSE. We use Fiskaly's cloud TSS — pure HTTPS, no USB stick.
//! See memory.md §18.4 for the state machine; this module owns the
//! INTENTION → TRANSACTION → FINISH transitions.
//!
//! Both commands respect mock mode — without a Fiskaly key, the dev build
//! returns fabricated-but-deterministic signatures so the UI can flow.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::config::{self, FISKALY_HTTP_TIMEOUT_MS};
use crate::error::{HardwareError, HwResult};
use crate::mock::{self, tse_mock};

// ────────────────────────────────────────────────────────────────────────
// Public IPC types — mirrored 1:1 in `hardware-client.ts`.
// ────────────────────────────────────────────────────────────────────────

/// Caller-supplied config — pulled from the Hardware tab in Einstellungen.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
// `api_secret` is part of the wire contract — the React side sends both
// halves of the Fiskaly credential pair even though V1 only uses the
// long-lived bearer key. V1.1 will exchange (key, secret) for a short-lived
// access token via /api/v2/auth, at which point `api_secret` lights up.
#[allow(dead_code)]
pub struct TseConfig {
    /// Fiskaly TSS UUID. Empty / missing = "not configured" → mock or error.
    pub tss_id: String,
    /// Fiskaly Client UUID (one per terminal).
    pub client_id: String,
    /// Long-lived API key — stored encrypted in `system_settings`,
    /// decrypted only inside Rust before this call.
    pub api_key: String,
    pub api_secret: String,
}

/// Process type per Fiskaly spec. V1 only emits `Kassenbeleg-V1` (cash sale).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TseStartParams {
    pub config: TseConfig,
    /// Per-transaction nonce — the React layer generates it (uuidv4)
    /// so retries are idempotent.
    pub intention_id: String,
    /// `Kassenbeleg-V1` for a sale, `Bestellung-V1` for an Ankauf, etc.
    /// V1 ships `Kassenbeleg-V1` only.
    pub process_type: String,
}

/// Returned to React when INTENTION is opened. `intentionId` is the same
/// nonce the caller supplied — echoed so the React layer doesn't have to
/// keep a separate map.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TseIntention {
    pub intention_id: String,
    pub fiskaly_transaction_id: String,
    pub started_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
// `intention_id` + `process_data_base64` are part of the documented wire
// contract — React always sends them so the queue/audit can correlate
// even though the current Fiskaly v2 call doesn't echo them back.
#[allow(dead_code)]
pub struct TseFinishParams {
    pub config: TseConfig,
    pub intention_id: String,
    pub fiskaly_transaction_id: String,
    /// Amount in cents — the final sum that gets signed.
    pub amount_cents: u64,
    /// Payment type passed to Fiskaly: "Bar" / "Unbar" — KassenSichV
    /// distinguishes cash from card.
    pub payment_kind: String,
    /// Free-form process_data — Fiskaly accepts a 64 KiB blob; we pack
    /// the line-items + receipt locator in there.
    pub process_data_base64: String,
    pub process_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TseSignature {
    /// Base64-encoded ECDSA signature blob.
    pub signature_value: String,
    /// Monotonic per-TSS counter — required on the receipt.
    pub signature_counter: u64,
    pub signature_algorithm: String,
    /// Fiskaly's transaction number (monotonic per-TSS, separate from `signature_counter`).
    pub transaction_number: u64,
    pub started_at: DateTime<Utc>,
    pub finished_at: DateTime<Utc>,
    /// The QR-payload string we render on the receipt (Fiskaly TSE QR spec).
    pub qr_code_payload: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TseStatus {
    pub reachable: bool,
    pub tss_state: Option<String>,
    pub last_checked_at: DateTime<Utc>,
    pub message: String,
}

// ────────────────────────────────────────────────────────────────────────
// Commands
// ────────────────────────────────────────────────────────────────────────

/// Open a TSE intention — Fiskaly `PUT /tss/{tssId}/tx/{txId}` with the
/// state machine in `Active` state. The terminal must call `tse_finish_transaction`
/// before the transaction expires (Fiskaly default ≈ 24 h).
#[tauri::command]
pub async fn tse_start_transaction(params: TseStartParams) -> HwResult<TseIntention> {
    if config::is_mock_mode() {
        return tse_mock::start_transaction(params).await;
    }

    validate_config(&params.config)?;

    let url = format!(
        "{base}/tss/{tss}/tx/{tx}",
        base = config::fiskaly_base_url(),
        tss = params.config.tss_id,
        tx = params.intention_id,
    );

    let client = http_client()?;
    let body = serde_json::json!({
        "state": "ACTIVE",
        "client_id": params.config.client_id,
        "type": params.process_type,
    });

    let res = client
        .put(&url)
        .bearer_auth(&params.config.api_key) // pre-issued token; real impl exchanges secret for token
        .json(&body)
        .send()
        .await?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(HardwareError::Device(format!(
            "Fiskaly PUT /tx returned {status}: {text}"
        )));
    }

    let parsed: serde_json::Value = res.json().await?;
    let fiskaly_tx_id = parsed
        .get("_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| HardwareError::Device("Fiskaly response missing _id".into()))?
        .to_string();

    Ok(TseIntention {
        intention_id: params.intention_id,
        fiskaly_transaction_id: fiskaly_tx_id,
        started_at: Utc::now(),
    })
}

/// Finish a TSE transaction — Fiskaly `PATCH /tss/{tssId}/tx/{txId}` with
/// `state=FINISHED`. The response carries the signature counter + value
/// that must land on the printed receipt.
#[tauri::command]
pub async fn tse_finish_transaction(params: TseFinishParams) -> HwResult<TseSignature> {
    if config::is_mock_mode() {
        return tse_mock::finish_transaction(params).await;
    }

    validate_config(&params.config)?;

    let url = format!(
        "{base}/tss/{tss}/tx/{tx}",
        base = config::fiskaly_base_url(),
        tss = params.config.tss_id,
        tx = params.fiskaly_transaction_id,
    );

    let body = serde_json::json!({
        "state": "FINISHED",
        "client_id": params.config.client_id,
        "schema": {
            "standard_v1": {
                "receipt": {
                    "receipt_type": params.process_type,
                    "amounts_per_vat_id": [],
                    "amounts_per_payment_type": [
                        { "payment_type": params.payment_kind, "amount": format_cents(params.amount_cents) }
                    ]
                }
            }
        },
    });

    let res = http_client()?
        .patch(&url)
        .bearer_auth(&params.config.api_key)
        .json(&body)
        .send()
        .await?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(HardwareError::Device(format!(
            "Fiskaly PATCH /tx returned {status}: {text}"
        )));
    }

    let parsed: serde_json::Value = res.json().await?;
    let sig = parsed
        .get("signature")
        .ok_or_else(|| HardwareError::Device("Fiskaly response missing signature".into()))?;

    Ok(TseSignature {
        signature_value: sig.get("value").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        signature_counter: sig.get("counter").and_then(|v| v.as_u64()).unwrap_or(0),
        signature_algorithm: sig
            .get("algorithm")
            .and_then(|v| v.as_str())
            .unwrap_or("ecdsa-plain-SHA256")
            .to_string(),
        transaction_number: parsed.get("number").and_then(|v| v.as_u64()).unwrap_or(0),
        started_at: parsed
            .get("time_start")
            .and_then(|v| v.as_str())
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|t| t.with_timezone(&Utc))
            .unwrap_or_else(Utc::now),
        finished_at: parsed
            .get("time_end")
            .and_then(|v| v.as_str())
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|t| t.with_timezone(&Utc))
            .unwrap_or_else(Utc::now),
        qr_code_payload: parsed
            .get("qr_code_data")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

/// Cheap health-probe — does the Fiskaly endpoint answer + is the TSS in
/// state `INITIALIZED`? Drives the green/red TSE badge in the Gerätemanager.
#[tauri::command]
pub async fn tse_status(config: TseConfig) -> HwResult<TseStatus> {
    if crate::config::is_mock_mode() {
        return tse_mock::status(config).await;
    }

    if config.tss_id.is_empty() {
        return Ok(TseStatus {
            reachable: false,
            tss_state: None,
            last_checked_at: Utc::now(),
            message: "TSS-ID nicht konfiguriert".into(),
        });
    }

    let url = format!(
        "{base}/tss/{tss}",
        base = crate::config::fiskaly_base_url(),
        tss = config.tss_id,
    );
    let client = http_client()?;
    match client.get(&url).bearer_auth(&config.api_key).send().await {
        Ok(res) if res.status().is_success() => {
            let v: serde_json::Value = res.json().await.unwrap_or_default();
            Ok(TseStatus {
                reachable: true,
                tss_state: v.get("state").and_then(|v| v.as_str()).map(str::to_string),
                last_checked_at: Utc::now(),
                message: "TSE erreichbar".into(),
            })
        }
        Ok(res) => Ok(TseStatus {
            reachable: false,
            tss_state: None,
            last_checked_at: Utc::now(),
            message: format!("Fiskaly antwortet {}", res.status()),
        }),
        Err(e) => Ok(TseStatus {
            reachable: false,
            tss_state: None,
            last_checked_at: Utc::now(),
            message: format!("Verbindung fehlgeschlagen: {e}"),
        }),
    }
}

// ────────────────────────────────────────────────────────────────────────
// Private helpers
// ────────────────────────────────────────────────────────────────────────

fn validate_config(cfg: &TseConfig) -> HwResult<()> {
    if cfg.tss_id.is_empty() || cfg.api_key.is_empty() {
        return Err(HardwareError::NotConfigured(
            "TSE: TSS-ID oder API-Key fehlt".into(),
        ));
    }
    Ok(())
}

fn http_client() -> HwResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(FISKALY_HTTP_TIMEOUT_MS))
        .build()
        .map_err(HardwareError::from)
}

fn format_cents(cents: u64) -> String {
    let euros = cents / 100;
    let rest = cents % 100;
    format!("{euros}.{rest:02}")
}

// Suppress "unused" warnings on the `mock` import when building without
// any mock paths active — defensive; the import IS used via tse_mock::*.
#[allow(dead_code)]
fn _link_mock() {
    let _ = mock::mock_delay(0);
}
