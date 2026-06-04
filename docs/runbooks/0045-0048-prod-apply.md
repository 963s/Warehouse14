# Runbook — apply migrations 0045–0048 to production

Four forward-only DB fixes, each proven red→green on the branch. All are latent in
prod today (0 transactions, 0 customers) but block the first real customer sale.

| # | File | Fixes |
|---|------|-------|
| 0045 | `0045_fix_blind_index_hmac.sql` | `blind_index()` passed a text key to `hmac()` → every customer email/phone save/search throws. |
| 0046 | `0046_security_cumulative_select_grant.sql` | `warehouse14_security` lacked SELECT on the cumulative customer columns its accumulation triggers read → any known-customer sale aborts "permission denied for table customers". |
| 0047 | `0047_payment_method_add_debt.sql` | `payment_method` had no `'DEBT'` label, but 0016's guard trigger compares every payment to `'DEBT'` → the first `transaction_payments` INSERT of ANY kind throws. |
| 0048 | `0048_ledger_chain_head_serialize.sql` | GoBD ledger hash-chain forked under concurrency (stale snapshot tail read) → serialize via a head-row `FOR UPDATE` + in-lock id. |

Prod applies migrations via the **`migrate` one-shot service** (`ghcr.io/963s/warehouse14-migrate`),
which **bakes `packages/db/migrations` into the image** and runs `migrate.sh`
(`psql -f`, no `-1`, idempotent — each applied file is recorded in
`_w14_schema_migrations`, so only the four new files run). Because the migrations
are baked in, the image must be **rebuilt + streamed** (no GHCR push / no source on
the server), then the migrate service re-run.

Server: `myserver` · prod dir `/opt/warehouse14` · `.env` is root-owned (use `sudo`).
The Mac is arm64 = same arch as the Oracle box, so a local `--platform linux/arm64`
build loads directly on the server.

---

## PRE — quiescence + baseline

1. Enter a write-quiescent window (stop the writers so no emit/sale lands mid-apply;
   0048 also self-protects with `LOCK TABLE … SHARE ROW EXCLUSIVE`, this is belt-and-braces):
   ```bash
   ssh myserver 'cd /opt/warehouse14 && sudo docker compose -f docker-compose.prod.yml stop api worker'
   ```
2. Record the baseline (paste into the deploy log):
   ```bash
   ssh myserver "cd /opt/warehouse14 && sudo docker compose -f docker-compose.prod.yml exec -T postgres \
     psql -U warehouse14 -d warehouse14 -c \
     'SELECT count(*) AS ledger_rows FROM ledger_events;' -c 'SELECT * FROM verify_ledger_chain();'"
   ```
   **Expected:** the row count (last known: 15) and `verify_ledger_chain()` → **0 rows = chain intact**.
   If `verify_ledger_chain()` returns a break row, STOP — investigate before seeding 0048's head.

---

## APPLY — rebuild migrate image, stream, run

3. Build the migrate image with the four new migrations baked in (context = repo root):
   ```bash
   cd /Users/basel/Desktop/warehouse14
   docker buildx build --platform linux/arm64 \
     -f infrastructure/docker/migrate.Dockerfile \
     -t ghcr.io/963s/warehouse14-migrate:latest --load .
   ```
4. Stream it to the server:
   ```bash
   docker save ghcr.io/963s/warehouse14-migrate:latest | gzip -1 | ssh myserver 'gunzip | docker load'
   ```
5. Run the migrate one-shot (applies 0045 → 0046 → 0047 → 0048 in order; already-applied
   files are skipped). Watch the log for `applying 0045_… … 0048_…`:
   ```bash
   ssh myserver 'cd /opt/warehouse14 && sudo docker compose -f docker-compose.prod.yml up migrate'
   ssh myserver 'sudo docker logs warehouse14-migrate --tail 30'
   ```
   **Expected tail:** `[migrate] applying 0045_… / 0046_… / 0047_… / 0048_…` then
   `[migrate] done — applied 4, already-current N`. `migrate.sh` runs with
   `ON_ERROR_STOP=1`, so any failure aborts before recording — re-runnable.

---

## POST-VERIFY (all should pass)

6. Run the checks (paste results):
   ```bash
   ssh myserver "cd /opt/warehouse14 && sudo docker compose -f docker-compose.prod.yml exec -T postgres \
     psql -U warehouse14 -d warehouse14 \
     -c 'SELECT * FROM verify_ledger_chain();' \
     -c \"SELECT length(blind_index('x@y.z')) AS bi_len FROM (SELECT set_config('warehouse14.pii_key','runbook-check',true)) s;\" \
     -c \"SELECT 'DEBT'::payment_method AS debt_label;\" \
     -c \"SELECT has_column_privilege('warehouse14_security','customers','cumulative_spend_eur','SELECT') AS sec_can_read_spend;\" \
     -c 'SELECT only_row, length(last_row_hash) AS head_len FROM ledger_chain_head;'"
   ```
   **Expected:**
   - `verify_ledger_chain()` → **0 rows** (0048 preserved chain integrity; head seeded from the real tail).
   - `bi_len` → **32** and **no** `function hmac(...) does not exist` (0045).
   - `debt_label` → `DEBT` and **no** `invalid input value for enum payment_method` (0047) — this is exactly what unblocks the guard trigger that fires on every CASH payment.
   - `sec_can_read_spend` → **t** (0046; the accumulation trigger can now read the counter, so a known-customer VERKAUF no longer hits "permission denied").
   - `ledger_chain_head` → one row, `head_len` = 32 (0048 head present + seeded).
7. **End-to-end smoke (do via the POS/app, not psql):** record one CASH sale **to a known customer**.
   It must (a) complete the payment (DEBT-guard trigger passes — 0047), (b) bump that customer's
   `cumulative_spend_eur` without a permission error (0046), and (c) extend the ledger
   (`verify_ledger_chain()` still 0 rows — 0048/0045).
8. Bring the writers back:
   ```bash
   ssh myserver 'cd /opt/warehouse14 && sudo docker compose -f docker-compose.prod.yml up -d api worker'
   ```

---

## ROLLBACK

All four are **forward-only** (`CREATE OR REPLACE` / additive `GRANT` / enum `ADD VALUE` /
new table). The migrate service is idempotent; it never rolls back. To revert a single
migration manually (as `warehouse14_migrator`), and noting each revert **re-introduces the
original bug**:

- **0045** — `CREATE OR REPLACE FUNCTION blind_index(...)` back to 0007's body (text key). Re-breaks customer save/search.
- **0046** — `REVOKE SELECT (cumulative_spend_eur, cumulative_ankauf_eur, cumulative_debt_eur) ON customers FROM warehouse14_security;`. Re-breaks known-customer sales.
- **0047** — **irreversible**: PostgreSQL has no `ALTER TYPE … DROP VALUE`. The added `'DEBT'` label is harmless and unused-by-default; leave it. (Full revert would require recreating the enum + recasting every dependent column — do NOT.)
- **0048** — `CREATE OR REPLACE FUNCTION ledger_compute_hash()` back to 0008's body (advisory lock + `ORDER BY id DESC` SELECT), then `REVOKE SELECT, UPDATE ON ledger_chain_head` + `REVOKE USAGE ON SEQUENCE ledger_events_id_seq FROM warehouse14_security` and `DROP TABLE ledger_chain_head;`. Re-introduces the concurrency fork — only if 0048 itself regresses.

Because prod has 0 transactions/customers, a rollback has no data to unwind; the safe
response to any POST-VERIFY failure is to STOP, diagnose, and re-apply a corrected forward
migration rather than revert.
