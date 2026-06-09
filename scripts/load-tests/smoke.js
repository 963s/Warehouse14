/**
 * Scenario: SMOKE — a 10-second, 2-VU sanity run.
 *
 * NOT a load test. This proves the harness itself works end-to-end against a
 * running API: login once, list products, do a tiny reserve+finalize, and read
 * a couple of cheap endpoints. Use it before a real run to confirm the env vars
 * (BASE_URL / PIN / DEVICE_FINGERPRINT) and the auth handshake are correct.
 *
 * Run:
 *   k6 run -e BASE_URL=http://localhost:3000 scripts/load-tests/smoke.js
 */

import { check, sleep } from 'k6';
import http from 'k6/http';

import {
  BASE_URL,
  SLA,
  authHeaders,
  buildCashSaleBody,
  fetchAvailableProducts,
  loginOnce,
  uuidv4,
} from './lib/common.js';

export const options = {
  vus: 2,
  duration: '10s',
  thresholds: {
    // Smoke only needs the harness to function; keep thresholds loose but real.
    checks: ['rate>0.9'],
    'http_req_duration{name:products:list}': [`p(95)<${SLA.read.p95 * 3}`],
  },
};

export function setup() {
  const { token, actor } = loginOnce();
  console.log(`SMOKE: logged in as ${actor && actor.role} (isOwner=${actor && actor.isOwner})`);
  const products = fetchAvailableProducts(token, 10).map((p) => p.id);
  console.log(`SMOKE: found ${products.length} AVAILABLE product(s)`);
  return { token, products };
}

export default function (data) {
  const { token, products } = data;

  // Cheap read — always available.
  const list = http.get(`${BASE_URL}/api/products?status=AVAILABLE&limit=5`, {
    headers: authHeaders(token),
    tags: { name: 'products:list' },
  });
  check(list, { 'products list 200': (r) => r.status === 200 });

  // If there's stock, exercise one reserve+finalize so the smoke covers the
  // money path too. Otherwise just the read above is enough to prove auth works.
  if (products && products.length > 0) {
    const productId = products[__VU % products.length];
    const sessionId = uuidv4();
    const reserveRes = http.post(
      `${BASE_URL}/api/inventory/reserve`,
      JSON.stringify({ productId, channel: 'POS', sessionId }),
      { headers: authHeaders(token), tags: { name: 'inventory:reserve' } },
    );
    // 409 just means another VU grabbed it — fine for a smoke.
    check(reserveRes, { 'reserve 200 or 409': (r) => r.status === 200 || r.status === 409 });

    if (reserveRes.status === 200) {
      const body = buildCashSaleBody(productId, sessionId, 4999, uuidv4());
      const fin = http.post(
        `${BASE_URL}/api/transactions/finalize`,
        JSON.stringify(body),
        { headers: authHeaders(token), tags: { name: 'transactions:finalize' } },
      );
      check(fin, { 'finalize 200': (r) => r.status === 200 });
    }
  }

  sleep(1);
}
