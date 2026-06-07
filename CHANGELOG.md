# Changelog

All notable changes to the Warehouse14 POS desktop binary are recorded
here. The format follows [Keep a Changelog](https://keepachangelog.com)
and the project adheres to [SemVer](https://semver.org).

## [Unreleased]

## [0.3.0] — 2026-06-07

Go-live release candidate (shop test build, **test mode** — mTLS/secret
rotation deferred to go-live). Consolidates the full UX redesign +
fiscal/compliance stack accumulated since v0.2.2.

### Compliance (binding — Roman Grützner sign-off)

- **GwG direction-aware KYC enforcement** (migration 0050). ANKAUF requires
  a KYC-verified seller for every buy from €0,01 (§259 StGB); VERKAUF
  requires identification at/above €2.000 (§10 GwG). Enforced by an
  un-bypassable SECURITY DEFINER trigger; the cashier sees a friendly 403,
  not a raw error. Stornos are never re-blocked.
- **AML smurfing-aggregation framework** + **TSE/KassenSichV compliance
  tables** (migrations 0049 and the AML set) — alert-only thresholds are
  placeholders pending the Steuerberater's confirmation.
- **Sample fiscal exports** (`docs/samples/`): real DATEV EXTF
  Buchungsstapel + Kassenbericht for the accountant's review. Open question
  surfaced: all VERKAUF currently post to revenue account `8400` regardless
  of `tax_treatment_code` (see the marked TODO).

### POS & Owner Desktop

- Full UX pass: shared Dialog/Sheet + form primitives, number-key
  navigation, cashier keypad/discount/barcode/confirm flows, plain-language
  Kasse, in-place product sheet, per-metal margin editor, metal ticker,
  Ankauf estimator, Steuer-Export surface, and the Control Desktop polish.

## [0.2.2] — 2026-06-05

Kasse usability pass for Roman's daily flow (reviewed + integrated
consolidation of the four `claude/kasse-*` + `test-gate` branches).

### Kasse

- **Ankauf — KYC surfaced early.** The GwG §10 identification gate
  (≥ €2.000) is shown up front via the pure, tested `evaluateKycGate`;
  enforcement is behaviour-identical (not weakened). Faster item entry:
  expanded form with sticky metal/tax and clearer price-direction labels.
- **Verkauf — clearer discounts + faster turnaround.** Live
  discount-reason feedback with touch-sized controls (pure, tested
  `isDiscountReasonValid`); the catalog search auto-refocuses the moment
  a sale finalizes so the next scan/keystroke lands without a click.
- **Lager — scan-to-adjust + clearer notes.** A barcode scan auto-opens
  the inventory-adjustment dialog; the adjustment note shows a live
  minimum-length hint before submit.

### Hardware (software-complete, awaiting the device day)

- **ZVT card path** hardened to a spec-accurate BMP parser
  (ecrterm-grounded) driving the full multi-message authorisation
  conversation; mocks promoted from facade to validating. Proven by the
  in-repo HIL suite (`cargo test`). Real-terminal field-location +
  status-cadence confirmation remain quarantined for the go-live day.

### Backend (ships separately)

Database migrations **0045–0048** (blind-index HMAC, cumulative SELECT
grant, `DEBT` payment method, ledger hash-chain serialization) deploy via
the migrate service per `docs/runbooks/0045-0048-prod-apply.md` — **not**
bundled in this desktop binary.

## [0.1.0] — 2026-05-27

First public release of the desktop POS bundle.

### Highlights

- **Tier-1 POS Core (Phase 1.0–1.9).** PIN-login + Verkauf cart + Kasse
  shift management + Ankauf intake + Bewertung appraisal + Lager
  inventory + Kunden CRM + Werkstatt dashboard with live ledger SSE.
- **Hardware bridge (Phase 2 Day 8, memory.md §18).** Native Rust
  commands for: TSE (Fiskaly Cloud), ZVT 1.10 card terminals over TCP,
  ESC/POS thermal printers, A4 invoice PDF via `printpdf`, image
  compression to WebP, OS print queue probe. Every command has a mock
  alternative gated by `WAREHOUSE14_MOCK_HARDWARE=1`.
- **Web-Zentrale UI (Day 14, memory.md §23).** Operator can publish
  products to the storefront, assign categories, edit SEO metadata,
  and trigger AI-generated SEO descriptions via MCP — all from the
  Lager detail dialog.
- **Brutal-audit fixes (memory.md §19).** Four critical findings closed:
  inventory-lock now matches `(sessionId, userId)`; per-operator
  `localStorage` keys are wiped on sign-out; `bewertung` + `ankauf`
  stores reset on sign-out; finalize requires a client-supplied
  `idempotencyKey` (UUIDv4) backed by a partial UNIQUE index.
- **Storefront catalog API (Phase 2.A, memory.md §20).** Public
  read-only endpoints under `/api/storefront/*` with strict column
  projection — `acquisition_cost_eur` and PII cannot leak. Heavy
  edge caching.
- **MCP server (Phase 2.A, memory.md §20.5).** JSON-RPC 2.0 endpoint
  at `POST /api/mcp` exposing two tools: `generate_seo_description`
  (writes) and `appraise_estate_item` (read-only). Every invocation
  audited to `mcp_tool_invocations`.
- **Auto-update from GitHub Releases (Day-15, memory.md §25).**
  Tauri-plugin-updater wired with minisign signature verification.
  In-app banner polls hourly + on launch; operator clicks
  "Aktualisieren" → download + verify + relaunch.

### Database migrations

This release applies migrations 0001 → 0030. Production deployment
requires applying the three migrations that landed in this cycle:

```
0028_transactions_idempotency.sql
0029_storefront_publishing.sql
0030_mcp_tool_invocations.sql
```

### Known limitations

- No Apple Developer ID + no Microsoft Authenticode signing. Gatekeeper
  on macOS shows a one-time warning (strip with
  `sudo xattr -dr com.apple.quarantine "/Applications/Warehouse14 POS.app"`);
  Windows SmartScreen shows a "More info → Run anyway" gate on first
  install. **Auto-updates work regardless** — Tauri verifies its own
  minisign signature independently of OS code-signing.
- The bundled AI tools ship as deterministic stubs. A real
  `@anthropic-ai/sdk` call replaces the `runLlm()` body in a single
  follow-up patch.
- The PDF invoice prints the textual TSE block; QR raster embed lands
  once `printpdf`'s image API stabilises.

[Unreleased]: https://github.com/__GITHUB_OWNER__/__GITHUB_REPO__/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/__GITHUB_OWNER__/__GITHUB_REPO__/compare/v0.1.0...v0.2.2
[0.1.0]: https://github.com/__GITHUB_OWNER__/__GITHUB_REPO__/releases/tag/v0.1.0
