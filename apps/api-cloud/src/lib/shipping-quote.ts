/**
 * Was der Versand kostet, und wann er ehrlich nein sagt.
 *
 * PUR. Kein Netz, keine Datenbank, keine Uhr. Die Zonen und Preise kommen als
 * Argumente herein, damit diese Rechnung ohne Server prüfbar ist und damit
 * derselbe Code den Preis im Checkout, auf der Rechnung und im Kassenbeleg
 * ergibt. Ein Versandpreis, der an zwei Stellen verschieden gerechnet wird,
 * ist ein Streit mit dem Kunden an der Tür.
 *
 * DIE WICHTIGSTE REGEL STEHT AM ANFANG: gibt es für ein Land keinen Preis,
 * dann ist die Antwort NICHT null und nicht irgendein Vorgabewert, sondern
 * „dorthin versenden wir noch nicht". Ein erfundener Preis wäre ein Versprechen
 * an der Kasse, das der Laden am Paketschalter bezahlt. Genau diese Sorte
 * Freundlichkeit hat den Shop schon „Versandkostenfrei" behaupten lassen,
 * während es überhaupt keinen Versand gab.
 *
 * Geld rechnet in ganzen Cent. Ein Versandpreis von 5,49 mal irgendetwas darf
 * nicht durch eine Fließkommazahl laufen.
 */

/** Eine benannte Ländergruppe. Genau eine darf die Auffangzone sein. */
export interface ShippingZoneRow {
  id: string;
  code: string;
  nameDe: string;
  /** ISO 3166-1 alpha-2, Großbuchstaben. Bei der Auffangzone leer. */
  countryCodes: readonly string[];
  isCatchAll: boolean;
  active: boolean;
}

/** Ein Preis für eine Zone in einem Gewichtsband. */
export interface ShippingRateRow {
  id: string;
  zoneId: string;
  serviceCode: string;
  nameDe: string;
  minWeightG: number;
  /** `null` heißt nach oben offen. */
  maxWeightG: number | null;
  /** NUMERIC(18,2) als String, wie er aus der Datenbank kommt. */
  priceEur: string;
  insuredUpToEur: string | null;
  freeAboveEur: string | null;
  active: boolean;
  sortOrder: number;
}

export type ShippingQuoteRefusal =
  /** Kein Land angegeben. */
  | 'NO_DESTINATION'
  /** Wir bedienen dieses Land nicht: keine Zone, auch keine Auffangzone. */
  | 'COUNTRY_NOT_SERVED'
  /** Zone ja, aber für dieses Gewicht ist kein Preis hinterlegt. */
  | 'NO_RATE_FOR_WEIGHT';

export interface ShippingQuote {
  zoneId: string;
  zoneCode: string;
  zoneNameDe: string;
  rateId: string;
  serviceCode: string;
  serviceNameDe: string;
  /** Ganze Cent. Null NUR, wenn die Freigrenze wirklich erreicht ist. */
  priceCents: number;
  /** Wahr, wenn der Preis wegen des Warenwerts auf null fiel. */
  free: boolean;
  /** Bis zu welchem Wert der Dienst ohne Zuschlag haftet, in Cent. */
  insuredUpToCents: number | null;
  /**
   * Der Warenwert liegt ÜBER der Deckung. Kein Grund, den Versand zu
   * verweigern, aber der Laden muss es wissen, bevor er Gold in einen
   * unterversicherten Umschlag legt.
   */
  underinsured: boolean;
}

export type ShippingQuoteResult =
  | { ok: true; quote: ShippingQuote }
  | { ok: false; reason: ShippingQuoteRefusal };

/** "12.34" → 1234. Leer, null oder unlesbar → null, niemals stillschweigend 0. */
export function eurToCents(value: string | null | undefined): number | null {
  if (value == null) return null;
  const t = value.trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  const neg = t.startsWith('-');
  const [whole, frac = ''] = (neg ? t.slice(1) : t).split('.');
  const cents = Number.parseInt(whole ?? '0', 10) * 100 + Number.parseInt((frac + '00').slice(0, 2), 10);
  return neg ? -cents : cents;
}

/** Groß, getrimmt. Alles andere ist kein Länderkürzel. */
function normalizeCountry(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(t) ? t : null;
}

/**
 * Welche Zone bedient dieses Land.
 *
 * Eine ausdrückliche Zone schlägt die Auffangzone immer. Sonst würde ein Land,
 * das jemand bewusst nach Deutschland-Tarif gelegt hat, plötzlich zum
 * Welt-Tarif abgerechnet, nur weil beide passen.
 */
export function resolveZone(
  zones: readonly ShippingZoneRow[],
  country: string | null | undefined,
): ShippingZoneRow | null {
  const cc = normalizeCountry(country);
  if (cc == null) return null;
  const active = zones.filter((z) => z.active);
  const named = active.find((z) => !z.isCatchAll && z.countryCodes.includes(cc));
  return named ?? active.find((z) => z.isCatchAll) ?? null;
}

/**
 * Der Preis für ein Ziel, ein Gewicht und einen Warenwert.
 *
 * `goodsValueCents` ist optional, weil eine Vorschau ohne Warenkorb legitim
 * ist. Fehlt er, greift KEINE Freigrenze: eine Grenze, deren Bezugsgröße
 * unbekannt ist, darf nicht zugunsten des Kunden geraten werden.
 */
export function quoteShipping(
  zones: readonly ShippingZoneRow[],
  rates: readonly ShippingRateRow[],
  input: {
    country: string | null | undefined;
    weightG: number;
    goodsValueCents?: number | null;
    /** Auf ein bestimmtes Produkt einschränken, sonst das günstigste. */
    serviceCode?: string | null;
  },
): ShippingQuoteResult {
  if (normalizeCountry(input.country) == null) return { ok: false, reason: 'NO_DESTINATION' };

  const zone = resolveZone(zones, input.country);
  if (zone == null) return { ok: false, reason: 'COUNTRY_NOT_SERVED' };

  const weight = Number.isFinite(input.weightG) && input.weightG > 0 ? Math.ceil(input.weightG) : 0;

  const candidates = rates
    .filter((r) => r.active && r.zoneId === zone.id)
    .filter((r) => (input.serviceCode == null ? true : r.serviceCode === input.serviceCode))
    .filter((r) => weight >= r.minWeightG && (r.maxWeightG == null || weight <= r.maxWeightG))
    // Ein unlesbarer Preis ist kein Preis. Lieber kein Angebot als ein falsches.
    .filter((r) => eurToCents(r.priceEur) != null);

  if (candidates.length === 0) return { ok: false, reason: 'NO_RATE_FOR_WEIGHT' };

  // Das billigste passende Band gewinnt; bei Gleichstand die eigene Reihenfolge
  // des Inhabers, damit die Auswahl vorhersagbar bleibt.
  const chosen = [...candidates].sort((a, b) => {
    const pa = eurToCents(a.priceEur) ?? Number.MAX_SAFE_INTEGER;
    const pb = eurToCents(b.priceEur) ?? Number.MAX_SAFE_INTEGER;
    return pa !== pb ? pa - pb : a.sortOrder - b.sortOrder;
  })[0]!;

  const listCents = eurToCents(chosen.priceEur) ?? 0;
  const freeAbove = eurToCents(chosen.freeAboveEur);
  const goods = input.goodsValueCents ?? null;
  const free = freeAbove != null && goods != null && goods >= freeAbove;

  const insured = eurToCents(chosen.insuredUpToEur);

  return {
    ok: true,
    quote: {
      zoneId: zone.id,
      zoneCode: zone.code,
      zoneNameDe: zone.nameDe,
      rateId: chosen.id,
      serviceCode: chosen.serviceCode,
      serviceNameDe: chosen.nameDe,
      priceCents: free ? 0 : listCents,
      free,
      insuredUpToCents: insured,
      underinsured: insured != null && goods != null && goods > insured,
    },
  };
}

/** Was der Kunde liest, wenn kein Preis zustande kommt. Nie eine Rohmarke. */
export function refusalTextDe(reason: ShippingQuoteRefusal): string {
  switch (reason) {
    case 'NO_DESTINATION':
      return 'Bitte zuerst das Lieferland angeben.';
    case 'COUNTRY_NOT_SERVED':
      return 'In dieses Land versenden wir derzeit nicht. Abholung im Geschäft ist weiterhin möglich.';
    case 'NO_RATE_FOR_WEIGHT':
      return 'Für dieses Gewicht ist noch kein Versandpreis hinterlegt. Bitte sprechen Sie uns an, wir finden einen Weg.';
  }
}
