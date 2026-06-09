/**
 * Scenario: BASELINE — "a normal busy day".
 *
 * Models ~5 virtual cashiers ringing up ~10 sales/minute for 15 minutes and
 * asserts the hot-path latency stays under the documented SLA. This is the
 * repeatable, precise replacement for the old ad-hoc curl stress run.
 *
 * Each iteration is ONE full sale: reserve a product → finalize a cash sale.
 * Login happens once in setup() (the /api/auth/ limit is 10/min), and the
 * token is reused by every VU.
 *
 * Run:
 *   k6 run -e BASE_URL=http://localhost:3000 scripts/load-tests/baseline.js
 *
 * Pace control: `constant-arrival-rate` fixes the SALE RATE (≈10/min)
 * independent of latency — exactly how a real shop behaves (cashiers don't
 * speed up because the server is fast). 5 cashiers = preallocated VUs.
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter } from 'k6/metrics';

import {
  BASE_URL,
  SLA,
  authHeaders,
  buildCashSaleBody,
  fetchAvailableProducts,
  loginOnce,
  uuidv4,
} from './lib/common.js';

const soldOut = new Counter('sales_no_stock'); // iterations skipped: no AVAILABLE product
const saleOk = new Counter('sales_completed'); // reserve+finalize both 200

export const options = {
  scenarios: {
    baseline_cashiers: {
      executor: 'constant-arrival-rate',
      rate: 10, // 10 sales ...
      timeUnit: '1m', // ... per minute
      duration: '15m',
      preAllocatedVUs: 5, // ~5 virtual cashiers
      maxVUs: 10, // headroom if latency spikes
    },
  },
  thresholds: {
    // Reserve hot path.
    'http_req_duration{name:inventory:reserve}': [
      `p(95)<${SLA.reserve.p95}`,
      `p(99)<${SLA.reserve.p99}`,
    ],
    // Finalize hot path — the artery.
    'http_req_duration{name:transactions:finalize}': [
      `p(95)<${SLA.finalize.p95}`,
      `p(99)<${SLA.finalize.p99}`,
    ],
    // No request may fail outright (excluding the deliberate "no stock" skip).
    'http_req_failed{name:transactions:finalize}': ['rate<0.01'],
    'http_req_failed{name:inventory:reserve}': ['rate<0.05'],
  },
};

export function setup() {
  const { token } = loginOnce();
  const products = fetchAvailableProducts(token, 50).map((p) => p.id);
  if (products.length === 0) {
    // Not fatal — but warn loudly; the run will just count `sales_no_stock`.
    console.warn(
      'BASELINE: no AVAILABLE products found. Seed stock or point BASE_URL at a ' +
        'populated test DB, otherwise every iteration is a no-op skip.',
    );
  }
  return { token, products };
}

export default function (data) {
  const { token, products } = data;
  if (!products || products.length === 0) {
    soldOut.add(1);
    sleep(1);
    return;
  }

  // Pick a product round-robin-ish by VU+iter so cashiers don't all collide on
  // the same row (which would be a real race, tested separately in burst.js).
  const idx = (__VU * 7 + __ITER) % products.length;
  const productId = products[idx];
  const sessionId = uuidv4();

  // 1) Reserve (AVAILABLE → RESERVED).
  const reserveRes = http.post(
    `${BASE_URL}/api/inventory/reserve`,
    JSON.stringify({ productId, channel: 'POS', sessionId }),
    { headers: authHeaders(token), tags: { name: 'inventory:reserve' } },
  );

  // 409 = product already reserved/sold by another VU this run; that's an
  // expected, graceful outcome — skip the finalize, don't count it as a sale.
  if (reserveRes.status === 409) {
    sleep(0.5);
    return;
  }
  check(reserveRes, { 'reserve 200': (r) => r.status === 200 });
  if (reserveRes.status !== 200) {
    sleep(0.5);
    return;
  }

  // 2) Finalize a cash sale for a synthetic gross between €5 and €500.
  const grossCents = 500 + ((__VU * 137 + __ITER * 311) % 49500);
  const body = buildCashSaleBody(productId, sessionId, grossCents, uuidv4());
  const finalizeRes = http.post(
    `${BASE_URL}/api/transactions/finalize`,
    JSON.stringify(body),
    { headers: authHeaders(token), tags: { name: 'transactions:finalize' } },
  );

  const finalized = check(finalizeRes, {
    'finalize 200': (r) => r.status === 200,
    'finalize returned receiptLocator': (r) =>
      r.status === 200 && !!r.json('receiptLocator'),
  });
  if (finalized) saleOk.add(1);
}
