/**
 * eBay Trading API client (Epic D) — just the `EndItem` call the reconciler
 * needs. When no token is configured (dev / test / CI) it returns a mock
 * success so the reconciler flow runs without eBay credentials; the real HTTP
 * call is the only mocked part.
 */

export type EbayFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal | undefined;
  },
) => Promise<Response>;

export interface EndItemResult {
  ended: boolean;
  /** True when no token was configured and the call was mocked. */
  mock: boolean;
  /** Trimmed provider response (or mock reason) — safe for the event payload. */
  detail: string;
}

export interface EbayClientOptions {
  baseUrl?: string;
  fetchImpl?: EbayFetch;
}

const DEFAULT_BASE_URL = 'https://api.ebay.com/ws/api.dll';
const defaultFetch: EbayFetch = (input, init) => fetch(input, init as RequestInit | undefined);

/** EndItem XML envelope (EndingReason `NotAvailable` — sold elsewhere). */
function endItemXml(itemRef: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><EndItemRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ItemID>${itemRef}</ItemID><EndingReason>NotAvailable</EndingReason></EndItemRequest>`;
}

/**
 * End an eBay listing. Resolves `{ ended: true }` on success; throws on a
 * configured-but-failing call so the reconciler can leave the row for retry.
 */
export async function endEbayListing(
  token: string,
  itemRef: string,
  opts: EbayClientOptions = {},
): Promise<EndItemResult> {
  if (token.length === 0) {
    return { ended: true, mock: true, detail: 'mock: EBAY_API_TOKEN not configured' };
  }

  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? defaultFetch;

  const res = await fetchImpl(baseUrl, {
    method: 'POST',
    headers: {
      'X-EBAY-API-CALL-NAME': 'EndItem',
      'X-EBAY-API-IAF-TOKEN': token,
      'X-EBAY-API-SITEID': '77', // Germany
      'X-EBAY-API-COMPATIBILITY-LEVEL': '1193',
      'Content-Type': 'text/xml',
    },
    body: endItemXml(itemRef),
  });

  if (!res.ok) {
    throw new Error(`eBay EndItem failed: HTTP ${res.status}`);
  }
  const text = await res.text();
  if (!text.includes('<Ack>Success</Ack>') && !text.includes('<Ack>Warning</Ack>')) {
    throw new Error('eBay EndItem returned a non-success Ack');
  }
  return { ended: true, mock: false, detail: text.slice(0, 300) };
}
