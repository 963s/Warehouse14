# @warehouse14/worker

The system's *subconscious mind* — a separate Node process that runs the
background cron jobs the API can't (and shouldn't) own. See
`docs/memory.md` decision #63 for the canonical architectural decision.

## Why PG-native (not BullMQ + Redis)

V1 ships on a single Oracle Cloud VM (ADR-0012). Postgres is already the
single source of truth + the SPOF. Layering Redis on top would add operational
surface area without changing the failure mode. We rely on three Postgres
primitives:

- **`pg_try_advisory_lock(bigint)`** for per-job mutual exclusion. The lock
  lives on a dedicated session-scoped connection — if the worker crashes,
  PG releases the lock at session death. Zero zombie locks.
- **`worker_job_runs` + `worker_job_dlq` tables** (migration 0017) for
  history + dead-letter persistence.
- **`node-cron`** for in-process scheduling.

If horizontal scaling lands later (Phase 1.5 item I-7), the public
`JobDefinition` interface stays identical — only the runner's lock primitive
swaps to Redis Redlock.

## Resilience contract

For every job, every tick:

| Phase | Behaviour |
|---|---|
| Tick fires | Runner attempts `pg_try_advisory_lock(hashtext(jobName))` on a fresh connection. Failure → SKIPPED, recorded, lock connection closed. |
| Lock acquired | `INSERT worker_job_runs (status='RUNNING')` returning id. |
| Job body | Called with `JobContext { db, sql, runId, jobRunId, signal, log }`. Timeout enforced via `AbortController` + `setTimeout(timeoutMs)`. `jobRunId` is the bigint `worker_job_runs.id` for the current attempt — embed in domain rows for forensics (see `lbma_prices` → `metal_prices.fetched_by_job_run_id`). |
| Body returns | `UPDATE worker_job_runs SET status='SUCCESS', finished_at, payload=…`. Counter reset. Metrics ticked. |
| Body throws | `UPDATE … SET status='FAILED', error_message`. Counter incremented. If ≥ `maxRetries`: INSERT into `worker_job_dlq` + emit `alert.worker_job_dead_letter` ledger event + counter reset. |
| Body times out | Same as throws, but `status='TIMEOUT'`. |
| Always | `pg_advisory_unlock`, dedicated connection `.end()`. |

## V1 job inventory

| Name | Schedule | Purpose |
|---|---|---|
| `reservation_sweeper` | every 1 min | releases STOREFRONT/EBAY reservations past `reservation_expires_at` |
| `chain_verifier` | daily 05:00 | runs `verify_ledger_chain()` — emits `alert.hash_chain_verification_failed` on any break |
| `sessions_cleanup` | hourly :15 | deletes sessions with `expires_at < now() - 7 days` |
| `anomaly_watchdog` | every 5 min | z-score on cash sales count vs trailing 30 d; emits `alert.anomaly_detected` |
| `lbma_prices` | every 15 min | STUB — fetches `LBMA_PRICES_URL` (configurable); persists to `system_settings.lbma.latest_fix` |
| `dsfinvk_daily_export` | daily 02:00 | SCAFFOLD — inserts `dsfinvk_exports` row state=GENERATING for yesterday's FINALIZED closing. Full CSV builder = Phase 1. |

## Running locally

```bash
# From repo root, with the API's docker-compose already running PG:
corepack pnpm --filter @warehouse14/worker dev
# … listens on 127.0.0.1:3100 (METRICS_PORT).
curl http://127.0.0.1:3100/health    # → { ok: true, db: 'up', ... }
curl http://127.0.0.1:3100/metrics   # → Prometheus text format
```

## Layout

```
src/
├── server.ts                       # entrypoint
├── app.ts                          # buildWorker() factory — testable
├── config/env.ts                   # TypeBox env + warehouse14_worker role guard
├── lib/
│   ├── job-runner.ts               # the core — advisory lock + retry + DLQ + metrics
│   └── metrics.ts                  # prom-client Registry + per-job counters
├── jobs/
│   ├── reservation-sweeper.ts
│   ├── chain-verifier.ts
│   ├── sessions-cleanup.ts
│   ├── anomaly-watchdog.ts
│   ├── lbma-prices.ts              # STUB endpoint-pluggable
│   ├── dsfinvk-daily-export.ts     # SCAFFOLD
│   └── index.ts
└── (no plugins/ dir — /health + /metrics live directly in app.ts)
tests/integration/
└── runner-resilience.test.ts       # 10 tests
```

## Tests

```bash
corepack pnpm --filter @warehouse14/worker test
```

Coverage:
- Lifecycle: SUCCESS row + metrics increment.
- Advisory lock: parallel `runOnce` of the same job → one SUCCESS + one SKIPPED.
- Failure path: 3 consecutive failures (default maxRetries) → DLQ row + alert ledger event emitted.
- Timeout: job exceeding `timeoutMs` → TIMEOUT row.
- Graceful close: subsequent `runOnce` → SKIPPED(closing).
- End-to-end: `reservation_sweeper` releases an expired RESERVED product + emits `inventory.reservation_auto_released`.
- HTTP: `/health` 200 db=up; `/metrics` contains `worker_job_runs_total` + `worker_up` + `process_cpu_user_seconds_total`.

## Conventions

- Pino-style structured logs with `{ job, runId }` labels (matches metric labels).
- Audit-log INSERTs go through `@warehouse14/audit.emit()` — same hash chain
  as the API.
- Inserts that hit `ledger_events` use the column-restricted INSERT grant
  (migration 0017 mirrors the app role's surface).
- New jobs: define the `JobDefinition`, register in `app.ts`, update memory.md
  decision #63's job inventory, add an integration test driving `runOnce(name)`.
