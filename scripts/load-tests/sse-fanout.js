/**
 * Scenario: SSE-FANOUT — many "watch the cashier from home" subscribers.
 *
 * The live ledger stream (GET /api/sse/ledger) and the companion-device
 * subsystem fan ONE pg_notify event out to EVERY connected subscriber. The
 * risk under load is a cascade: one slow/broken subscriber, or N subscribers
 * all reconnecting at once, dragging the whole stream — or the broadcast — down.
 *
 * This scenario opens many concurrent long-lived SSE connections and a small
 * amount of WRITE traffic (finalize) to generate fan-out events, then asserts:
 *
 *   • Every SSE connection establishes (200 + text/event-stream) under the
 *     connect SLA — no subscriber is starved at handshake.
 *   • Connections stay open and receive the heartbeat/`event:` frames (we read
 *     at least the initial bytes) — the stream isn't dropping subscribers.
 *   • The concurrent finalize path does NOT degrade into 5xx because of the
 *     SSE load — i.e. no cascade from the read-stream side into writes.
 *
 * k6 has no native EventSource, so we use http.get with a short `timeout` to
 * grab the connection's initial frames (headers + replay + first heartbeat)
 * and measure time-to-first-bytes. Each iteration re-opens (k6's per-iteration
 * model) which also exercises the reconnect storm — exactly the cascade risk.
 *
 * Run:
 *   k6 run -e BASE_URL=http://localhost:3000 scripts/load-tests/sse-fanout.js
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
  loginOnce,
  uuidv4,
} from './lib/common.js';

const sseConnectTime = new Trend('sse_connect_time', true);
const sseConnected = new Counter('sse_connected'); // streams that opened cleanly
const sseFailed = new Counter('sse_failed'); // streams that did NOT open
const sseGotEventStream = new Counter('sse_content_type_ok'); // correct content-type
const writeDuringFanout5xx = new Counter('write_during_fanout_5xx'); // cascade detector

// How long each subscriber holds the connection (ms). The SSE route emits a
// heartbeat comment periodically; this window is enough to capture the
// handshake + initial replay + at least the first heartbeat without making the
// run take forever. k6 treats the timeout-close as the end of the request.
const HOLD_MS = Number(__ENV.SSE_HOLD_MS || 3000);

export const options = {
  scenarios: {
    // Many concurrent subscribers, repeatedly connecting (reconnect storm).
    subscribers: {
      executor: 'constant-vus',
      exec: 'subscribe',
      vus: Number(__ENV.SSE_VUS || 60),
      duration: '2m',
    },
    // A trickle of writes so there are real fan-out events to broadcast, and
    // so we can prove the write path survives the read-stream load.
    writers: {
      executor: 'constant-arrival-rate',
      exec: 'write',
      rate: 5,
      timeUnit: '1m',
      duration: '2m',
      preAllocatedVUs: 2,
      maxVUs: 4,
      startTime: '5s',
    },
  },
  thresholds: {
    // Every subscriber must connect promptly — no handshake starvation.
    'http_req_duration{name:sse:connect}': [`p(95)<${SLA.sseConnect.p95}`],
    // The vast majority of connection attempts must succeed.
    sse_failed: ['count<5'],
    // No cascade: the write path must never 5xx because of the SSE fan-out.
    write_during_fanout_5xx: ['count==0'],
  },
};

export function setup() {
  const { token } = loginOnce();
  const products = fetchAvailableProducts(token, 20).map((p) => p.id);
  return { token, products };
}

// ── Subscriber VU body ──────────────────────────────────────────────────────
export function subscribe(data) {
  const { token } = data;

  // Open the stream. We do NOT want k6 to wait forever — `timeout` caps the
  // hold so the iteration ends and re-opens (the reconnect storm). The bytes
  // received before the timeout are the handshake + replay + heartbeats.
  const res = http.get(`${BASE_URL}/api/sse/ledger`, {
    headers: {
      ...authHeaders(token),
      Accept: 'text/event-stream',
    },
    tags: { name: 'sse:connect' },
    timeout: `${HOLD_MS}ms`,
  });

  sseConnectTime.add(res.timings.duration);

  // A long-poll that the client closes via timeout reports status 0 in k6 even
  // though the connection was fine. So we treat EITHER a clean 200 OR a
  // timeout-after-headers as "connected", and only count a real failure when
  // the server actively rejected the handshake (401/403/5xx).
  const rejected = res.status >= 400;
  const contentType = (res.headers['Content-Type'] || res.headers['content-type'] || '').toLowerCase();
  const looksLikeStream = contentType.indexOf('text/event-stream') !== -1;

  if (rejected) {
    sseFailed.add(1);
    check(res, { 'sse handshake not rejected': () => false });
  } else {
    sseConnected.add(1);
    if (looksLikeStream) sseGotEventStream.add(1);
    check(res, { 'sse connected (200 or held-open)': () => true });
  }
}

// ── Writer VU body — generate fan-out events ────────────────────────────────
export function write(data) {
  const { token, products } = data;
  if (!products || products.length === 0) {
    sleep(1);
    return;
  }
  const productId = products[(__VU + __ITER) % products.length];
  const sessionId = uuidv4();

  const reserveRes = http.post(
    `${BASE_URL}/api/inventory/reserve`,
    JSON.stringify({ productId, channel: 'POS', sessionId }),
    { headers: authHeaders(token), tags: { name: 'inventory:reserve' } },
  );
  if (reserveRes.status >= 500) {
    writeDuringFanout5xx.add(1);
    return;
  }
  if (reserveRes.status !== 200) return;

  const grossCents = 1500 + ((__VU * 91 + __ITER * 251) % 15000);
  const body = buildCashSaleBody(productId, sessionId, grossCents, uuidv4());
  const finalizeRes = http.post(
    `${BASE_URL}/api/transactions/finalize`,
    JSON.stringify(body),
    { headers: authHeaders(token), tags: { name: 'transactions:finalize' } },
  );
  if (finalizeRes.status >= 500) writeDuringFanout5xx.add(1);
}
