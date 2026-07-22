/**
 * Der Versandpreis, gegen die Fälle geprüft, die im Laden wirklich vorkommen.
 *
 * Der wichtigste Test ist nicht, dass 5,49 herauskommt. Er ist, dass für ein
 * Land ohne Preis KEINE Zahl herauskommt: ein erfundener Versandpreis ist ein
 * Versprechen an der Kasse, das der Laden am Paketschalter bezahlt.
 */

import { describe, expect, it } from 'vitest';

import {
  eurToCents,
  quoteShipping,
  refusalTextDe,
  resolveZone,
  type ShippingRateRow,
  type ShippingZoneRow,
} from '../../src/lib/shipping-quote.js';

const ZONES: ShippingZoneRow[] = [
  { id: 'z-de', code: 'DE', nameDe: 'Deutschland', countryCodes: ['DE'], isCatchAll: false, active: true },
  {
    id: 'z-eu',
    code: 'EU',
    nameDe: 'Europäische Union',
    countryCodes: ['FR', 'AT', 'NL'],
    isCatchAll: false,
    active: true,
  },
  { id: 'z-world', code: 'WORLD', nameDe: 'Übrige Welt', countryCodes: [], isCatchAll: true, active: true },
];

function rate(over: Partial<ShippingRateRow> & Pick<ShippingRateRow, 'id' | 'zoneId'>): ShippingRateRow {
  return {
    serviceCode: 'V01PAK',
    nameDe: 'DHL Paket',
    minWeightG: 0,
    maxWeightG: null,
    priceEur: '5.49',
    insuredUpToEur: null,
    freeAboveEur: null,
    active: true,
    sortOrder: 0,
    ...over,
  };
}

describe('resolveZone', () => {
  it('prefers a named zone over the catch-all', () => {
    // Sonst würde ein Land, das jemand bewusst nach Deutschland-Tarif gelegt
    // hat, plötzlich zum Welt-Tarif abgerechnet.
    expect(resolveZone(ZONES, 'DE')?.code).toBe('DE');
    expect(resolveZone(ZONES, 'FR')?.code).toBe('EU');
  });

  it('falls back to the catch-all for a country nobody listed', () => {
    expect(resolveZone(ZONES, 'JP')?.code).toBe('WORLD');
  });

  it('accepts lower case and stray spaces, rejects anything else', () => {
    expect(resolveZone(ZONES, ' fr ')?.code).toBe('EU');
    expect(resolveZone(ZONES, 'Deutschland')).toBeNull();
    expect(resolveZone(ZONES, '')).toBeNull();
    expect(resolveZone(ZONES, null)).toBeNull();
  });

  it('returns nothing at all when there is no catch-all and no match', () => {
    const named = ZONES.filter((z) => !z.isCatchAll);
    expect(resolveZone(named, 'JP')).toBeNull();
  });

  it('ignores a deactivated zone', () => {
    const off = ZONES.map((z) => (z.code === 'EU' ? { ...z, active: false } : z));
    // Fällt auf die Auffangzone, nicht auf die abgeschaltete EU-Zone.
    expect(resolveZone(off, 'FR')?.code).toBe('WORLD');
  });
});

describe('quoteShipping refuses rather than inventing a price', () => {
  const rates = [rate({ id: 'r1', zoneId: 'z-de' })];

  it('refuses without a destination', () => {
    const r = quoteShipping(ZONES, rates, { country: null, weightG: 500 });
    expect(r).toEqual({ ok: false, reason: 'NO_DESTINATION' });
  });

  it('refuses a country the shop does not serve', () => {
    const named = ZONES.filter((z) => !z.isCatchAll);
    const r = quoteShipping(named, rates, { country: 'JP', weightG: 500 });
    expect(r).toEqual({ ok: false, reason: 'COUNTRY_NOT_SERVED' });
  });

  it('refuses a weight nobody priced, instead of falling back to another band', () => {
    const banded = [rate({ id: 'r1', zoneId: 'z-de', minWeightG: 0, maxWeightG: 2000 })];
    const r = quoteShipping(ZONES, banded, { country: 'DE', weightG: 5000 });
    expect(r).toEqual({ ok: false, reason: 'NO_RATE_FOR_WEIGHT' });
  });

  it('refuses when the only rate carries an unreadable price', () => {
    // Lieber kein Angebot als ein falsches. Ein kaputter Preis darf nicht
    // stillschweigend als 0,00 durchgehen.
    const broken = [rate({ id: 'r1', zoneId: 'z-de', priceEur: 'kostenlos' })];
    const r = quoteShipping(ZONES, broken, { country: 'DE', weightG: 500 });
    expect(r).toEqual({ ok: false, reason: 'NO_RATE_FOR_WEIGHT' });
  });

  it('says each refusal in German, never as a code', () => {
    for (const reason of ['NO_DESTINATION', 'COUNTRY_NOT_SERVED', 'NO_RATE_FOR_WEIGHT'] as const) {
      const text = refusalTextDe(reason);
      expect(text).not.toContain('_');
      expect(text.length).toBeGreaterThan(20);
    }
  });
});

describe('quoteShipping picks the right band and the right price', () => {
  const banded = [
    rate({ id: 'small', zoneId: 'z-de', minWeightG: 0, maxWeightG: 2000, priceEur: '5.49' }),
    rate({ id: 'large', zoneId: 'z-de', minWeightG: 2001, maxWeightG: null, priceEur: '9.99' }),
  ];

  it('uses the band the weight actually falls into', () => {
    const a = quoteShipping(ZONES, banded, { country: 'DE', weightG: 500 });
    expect(a.ok && a.quote.priceCents).toBe(549);
    const b = quoteShipping(ZONES, banded, { country: 'DE', weightG: 3000 });
    expect(b.ok && b.quote.priceCents).toBe(999);
  });

  it('treats the band edges as inclusive', () => {
    const edge = quoteShipping(ZONES, banded, { country: 'DE', weightG: 2000 });
    expect(edge.ok && edge.quote.priceCents).toBe(549);
    const over = quoteShipping(ZONES, banded, { country: 'DE', weightG: 2001 });
    expect(over.ok && over.quote.priceCents).toBe(999);
  });

  it('rounds a fractional gram UP, so a 2000.4 g parcel is not priced as 2000 g', () => {
    const r = quoteShipping(ZONES, banded, { country: 'DE', weightG: 2000.4 });
    expect(r.ok && r.quote.priceCents).toBe(999);
  });

  it('takes the cheapest of several matching rates', () => {
    const two = [
      rate({ id: 'teuer', zoneId: 'z-de', priceEur: '9.99', sortOrder: 0 }),
      rate({ id: 'guenstig', zoneId: 'z-de', priceEur: '4.99', sortOrder: 1 }),
    ];
    const r = quoteShipping(ZONES, two, { country: 'DE', weightG: 100 });
    expect(r.ok && r.quote.rateId).toBe('guenstig');
  });

  it('can be pinned to one service', () => {
    const two = [
      rate({ id: 'paket', zoneId: 'z-de', serviceCode: 'V01PAK', priceEur: '5.49' }),
      rate({ id: 'warenpost', zoneId: 'z-de', serviceCode: 'V62WP', priceEur: '2.99' }),
    ];
    const r = quoteShipping(ZONES, two, { country: 'DE', weightG: 100, serviceCode: 'V01PAK' });
    expect(r.ok && r.quote.rateId).toBe('paket');
  });
});

describe('the free-shipping threshold', () => {
  const rates = [rate({ id: 'r1', zoneId: 'z-de', priceEur: '5.49', freeAboveEur: '100.00' })];

  it('drops the price to zero at and above the threshold', () => {
    const at = quoteShipping(ZONES, rates, { country: 'DE', weightG: 500, goodsValueCents: 10000 });
    expect(at.ok && at.quote.priceCents).toBe(0);
    expect(at.ok && at.quote.free).toBe(true);
  });

  it('still charges one cent below', () => {
    const below = quoteShipping(ZONES, rates, { country: 'DE', weightG: 500, goodsValueCents: 9999 });
    expect(below.ok && below.quote.priceCents).toBe(549);
    expect(below.ok && below.quote.free).toBe(false);
  });

  it('does NOT give free shipping when the basket value is unknown', () => {
    // Eine Grenze, deren Bezugsgröße fehlt, darf nicht zugunsten des Kunden
    // geraten werden: der Laden zahlt sonst den Unterschied.
    const unknown = quoteShipping(ZONES, rates, { country: 'DE', weightG: 500 });
    expect(unknown.ok && unknown.quote.priceCents).toBe(549);
    expect(unknown.ok && unknown.quote.free).toBe(false);
  });
});

describe('insurance, for a shop that posts gold', () => {
  const rates = [rate({ id: 'r1', zoneId: 'z-de', insuredUpToEur: '500.00' })];

  it('flags a parcel worth more than the cover', () => {
    const r = quoteShipping(ZONES, rates, { country: 'DE', weightG: 300, goodsValueCents: 120000 });
    expect(r.ok && r.quote.underinsured).toBe(true);
    expect(r.ok && r.quote.insuredUpToCents).toBe(50000);
  });

  it('does not flag a parcel inside the cover', () => {
    const r = quoteShipping(ZONES, rates, { country: 'DE', weightG: 300, goodsValueCents: 20000 });
    expect(r.ok && r.quote.underinsured).toBe(false);
  });

  it('does not claim underinsurance when the value is unknown', () => {
    const r = quoteShipping(ZONES, rates, { country: 'DE', weightG: 300 });
    expect(r.ok && r.quote.underinsured).toBe(false);
  });

  it('shipping is still offered when underinsured, it is a warning not a refusal', () => {
    const r = quoteShipping(ZONES, rates, { country: 'DE', weightG: 300, goodsValueCents: 999999 });
    expect(r.ok).toBe(true);
  });
});

describe('eurToCents', () => {
  it('reads what the database hands us', () => {
    expect(eurToCents('5.49')).toBe(549);
    expect(eurToCents('100')).toBe(10000);
    expect(eurToCents('0.05')).toBe(5);
    expect(eurToCents('-2.50')).toBe(-250);
  });

  it('returns null rather than a silent zero for anything unreadable', () => {
    // Ein stiller 0 wäre Gratisversand aus einem Tippfehler.
    for (const bad of ['', ' ', 'gratis', '1,50', '1.234', null, undefined]) {
      expect(eurToCents(bad)).toBeNull();
    }
  });
});
