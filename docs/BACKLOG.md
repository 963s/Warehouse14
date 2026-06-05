# Warehouse14 — Working Backlog & Decisions

> Shared memory between the strategist (Claude) and Basel. Updated 2026-06-05.
> ⚠️ **This file MUST stay committed** — it was previously an untracked working-tree file and branch switches wiped it.

## Operating model
- **Strategist/reviewer (Claude):** owns technical decisions, reviews every executor claim against the real code, writes the prompts. Full technical authority — brings Basel only goals/product decisions.
- **Basel:** direction/goals; relays prompts; triggers deploys.
- **Executor (Claude Code, `claude/*` branches):** implementation/commits.
- **Doctrine:** no facade — nothing ships that looks strong but is hollow; prove under real pressure; tests = disaster discovery; "green" must prove correctness vs the real world, not self-consistency.

## ✅ SHIPPABLE NOW — Foundation / test-gate (`claude/test-gate`, not pushed)
Four real, latent (prod: 0 customers / 0 transactions), go-live-blocking prod bugs caught + fixed, each reviewed + proven red→green:
- **0045** `blind_index` — customer email/phone save+search threw (hmac signature).
- **0046** `security` SELECT on cumulative counters — every customer-attributed sale aborted.
- **0047** `DEBT` `payment_method` enum — first payment of any kind threw.
- **0048** ledger hash-chain serialize — GoBD fork under concurrency; + `LOCK TABLE` hardening (statement 0, verified).
Plus: harness boots (SUPERUSER + `check_function_bodies=off` mirrors prod) + psql-fidelity splitter (full chain boots); non-blocking CI `db-suites` workflow; ledger test bit-rot fixes; runbook `docs/runbooks/0045-0048-prod-apply.md` (PRE/APPLY/POST-VERIFY/ROLLBACK).
**SHIP:** merge `claude/test-gate` → main → deploy (migrate service applies per runbook). Deploy = Basel's trigger.

## Kasse (Phase 1) — Roman's visible value
- ✅ **Ankauf batch DONE** (`claude/kasse-ankauf`, `efaa5b1`): KYC surfaced early (pure tested `evaluateKycGate`, GwG §10 ≥€2.000) — reviewed compliance-sound, enforcement behaviour-identical (NOT weakened); faster item entry (expanded + sticky metal/tax); clear price-direction labels.
- ✅ **Verkauf batch DONE** (`claude/kasse-verkauf`, `4c28ecb`): live discount-reason feedback + touch sizing (pure tested `isDiscountReasonValid`) · auto-refocus catalog search on the real finalize-success close · accurate "bereits in der Karte" (unique-item — no quantity).
- ⏳ **Lager (THIS, `claude/kasse-lager`):** barcode → auto-open adjustment dialog · notes-min feedback (pure tested) · partial location (server-gated). Then cross-cutting (network-error specificity · Enter-to-submit).

## Hardware-in-the-loop / no-facade (`claude/hil-hardware`, not pushed)
- ✅ **ZVT card path SOFTWARE-COMPLETE:** spec BMP parser (ecrterm-grounded) · multi-message conversation · robust `read_exact` framing · mocks hardened facade→validating. **TSE solid** (config validation + monotonic counter).
- 🔦 **Quarantined for the REAL terminal (CCV A920) go-live session:** exact PAN/approval-code field location; real status cadence/timing.
- ⏳ **Phase 2:** label + receipt printers (ESC/POS/ZPL HIL asserting SKU + TSE block), camera→inventory.

## Deferred
- ~49 mechanical db-test bit-rot fixes (minute-precision, `lower(enum)`, `?:`, timestamp-as-string) — background drip; needed before the CI db-suites gate can be made *required*.
- Auto-pricer (Schmelzwert = weight × fineness × live metal rate − margin) — Phase 1+ Kasse; data exists; solves the €0 case.
- Roman's 4 doc templates (Briefpapier / Bewertung / Ankauf / Expertise) — Documents phase; tooling: pdfme / TipTap vs extend satori.

## Pre-go-live gate
One **hardware validation session** on the real devices (card terminal + receipt/label printer + camera) to close the HIL quarantines before launch.
