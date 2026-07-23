/**
 * Die Marke darf NICHTS behaupten, was nicht existiert.
 *
 * Der teuerste Fehler dieses Hauses war zweimal derselbe: eine Nummer im
 * richtigen Format zu erfinden, wenn die echte fehlt. Der wichtigste Test hier
 * ist deshalb nicht, dass die Marke hübsch aussieht, sondern dass sie keine
 * Sendungsnummer trägt und lieber gar nicht druckt als halb.
 */

import { describe, expect, it } from 'vitest';

import { fehlendeAngaben, versandmarkeHtml, type MarkeBestellung } from './versandmarke.js';

const ABSENDER = {
  name: 'Briefmarken-To-Go',
  anschrift: ['Rosenstraße 40', '73614 Schorndorf'],
};

const VERSAND: MarkeBestellung = {
  bestellnummer: 'BST-2026-000001',
  versandart: 'SHIPPING',
  empfaenger: 'Maria Schneider',
  lieferanschrift: 'Hauptstraße 5\n70173 Stuttgart',
  land: 'DE',
  stueckzahl: 2,
  bestelltAm: '23.07.2026',
};

const ABHOLUNG: MarkeBestellung = {
  ...VERSAND,
  versandart: 'PICKUP',
  lieferanschrift: null,
  land: null,
  stueckzahl: 1,
};

describe('fehlendeAngaben', () => {
  it('lässt eine vollständige Versandbestellung durch', () => {
    expect(fehlendeAngaben(VERSAND)).toEqual([]);
    expect(fehlendeAngaben(ABHOLUNG)).toEqual([]);
  });

  it('verlangt eine Lieferanschrift, wenn versendet wird', () => {
    expect(fehlendeAngaben({ ...VERSAND, lieferanschrift: null })).toEqual([
      'Für eine Versandbestellung fehlt die Lieferanschrift.',
    ]);
    // Leerzeichen sind keine Anschrift.
    expect(fehlendeAngaben({ ...VERSAND, lieferanschrift: '   ' })).toHaveLength(1);
  });

  it('verlangt eine Bestellnummer', () => {
    expect(fehlendeAngaben({ ...ABHOLUNG, bestellnummer: '' })).toEqual([
      'Ohne Bestellnummer lässt sich keine Marke drucken.',
    ]);
  });
});

describe('versandmarkeHtml', () => {
  it('trägt KEINE Sendungsnummer, sondern sagt, wer sie vergibt', () => {
    const html = versandmarkeHtml(ABSENDER, VERSAND);
    expect(html).toContain('Die Sendungsnummer vergibt der Zusteller beim Einliefern.');
    // Kein Feld, kein Platzhalter, keine erfundene Nummer.
    expect(html).not.toMatch(/Sendungsnummer\s*[:：]/);
    expect(html).not.toMatch(/\b\d{12,}\b/);
  });

  it('druckt die vollständige Lieferanschrift samt Land', () => {
    const html = versandmarkeHtml(ABSENDER, VERSAND);
    expect(html).toContain('Maria Schneider');
    expect(html).toContain('Hauptstraße 5');
    expect(html).toContain('70173 Stuttgart');
    expect(html).toContain('>DE<');
  });

  it('macht aus einer Abholung einen Regalzettel statt einer Anschrift', () => {
    const html = versandmarkeHtml(ABSENDER, ABHOLUNG);
    expect(html).toContain('Abholung im Laden');
    expect(html).toContain('Zum Abholen bitte diese Nummer nennen.');
    expect(html).not.toContain('Hauptstraße');
  });

  it('trägt die Bestellnummer als lesbaren Text UND als Strichcode', () => {
    const html = versandmarkeHtml(ABSENDER, VERSAND);
    expect(html).toContain('BST-2026-000001');
    expect(html).toContain('aria-label="Strichcode BST-2026-000001"');
    expect(html).toContain('<svg');
  });

  it('weigert sich zu drucken, wenn die Anschrift fehlt', () => {
    // Lieber gar keine Marke als eine, die jemand später von Hand ergänzt und
    // dabei vergisst.
    expect(() => versandmarkeHtml(ABSENDER, { ...VERSAND, lieferanschrift: null })).toThrow(
      /Lieferanschrift/,
    );
  });

  it('entschärft spitze Klammern in einem Namen', () => {
    const html = versandmarkeHtml(ABSENDER, { ...VERSAND, empfaenger: 'A <b>B</b>' });
    expect(html).toContain('A &lt;b&gt;B&lt;/b&gt;');
    expect(html).not.toContain('<b>B</b>');
  });

  it('schreibt die Stückzahl in Worten aus, im Singular wie im Plural', () => {
    expect(versandmarkeHtml(ABSENDER, { ...VERSAND, stueckzahl: 1 })).toContain('1 Stück<');
    expect(versandmarkeHtml(ABSENDER, { ...VERSAND, stueckzahl: 3 })).toContain('3 Stücke<');
  });
});
