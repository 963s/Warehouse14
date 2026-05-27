//! TSE mock — deterministic fake signatures so the UI can flow without
//! a real Fiskaly key. Each call increments a process-local counter so
//! repeated mock sales produce a believable sequence.

use std::sync::atomic::{AtomicU64, Ordering};

use chrono::Utc;

use crate::commands::tse::{
    TseConfig, TseFinishParams, TseIntention, TseSignature, TseStartParams, TseStatus,
};
use crate::error::HwResult;
use crate::mock;

static MOCK_COUNTER: AtomicU64 = AtomicU64::new(1);
static MOCK_TX_NUMBER: AtomicU64 = AtomicU64::new(1);

pub async fn start_transaction(params: TseStartParams) -> HwResult<TseIntention> {
    mock::mock_delay(450).await;
    mock::maybe_inject_failure("TSE start_transaction (mock)")?;

    Ok(TseIntention {
        intention_id: params.intention_id.clone(),
        fiskaly_transaction_id: format!("MOCK-TX-{}", params.intention_id),
        started_at: Utc::now(),
    })
}

pub async fn finish_transaction(params: TseFinishParams) -> HwResult<TseSignature> {
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
