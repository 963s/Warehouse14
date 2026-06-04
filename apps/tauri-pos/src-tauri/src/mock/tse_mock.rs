//! TSE mock — deterministic fake signatures so the UI can flow without
//! a real Fiskaly key. Each call increments a process-local counter so
//! repeated mock sales produce a believable sequence.

use std::sync::atomic::{AtomicU64, Ordering};

use chrono::Utc;

use crate::commands::tse::{
    TseConfig, TseFinishParams, TseIntention, TseSignature, TseStartParams, TseStatus,
};
use crate::error::{HardwareError, HwResult};
use crate::mock;

static MOCK_COUNTER: AtomicU64 = AtomicU64::new(1);
static MOCK_TX_NUMBER: AtomicU64 = AtomicU64::new(1);

/// NO FACADE: the mock must reject the SAME misconfiguration the real Fiskaly
/// path rejects in `commands::tse::validate_config`. Otherwise a no-credentials
/// operator gets a fabricated signature in dev/mock and only discovers the gap
/// on the first REAL sale at go-live. Mirrors the real check exactly.
fn validate_mock_config(cfg: &TseConfig) -> HwResult<()> {
    if cfg.tss_id.is_empty() || cfg.api_key.is_empty() {
        return Err(HardwareError::NotConfigured(
            "TSE: TSS-ID oder API-Key fehlt".into(),
        ));
    }
    Ok(())
}

pub async fn start_transaction(params: TseStartParams) -> HwResult<TseIntention> {
    validate_mock_config(&params.config)?;
    mock::mock_delay(450).await;
    mock::maybe_inject_failure("TSE start_transaction (mock)")?;

    Ok(TseIntention {
        intention_id: params.intention_id.clone(),
        fiskaly_transaction_id: format!("MOCK-TX-{}", params.intention_id),
        started_at: Utc::now(),
    })
}

pub async fn finish_transaction(params: TseFinishParams) -> HwResult<TseSignature> {
    validate_mock_config(&params.config)?;
    // A real TSE will not sign a zero-amount fiscal record, and KassenSichV only
    // recognises Bar/Unbar payment types — reject both here too.
    if params.amount_cents == 0 {
        return Err(HardwareError::InvalidArgument(
            "TSE: Betrag 0 kann nicht signiert werden".into(),
        ));
    }
    if params.payment_kind != "Bar" && params.payment_kind != "Unbar" {
        return Err(HardwareError::InvalidArgument(format!(
            "TSE: payment_kind '{}' ungültig (erwartet Bar|Unbar)",
            params.payment_kind
        )));
    }
    mock::mock_delay(950).await;
    mock::maybe_inject_failure("TSE finish_transaction (mock)")?;

    let counter = MOCK_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tx_number = MOCK_TX_NUMBER.fetch_add(1, Ordering::Relaxed);
    let now = Utc::now();
    let qr_payload = format!(
        "MOCK-QR;tx={};amount={};counter={};kind={}",
        params.fiskaly_transaction_id, params.amount_cents, counter, params.payment_kind
    );

    Ok(TseSignature {
        signature_value: format!("MOCK-SIG-{counter:08x}"),
        signature_counter: counter,
        signature_algorithm: "ecdsa-plain-SHA256".into(),
        transaction_number: tx_number,
        started_at: now - chrono::Duration::seconds(2),
        finished_at: now,
        qr_code_payload: qr_payload,
    })
}

pub async fn status(_config: TseConfig) -> HwResult<TseStatus> {
    mock::mock_delay(180).await;
    Ok(TseStatus {
        reachable: true,
        tss_state: Some("INITIALIZED".into()),
        last_checked_at: Utc::now(),
        message: "Mock-TSE aktiv (WAREHOUSE14_MOCK_HARDWARE=1)".into(),
    })
}
