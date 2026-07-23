/**
 * Ein gelöschtes Konto darf NIE in einer Kundenauswahl auftauchen.
 *
 * WARUM ES DIESEN WÄCHTER GIBT
 * Am 23.07.2026 kam ein Wunsch von Basel dazu: eine gelöschte Kundschaft soll
 * in der Kundenliste stehen bleiben, durchgestrichen, mit dem Hinweis, dass der
 * Mensch selbst gelöscht hat. Dafür bekam `GET /api/customers` die Flagge
 * `includeErased`.
 *
 * Genau dieselbe Liste bedient aber auch jede Kundenauswahl: der Käuferpicker
 * im Verkauf, der Kundenschritt im Ankauf, der Bewertungsschritt, die Suche.
 * Setzt eine davon die Flagge, bietet sie ein anonymisiertes Konto zur Auswahl
 * an — und ein Verkauf oder Ankauf würde auf einen Menschen gebucht, dessen
 * Daten wir auf sein eigenes Verlangen gelöscht haben. Das ist kein
 * Schönheitsfehler, das ist ein Rückfall in Daten, die weg sein sollten.
 *
 * Der Wächter ist bewusst eine Textprüfung über die Quellen: er braucht weder
 * Datenbank noch Server und schlägt an, sobald jemand die Flagge an eine
 * falsche Stelle schreibt. Die Erlaubnisliste unten ist die einzige Stelle, an
 * der eine neue Ausnahme bewusst eingetragen werden muss.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = fileURLToPath(new URL('.', import.meta.url));
const WURZEL = join(HIER, '..', '..', '..', '..');

/**
 * Die EINZIGEN Flächen, die gelöschte Konten sehen dürfen: die beiden
 * Kundenlisten selbst. Dort ist die Frage „was ist mit diesem Menschen
 * passiert" berechtigt, und ausgewählt wird dort nichts für einen Beleg.
 */
const ERLAUBT = new Set([
  'apps/mobile/src/app/(tabs)/customers.tsx',
  'apps/tauri-pos/src/screens/kunden/CustomerListPanel.tsx',
  // Der Server selbst: dort wird die Flagge gelesen, nicht gesetzt.
  'apps/api-cloud/src/routes/customers-list.ts',
  'apps/api-cloud/src/schemas/customer-list.ts',
  'packages/api-client/src/domains/customers.ts',
]);

const WURZELN = [
  'apps/mobile/src',
  'apps/tauri-pos/src',
  'apps/api-cloud/src',
  'packages/api-client/src',
];

function dateienUnter(verzeichnis: string): string[] {
  const voll = join(WURZEL, verzeichnis);
  let eintraege: string[];
  try {
    eintraege = readdirSync(voll);
  } catch {
    return [];
  }
  const gefunden: string[] = [];
  for (const name of eintraege) {
    if (name === 'node_modules' || name === 'dist') continue;
    const pfad = join(voll, name);
    if (statSync(pfad).isDirectory()) {
      gefunden.push(...dateienUnter(join(verzeichnis, name)));
    } else if (/\.(ts|tsx)$/.test(name)) {
      gefunden.push(pfad);
    }
  }
  return gefunden;
}

describe('gelöschte Konten bleiben aus jeder Kundenauswahl heraus', () => {
  it('setzt includeErased NUR in den beiden Kundenlisten', () => {
    const verstoesse: string[] = [];

    for (const wurzel of WURZELN) {
      for (const datei of dateienUnter(wurzel)) {
        const rel = relative(WURZEL, datei).split('\\').join('/');
        if (ERLAUBT.has(rel)) continue;
        // Auch Testdateien dürfen die Flagge nennen, sie rufen nichts auf.
        if (rel.includes('/tests/')) continue;
        const inhalt = readFileSync(datei, 'utf8');
        if (/includeErased/.test(inhalt)) verstoesse.push(rel);
      }
    }

    expect(
      verstoesse,
      'Diese Dateien setzen includeErased, obwohl sie keine Kundenliste sind. ' +
        'Eine Kundenauswahl, die ein anonymisiertes Konto anbietet, bucht einen ' +
        'Beleg auf einen Menschen, dessen Daten auf sein Verlangen gelöscht wurden.',
    ).toEqual([]);
  });

  it('lässt die Liste ohne die Flagge weiterhin nur lebende Konten sehen', () => {
    const route = readFileSync(
      join(WURZEL, 'apps/api-cloud/src/routes/customers-list.ts'),
      'utf8',
    );

    // Der Standardzweig MUSS die gelöschten Zeilen ausschliessen. Fällt das
    // `soft_deleted_at IS NULL` weg, sehen sie plötzlich ALLE Aufrufer.
    expect(route).toMatch(/includeErased\s*\?\s*sql`TRUE`\s*:\s*sql`soft_deleted_at IS NULL`/);

    // Und die Flagge darf nicht versehentlich als Standard wahr werden.
    expect(route).toMatch(/req\.query\.includeErased === true/);
  });
});
