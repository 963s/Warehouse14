/**
 * Gewichtsbänder dürfen sich nicht überlappen.
 *
 * Täten sie es, hinge der Versandpreis davon ab, welche Zeile die Abfrage
 * zuerst zurückgibt, und derselbe Warenkorb kostete beim zweiten Aufruf etwas
 * anderes. Die Datenbank kann das nicht ausdrücken, weil es eine Prüfung über
 * mehrere Zeilen ist; darum prüft es die Route, und darum wird es hier
 * festgenagelt.
 */

import { describe, expect, it } from 'vitest';

import { overlaps } from '../../src/routes/shipping-settings.js';

const band = (min: number, max: number | null) => ({ minWeightG: min, maxWeightG: max });

describe('overlaps', () => {
  it('sees a plain overlap', () => {
    expect(overlaps(band(0, 2000), band(1000, 3000))).toBe(true);
  });

  it('lets neighbouring bands sit next to each other', () => {
    // 0 bis 2000 und 2001 bis offen ist die normale Staffel und muss erlaubt sein.
    expect(overlaps(band(0, 2000), band(2001, null))).toBe(false);
  });

  it('treats a shared edge as an overlap, because both would match that gram', () => {
    expect(overlaps(band(0, 2000), band(2000, 5000))).toBe(true);
  });

  it('catches a band swallowed by another', () => {
    expect(overlaps(band(0, 10000), band(500, 600))).toBe(true);
  });

  it('knows an open band swallows everything above it', () => {
    expect(overlaps(band(2000, null), band(5000, 6000))).toBe(true);
    expect(overlaps(band(2000, null), band(100, 500))).toBe(false);
  });

  it('sees two open bands as an overlap', () => {
    // Zwei nach oben offene Bänder derselben Zone sind immer mehrdeutig.
    expect(overlaps(band(0, null), band(3000, null))).toBe(true);
  });

  it('is symmetric', () => {
    const a = band(0, 2000);
    const b = band(1500, 4000);
    expect(overlaps(a, b)).toBe(overlaps(b, a));
  });
});
