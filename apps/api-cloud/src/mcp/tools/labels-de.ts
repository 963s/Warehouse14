/**
 * Shared German label maps + money formatting for the Jarvis read tools.
 *
 * The voice model SPEAKS the `summary` string of every tool result, so raw
 * SCREAMING enum tokens (many of which contain an underscore) must never reach
 * it. Each map turns a DB enum value into a natural German word; `labelDe()`
 * falls back to a de-tokenised form so an unmapped value still speaks cleanly
 * instead of leaking e.g. "USED_EXCELLENT". Money is formatted de-DE
 * (1.234,56) from the raw decimal strings the queries return; nothing is
 * rounded away or invented.
 */

export const PRODUCT_STATUS_DE: Record<string, string> = {
  DRAFT: 'Entwurf',
  AVAILABLE: 'verfügbar',
  RESERVED: 'reserviert',
  SOLD: 'verkauft',
};

export const ITEM_TYPE_DE: Record<string, string> = {
  gold_jewelry: 'Goldschmuck',
  gold_coin: 'Goldmünze',
  gold_bar: 'Goldbarren',
  silver_jewelry: 'Silberschmuck',
  silver_coin: 'Silbermünze',
  silver_bar: 'Silberbarren',
  platinum_jewelry: 'Platinschmuck',
  platinum_coin: 'Platinmünze',
  platinum_bar: 'Platinbarren',
  antique: 'Antiquität',
  watch: 'Uhr',
  other: 'Sonstiges',
};

export const METAL_DE: Record<string, string> = {
  gold: 'Gold',
  silver: 'Silber',
  platinum: 'Platin',
  palladium: 'Palladium',
};

export const CONDITION_DE: Record<string, string> = {
  NEW: 'neu',
  USED_EXCELLENT: 'gebraucht, sehr gut',
  USED_GOOD: 'gebraucht, gut',
  USED_FAIR: 'gebraucht, akzeptabel',
  ANTIQUE_RESTORED: 'antik, restauriert',
  ANTIQUE_AS_FOUND: 'antik, im Fundzustand',
};

export const EBAY_STATE_DE: Record<string, string> = {
  ENTWURF: 'Entwurf',
  GEPRUEFT: 'geprüft',
  ONLINE: 'online',
  VERKAUFT: 'verkauft',
  BEZAHLT: 'bezahlt',
  VERPACKT: 'verpackt',
  VERSENDET: 'versendet',
  REKLAMIERT: 'reklamiert',
  RETOURNIERT: 'retourniert',
  BEENDET: 'beendet',
};

export const TRUST_LEVEL_DE: Record<string, string> = {
  NEW: 'Neu',
  VERIFIED: 'Verifiziert',
  VIP: 'VIP',
  SUSPICIOUS: 'Auffällig',
  BANNED: 'Gesperrt',
};

/**
 * Map an enum token to its German label; if the map has no entry, de-tokenise
 * (drop underscores, lower-case) so the spoken output never contains a raw
 * SCREAMING_TOKEN. Returns '' for null/empty so callers can skip the field.
 */
export function labelDe(map: Record<string, string>, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  return map[value] ?? value.toLowerCase().split('_').join(' ');
}

/** de-DE money from a raw decimal string/number (e.g. "15845.62" → "15.845,62"). No " EUR" suffix. */
export function eurDE(raw: string | number | null | undefined): string {
  const n = Number(raw ?? 0);
  const v = Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(v);
}
