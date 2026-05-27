//! Runtime configuration helpers — small, side-effect-free.
//!
//! Two switches drive the hardware layer:
//!
//!   1. `WAREHOUSE14_MOCK_HARDWARE=1` flips every command into a fake
//!      implementation. Used by `pnpm dev:tauri`, CI, and the demo build.
//!
//!   2. `WAREHOUSE14_MOCK_FAIL_RATE=0.25` makes the mocks fail 25 % of the
//!      time. Useful when exercising the UI's error-handling paths.
//!
//! Both are read *every* call (not cached) so a developer can toggle them
//! without restarting the app. Reading an env var is cheap.

/// `true` when every command should short-circuit to its mock implementation.
///
/// Default `true` in debug builds, `false` in release builds — production
/// shoppers must never silently run mocks. The env var overrides both.
pub fn is_mock_mode() -> bool {
    match std::env::var("WAREHOUSE14_MOCK_HARDWARE") {
        Ok(v) => v == "1" || v.eq_ignore_ascii_case("true"),
        // Unset → fall back to build profile.
        Err(_) => cfg!(debug_assertions),
    }
}

/// Mock failure injection rate, 0.0 ..= 1.0. Anything outside that range
/// is clamped. Use this from the React side (`hardware-client.ts`) to
/// exercise the error UI paths.
pub fn mock_fail_rate() -> f64 {
    std::env::var("WAREHOUSE14_MOCK_FAIL_RATE")
        .ok()
        .and_then(|v| v.parse::<f64>().ok())
        .map(|v| v.clamp(0.0, 1.0))
        .unwrap_or(0.0)
}

/// Fiskaly base URL — overridable for the test sandbox vs. production.
/// Defaults to the EU production endpoint.
pub fn fiskaly_base_url() -> String {
    std::env::var("WAREHOUSE14_FISKALY_BASE_URL")
        .unwrap_or_else(|_| "https://kassensichv.fiskaly.com/api/v2".to_string())
}

/// Five-second timeout for every TCP hardware call. A hung printer or
/// terminal must never freeze the POS — the operator's next action is
/// always to retry or skip.
pub const DEFAULT_TCP_TIMEOUT_MS: u64 = 5_000;

/// Fiskaly HTTPS calls get a longer budget — the EU endpoint can take 4 s
/// to issue a signature under load. 10 s leaves headroom without making
/// the operator feel the wait beyond the spinner.
pub const FISKALY_HTTP_TIMEOUT_MS: u64 = 10_000;
