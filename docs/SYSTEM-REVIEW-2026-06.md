# Warehouse14 — System Review & Roadmap (2026-06-29)

Read-only 6-dimension review (architecture, resilience, cashier, KYC-photo, GDPR, code health).
**Headline: the system is healthy.** The spine is sound — coherent hub-and-spoke (one Fastify API),
strong storefront projection + fiscal/TSE split, model error-handling, near-zero rot, ~160 test files
on money/fiscal/auth. The cashier app is *more* mature than the admin app. This is **fill-the-gaps and
harden, not repair.**

## (1) CRITICAL / LEGAL — before serving a data-subject request or launching the public store
- **C1 — GDPR Art. 17 erasure does not exist.** No code path can delete a customer + their data. Schema
  was *designed* for it (`customers.soft_deleted_at` + `anonymized_at`, CHECK constraints) but **0% wired**.
  THE single most critical item. Model = anonymize-in-place (keep `id`+`customer_number`, NULL all PII).
- **C2 — Erasure must cascade to ~10 PII tables** (appointments raw name/phone/email, whatsapp_inbound,
  kyc_documents, transactions.shipping_address_encrypted, documentAttachments, appraisals, vouchers, holds).
  Cheapest first step: a documented PII-table inventory so no column escapes.
- **C3 — Fiscal reconciliation (Art. 17 vs §147/GoBD).** transactions/tse/ledger/closings are 10-year
  immutable → keep them, anonymize the customer row. **Needs a tax-advisor (Steuerberater) sign-off — start now.**
- **C4 — KYC Ausweis cannot be replaced/deleted (owner's bug).** Capability was never built: no DELETE/PUT
  route, no api-client method, no UI. Re-capture appends a second row. Falls out of C1 nearly for free.
- **C5 — Art. 20 data export does not exist.** Read-only aggregation over the C2 inventory; ships first, low-risk.
- **C6 — mTLS device wall is OFF in prod** (`TEST_DEVICE_FINGERPRINT` escape hatch, verified live). NOT open
  access (session/PIN still enforced) — but make a conscious go-live decision before the public store launch.

## (2) HIGH daily-friction — what the owner feels on the phone
- **H1 — Photo-upload hang (the stated pain).** Full-res base64 (~+33%) through a 15s JSON timeout, no
  on-device downscale, no write-retry → slow-LTE upload reliably times out + hard-rejects. KYC upload identical.
  Fix: downscale ~1600px + compress ~0.7, generous ~60s upload timeout, lower global read timeout to ~8-10s,
  bounded background retry. **Fastest fix, biggest daily relief.**
- **H2 — Mobile has no offline write-queue.** Any mutation hit by a blip = red error + rollback (the cashier
  has a durable SQLite outbox). Port that pattern; fiscal writes stay fail-loud.
- **H3 — Step-up PIN is timed against the 15s network window** → typing the PIN slowly wrongly rejects.
- **H4 — Offline only learned after a full timeout** (no NetInfo). Pairs with H1.

## (3) THE BIG NEXT PROJECT — cashier (apps/tauri-pos): targeted hardening, NOT a rebuild
The cashier is already the stronger codebase (Tauri 2, clean layering, durable outbox, CI-asserted middleware).
- **P1 — R2 document-upload 500 (the one real bug).** `Dokumente.tsx` still does the broken browser→R2 PUT;
  add a server-proxied `/api/documents/upload` like photos/KYC.
- **P2 — `BezahlenDialog` 2,624-line monolith with a stale "CASH only" header** that contradicts shipped
  ZVT/split/voucher code. Fix the header + extract sub-flows + move money math to `lib` with tests.
- **P3/P4 — split >1,000-line screens opportunistically; optional `lib/api/` for query keys.**

## (4) FOUNDATION / HEALTH — pay down when convenient
- **F1/F2 — Money/VAT math hand-mirrored across 3 codebases** (tauri, mobile, server); `toCents/fromCents`
  re-implemented 4× and NOT identical (one fixed a sign-bug the others handle differently). Server re-validates
  at finalize (drift fails loud) but consolidate into `@warehouse14/domain`.
- **F3 — Wire-contract types mirrored 3-5× ; `intake-pipeline` declares a narrower `TaxTreatmentCode` (3 vs 6).**
- **F4 — Operational hygiene:** single un-replicated api/worker/postgres (SPOF); bot-orchestrator turns
  dispatched in-process (lost on api restart); SSE token in query string (log-leak). Conscious trade-offs for
  a single shop — verify rolling deploy + webhook retry.

**Leave alone (already good):** storefront MOAT, fiscal/TSE split, 429/rate-limit chain, offline/404/error UX,
the error envelope, `gdpr-cleanup.ts`.

## RECOMMENDED SEQUENCE
1. **H1+H4 together** — photo-upload hang. Smallest effort, biggest daily relief, your pain. Ship first.
2. **Legal track in parallel** (C3 needs your tax advisor — that clock starts now): C2 (PII inventory) →
   C5 (export) → C3 (fiscal policy sign-off) → C1 (erasure endpoint) → C4 (KYC replace/delete, ~free after C1).
3. **C6 go-live decision** before any public-store launch.
4. **H2 + H3** — mobile offline write-queue (port the cashier outbox) + step-up timeout.
5. **Cashier:** P1 (real bug) → P2 (de-monolith) → P3/P4.
6. **Foundation:** F2→F1 (money math into `domain`), F3 (contract single-source), F4 hygiene.

**Single most critical: C1 (GDPR Art. 17 erasure)** — a legal obligation with no code path today.
**Fastest daily win: H1 (photo upload).**

> External dependencies the owner must action: (a) Steuerberater sign-off on anonymize-not-delete for fiscal
> records (C3); (b) go-live posture decision on mTLS device-binding (C6).
