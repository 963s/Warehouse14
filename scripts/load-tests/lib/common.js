/**
 * Shared helpers for the Warehouse14 k6 load-test harness.
 *
 * Every scenario imports from here so the auth handshake, header shaping,
 * money discipline, and the documented SLA constants live in ONE place.
 *
 * ── Auth discipline (CRITICAL) ───────────────────────────────────────────
 * The API caps `/api/auth/*` at 10 requests / minute / IP (see
 * apps/api-cloud/src/plugins/rate-limit.ts). A naive k6 test that logs in
 * per-VU per-iteration trips that limit in seconds and reports phantom 429s.
 *
 * So the harness LOGS IN EXACTLY ONCE in `setup()` (which k6 runs a single
 * time, before any VU starts) and hands the resulting Bearer token to every
 * VU via the setup-data return value. No VU ever calls `/api/auth/*`.
 *
 * ── Money discipline ─────────────────────────────────────────────────────
 * This is a German GoBD/KassenSichV POS: money is integer cents or Decimal
 * STRINGS on the wire — never a JS float. `eur()` formats an integer-cent
 * amount into the `"12.34"` Decimal string the API's TypeBox schema expects.
 * No parseFloat / toFixed arithmetic anywhere.
 */

import http from 'k6/http';
import { check, fail } from 'k6';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ─────────────────────────────────────────────────────────────────────────
// Environment / configuration
// ─────────────────────────────────────────────────────────────────────────

/** Base URL of the API under test. Default = local dev API (port 3000). */
export const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

/** POS PIN to authenticate with. Test-mode owner PIN is `0000`. */
export const PIN = __ENV.PIN || '0000';

/**
 * Device fingerprint header. In test mode the server reads
 * `x-dev-device-fingerprint` (apps/api-cloud/src/plugins/mtls.ts) to bind
 * req.deviceId — a CASHIER needs a paired device for reserve/finalize. If the
 * server already has TEST_DEVICE_FINGERPRINT set, sending this is harmless.
 */
export const DEVICE_FINGERPRINT = __ENV.DEVICE_FINGERPRINT || 'loadtest-device-0001';

/** Tax treatment used for the synthetic VERKAUF lines. STANDARD_19 = 19% VAT. */
export const TAX_TREATMENT = 'STANDARD_19';

// ─────────────────────────────────────────────────────────────────────────
// Documented SLAs — the single source of truth for every scenario's
// `thresholds`. Keep these in sync with docs/load-testing.md.
//
// Latencies are in milliseconds. They are deliberately conservative for a
// single-box Oracle arm64 deployment behind a Cloudflare tunnel; tighten
// them once a real baseline run exists.
// ─────────────────────────────────────────────────────────────────────────

export const SLA = {
  // Read paths (product lookup, closings list) — cheap, mostly index reads.
  read: { p50: 120, p95: 400, p99: 800 },
  // Reserve — one race-safe UPDATE; slightly heavier than a read.
  reserve: { p50: 150, p95: 500, p99: 1000 },
  // Finalize — the heaviest hot path: a multi-statement DB transaction with
  // several BEFORE/AFTER triggers (hash chain, ledger, customer rollups).
  finalize: { p50: 250, p95: 900, p99: 1800 },
  // Export (DATEV / DSFinV-K) — generates a full-day CSV/ZIP bundle. Heavy by
  // design, but must NOT block or time out under concurrent finalize load.
  export: { p50: 800, p95: 3000, p99: 6000 },
  // SSE first-byte (headers + initial replay) — should connect promptly.
  sseConnect: { p95: 1500 },
};

// ─────────────────────────────────────────────────────────────────────────
// HTTP helpers
// ─────────────────────────────────────────────────────────────────────────

/** Standard JSON headers + Bearer token + device fingerprint. */
export function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'x-dev-device-fingerprint': DEVICE_FINGERPRINT,
  };
}

/**
 * Log in ONCE and return the Bearer token. MUST be called only from a k6
 * `setup()` (which runs a single time) so the 10/min auth cap is never near.
 *
 * Returns `{ token, actor }`. Throws (fails the test) if login fails — a
 * harness that silently runs unauthenticated would report meaningless 401s.
 */
export function loginOnce() {
  const res = http.post(
    `${BASE_URL}/api/auth/pin-login`,
    JSON.stringify({ pin: PIN }),
    {
      headers: {
        'Content-Type': 'application/json',
        'x-dev-device-fingerprint': DEVICE_FINGERPRINT,
      },
      tags: { name: 'auth:pin-login' },
    },
  );

  const ok = check(res, {
    'login returned 200': (r) => r.status === 200,
  });
  if (!ok) {
    fail(
      `pin-login failed (status ${res.status}). Body: ${String(res.body).slice(0, 300)}. ` +
        `Is the API up at ${BASE_URL} and is PIN '${PIN}' valid + the device paired?`,
    );
  }

  const body = res.json();
  const token = body && body.token;
  if (!token) {
    fail(
      'pin-login returned 200 but no `token` field. ' +
        'The Tauri-webview Bearer fallback must be enabled on this build.',
    );
  }
  return { token, actor: body.actor };
}

/**
 * Fetch a page of AVAILABLE products. Used by scenarios that need real
 * product ids to reserve/finalize against. Returns an array of `{ id, ... }`
 * (possibly empty if the test DB has no AVAILABLE stock).
 */
export function fetchAvailableProducts(token, limit = 50) {
  const res = http.get(
    `${BASE_URL}/api/products?status=AVAILABLE&limit=${limit}`,
    { headers: authHeaders(token), tags: { name: 'products:list' } },
  );
  if (res.status !== 200) return [];
  const body = res.json();
  const items = (body && body.items) || [];
  return items;
}

/** List recent closings — used by the export scenario to find an id to export. */
export function fetchClosings(token) {
  const res = http.get(`${BASE_URL}/api/closings`, {
    headers: authHeaders(token),
    tags: { name: 'closings:list' },
  });
  if (res.status !== 200) return [];
  const body = res.json();
  return (body && body.items) || [];
}

// ─────────────────────────────────────────────────────────────────────────
// Money helpers — integer cents → Decimal string. NEVER float arithmetic.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Format an integer number of cents as the `"12.34"` Decimal string the API
 * expects. Pure integer math + string padding — no float, no toFixed.
 */
export function eur(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents | 0);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  return `${sign}${whole}.${frac < 10 ? '0' : ''}${frac}`;
}

/**
 * Build a one-line, single-payment cash VERKAUF finalize body for a given
 * product + reservation session. Money is split into 19%-VAT components with
 * pure integer-cent math.
 *
 * grossCents → subtotal (net) + vat such that net + vat === gross. We derive
 * vat = round(gross - gross/1.19) using integer math: vat = gross*19/119.
 */
export function buildCashSaleBody(productId, reservationSessionId, grossCents, idempotencyKey) {
  // vat = gross * 19 / 119, rounded to nearest cent (banker-ish: round half up
  // is fine for synthetic load data — the API re-validates the equation).
  const vatCents = Math.round((grossCents * 19) / 119);
  const netCents = grossCents - vatCents;

  return {
    direction: 'VERKAUF',
    customerId: null,
    subtotalEur: eur(netCents),
    vatEur: eur(vatCents),
    totalEur: eur(grossCents),
    taxTreatmentCode: TAX_TREATMENT,
    items: [
      {
        productId,
        reservationSessionId,
        lineSubtotalEur: eur(netCents),
        lineVatEur: eur(vatCents),
        lineTotalEur: eur(grossCents),
        appliedTaxTreatmentCode: TAX_TREATMENT,
        appliedVatRate: '19.00',
        acquisitionCostEurSnapshot: null,
        marginEur: null,
        displayOrder: 0,
      },
    ],
    payments: [{ paymentMethod: 'CASH', amountEur: eur(grossCents) }],
    idempotencyKey: idempotencyKey || uuidv4(),
  };
}

/** Re-export uuidv4 so scenarios don't each import the jslib URL. */
export { uuidv4 };
