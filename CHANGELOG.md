# Changelog

All notable changes to the Warehouse14 POS desktop binary are recorded
here. The format follows [Keep a Changelog](https://keepachangelog.com)
and the project adheres to [SemVer](https://semver.org).

## [Unreleased]

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

[Unreleased]: https://github.com/__GITHUB_OWNER__/__GITHUB_REPO__/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/__GITHUB_OWNER__/__GITHUB_REPO__/releases/tag/v0.1.0
