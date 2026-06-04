# Runbook — Hardware-in-the-loop (HIL) for ZVT + TSE

Two layers prove the hardware command paths. **Layer 1 is the gate; Layer 2 is for
human visual-pressure sessions.**

## Layer 1 — automated, in-repo, CI-runnable (the gate)

In-repo protocol-validating servers exercise the REAL command paths (mock mode
OFF). No external service, no device — runs anywhere `cargo test` runs.

```bash
cd apps/tauri-pos/src-tauri
cargo test                 # lib unit + all HIL integration suites
cargo test --test zvt_hil  # ZVT TCP only
cargo test --test tse_hil  # Fiskaly HTTP only
cargo test --test mock_hardening   # mock now catches real-device errors
```

What it proves (see `tests/zvt_hil.rs`, `tests/tse_hil.rs`, `tests/mock_hardening.rs`):

- **ZVT** — `zvt_authorize_payment` → a TCP server that asserts `06 01` CLASS/INS,
  the `0x04` 6-byte-BCD amount == the cents charged, and a valid CRC-CCITT, then
  returns a realistic `04 0F` completion. Covers approve, decline, peer-EOF
  (→ Device error), and silent-hang (→ Timeout, via `WAREHOUSE14_ZVT_READ_TIMEOUT_MS`).
- **TSE** — `tse_start/finish_transaction` → a Fiskaly HTTP mock that asserts the
  bearer, `state` transitions, `amount > 0`, `payment_type ∈ {Bar,Unbar}`, and
  returns a monotonic signature counter. Empty config → `NotConfigured`.
- **Mock parity** — `WAREHOUSE14_MOCK_HARDWARE=1` now rejects the SAME bad input a
  real device would (0/oversized amount, no-creds config, bad payment type), and
  builds its ZVT frame via the same canonical builder as the real path.

## Layer 2 — manual, external emulators (visual pressure sessions)

For a human to watch the full Bezahlen/TSE flow against an independent emulator.
Point the app at the emulator via the same env switches; **mock mode OFF**.

### ESC/POS receipt printer — `escpresso` (Phase 2 scope, listed for completeness)
- Emulator: <https://github.com/local-net/escpresso> (or `receiptline` viewer), TCP `:9100`.
- In the Gerätemanager set the thermal printer IP to the emulator host, port `9100`.

### ZVT card terminal — `panda-zvt-simulator`
- Emulator: a ZVT 1.10 TCP simulator on `:20007` with REST error injection
  (decline / timeout / partial-frame), e.g. <https://github.com/yo-no/zvt> tooling
  or the vendor's PA/ZVT test simulator.
- Set the terminal IP/port in the Hardware tab to the simulator. Drive a sale;
  use the simulator's REST endpoint to inject a decline and confirm the POS shows
  "Nochmal versuchen / Bar zahlen", not a crash.

### TSE — Fiskaly test sandbox
- Use Fiskaly's **test** TSS (not production): set
  `WAREHOUSE14_FISKALY_BASE_URL=https://kassensichv-middleware.fiskaly.com/api/v2`
  (test base) and store the **sandbox** key/secret via the Hardware tab
  (`tse_store_credentials` → OS keychain). Run a sale and verify the QR + monotonic
  signature counter on the printed receipt against the Fiskaly dashboard.
- Never point a pressure session at the production TSS — it consumes real signatures.

### Env switches (both layers)
| Var | Meaning |
|-----|---------|
| `WAREHOUSE14_MOCK_HARDWARE` | `0`/`false` = real paths; `1`/`true` = mocks |
| `WAREHOUSE14_FISKALY_BASE_URL` | TSE endpoint (test sandbox or the in-repo mock) |
| `WAREHOUSE14_ZVT_READ_TIMEOUT_MS` | cardholder read-timeout (default 75 000) — HIL tests shrink it |
| `WAREHOUSE14_MOCK_FAIL_RATE` | mock decline/failure injection rate `0.0..=1.0` |

> The automated gate (Layer 1) is the source of truth for "the protocol bytes are
> correct". Layer 2 is for confidence under a human's eyes, not for catching
> protocol regressions — those belong in the in-repo servers.
