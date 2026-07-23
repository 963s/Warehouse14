/**
 * Jede Nachbestätigung verlangt die GERÄTESPERRE, nie die abgeschaffte PIN.
 *
 * BASELS BEFUND, 23.07.2026
 * Die vierstellige Kassen-PIN wurde am 21.07. abgeschafft: die Anmeldung ist
 * Google, jedes Gerät hat seinen eigenen Sperrcode. Trotzdem fragte JEDE
 * empfindliche Handlung — DATEV-Export, Storno, Z-Bon, Löschung, Preismarge —
 * weiter nach der abgeschafften Zahl.
 *
 * Zwei Folgen, und die zweite ist die schlimmere:
 *   1. Man wird nach einer Zahl gefragt, die es nicht mehr geben soll.
 *   2. Wer keinen alten PIN-Abdruck trägt, bekommt „PIN not set for this user"
 *      und kann die Handlung NIE ausführen. Am Tag der Prüfung hatten beide
 *      angelegten Menschen noch einen Abdruck; der erste neu angelegte
 *      Mitarbeiter hätte den Steuerexport dauerhaft gesperrt vorgefunden.
 *
 * Dieser Wächter hält beide Flächen auf dem neuen Weg fest. Er ist eine
 * Textprüfung über die Quellen, weil genau das der Rückfall wäre: jemand
 * greift beim nächsten Dialog wieder zur naheliegenden alten Funktion.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = fileURLToPath(new URL('.', import.meta.url));
const WURZEL = join(HIER, '..', '..', '..', '..');

/**
 * Die alte PIN-Bestätigung. Sie lebt am Server absichtlich weiter, damit die
 * noch nicht aktualisierte Kasse draussen nicht stehen bleibt — aber KEINE
 * Fläche darf sie neu aufrufen.
 */
const ALTER_WEG = /authPin\.stepUp\s*\(|['"`]\/api\/auth\/step-up['"`]/;

/** Nur der Bausatz darf beide Wege kennen: er bietet sie ja an. */
const AUSGENOMMEN = new Set(['packages/api-client/src/domains/auth-pin.ts']);

const FLAECHEN = ['apps/tauri-pos/src', 'apps/mobile/src', 'packages/api-client/src'];

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
    if (statSync(pfad).isDirectory()) gefunden.push(...dateienUnter(join(verzeichnis, name)));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) gefunden.push(pfad);
  }
  return gefunden;
}

describe('die Nachbestätigung verlangt die Gerätesperre', () => {
  it('keine Fläche ruft noch die abgeschaffte PIN-Bestätigung', () => {
    const verstoesse: string[] = [];
    for (const wurzel of FLAECHEN) {
      for (const datei of dateienUnter(wurzel)) {
        const rel = relative(WURZEL, datei).split('\\').join('/');
        if (AUSGENOMMEN.has(rel)) continue;
        if (ALTER_WEG.test(readFileSync(datei, 'utf8'))) verstoesse.push(rel);
      }
    }
    expect(
      verstoesse,
      'Diese Dateien verlangen wieder die abgeschaffte Kassen-PIN. Empfindliche ' +
        'Handlungen müssen mit derselben Bildschirmsperre bestätigt werden, die ' +
        'die Person am Tresen beim Öffnen der App eingibt.',
    ).toEqual([]);
  });

  it('beide Flächen prüfen den Code LOKAL, bevor sie den Server stempeln lassen', () => {
    // Der entscheidende Punkt: `stepUpDevice` sagt dem Server nur „bestätigt".
    // Würde eine Fläche das aufrufen, OHNE vorher `verifyLocalPin` zu prüfen,
    // wäre die Nachbestätigung ein Knopf ohne Frage.
    for (const datei of [
      'apps/tauri-pos/src/app/chrome/StepUpModal.tsx',
      'apps/mobile/src/warehouse14/StepUpDialog.tsx',
    ]) {
      const inhalt = readFileSync(join(WURZEL, datei), 'utf8');
      expect(inhalt, `${datei} ruft stepUpDevice nicht auf`).toMatch(/stepUpDevice|deviceStepUp/);
      expect(inhalt, `${datei} prüft den Code nicht lokal`).toMatch(/verifyLocalPin/);
      // Und der Fehlversuch MUSS gezählt werden, sonst sind die zehntausend
      // Möglichkeiten eines vierstelligen Codes in Minuten durchprobiert.
      expect(inhalt, `${datei} zählt Fehlversuche nicht`).toMatch(/recordFailedAttempt/);
    }
  });

  it('der Server kennt den neuen Weg und nennt den Faktor im Tagebuch', () => {
    const route = readFileSync(
      join(WURZEL, 'apps/api-cloud/src/routes/auth-pin.ts'),
      'utf8',
    );
    expect(route).toContain("'/api/auth/step-up/device'");
    // Ein EIGENER Ereignisname: wer das Tagebuch liest, muss unterscheiden
    // können, ob eine PIN oder eine Gerätesperre bestätigt hat.
    expect(route).toContain("'auth.step_up_device'");
    expect(route).toContain("factor: 'device_lock'");
  });
});
