# Changelog

All notable changes to the Warehouse14 POS desktop binary are recorded
here. The format follows [Keep a Changelog](https://keepachangelog.com)
and the project adheres to [SemVer](https://semver.org).

## [Unreleased]

## [0.4.10] — 2026-06-08

- **DSFinV-K export** (Steuer-Export + Owner-Desktop): one-click download of the
  standardized cash-register data bundle a tax inspector asks for in a
  Kassen-Nachschau. (Core export — to be validated against the official
  DSFinV-K Prüftool and your tax advisor before a real audit.)
- **Verfahrensdokumentation**: the GoBD-required procedural documentation of the
  cash system is now written and included.
- **Cleaner German labels**: product type, condition, status, appointment and
  customer fields now show proper German text instead of internal codes.

## [0.4.9] — 2026-06-08

- **Security hardening** (from a final internal audit): the customer-display
  companion now carries its access token in a handshake header instead of the
  connection URL, so it can't be recovered from device logs/history.
- **Internal cleanup**: the money rounding/conversion helpers are now defined
  once and shared (previously copied across three screens), removing the risk of
  the cash, intake and appraisal screens ever rounding differently. No change to
  any amount — proven by tests.

## [0.4.8] — 2026-06-08

- **Split payment** (Kasse): pay part of a sale in cash and the rest on the
  card terminal — one receipt, one transaction. Appears as a "Betrag aufteilen"
  option in the Bezahlen dialog when a card terminal is configured.
- **Publish to eBay** (Lager): the "Bei eBay listen" button now drives a real
  eBay listing push when an eBay account is connected (shows a clear "token
  pending" note until then) — no fiscal data involved.
- **Reliability hardening** (server): fixed three latent permission/typing
  faults in the audit-ledger triggers that would have surfaced on the first
  real cash-up, card/TSE event, or viewing-appointment booking.

## [0.4.7] — 2026-06-08

- **Customer display updates live** (Kundenanzeige companion): the paired
  iPad/phone now mirrors the cashier's cart in real time over the shop Wi-Fi
  instead of refreshing once a second.
- **Second cashier can build a cart** (Zweitkasse companion): add items, adjust
  quantities and see the running total on a paired tablet; payment is handed
  back to the main till (the companion never writes a fiscal record on its own).
- **Cleaner, more accessible chrome**: clearer top-bar spacing and a more
  legible connection badge; clickable cards and the search overlay are now
  fully keyboard-operable.

## [0.4.6] — 2026-06-08

- **Cleaner screens across the app**: consistent spacing, stronger hierarchy
  (the cart/day total now dominates), and one obvious brass primary action per
  view — applied to Verkauf, Lager, Ankauf, Tageskasse, Kunden and Werkstatt.

## [0.4.5] — 2026-06-08

- **Visible primary buttons** (brass accent across every screen) + a real
  spacing scale in the design system.
- **In-app camera** enabled (camera usage description + entitlement) — capture
  product photos directly (works in the installed app; first use prompts for
  macOS camera permission).
- **TSE signatures are persisted server-side** (GoBD): each KassenSichV
  signature is durably stored, linked to its transaction (migration 0054).

## [0.4.4] — 2026-06-08

- **Verkauf catalog shows product photo cards** (image + name + price + metal),
  fed by a new primary-photo field on the products feed.
- **Product lifecycle**: a 'Fertig' finish button in the photo studio; delete a
  DRAFT product (guarded, owner + step-up); a single 'Bei eBay listen' action
  (honest stub) alongside the existing web-shop toggle.
- **Companion (iPad/phone)**: real role screens — Lager (label printer, add/edit
  product, inventory + clean barcode lookup), Zweitkasse, Kundenanzeige — with
  big-icon role selection after pairing.

## [0.4.3] — 2026-06-08

- **Product photos now display in the app.** The CSP `img-src` now allows the
  API media host, so server-stored product photos render as thumbnails in the
  product sheet (upload already worked in 0.4.2; this lets the webview show them).

## [0.4.2] — 2026-06-08

- **Product photos work again.** Upload now goes through the API
  (`POST /api/photos/upload`) instead of a direct browser→R2 PUT, removing the
  R2-CORS dependency that silently blocked every upload; fixed a webp/jpeg
  content-type mismatch; photos now render as thumbnails in the product sheet
  (CSP extended for the R2 media host).
- **iPad/iPhone pairing connects.** The companion hub now detects the real
  Wi-Fi LAN IP (ignoring VPN/Docker interfaces) for the pairing QR, and the
  subnet guard tolerates real LAN topologies instead of rejecting the device.

## [0.4.1] — 2026-06-07

Security hardening of the companion LAN subsystem (review-driven, before any
second-cashier payment ring-up):

- The companion proxy role allow-list is now positive + deny-by-default: a
  paired Second-Cashier tablet can only ring up (`transactions/finalize`) — it
  can no longer reach Ankauf (cash payout), Storno (void) or Return (refund).
- The proxy path is traversal-safe (percent-decoded + rejected on `..`/`//`),
  closing a deny-list bypass.
- Pairing code is single-use + 5-min TTL + CSPRNG + per-TCP-peer rate limit +
  global lockout; strict CSP + no innerHTML sink on the companion page;
  same-subnet peer guard + token TTL; request body/concurrency/timeout limits.

## [0.4.0] — 2026-06-07

Deep-overhaul release (test mode). Driven by a 54-finding multi-agent audit
(`docs/deep-audit-2026-06-07.md`).

### Fixed — the "no server connection" on Windows

- The cloud session cookie is `SameSite=None; Secure`, which Windows WebView2
  drops at the non-secure `http://tauri.localhost` origin — so the app opened
  but every request read as logged-out. Now the session token is also carried
  as `Authorization: Bearer` (immune to cookie policy), with an `access_token`
  query param for the SSE stream. Auth now survives on Windows.

### Fixed — money safety & honest connection state

- Ankauf double-pay on double-click (client mutex + idempotency key + server
  dedup); offline-queued buy-ins/cards no longer read as "failure"; ZVT
  finalize-retry no longer re-authorizes (no double charge); cart-line removal
  rolls back on release failure (no zombie reservation); offline fiscal
  mutations are correctly GoBD-tagged.
- A down server now shows "Keine Verbindung zum Server" + retry instead of an
  empty catalog / the PIN pad; the status badge reflects real reachability.

### Added — high-value sale & companion devices

- §10 GwG: a VERKAUF ≥ €2.000 is now completable — a buyer picker with
  Ausweisprüfung (search / create / KYC-verify) attaches a verified buyer.
- **Companion LAN hub** (`docs/companion-architecture.md`): the mother POS
  embeds a local server so an iPad/phone on the shop Wi-Fi pairs via QR
  (Settings → "Geräte koppeln"), picks a role (Lager / Zweitkasse /
  Kundenanzeige), and rides the mother's session through a role-scoped proxy.
  The Customer-Display shows the mother's live cart. (Second-cashier ring-up +
  realtime WebSocket are the next phase.)

### Changed

- German UI polish (no English enums on the floor); enforced server rate
  limits; mTLS-bypass boot guard; ±50% metal-price plausibility band; 11
  secondary surfaces lazy-loaded off the first-paint path.

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
