//! Proves the MOCK paths (`WAREHOUSE14_MOCK_HARDWARE=1`) now catch the SAME
//! input/config errors a real device would — so a green mock run no longer
//! hides a misconfiguration that would only blow up on the first real sale.
//! Before this hardening these all returned a fabricated `Ok(...)`.

use warehouse14_tauri_pos_lib::commands::tse::{TseConfig, TseFinishParams, TseStartParams};
use warehouse14_tauri_pos_lib::commands::zvt::ZvtEndpoint;
use warehouse14_tauri_pos_lib::error::HardwareError;
use warehouse14_tauri_pos_lib::mock::{tse_mock, zvt_mock};

fn endpoint() -> ZvtEndpoint {
    ZvtEndpoint {
        ip: "127.0.0.1".into(),
        port: 20007,
    }
}

fn full_cfg(tss: &str) -> TseConfig {
    TseConfig {
        tss_id: tss.into(),
        client_id: "c".into(),
        api_key: "k".into(),
        api_secret: "s".into(),
    }
}

fn finish(cfg: TseConfig, amount_cents: u64, payment_kind: &str) -> TseFinishParams {
    TseFinishParams {
        config: cfg,
        intention_id: "i".into(),
        fiskaly_transaction_id: "tx".into(),
        amount_cents,
        payment_kind: payment_kind.into(),
        process_data_base64: String::new(),
        process_type: "Kassenbeleg-V1".into(),
    }
}

#[tokio::test]
async fn zvt_mock_rejects_zero_amount() {
    let err = zvt_mock::authorize_payment(endpoint(), 0)
        .await
        .expect_err("mock must reject a 0 amount like a real terminal");
    assert!(matches!(err, HardwareError::InvalidArgument(_)), "{err:?}");
}

#[tokio::test]
async fn zvt_mock_rejects_amount_over_bcd_limit() {
    let err = zvt_mock::authorize_payment(endpoint(), 1_000_000_000_000)
        .await
        .expect_err("mock must reject an amount that overflows 6-byte BCD");
    assert!(matches!(err, HardwareError::InvalidArgument(_)), "{err:?}");
}

#[tokio::test]
async fn zvt_mock_valid_amount_reflects_the_real_sum() {
    std::env::set_var("WAREHOUSE14_MOCK_FAIL_RATE", "0");
    let res = zvt_mock::authorize_payment(endpoint(), 12_345)
        .await
        .expect("a valid amount authorises");
    assert!(res.success);
    // The mock reflects the ACTUAL amount, not a hardcoded value.
    assert!(
        res.receipt_text.as_deref().unwrap_or("").contains("123.45"),
        "receipt must show 123.45, got {:?}",
        res.receipt_text
    );
}

#[tokio::test]
async fn tse_mock_start_rejects_empty_config() {
    let err = tse_mock::start_transaction(TseStartParams {
        config: full_cfg(""), // empty TSS-ID
        intention_id: "i".into(),
        process_type: "Kassenbeleg-V1".into(),
    })
    .await
    .expect_err("no-creds operator must NOT get a fake intention");
    assert!(matches!(err, HardwareError::NotConfigured(_)), "{err:?}");
}

#[tokio::test]
async fn tse_mock_finish_rejects_empty_config() {
    let err = tse_mock::finish_transaction(finish(full_cfg(""), 100, "Bar"))
        .await
        .expect_err("no-creds operator must NOT get a fake signature");
    assert!(matches!(err, HardwareError::NotConfigured(_)), "{err:?}");
}

#[tokio::test]
async fn tse_mock_finish_rejects_zero_amount() {
    let err = tse_mock::finish_transaction(finish(full_cfg("tss-1"), 0, "Bar"))
        .await
        .expect_err("a 0-amount fiscal record must not be signed");
    assert!(matches!(err, HardwareError::InvalidArgument(_)), "{err:?}");
}

#[tokio::test]
async fn tse_mock_finish_rejects_unknown_payment_kind() {
    let err = tse_mock::finish_transaction(finish(full_cfg("tss-1"), 100, "Karte"))
        .await
        .expect_err("only Bar/Unbar are valid KassenSichV payment types");
    assert!(matches!(err, HardwareError::InvalidArgument(_)), "{err:?}");
}

#[tokio::test]
async fn tse_mock_finish_accepts_valid_input() {
    std::env::set_var("WAREHOUSE14_MOCK_FAIL_RATE", "0");
    let sig = tse_mock::finish_transaction(finish(full_cfg("tss-1"), 9_900, "Unbar"))
        .await
        .expect("a fully-configured Unbar sale signs");
    assert!(sig.signature_counter >= 1);
    assert!(sig.qr_code_payload.contains("amount=9900"));
}
