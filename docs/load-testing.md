# Load Testing — SLAs, Thresholds, and How to Run

Status: harness authored, SLAs are **initial targets** (conservative, not yet
calibrated against a real baseline run). The k6 scripts live in
[`scripts/load-tests/`](../scripts/load-tests/) — see that
[README](../scripts/load-tests/README.md) for the per-script run commands.

This document is the single source of truth for the **target latency SLAs** and
the **threshold rationale** behind every scenario. The numbers here are mirrored
in `scripts/load-tests/lib/common.js` (`export const SLA`) — keep the two in
sync.

---

## Why this exists

The previous capacity signal was an ad-hoc `curl` stress loop: not repeatable,
no assertions, no record of what "good" looks like. This harness makes load a
**gated, versioned artifact**: each scenario declares k6 `thresholds`, so a run
exits non-zero the moment an SLA is breached. That's the difference between
"it felt fast" and "p95 finalize was 612 ms, under the 900 ms SLA."

The system under test is the live single-box deployment described in the project
memory: one Oracle arm64 host running postgres + redis + api + worker behind a
Cloudflare tunnel. The SLAs are sized for that box, **including the public edge
hop** — they are end-to-end-from-a-client numbers, not in-datacenter numbers.

---

## Auth & rate-limit discipline (read before running)

The API enforces (see `apps/api-cloud/src/plugins/rate-limit.ts`):

| Path prefix | Limit | Key |
| --- | --- | --- |
| `/api/auth/*` | **10 / minute** | per IP |
| `/api/transactions/finalize` | **30 / minute** | per actor |
| `/api/transactions/storno` | **30 / minute** | per actor |
| everything else | 300 / minute (default) | per actor, else IP |

Consequences baked into the harness:

- **Login once.** `lib/common.js#loginOnce()` runs only in k6 `setup()` (a
  single invocation for the whole test) and the Bearer token is reused by every
  VU. No VU ever calls `/api/auth/*`, so the 10/min cap is never near.
- **Finalize is 30/min/actor.** Because all VUs share one login, the `burst`
  scenario *deliberately* exceeds this — and asserts the overflow comes back as
  **429, not 5xx**. A real multi-cashier deployment has one actor per cashier,
  so production headroom is `30 × cashiers`/min; the single-actor test is the
  pessimistic floor.

---

## Target SLAs

Latencies are server response time as seen by the client (k6 `http_req_duration`),
in milliseconds. p50/p95/p99 are the percentiles over the run.

| Path | Tag | p50 | p95 | p99 | Notes |
| --- | --- | ---: | ---: | ---: | --- |
| Read (product list, closings list) | `read` | 120 | 400 | 800 | Index reads; cheap. |
| Reserve (`POST /api/inventory/reserve`) | `reserve` | 150 | 500 | 1000 | One race-safe `UPDATE`. |
| Finalize (`POST /api/transactions/finalize`) | `finalize` | 250 | 900 | 1800 | The artery: multi-statement TX + hash-chain/ledger/customer-rollup triggers. |
| Export (DATEV CSV, DSFinV-K ZIP) | `export` | 800 | 3000 | 6000 | Full-day bundle generation; heavy by design, must not block selling. |
| SSE connect (first bytes) | `sseConnect` | — | 1500 | — | Handshake + initial replay + first heartbeat. |

These are encoded as the `SLA` object in `lib/common.js` and consumed by each
scenario's `thresholds`. **Tightening procedure:** run `baseline` against a
representative box, take the observed p95/p99 + ~30% headroom, and lower the SLA
to match. Until then, treat the numbers above as a generous ceiling.

---

## Scenarios & their assertions

### 1. `baseline.js` — a normal busy day

- **Load:** `constant-arrival-rate` 10 sales/min for 15 min, 5 preallocated VUs
  (~5 cashiers), up to 10 VUs of headroom.
- **Each iteration:** reserve a product → finalize a one-line cash VERKAUF.
- **Thresholds (gates the run):**
  - `http_req_duration{name:inventory:reserve}` → `p95 < 500`, `p99 < 1000`
  - `http_req_duration{name:transactions:finalize}` → `p95 < 900`, `p99 < 1800`
  - `http_req_failed{name:transactions:finalize}` → `rate < 0.01`
  - `http_req_failed{name:inventory:reserve}` → `rate < 0.05`

### 2. `burst.js` — concurrency correctness

- **Load:** `constant-vus` 50 VUs for 2 min, all racing a tiny product pool.
- **Asserts (these are the point of the scenario):**
  - `reserve_5xx == 0` — reserve never 5xxs under contention.
  - `finalize_5xx == 0` — finalize never 5xxs under contention.
  - `idempotency_violations == 0` — a finalize retried with the **same
    `idempotencyKey`** returns the **same transaction id**, never two rows
    (no double-sell).
  - `idempotency_consistent rate == 1.0` — every observed retry matched.
  - `finalize_429 > 0` — the limiter actually engaged (over-limit traffic shed
    as 429), proving graceful degradation rather than the run accidentally
    staying under the cap.

### 3. `export-under-load.js` — auditor pulls a big day while the shop sells

- **Load:** two concurrent scenarios — `sellers` (6 sales/min) and `exporters`
  (3 VUs hitting DATEV + DSFinV-K repeatedly) for 3 min.
- **Thresholds:**
  - `export_non_200 == 0` — every export returns 200, never 5xx / timeout.
  - `http_req_duration{name:export:datev}` → `p95 < 3000`, `p99 < 6000`
  - `http_req_duration{name:export:dsfinvk}` → `p95 < 3000`, `p99 < 6000`
  - `http_req_failed{name:transactions:finalize}` → `rate < 0.5` (the sell path
    must keep mostly succeeding; some 409/429 under the competing export is ok).
- **Seeding:** pass `-e CLOSING_ID=<uuid>` for a specific (large) day, else the
  newest FINALIZED closing is auto-selected.

### 4. `sse-fanout.js` — many subscribers, no cascade

- **Load:** `subscribers` = 60 VUs repeatedly opening `GET /api/sse/ledger`
  (a reconnect storm) for 2 min, plus `writers` = 5 finalizes/min to generate
  fan-out events.
- **Thresholds:**
  - `http_req_duration{name:sse:connect}` → `p95 < 1500` — no handshake
    starvation.
  - `sse_failed < 5` — almost every connection establishes.
  - `write_during_fanout_5xx == 0` — the **write path never 5xxs because of
    the SSE fan-out** (the cascade guard).
- **Note:** k6 has no native `EventSource`; each subscriber uses `http.get` with
  a `timeout` (`SSE_HOLD_MS`, default 3 s) to capture the handshake + initial
  replay + first heartbeat, then re-opens — which also exercises reconnect load.

---

## How to run

Install k6 (one line):

```bash
brew install k6
# or run via Docker without installing:
#   docker run --rm -i grafana/k6 run - < scripts/load-tests/smoke.js
```

Then, against a **non-production** target with a populated test DB:

```bash
# 1) Sanity — 10 s, 2 VU. Confirms auth + env vars + the harness itself.
k6 run -e BASE_URL=http://localhost:3000 scripts/load-tests/smoke.js

# 2) The four scenarios.
k6 run -e BASE_URL=http://localhost:3000 scripts/load-tests/baseline.js
k6 run -e BASE_URL=http://localhost:3000 scripts/load-tests/burst.js
k6 run -e BASE_URL=http://localhost:3000 -e CLOSING_ID=<uuid> scripts/load-tests/export-under-load.js
k6 run -e BASE_URL=http://localhost:3000 scripts/load-tests/sse-fanout.js
```

Useful flags:

- `--summary-export=summary.json` — machine-readable result for CI/trend tracking.
- `--out json=raw.json` — full per-request stream for offline analysis.
- `-e PIN=… -e DEVICE_FINGERPRINT=…` — override the login + device identity.

A breached threshold makes `k6 run` exit non-zero. In CI, run `smoke.js` on
every PR and the heavier scenarios on a schedule against staging.

### Environment variables

| Var | Default | Meaning |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:3000` | API under test. |
| `PIN` | `0000` | POS PIN (test-mode owner). |
| `DEVICE_FINGERPRINT` | `loadtest-device-0001` | `x-dev-device-fingerprint` header so a CASHIER is "paired". |
| `CLOSING_ID` | auto | `export-under-load.js` — daily-closing UUID to export. |
| `SSE_VUS` | `60` | `sse-fanout.js` — concurrent subscribers. |
| `SSE_HOLD_MS` | `3000` | `sse-fanout.js` — per-subscriber hold time. |

---

## Safety

- **Never run the heavy scenarios against `api.warehouse14.de`.** They commit
  real finalizes (immutable fiscal rows, hash-chain entries) and broadcast
  fan-out events. Always target a disposable test DB.
- The harness does **not** hammer prod from CI. Authoring + the smoke run are
  the only things executed in development; full runs are an explicit, manual,
  staging-only action.
