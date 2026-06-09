# Warehouse14 — k6 Load-Test Harness

Repeatable, precise load tests for the Warehouse14 API (`apps/api-cloud`). This
replaces the old ad-hoc `curl` stress run with versioned [k6](https://k6.io)
scripts and documented SLAs.

The full SLA table, threshold rationale, and how to interpret results live in
**[`docs/load-testing.md`](../../docs/load-testing.md)**. This README is the
quick "how do I run it" reference.

## Install k6 (one line)

```bash
brew install k6          # macOS
# or: docker run --rm -i grafana/k6 run - < scripts/load-tests/smoke.js
```

(Other platforms: https://grafana.com/docs/k6/latest/set-up/install-k6/)

## Scripts

| Script | What it proves |
| --- | --- |
| `smoke.js` | 10 s / 2 VU sanity — the harness + auth + env vars work. Run this first. |
| `baseline.js` | ~5 cashiers, ~10 sales/min, 15 min. Asserts hot-path p95/p99 < SLA. |
| `burst.js` | 50 concurrent reserve+finalize, 2 min. Asserts **no double-sell** (idempotency) and **graceful 429s, never 5xx**. |
| `export-under-load.js` | DATEV + DSFinV-K export while finalize traffic competes. Asserts exports stay **200** and under the export SLA. |
| `sse-fanout.js` | Many concurrent SSE subscribers + reconnect storm. Asserts no cascade into the write path. |

`lib/common.js` is shared: it logs in **once** in `setup()` and hands the Bearer
token to every VU, so no scenario ever trips the `/api/auth/*` 10/min cap.

## Run

```bash
# Sanity first.
k6 run -e BASE_URL=http://localhost:3000 scripts/load-tests/smoke.js

# Then the scenarios.
k6 run -e BASE_URL=http://localhost:3000 scripts/load-tests/baseline.js
k6 run -e BASE_URL=http://localhost:3000 scripts/load-tests/burst.js
k6 run -e BASE_URL=http://localhost:3000 -e CLOSING_ID=<uuid> scripts/load-tests/export-under-load.js
k6 run -e BASE_URL=http://localhost:3000 scripts/load-tests/sse-fanout.js
```

A run **fails** (non-zero exit) if any `thresholds` entry is breached — that's
the SLA gate. Wire it into CI by running `smoke.js` on every PR and the heavier
scenarios on a schedule against a staging box.

## Environment variables

| Var | Default | Meaning |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:3000` | API under test. **Never point at prod** for the heavy scenarios. |
| `PIN` | `0000` | POS PIN to log in with (test-mode owner). |
| `DEVICE_FINGERPRINT` | `loadtest-device-0001` | Sent as `x-dev-device-fingerprint` so a CASHIER has a paired device. Harmless if the server already sets `TEST_DEVICE_FINGERPRINT`. |
| `CLOSING_ID` | (auto) | `export-under-load.js` only — the daily-closing UUID to export. Auto-resolves to the newest closing if unset. |
| `SSE_VUS` | `60` | `sse-fanout.js` — number of concurrent subscribers. |
| `SSE_HOLD_MS` | `3000` | `sse-fanout.js` — how long each subscriber holds the stream. |

## Pre-run checklist

- The target API is **up** and reachable at `BASE_URL` (`curl $BASE_URL/health`).
- The test DB has **AVAILABLE stock** — `baseline`/`burst`/`sse-fanout` reserve
  real products. With zero stock they degrade to no-op skips (counted as
  `sales_no_stock` / warnings), not crashes.
- For `export-under-load`, the DB has at least one **daily closing** (ideally a
  large day) — pass `-e CLOSING_ID=<uuid>` to pin it.
- **Do not run the heavy scenarios against production.** They commit real
  finalizes (fiscal rows) and generate fan-out. Use a disposable test DB.

## Money discipline

All money on the wire is an integer-cent value formatted into a Decimal string
by `eur()` in `lib/common.js` (pure integer math + string padding). No
`parseFloat` / `toFixed` arithmetic anywhere — this is a GoBD/KassenSichV POS.
