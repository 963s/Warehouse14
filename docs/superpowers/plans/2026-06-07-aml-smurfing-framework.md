# AML Smurfing / Structuring Framework Implementation Plan

> Steps use checkbox syntax. TDD the detection + gate HEAVILY (compliance). Reuse the EXISTING machinery — do NOT duplicate.

**Goal:** Complete the GwG §10 anti-structuring framework: make the detection thresholds fully configurable (placeholders pending the Steuerberater), HEAVILY-test the detection heart, add the §10 AGGREGATE-aware KYC gate (require ID when a customer's rolling window crosses the threshold even if the current buy is under), persist detected patterns as append-only AML flags, and surface OPEN flags to the Owner for review — conservative (flag + enforce ID; never auto-block, never auto-file a SAR).

**Reconciliation (audit):** A pure `detectSmurfing` ALREADY exists (`apps/api-cloud/src/lib/smurfing.ts`) with BOTH the §10 `AGGREGATE_CROSSES_KYC_LIMIT` rule and `NEAR_THRESHOLD_COUNT`, settings-driven thresholds (`loadSmurfingThresholds`), a post-commit finalize hook (`runSmurfingDetection` → `alert.smurfing_detected` + audit). It is already tested (`tests/unit/smurfing.test.ts`). So this task EXTENDS, not builds-from-zero.

**Architecture:** Server stays the source of truth + audit-first. Money = bigint cents / NUMERIC strings, no float. New migration 0049 is append-only + idempotent + grant-managed + Drizzle-mirrored. ADMIN + step-up on review actions. Respect alert invariant #45 — NO new CRITICAL alert type; the new signal is a persisted flag + a review surface.

---

## Genuine gaps vs the existing framework

| Deliverable | Reality | Gap → work |
|---|---|---|
| 1. Config (settings) | window/count/near are settings; **aggregate (€2.000) threshold is HARDCODED** `KYC_LIMIT_CENTS=200_000n` | Promote to `gwg.identity_threshold_eur`; PLACEHOLDER docs; (fix stale "Weil am Rhein" → Schorndorf) |
| 2. Detection (pure+TDD) | exists + tested (count, aggregate, window) | ADD fixtures: exactly-at-threshold boundary, decimal-exact, configurable-threshold flip |
| 3. §10 KYC **gate** aggregate-aware | only post-commit DETECT; the POS gate is single-tx | **NEW**: pure `evaluateAggregateKyc` + server rolling-window aggregate on customer detail + Ankauf banner |
| 4. Append-only flag + Owner surface | only a ledger alert + audit; no reviewable table/surface | **NEW**: migration 0049 `aml_flags` + persist + `GET /api/aml-flags` + `POST /:id/review` (ADMIN+step-up) + POS surface |
| 5. Conservative | already post-commit, non-blocking | keep |

## Tasks

### T1 — Config + detection TDD gaps (`smurfing.ts` + `smurfing.test.ts`)
- [ ] `loadSmurfingThresholds`: read `gwg.identity_threshold_eur` → `kycLimitCents` (default 200_000n). PLACEHOLDER comment on every key ("confirm with Steuerberater/bank before go-live"). Fix the "Weil am Rhein" comment → "Schorndorf".
- [ ] smurfing.test.ts: add — aggregate exactly == threshold → flagged; one cent under → not; decimal-exact (666.67×3 = 2000.01 crosses); a LOWER configured threshold flips a previously-clean window to flagged.
- [ ] Run api-cloud unit tests green.

### T2 — §10 aggregate-aware KYC gate (POS pure + TDD + server aggregate + Ankauf banner)
- [ ] NEW `apps/tauri-pos/src/lib/aggregate-kyc-gate.ts` + test: `evaluateAggregateKyc({ incomingCents, priorWindowAnkaufCents, thresholdCents, windowDays, customer })` → `{ aggregateCents, reachesThreshold, required }`. `required` = reachesThreshold && customer && !kycVerified (even when incoming < threshold). HEAVY fixtures incl. boundary + decimal + verified-customer + null-customer.
- [ ] Server `GET /api/customers/:id`: add `gwgRollingAnkauf: { windowDays, priorAnkaufEur }` (the smurfing window query + thresholds). api-client `CustomerDetail` type.
- [ ] Ankauf KYC banner: also require ID when the aggregate gate fires (single-tx gate preserved). 
- [ ] tauri-pos unit tests + typecheck green.

### T3 — Append-only `aml_flags` (migration 0049 + Drizzle + grants) + persist
- [ ] `packages/db/migrations/0049_aml_flags.sql`: append-only table (id, customer_id, transaction_id, rule, window_days, aggregate_eur, near_threshold_count, reasons jsonb, detected_at, reviewed_by_user_id, reviewed_at, review_note) + immutability trigger (only review_* fields mutable) + grants (INSERT app, SELECT/UPDATE security/app) + Drizzle mirror `schema/compliance/amlFlags.ts` registered.
- [ ] `runSmurfingDetection`: INSERT an `aml_flags` row on a hit (alongside the existing alert + audit). Idempotent per (transaction_id) — one flag per detection.
- [ ] Drizzle build + api-cloud typecheck green. (DB integration needs the testcontainers harness — note it.)

### T4 — Owner review surface (route + api-client + POS surface)
- [ ] `routes/aml-flags.ts`: `GET /api/aml-flags?state=open|all` (ADMIN) + `POST /api/aml-flags/:id/review` (ADMIN + step-up; sets reviewed_by/at + note; audit-logged). Register route.
- [ ] api-client `amlFlags` domain (list + review) + types.
- [ ] POS Tier-2 `/aml-pruefung` surface: ADMIN-gated list of OPEN flags (customer, window, aggregate, reasons, detected_at) + "Geprüft" action (step-up). surface-registry entry (≤8 Tier-1).
- [ ] Gates: typecheck + lint net-0-new + all suites + vite build.

## Deferred (state in report)
- The REAL thresholds (window / aggregate / small ceiling / min count) — Basel's Steuerberater + bank must supply; we ship conservative PLACEHOLDERS.
- The Verdachtsmeldung/SAR workflow (FIU filing) — Owner decision, out of scope; the surface flags + enforces ID only.
- DB integration tests for the migration + flag persistence — need the testcontainers harness (pure logic is unit-tested).
