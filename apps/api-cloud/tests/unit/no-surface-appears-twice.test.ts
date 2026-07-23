/**
 * Keine Fläche darf an ZWEI Stellen stehen.
 *
 * BASELS BEFUND, 23.07.2026
 * „وضوح وتنظيم منطقي وتجربة ممتازة بدون تعقيد" — Klarheit, logische Ordnung,
 * keine unnötige Verschachtelung.
 *
 * Der konkrete Fall: „Bestellungen" wanderte an diesem Morgen aus dem
 * Mehr-Hub in die untere Leiste, weil es täglich Arbeit macht. Der Eintrag im
 * Hub blieb aber stehen. Derselbe Schirm war fortan über zwei verschiedene
 * Wege erreichbar, und wer die App zum ersten Mal öffnet, liest das nicht als
 * Bequemlichkeit, sondern als Unordnung: gibt es zwei Bestellungen? welche ist
 * die richtige?
 *
 * Der Hub filtert die Haupt-Tabs jetzt AUS DERSELBEN QUELLE heraus, aus der die
 * Leiste gebaut wird. Dieser Wächter hält fest, dass das so bleibt — und dass
 * niemand den Filter wieder entfernt, weil der doppelte Eintrag „ja nicht
 * stört".
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const WURZEL = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..');
const MOBIL = join(WURZEL, 'apps/mobile/src');

/** Die Routennamen der SICHTBAREN unteren Leiste. */
function tabRouten(): string[] {
  const s = readFileSync(join(MOBIL, 'warehouse14/surfaces.ts'), 'utf8');
  const bloecke = s.split(/\{\s*\n/).slice(1);
  const routen: string[] = [];
  for (const b of bloecke) {
    const name = /name:\s*"([^"]+)"/.exec(b)?.[1];
    if (!name) continue;
    // `hidden` hält eine Route eingehängt, ohne einen Knopf zu zeigen — sie
    // DARF deshalb im Hub stehen, sonst wäre sie gar nicht erreichbar.
    if (/hidden:\s*true/.test(b.split('},')[0] ?? '')) continue;
    routen.push(name);
  }
  return routen;
}

/** Alle Wege, die der Mehr-Hub anbietet. */
function hubRouten(): string[] {
  const s = readFileSync(join(MOBIL, 'warehouse14/owner-surfaces.ts'), 'utf8');
  return [...s.matchAll(/route:\s*"([^"]+)"/g)].map((m) => m[1] as string);
}

describe('keine Fläche steht an zwei Stellen', () => {
  it('der Mehr-Hub filtert die sichtbaren Haupt-Tabs heraus', () => {
    const quelle = readFileSync(join(MOBIL, 'app/(tabs)/more.tsx'), 'utf8');

    // Der Filter MUSS aus der Leisten-Registrierung kommen, nicht aus einer von
    // Hand gepflegten Liste — sonst ist der nächste Umzug wieder ein Duplikat.
    expect(quelle, 'more.tsx liest die Leisten-Registrierung nicht').toMatch(
      /from ["']@\/warehouse14\/surfaces["']/,
    );
    expect(quelle, 'more.tsx überspringt die Tab-Routen nicht').toMatch(
      /tabRouten\.has\(s\.route\)/,
    );
  });

  it('nennt die Überschneidungen, damit sie bewusst bleiben', () => {
    const tabs = new Set(tabRouten().map((n) => `/${n}`));
    const doppelt = hubRouten().filter((r) => tabs.has(r));

    // Ein Eintrag im Hub, der schon ein Tab ist, ist NICHT verboten — der
    // Filter fängt ihn ab. Aber er ist toter Ballast in der Registrierung, und
    // dieser Test macht ihn sichtbar, statt ihn jahrelang mitzuschleppen.
    expect(
      doppelt,
      'Diese Wege stehen sowohl in der unteren Leiste als auch im Mehr-Hub. ' +
        'Der Hub blendet sie aus, aber der Eintrag gehört entfernt.',
    ).toEqual([]);
  });
});
