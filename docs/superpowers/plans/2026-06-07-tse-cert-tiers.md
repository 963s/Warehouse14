# TSE Cert-Expiry Tiers + Archive Reconciliation Plan

> TDD the pure tier logic HEAVILY. Append-only migration. Zero new alert types (#45).

**Goal:** Close the genuine gaps in the (already ~95% built) TSE KassenSichV §10 compliance: add a pure, heavily-tested multi-tier cert-expiry classifier (T-30 / T-7 / T-1 / expired), make the cert-checker job re-alert on ESCALATION (not a blunt 24h cooldown — and never re-alert the same tier), and declare the two already-emitted TSE alert types in the ledger union.

**Reconciliation (audit — like smurfing, this is mostly built):**
- `tse_clients` table + Drizzle EXIST (migration 0043): tss_id, cert_valid_to, last_checked, alert_sent_at.
- `tse_daily_archives` table + Drizzle EXIST (migration 0040): archive_date, status enum, file_r2_key, sha256, transaction_count — the §10 evidence.
- `tse_cert_checker` job EXISTS (daily 05:00): reads Fiskaly cert, single binary 30-day threshold, 24h cooldown, emits `alert.tse_cert_expiry`. Tested.
- `tse_archive_exporter` job EXISTS (daily 03:00): exports the prior day's FINISHED tse_transactions as a TAR → SHA-256 → R2 → tse_daily_archives; emits `alert.tse_critical_failure` on failure. Tested.
- Fiskaly clients are INJECTED (real HTTP `createDefault*Client`, mocks in tests) — the HIL boundary. ✓
- **Archive vs DSFinV-K reconciliation:** `tse_archive_exporter` = the §10 TSE-transaction TAR EVIDENCE (R2 + hash + record). `dsfinvk_daily_export` = the separate DSFinV-K cash-register push to Fiskaly cloud. Complementary; both exist. Nothing to merge.

**Genuine gaps → this plan:**
1. No multi-tier cert logic — single binary 30-day flag. → pure `certExpiryTier` + heavy TDD.
2. Cooldown is time-based (24h), not tier-based — can't escalate T-30→T-7→T-1 cleanly nor avoid same-tier spam. → persist `last_alert_tier`; alert on escalation.
3. `alert.tse_cert_expiry` + `alert.tse_critical_failure` are EMITTED but missing from the ledger.ts union. → declare them (type-safety; NOT new alerts).

## #45 decision
**Zero new alert types introduced.** `alert.tse_cert_expiry` ALREADY exists as a DND-bypass critical alert in shipped code (tse-cert-checker.ts:161 + the Day-24 union comment). The multi-tier change is re-alert CADENCE (escalation), reusing the SAME event with a `tier` payload field. Declaring the two already-emitted types in the union is a type-safety fix (they already fire in prod), not a new classification. No ADR required.

## Tasks

### T1 — Pure `certExpiryTier` + TDD (worker lib)
- [ ] NEW `apps/worker/src/lib/cert-expiry-tier.ts`: `certExpiryTier(validTo, now) → 'T-30'|'T-7'|'T-1'|'expired'|null` (ms<=0 → expired; floor-days <=1 → T-1; <=7 → T-7; <=30 → T-30; else null) + `tierRank(tier|null) → number` (null 0 … expired 4) for escalation.
- [ ] NEW test: every boundary (60d null, 30d T-30, 31d null, 7d T-7, 8d T-30, 1d T-1, 2d T-7, 12h T-1, ==now expired, 1ms past expired, -1d expired) + tierRank ordering. Run green.

### T2 — Migration 0049 + Drizzle: persist the last-alerted tier
- [ ] `packages/db/migrations/0049_tse_client_alert_tier.sql`: `ALTER TABLE tse_clients ADD COLUMN IF NOT EXISTS last_alert_tier TEXT;` (append-only, idempotent; the existing table-level UPDATE grant to worker/app already covers it) + rationale comment.
- [ ] Drizzle: add `lastAlertTier: text('last_alert_tier')` to `tseClients.ts`.

### T3 — Wire the cert-checker to escalation-aware re-alerting
- [ ] `runTseCertCheck`: SELECT `last_alert_tier`; compute `tier = certExpiryTier(certValidTo, now)`; alert iff `tier !== null && tierRank(tier) > tierRank(lastTier)`; on alert persist `last_alert_tier = tier` (+ keep `alert_sent_at`); add `tier` to the alert payload. Replace the 24h cooldown gate with the tier gate.
- [ ] Update tse-cert-checker.test.ts: far-out (null → no alert); first entry into T-30/T-7/T-1 alerts; same tier again → no re-alert; escalation T-30→T-7 → re-alert; expired → alert. Run green.

### T4 — Declare the already-emitted TSE alert types in the union
- [ ] `packages/api-client/src/domains/ledger.ts`: add `'alert.tse_cert_expiry' | 'alert.tse_critical_failure'`. Build api-client.

### Gates
- [ ] typecheck (worker + api-cloud + api-client) + biome + lint:all net-0-new + worker/api-cloud unit tests green + builds.

## Deferred / needs harness
- DB integration tests for migration 0049 + schema tests for 0040/0043 (the audit noted these have none) — testcontainers harness.
- Real Fiskaly cert read + real archive TAR — on-device HIL (mock-backed in dev, real `createDefault*Client` on the box).
- Surfacing archive status on the dashboard/Steuer-Export (bridge reads tse_clients but not tse_daily_archives) — light follow-up.
