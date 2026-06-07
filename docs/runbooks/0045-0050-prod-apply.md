# Runbook — Production go-live: PR #2 + migrations 0045–0050 (api-cloud server)

Extends `0045-0048-prod-apply.md` to the **full server go-live**: the reserve fix (PR #2) +
the 0045–0048 stability fixes + 0049 (TSE escalation column) + **0050 (binding GwG KYC
enforcement, Roman Grützner sign-off — memory §29)**. The POS + Control Desktop ship
**separately** via a signed tag (§8).

> ⚠️ Prod has **0 transactions / 0 customers** today. The moment writers are back up, every POS
> click writes the **real, append-only GoBD ledger**. Do NOT point a dev POS at `api.warehouse14.de`.

Server: `myserver` · prod dir `/opt/warehouse14` · `.env` root-owned (use `sudo`). The Mac is
arm64 = same arch as the Oracle box, so a local `--platform linux/arm64` build loads directly.

---

## 0. Artifacts — what goes where

| Artifact | Built from | Reaches prod via |
|---|---|---|
| `warehouse14-api`, `warehouse14-worker` | push to **`main`** → `deploy-images.yml` (CI, linux/arm64) → GHCR `:latest` | on-server `./scripts/update.sh` → `docker compose pull && up -d` |
| `warehouse14-migrate` (bakes `packages/db/migrations`) | CI from main, **or** local `buildx` + stream (this runbook) | the `migrate` one-shot service (idempotent, `_w14_schema_migrations`) |
| POS + Control Desktop | git tag `v*.*.*` → `release.yml` → minisign | Tauri OTA (hourly) — **§8, separate** |

The **server** deploy needs everything on `main`. The migrate image bakes the SQL files, so
**all of 0045–0050 must be present in the tree that builds the migrate image.**

---

## 1. Convergence to `main` (prerequisite — migrations live on 4 branches)

| Branch | Carries |
|---|---|
| `claude/test-gate` | migrations **0045–0048** + the prod Docker stack (compose, `migrate.sh`, `update.sh`, Dockerfiles) + the original runbook |
| `claude/gwg-kyc-enforcement` | **0050** + the KYC api code (route pre-checks, `KYC_REQUIRED`, smurfing default) + the POS client gate; **also carries 0049 + the TSE code + §28/§29** (stacked off `claude/tse-compliance-tables`) |
| `claude/fix-reserve-sell-bug` | **PR #2** — the reserve 500 fix (api-cloud) |

**Merge to `main` in this order, re-running gates after each (resolve conflicts):**
1. `claude/test-gate` — the deploy infra + 0045–0048 (the base the others assume).
2. `claude/gwg-kyc-enforcement` — brings 0049 + 0050 + the KYC api code.
3. `claude/fix-reserve-sell-bug` (PR #2) — merge via GitHub.

Then on `main`, confirm + gate:
```bash
ls packages/db/migrations/004[5-9]_*.sql packages/db/migrations/0050_*.sql   # 0045…0050 all present
pnpm -r typecheck && pnpm -r test && pnpm lint:all                           # green
```
> POS/UX branches (`ux-*`, `control-desktop-polish`) are **not** part of the server deploy — they go
> into the tagged POS release (§8).

---

## 2. ⚠️ PRE-DEPLOY GATE — the 0050 KYC trigger DB-integration test (BINDING, do not skip)

0050's `transactions_validate_kyc()` is the un-bypassable compliance gate. It was verified by
line-by-line read + mirrors the prod-proven `transactions_validate_sanctions` trigger, but its
**runtime `RAISE` has not yet been exercised**. The testcontainers harness exists
(`packages/db`, `test:integration`, template `0048_ledger_chain_head_serialize.test.ts`). **Before
building the migrate image, prove the trigger against a real Postgres:**

1. Write `packages/db/tests/migrations/0050_gwg_kyc_enforcement.test.ts` (mirror the 0048 test: boot
   `postgres:17-alpine`, apply 0001→0050, seed a non-banned customer + a valid business day, insert
   as `warehouse14_app`). Assert:
   - **ANKAUF** + customer `kyc_verified_at IS NULL` → **rejected** (`KYC hard-block (Ankauf)`); customer verified → **ok**; even at €0,01.
   - **VERKAUF** total **≥ 2000** + (no customer OR unverified) → **rejected** (`KYC hard-block (Verkauf)`); **< 2000** → **ok**; ≥ 2000 + verified → **ok**.
   - **Storno** (`storno_of_transaction_id` NOT NULL) → **bypassed** (never re-block a reversal).
2. Run:
   ```bash
   pnpm --filter @warehouse14/db test:integration
   ```
   **All green = the gate is closed.** Do NOT deploy 0050 until this passes. (This is the one
   verification neither executor nor review could run statically — memory §29.3.)

---

## 3. PRE — quiescence + baseline  *(per `0045-0048-prod-apply.md`)*

```bash
ssh myserver 'cd /opt/warehouse14 && sudo docker compose -f docker-compose.prod.yml stop api worker'
ssh myserver "cd /opt/warehouse14 && sudo docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U warehouse14 -d warehouse14 -c 'SELECT count(*) FROM ledger_events;' -c 'SELECT * FROM verify_ledger_chain();'"
```
**Expected:** baseline row count + `verify_ledger_chain()` → **0 rows**. If it returns a break row, STOP.

---

## 4. APPLY — rebuild the migrate image, stream, run  *(now 6 files: 0045→0050)*

```bash
cd /Users/basel/Desktop/warehouse14      # on converged main
docker buildx build --platform linux/arm64 -f infrastructure/docker/migrate.Dockerfile \
  -t ghcr.io/963s/warehouse14-migrate:latest --load .
docker save ghcr.io/963s/warehouse14-migrate:latest | gzip -1 | ssh myserver 'gunzip | docker load'
ssh myserver 'cd /opt/warehouse14 && sudo docker compose -f docker-compose.prod.yml up migrate'
ssh myserver 'sudo docker logs warehouse14-migrate --tail 40'
```
**Expected tail:** `applying 0045_… 0046_… 0047_… 0048_… 0049_… 0050_…` then `done — applied 6,
already-current N`. `ON_ERROR_STOP=1` → any failure aborts before recording (re-runnable).

> **0048 self-protects** with `LOCK TABLE … SHARE ROW EXCLUSIVE`; the quiescence in §3 is belt-and-braces.

---

## 5. POST-VERIFY  *(the original 6 checks + 0049/0050)*

Run the **0045–0048 checks** from `0045-0048-prod-apply.md` §POST-VERIFY (chain intact, `blind_index`
32 bytes, `'DEBT'` enum, `warehouse14_security` reads cumulative cols, `ledger_chain_head` seeded),
**plus:**

```bash
ssh myserver "cd /opt/warehouse14 && sudo docker compose -f docker-compose.prod.yml exec -T postgres \
  psql -U warehouse14 -d warehouse14 \
  -c \"SELECT 1 FROM information_schema.columns WHERE table_name='tse_clients' AND column_name='last_alert_tier';\" \
  -c \"SELECT 1 FROM pg_trigger WHERE tgname='trg_transactions_validate_kyc';\" \
  -c \"SELECT key, value FROM system_settings WHERE key IN ('gwg.verkauf_identity_threshold_eur','gwg.ankauf_identity_required_always','smurfing.ankauf_count_window_days','kyc.high_value_threshold_eur');\""
```
**Expected:** `last_alert_tier` column present (0049); `trg_transactions_validate_kyc` present (0050);
`gwg.verkauf_identity_threshold_eur="2000.00"`, `gwg.ankauf_identity_required_always=true`,
`smurfing.ankauf_count_window_days=30`, `kyc.high_value_threshold_eur="2000.00"` (realigned/SUPERSEDED).

---

## 6. Deploy the server code (api + worker)

The migrations are applied; now ship the api/worker images carrying the **KYC route pre-checks +
`KYC_REQUIRED` mapping + the smurfing default** (built from converged `main` by CI):
```bash
# CI already built ghcr.io/963s/warehouse14-{api,worker}:latest from main.
ssh myserver 'cd /opt/warehouse14 && sudo ./scripts/update.sh'   # pull :latest + up -d (migrate is a no-op now)
```
**E2E smoke (via the POS, not psql) — the real enforcement proof:**
- A **CASH sale to a known, KYC-verified customer** completes (DEBT-guard 0047 + cumulative 0046 + chain 0045/0048).
- An **ANKAUF to an UN-verified customer is BLOCKED** at payout → POS shows *"Identifizierung erforderlich (§ 259 / § 10 GwG)"* (0050 live).
- A **VERKAUF ≥ €2.000 with no/unverified customer is BLOCKED**; < €2.000 completes anonymously.
- `verify_ledger_chain()` still **0 rows**.

Then bring writers fully up (if not already): `sudo docker compose -f docker-compose.prod.yml up -d api worker`.

---

## 7. ROLLBACK

Per `0045-0048-prod-apply.md` (0045 CREATE OR REPLACE · 0046 REVOKE · **0047 irreversible** enum ·
0048 multi-step), **plus:**
- **0049** — `ALTER TABLE tse_clients DROP COLUMN last_alert_tier;` (reversible; cert escalation goes dumb).
- **0050** — **DO NOT REVERT (binding compliance).** The KYC trigger enforces GwG §10 / §259 StGB. If it
  regresses, **fix forward** (a corrected migration), never disable. Prod has 0 rows, so any POST-VERIFY
  failure → STOP, diagnose, re-apply a corrected forward migration.

---

## 8. POS + Control Desktop release (SEPARATE — tagged OTA)

The cashier UI (KYC client gate, the §27 UX redesign, the cashier hardening) + the Control Desktop
ship via a signed tag, NOT the server deploy:
```bash
git tag v0.3.0 <converged-pos-commit> && git push origin v0.3.0   # → release.yml → minisign → GitHub Release + latest.json
```
- Requires converging the POS branches (`ux-*`, the cashier set, `control-desktop-polish`, **and the
  POS client changes inside `gwg-kyc-enforcement`** — `evaluateKycGate`, IntakeList/Bezahlen dialogs).
- `TAURI_SIGNING_PRIVATE_KEY` must be in CI secrets only (never the repo).
- Installed POS/Desktop poll `latest.json` hourly → verify minisign → prompt + install. No auto-downgrade.
- **The server (0050 trigger) is the authoritative KYC gate; the POS gate is UI-surfacing** — so the
  server deploy can precede the POS release without a compliance gap (an out-of-date POS still can't
  bypass the trigger).

---

## 9. Go-live checklist (after §1–8)

- [ ] §2 KYC trigger integration test **green**.
- [ ] Migrations 0045–0050 applied + POST-VERIFY (§5) all pass.
- [ ] api/worker `:latest` deployed; E2E smoke (§6) incl. the **live KYC block** confirmed.
- [ ] **HIL hardware session** — ZVT card terminal (still cash-only), label print + scan round-trip, Fiskaly TSE live, camera.
- [ ] POS/Control-Desktop tagged release installed on the shop machines (§8).
- [ ] Owner briefed: he is Geldwäschebeauftragter (§43); he decides Smurfing-alert aborts (§29.1).
