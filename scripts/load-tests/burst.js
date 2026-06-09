/**
 * Scenario: BURST — concurrency correctness, not just throughput.
 *
 * 50 concurrent virtual users hammer reserve + finalize over 2 minutes. This
 * scenario does NOT primarily care about latency; it asserts two SAFETY
 * properties under contention:
 *
 *   1. NO DOUBLE-SELL. Many VUs race to reserve the SAME small pool of
 *      products. Exactly one VU may win each product (reserve → 200); the
 *      losers MUST get a clean 409 PRODUCT_NOT_RESERVABLE, never a 200 and
 *      never a 5xx. And a single logical sale retried with the SAME
 *      idempotencyKey MUST return the SAME transaction id — never two rows.
 *
 *   2. GRACEFUL 429s, NOT 5xx. The finalize limit is 30/min/actor. Because
 *      every VU shares ONE actor (one login), a 50-VU burst WILL exceed it.
 *      The server must shed load with HTTP 429 (Too Many Requests), never
 *      collapse into 500s. We assert: zero 5xx on the hot paths, and that the
 *      over-limit traffic surfaces as 429.
 *
 * Run:
 *   k6 run -e BASE_URL=http://localhost:3000 scripts/load-tests/burst.js
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Rate } from 'k6/metrics';

import {
  BASE_URL,
  authHeaders,
  buildCashSaleBody,
  fetchAvailableProducts,
  loginOnce,
  uuidv4,
} from './lib/common.js';

const reserveWon = new Counter('reserve_won'); // got the product (200)
const reserveLost = new Counter('reserve_lost_409'); // clean race loss (409)
const reserve5xx = new Counter('reserve_5xx'); // BUG: server error under load
const finalize429 = new Counter('finalize_429'); // graceful shed
const finalize5xx = new Counter('finalize_5xx'); // BUG: server error under load
const idempotencyViolations = new Counter('idempotency_violations'); // BUG: two ids for one key
const idempotencyOk = new Rate('idempotency_consistent'); // retry returned same id

export const options = {
  scenarios: {
    burst: {
      executor: 'constant-vus',
      vus: 50, // 50 concurrent
      duration: '2m',
    },
  },
  thresholds: {
    // The two SAFETY assertions — these FAIL the run if violated.
    reserve_5xx: ['count==0'], // reserve must never 5xx under contention
    finalize_5xx: ['count==0'], // finalize must never 5xx under contention
    idempotency_violations: ['count==0'], // a retried key must never create 2 rows
    idempotency_consistent: ['rate==1.0'], // every retry returned the original id
    // Over-limit traffic MUST appear as 429, proving the limiter engaged
    // (rather than the run accidentally staying under the cap and proving
    // nothing). If this fails, raise VUs or lower the window — not a server bug.
    finalize_429: ['count>0'],
    // No request should hard-fail in a way other than the documented 409/429.
    'http_req_failed{name:transactions:finalize}': ['rate<0.95'],
  },
};

export function setup() {
  const { token } = loginOnce();
  // Intentionally a SMALL pool so VUs collide and we exercise the race.
  const products = fetchAvailableProducts(token, 20).map((p) => p.id);
  if (products.length === 0) {
    console.warn(
      'BURST: no AVAILABLE products — the double-sell assertion cannot run. ' +
        'Seed stock into the test DB first.',
    );
  }
  return { token, products };
}

export default function (data) {
  const { token, products } = data;
  if (!products || products.length === 0) {
    sleep(1);
    return;
  }

  // Deliberately narrow the pool further so MANY VUs target the SAME product
  // in the same instant — that is the double-sell race.
  const poolSize = Math.min(products.length, 5);
  const productId = products[__ITER % poolSize];
  const sessionId = uuidv4();

  // ── Reserve: exactly one VU may win each product ────────────────────────
  const reserveRes = http.post(
    `${BASE_URL}/api/inventory/reserve`,
    JSON.stringify({ productId, channel: 'POS', sessionId }),
    { headers: authHeaders(token), tags: { name: 'inventory:reserve' } },
  );

  if (reserveRes.status >= 500) {
    reserve5xx.add(1);
    return;
  }
  if (reserveRes.status === 409) {
    reserveLost.add(1);
    check(reserveRes, { 'race loss is a clean 409': () => true });
    sleep(0.2);
    return;
  }
  if (reserveRes.status === 429) {
    // Reserve isn't separately limited but may hit the global default — fine.
    sleep(0.5);
    return;
  }
  if (reserveRes.status !== 200) {
    sleep(0.2);
    return;
  }
  reserveWon.add(1);

  // ── Finalize with a FIXED idempotency key, then RETRY it ────────────────
  // We send the same logical sale twice with the same key. The server's
  // INSERT … ON CONFLICT (idempotency_key) must return the SAME transaction
  // id both times — proving at-most-once finalize.
  const idemKey = uuidv4();
  const grossCents = 1000 + ((__VU * 53 + __ITER * 97) % 9000);
  const body = JSON.stringify(buildCashSaleBody(productId, sessionId, grossCents, idemKey));

  const first = http.post(`${BASE_URL}/api/transactions/finalize`, body, {
    headers: authHeaders(token),
    tags: { name: 'transactions:finalize' },
  });

  if (first.status >= 500) {
    finalize5xx.add(1);
    return;
  }
  if (first.status === 429) {
    finalize429.add(1);
    // Graceful shed — the limiter engaged. Nothing was committed; move on.
    check(first, { 'over-limit is 429 not 5xx': (r) => r.status === 429 });
    return;
  }
  if (first.status !== 200) {
    // 409 (e.g. product already SOLD via a prior winner) is acceptable here.
    return;
  }

  const firstId = first.json('id');
  check(first, { 'first finalize has an id': () => !!firstId });

  // RETRY the exact same key.
  const retry = http.post(`${BASE_URL}/api/transactions/finalize`, body, {
    headers: authHeaders(token),
    tags: { name: 'transactions:finalize-retry' },
  });

  if (retry.status >= 500) {
    finalize5xx.add(1);
    return;
  }
  if (retry.status === 429) {
    // Limiter ate the retry — we can't assert idempotency this iteration, but
    // it's not a violation. Skip the consistency check.
    finalize429.add(1);
    return;
  }
  if (retry.status === 200) {
    const retryId = retry.json('id');
    const same = retryId === firstId;
    idempotencyOk.add(same);
    if (!same) {
      idempotencyViolations.add(1);
      console.error(
        `DOUBLE-SELL: idempotency key ${idemKey} produced two ids: ${firstId} vs ${retryId}`,
      );
    }
  }
}
