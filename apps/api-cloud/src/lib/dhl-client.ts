/**
 * DHL Versenden (Parcel DE Shipping) client (Epic D).
 *
 * Builds an authenticated label request from env credentials and returns the
 * tracking number + Base64 PDF label. When credentials are absent (dev / test /
 * CI) it returns a deterministic MOCK label so the end-to-end flow works
 * without DHL sandbox access — the real HTTP call is the only mocked part.
 *
 * PII: the recipient address is passed through opaquely and is NEVER logged.
 */

export interface DhlConfig {
  user: string;
  signature: string;
  ekp: string;
}

export interface DhlShipmentRequest {
  /** Our reference (the transaction id) — echoed into the DHL order. */
  reference: string;
  /** Decrypted recipient address blob. Opaque to this client; never logged. */
  recipientAddress: string;
  /** Parcel weight in grams; defaults to 500 g if unknown. */
  weightGrams?: number;
}

export interface DhlLabelResult {
  trackingNumber: string;
  /** Base64-encoded PDF shipping label. */
  labelBase64: string;
  /** True when produced by the offline mock (no DHL credentials configured). */
  mock: boolean;
}

export type DhlFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal | undefined;
  },
) => Promise<Response>;

export interface DhlClientOptions {
  baseUrl?: string;
  fetchImpl?: DhlFetch;
}

const DEFAULT_BASE_URL = 'https://api-sandbox.dhl.com/parcel/de/shipping/v2';
const defaultFetch: DhlFetch = (input, init) => fetch(input, init as RequestInit | undefined);

export function isDhlConfigured(config: DhlConfig): boolean {
  return config.user.length > 0 && config.signature.length > 0 && config.ekp.length > 0;
}

/** Minimal but valid single-page PDF, used as the mock label body. */
function mockLabelPdf(trackingNumber: string): string {
  const pdf = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 283 425]>>endobj',
    `% DHL MOCK LABEL ${trackingNumber}`,
    'trailer<</Root 1 0 R>>',
    '%%EOF',
  ].join('\n');
  return Buffer.from(pdf, 'utf8').toString('base64');
}

/** Deterministic synthetic tracking number from the reference (mock mode). */
function mockTrackingNumber(reference: string): string {
  const digits = reference.replace(/\D/g, '').padEnd(12, '0').slice(0, 12);
  return `00340434${digits}`; // DHL tracking numbers are 20 digits
}

function basicAuth(config: DhlConfig): string {
  return `Basic ${Buffer.from(`${config.user}:${config.signature}`, 'utf8').toString('base64')}`;
}

/**
 * Create a DHL shipping label. Resolves to `{ trackingNumber, labelBase64 }`.
 * Throws on a configured-but-failing DHL call.
 */
export async function createDhlLabel(
  config: DhlConfig,
  req: DhlShipmentRequest,
  opts: DhlClientOptions = {},
): Promise<DhlLabelResult> {
  if (!isDhlConfigured(config)) {
    const trackingNumber = mockTrackingNumber(req.reference);
    return { trackingNumber, labelBase64: mockLabelPdf(trackingNumber), mock: true };
  }

  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? defaultFetch;

  const body = {
    profile: 'STANDARD_GRUPPENPROFIL',
    shipments: [
      {
        product: 'V01PAK',
        billingNumber: config.ekp,
        refNo: req.reference,
        details: { weight: { uom: 'g', value: req.weightGrams ?? 500 } },
        // The consignee address is sent opaquely; we never log it.
        consignee: { address: req.recipientAddress },
      },
    ],
  };

  const res = await fetchImpl(`${baseUrl}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: basicAuth(config),
      'dhl-api-key': config.signature,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`DHL label request failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as {
    items?: Array<{ shipmentNo?: string; label?: { b64?: string } }>;
  };
  const item = data.items?.[0];
  if (!item?.shipmentNo || !item.label?.b64) {
    throw new Error('DHL response missing shipmentNo / label');
  }

  return { trackingNumber: item.shipmentNo, labelBase64: item.label.b64, mock: false };
}
