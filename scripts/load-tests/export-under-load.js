/**
 * Scenario: EXPORT-UNDER-LOAD — the auditor pulls a big day while the shop
 * keeps selling.
 *
 * Two scenarios run CONCURRENTLY:
 *
 *   • `sellers`  — a steady trickle of reserve+finalize (the shop is open).
 *   • `exporters` — repeatedly download the DATEV CSV and the DSFinV-K ZIP
 *      for an existing (ideally large) daily closing.
 *
 * Assertions: the exports stay HTTP 200 (never 5xx, never time out) AND stay
 * under the documented export SLA even while finalize traffic competes for the
 * same DB. A heavy export must not starve the sell path, and the sell path
 * must not make the export error out.
 *
 * "Seed/assume a large day": this script does NOT fabricate a day — it targets
 * the most recent FINALIZED closing returned by /api/closings (fall back to the
 * newest closing of any state). For a meaningful test, point BASE_URL at a DB
 * that already has a full day of transactions, or pass CLOSING_ID explicitly.
 *
 * Run:
 *   k6 run -e BASE_URL=http://localhost:3000 \
 *          -e CLOSING_ID=<uuid> scripts/load-tests/export-under-load.js
 *
 * Note: the export routes require ADMIN|READONLY + step-up. The test-mode
 * owner PIN login is ADMIN and freshly stepped-up, so a single login covers
 * both the seller and exporter roles.
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

import {
  BASE_URL,
  SLA,
  authHeaders,
  buildCashSaleBody,
  fetchAvailableProducts,
  fetchClosings,
  loginOnce,
  uuidv4,
} from './lib/common.js';

const datevDuration = new Trend('export_datev_duration', true);
const dsfinvkDuration = new Trend('export_dsfinvk_duration', true);
const exportNon200 = new Counter('export_non_200'); // BUG: an export did not return 200
const exportBytes = new Counter('export_bytes'); // sanity: exports actually carried data

export const options = {
  scenarios: {
    // The shop keeps selling — modest, steady.
    sellers: {
      executor: 'constant-arrival-rate',
      exec: 'sell',
      rate: 6,
      timeUnit: '1m',
      duration: '3m',
      preAllocatedVUs: 3,
      maxVUs: 6,
    },
    // Auditors pull exports concurrently.
    exporters: {
      executor: 'constant-vus',
      exec: 'exportDay',
      vus: 3,
      duration: '3m',
      startTime: '10s', // let a few sales land first
    },
  },
  thresholds: {
    export_non_200: ['count==0'], // every export must return 200
    'http_req_duration{name:export:datev}': [
      `p(95)<${SLA.export.p95}`,
      `p(99)<${SLA.export.p99}`,
    ],
    'http_req_duration{name:export:dsfinvk}': [
      `p(95)<${SLA.export.p95}`,
      `p(99)<${SLA.export.p99}`,
    ],
    // The competing sell path must still mostly succeed (some 409/429 ok).
    'http_req_failed{name:transactions:finalize}': ['rate<0.5'],
  },
};

export function setup() {
  const { token } = loginOnce();

  // Resolve the closing to export.
  let closingId = __ENV.CLOSING_ID || null;
  if (!closingId) {
    const closings = fetchClosings(token);
    if (closings.length > 0) {
      const finalized = closings.find((c) => c.state === 'FINALIZED');
      closingId = (finalized || closings[0]).id;
    }
  }
  if (!closingId) {
    console.warn(
      'EXPORT-UNDER-LOAD: no closing id found. Pass -e CLOSING_ID=<uuid> or point ' +
        'BASE_URL at a DB with at least one daily closing. The exporter VUs will idle.',
    );
  }

  const products = fetchAvailableProducts(token, 30).map((p) => p.id);
  return { token, closingId, products };
}

// ── Seller VU body ─────────────────────────────────────────────────────────
export function sell(data) {
  const { token, products } = data;
  if (!products || products.length === 0) {
    sleep(1);
    return;
  }
  const productId = products[(__VU * 3 + __ITER) % products.length];
  const sessionId = uuidv4();

  const reserveRes = http.post(
    `${BASE_URL}/api/inventory/reserve`,
    JSON.stringify({ productId, channel: 'POS', sessionId }),
    { headers: authHeaders(token), tags: { name: 'inventory:reserve' } },
  );
  if (reserveRes.status !== 200) return;

  const grossCents = 800 + ((__VU * 211 + __ITER * 173) % 20000);
  const body = buildCashSaleBody(productId, sessionId, grossCents, uuidv4());
  http.post(`${BASE_URL}/api/transactions/finalize`, JSON.stringify(body), {
    headers: authHeaders(token),
    tags: { name: 'transactions:finalize' },
  });
}

// ── Exporter VU body ─────────────────────────────────────────────────────────
export function exportDay(data) {
  const { token, closingId } = data;
  if (!closingId) {
    sleep(1);
    return;
  }

  // DATEV CSV.
  const datev = http.get(
    `${BASE_URL}/api/closings/${closingId}/export/datev`,
    { headers: authHeaders(token), tags: { name: 'export:datev' }, timeout: '30s' },
  );
  datevDuration.add(datev.timings.duration);
  const datevOk = check(datev, { 'datev export 200': (r) => r.status === 200 });
  if (!datevOk) exportNon200.add(1);
  else exportBytes.add(datev.body ? datev.body.length : 0);

  // DSFinV-K ZIP bundle.
  const dsfinvk = http.get(
    `${BASE_URL}/api/closings/${closingId}/export/dsfinvk`,
    { headers: authHeaders(token), tags: { name: 'export:dsfinvk' }, timeout: '30s' },
  );
  dsfinvkDuration.add(dsfinvk.timings.duration);
  const dsfinvkOk = check(dsfinvk, { 'dsfinvk export 200': (r) => r.status === 200 });
  if (!dsfinvkOk) exportNon200.add(1);
  else exportBytes.add(dsfinvk.body ? dsfinvk.body.length : 0);

  sleep(1); // exporters poll, they don't busy-loop
}
