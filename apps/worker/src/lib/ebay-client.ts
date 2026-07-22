/**
 * eBay Trading API client (Epic D) — just the `EndItem` call the reconciler
 * needs.
 *
 * Ohne Zugang wird ABGELEHNT, nicht gemeldet, das Inserat sei beendet. Siehe
 * `EbayNotConfiguredError`.
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
  /** Immer false. Ein beendetes Inserat kann nicht simuliert werden. */
  mock: boolean;
  /** Trimmed provider response — safe for the event payload. */
  detail: string;
}

/**
 * Wird geworfen, wenn kein eBay-Zugang hinterlegt ist.
 *
 * Vorher meldete diese Stelle ohne Zugang `ended: true`, OHNE eBay überhaupt
 * zu fragen. Der Abgleich schrieb daraufhin `ebay_state` von ONLINE auf
 * BEENDET und vermerkte „sold at retail counter; eBay listing ended".
 *
 * Das Inserat war aber weiter online. Und weil hier jedes Stück ein Einzelstück
 * ist, heißt das: das Haus hält es für vom Markt genommen, während es auf eBay
 * weiter gekauft werden kann. Ein zweiter Käufer bezahlt dann eine Sache, die
 * über den Tresen bereits gegangen ist.
 *
 * Auf der Produktion ist `EBAY_API_TOKEN` nicht gesetzt und der Abgleich läuft
 * alle fünf Minuten. Ausgelöst hat es bisher nichts, weil noch kein Stück
 * überhaupt einen eBay-Zustand trägt. Es hätte beim ersten Inserat gegriffen.
 */
export class EbayNotConfiguredError extends Error {
  public readonly code = 'EBAY_NOT_CONFIGURED';
  constructor() {
    super(
      'Für eBay ist kein Zugang hinterlegt. Das Inserat wurde NICHT beendet und ' +
        'steht weiterhin online; der Artikel bleibt zum Abgleich vorgemerkt.',
    );
    this.name = 'EbayNotConfiguredError';
  }
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
 * Ohne Zugang wird ebenfalls geworfen: der Abgleich behält die Zeile, und der
 * Zustand bleibt ONLINE, weil das Inserat online IST.
 */
export async function endEbayListing(
  token: string,
  itemRef: string,
  opts: EbayClientOptions = {},
): Promise<EndItemResult> {
  if (token.length === 0) {
    throw new EbayNotConfiguredError();
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
