/**
 * Der Träger-Anschluss, geprüft an der Frage, die zählt: was tut er, wenn kein
 * Versanddienst angeschlossen ist, und kann eine Übungssendung jemals mit
 * einer echten verwechselt werden.
 */

import { describe, expect, it } from 'vitest';

import {
  carrierRefusalTextDe,
  type CreateLabelInput,
  createSimulatedCarrier,
  createUnconfiguredCarrier,
  needsCustoms,
  validateLabelInput,
} from '../../src/lib/shipping-carrier.js';

function input(over: Partial<CreateLabelInput> = {}): CreateLabelInput {
  return {
    shipmentId: 's-1',
    serviceCode: 'V01PAK',
    recipient: {
      recipientName: 'Erika Mustermann',
      line1: 'Hauptstraße 1',
      postalCode: '70173',
      city: 'Stuttgart',
      country: 'DE',
    },
    weightG: 500,
    ...over,
  };
}

describe('the unconfigured carrier refuses, and never pretends', () => {
  const dhl = createUnconfiguredCarrier();

  it('reports itself as not configured', () => {
    expect(dhl.configured).toBe(false);
    expect(dhl.simulated).toBe(false);
  });

  it('buys no label and hands out no number', async () => {
    const r = await dhl.createLabel(input());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('NOT_CONFIGURED');
    // Die Zusage, dass NICHTS passiert ist, muss im Text stehen: der Laden
    // muss wissen, ob DHL bereits belastet hat.
    expect(!r.ok && r.detail).toContain('kein Etikett gekauft');
  });

  it('separates "not connected yet" from "the carrier said no"', async () => {
    // Zwei völlig verschiedene Lagen: die eine löst der Inhaber mit einem
    // Zugang, die andere mit einer korrigierten Sendung.
    const r = await dhl.createLabel(input());
    expect(!r.ok && r.reason).not.toBe('CARRIER_REJECTED');
  });

  it('speaks German, with no raw code in the sentence', async () => {
    const r = await dhl.createLabel(input());
    const text = !r.ok ? carrierRefusalTextDe(r.reason, r.detail) : '';
    expect(text).not.toContain('_');
    expect(text).toContain('DHL');
  });
});

describe('a simulated label can never be mistaken for a real one', () => {
  it('marks the tracking number visibly, in the number itself', async () => {
    const sim = createSimulatedCarrier();
    const r = await sim.createLabel(input());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Der eigentliche Schutz. Eine simulierte Nummer im DHL-Format endet
    // damit, dass jemand ein echtes Paket mit einem erfundenen Etikett zur
    // Post trägt.
    expect(r.value.trackingNumber.startsWith('SIMULATION-')).toBe(true);
    expect(r.value.simulated).toBe(true);
    expect(r.value.labelPdf).toBeNull();
  });

  it('never produces a DHL-shaped number', async () => {
    const sim = createSimulatedCarrier();
    const r = await sim.createLabel(input());
    // Echte DHL-Sendungsnummern sind lange reine Ziffernfolgen.
    expect(r.ok && /^\d{10,}$/.test(r.value.trackingNumber)).toBe(false);
  });

  it('declares itself simulated on the port as well', () => {
    const sim = createSimulatedCarrier();
    expect(sim.simulated).toBe(true);
    expect(sim.configured).toBe(true);
  });

  it('is deterministic, so a test run twice gives the same numbers', async () => {
    const a = createSimulatedCarrier('DHL', (() => { let n = 0; return () => ++n; })());
    const b = createSimulatedCarrier('DHL', (() => { let n = 0; return () => ++n; })());
    const ra = await a.createLabel(input());
    const rb = await b.createLabel(input());
    expect(ra.ok && rb.ok && ra.value.trackingNumber).toBe(rb.ok ? rb.value.trackingNumber : '');
  });

  it('refuses to track a number that did not come from the simulation', async () => {
    const sim = createSimulatedCarrier();
    const r = await sim.track('00340434161094042557');
    expect(r.ok).toBe(false);
  });

  it('applies the SAME input checks a real carrier would', async () => {
    // Sonst übt man einen Weg ein, der beim echten Anschluss auseinanderfällt.
    const sim = createSimulatedCarrier();
    const r = await sim.createLabel(input({ weightG: 0 }));
    expect(!r.ok && r.reason).toBe('INVALID_INPUT');
  });
});

describe('customs, because the shop posts to the whole world', () => {
  it('knows which destinations need a declaration', () => {
    expect(needsCustoms('DE')).toBe(false);
    expect(needsCustoms('fr')).toBe(false);
    expect(needsCustoms('CH')).toBe(true); // Schweiz ist nicht in der EU
    expect(needsCustoms('GB')).toBe(true); // seit dem Austritt
    expect(needsCustoms('US')).toBe(true);
  });

  it('refuses a parcel outside the EU with no declaration', () => {
    // Ohne Inhaltserklärung bleibt das Paket am Zoll stehen. Besser hier
    // scheitern als dort.
    const problem = validateLabelInput(
      input({ recipient: { ...input().recipient, country: 'US' } }),
    );
    expect(problem).toContain('Zollinhaltserklärung');
  });

  it('accepts it once the declaration is complete', () => {
    const problem = validateLabelInput(
      input({
        recipient: { ...input().recipient, country: 'US' },
        customs: {
          contentsDescription: 'Sammlermünze Silber',
          valueCents: 24900,
          originCountry: 'DE',
          tariffNumber: '9705.31',
        },
      }),
    );
    expect(problem).toBeNull();
  });

  it('does not demand customs inside the EU', () => {
    expect(validateLabelInput(input({ recipient: { ...input().recipient, country: 'FR' } }))).toBeNull();
  });
});

describe('the input check names the missing field in German', () => {
  const cases: [Partial<CreateLabelInput>, string][] = [
    [{ recipient: { ...input().recipient, recipientName: '  ' } }, 'Name'],
    [{ recipient: { ...input().recipient, line1: '' } }, 'Straße'],
    [{ recipient: { ...input().recipient, postalCode: '' } }, 'Postleitzahl'],
    [{ recipient: { ...input().recipient, city: '' } }, 'Ort'],
    [{ recipient: { ...input().recipient, country: 'Deutschland' } }, 'Lieferland'],
    [{ weightG: 0 }, 'Gewicht'],
    [{ serviceCode: '' }, 'Versandprodukt'],
  ];

  it.each(cases)('names it: %#', (over, needle) => {
    const problem = validateLabelInput(input(over));
    expect(problem).not.toBeNull();
    expect(problem).toContain(needle);
    expect(problem).not.toContain('_');
  });

  it('passes a complete German parcel', () => {
    expect(validateLabelInput(input())).toBeNull();
  });
});
