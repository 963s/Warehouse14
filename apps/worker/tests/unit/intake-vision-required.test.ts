/**
 * Ohne Bilderkennung wird nicht geschätzt.
 *
 * `intakeSweepJob` hatte als Voreinstellung `createMockVisionClient()`. Der
 * antwortet auf JEDES Foto mit denselben Angaben: 585er Gold, 3,2 Gramm fein,
 * Zustand gut. Diese Angaben laufen weiter in `estimateDraftPrices` und werden
 * dort mit dem echten Goldpreis zu einem vorgeschlagenen ANKAUFSPREIS. Am
 * Tresen liest sich das wie eine Messung an genau diesem Stück.
 *
 * Auf der Produktion ist kein `ANTHROPIC_API_KEY` gesetzt und der Auftrag läuft
 * jede Minute. Ausgelöst hat es nichts, weil noch keine Sitzung angelegt wurde.
 *
 * Der Verhaltensnachweis (zurückholen ja, schätzen nein) steht im
 * Integrationstest `intake-reclaim.test.ts` und läuft gegen echtes Postgres.
 * Hier wird nur die Regel selbst festgenagelt, damit sie nicht zurückkehrt.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const jobSource = readFileSync(new URL('../../src/jobs/intake-sweep.ts', import.meta.url), 'utf8');

describe('intake_sweep verlangt eine echte Bilderkennung', () => {
  it('greift auf keinen Doppelgänger zurück', () => {
    expect(jobSource).not.toMatch(/createMockVisionClient/);
  });

  it('hat keine Voreinstellung für die Bilderkennung', () => {
    // `deps.vision ?? irgendwas` wäre wieder genau der alte Fehler.
    expect(jobSource).not.toMatch(/vision\s*\?\?/);
  });

  it('bricht ab, bevor Sitzungen verarbeitet werden', () => {
    const guard = jobSource.indexOf('if (!vision)');
    const processing = jobSource.indexOf('processIntakeSession(');
    expect(guard).toBeGreaterThan(-1);
    // Die Prüfung muss VOR dem Verarbeiten stehen, sonst schützt sie nichts.
    expect(guard).toBeLessThan(processing);
  });

  it('wird von keinem Produktionspfad umgangen', () => {
    // Wenn jemand den Doppelgänger später doch wieder in eine App zieht, soll
    // dieser Test brechen und die Frage stellen, ob das wirklich gewollt ist.
    const app = readFileSync(new URL('../../src/app.ts', import.meta.url), 'utf8');
    expect(app).not.toMatch(/createMockVisionClient/);
  });
});
