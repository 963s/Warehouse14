/**
 * versandmarke — der druckbare Aufkleber zu einer Bestellung.
 *
 * WAS DARAUF STEHT
 * Absender, Empfänger, die Bestellnummer und ihr Strichcode. Bei einer
 * Abholung tritt an die Stelle der Lieferanschrift der Regalhinweis, denn
 * dieselbe Marke klebt dann am Paket im Regal und macht es auffindbar.
 *
 * WAS BEWUSST NICHT DARAUF STEHT
 * **Keine Sendungsnummer eines Zustellers.** Solange kein Zusteller angebunden
 * ist, gibt es keine, und eine erfundene wäre genau der Fehler, den dieses Haus
 * schon zweimal gemacht hat: eine Nummer im richtigen Format, die nirgendwo
 * existiert, sieht bis zur ersten Kundennachfrage aus wie ein Erfolg. Der
 * Aufkleber sagt stattdessen in Worten, dass die Sendungsnummer beim Zusteller
 * vergeben wird.
 *
 * Reines Modul: kein React, kein Fensterzugriff, direkt prüfbar.
 */

import { code128Svg } from './code128.js';

export interface MarkeAbsender {
  name: string;
  /** Anschriftzeilen, leere fallen weg. */
  anschrift: readonly string[];
}

export interface MarkeBestellung {
  /** `BST-2026-000001`. Ohne sie gibt es nichts zu drucken. */
  bestellnummer: string;
  /** Wie die Bestellung erfüllt wird. */
  versandart: 'PICKUP' | 'SHIPPING';
  /** Name der Kundschaft, wie er auf dem Paket stehen soll. */
  empfaenger: string | null;
  /** Mehrzeilige Lieferanschrift. Null bei einer Abholung. */
  lieferanschrift: string | null;
  /** Zweibuchstabiges Land, z. B. `DE`. Null wenn unbekannt. */
  land: string | null;
  /** Wie viele Stücke im Paket sind. */
  stueckzahl: number;
  /** Wann sie bestellt wurde, als deutsches Datum. */
  bestelltAm: string;
}

/**
 * Was der Marke fehlt, um gedruckt werden zu dürfen. Leer heisst: sie ist
 * vollständig. Der Aufrufer zeigt diese Sätze, statt einen halben Aufkleber
 * zu drucken, den jemand später von Hand ergänzen müsste.
 */
export function fehlendeAngaben(b: MarkeBestellung): string[] {
  const fehlt: string[] = [];
  if (!b.bestellnummer.trim()) {
    fehlt.push('Ohne Bestellnummer lässt sich keine Marke drucken.');
  }
  if (b.versandart === 'SHIPPING' && !b.lieferanschrift?.trim()) {
    fehlt.push('Für eine Versandbestellung fehlt die Lieferanschrift.');
  }
  return fehlt;
}

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Der Aufkleber als vollständiges HTML-Dokument im Format 100 × 150 mm, dem
 * gängigen Versandetikett. Er ist so gebaut, dass er ohne Netz und ohne
 * Schriftartendownload druckt: nur Systemschriften, nur Schwarz auf Weiss.
 */
export function versandmarkeHtml(absender: MarkeAbsender, b: MarkeBestellung): string {
  const fehlt = fehlendeAngaben(b);
  if (fehlt.length > 0) {
    throw new Error(fehlt.join(' '));
  }

  const nummer = b.bestellnummer.trim();
  const versand = b.versandart === 'SHIPPING';

  const empfaengerBlock = versand
    ? [b.empfaenger?.trim(), ...(b.lieferanschrift ?? '').split(/\r?\n/), b.land]
        .map((z) => (z ?? '').trim())
        .filter((z) => z.length > 0)
    : [b.empfaenger?.trim() ?? 'Abholung im Laden'].filter((z) => z.length > 0);

  const stueck = b.stueckzahl === 1 ? '1 Stück' : `${b.stueckzahl} Stücke`;

  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>${escape(nummer)}</title>
<style>
  @page { size: 100mm 150mm; margin: 0 }
  * { box-sizing: border-box }
  body {
    margin: 0; width: 100mm; height: 150mm; padding: 6mm;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #000; background: #fff; display: flex; flex-direction: column;
  }
  .absender { font-size: 8pt; line-height: 1.35; border-bottom: 0.4mm solid #000; padding-bottom: 3mm }
  .art { font-size: 9pt; letter-spacing: 0.12em; text-transform: uppercase; margin: 4mm 0 1.5mm }
  .empfaenger { font-size: 15pt; line-height: 1.32; font-weight: 700; flex: 1 }
  .empfaenger div { margin-bottom: 0.6mm }
  .fuss { border-top: 0.4mm solid #000; padding-top: 3mm }
  .zeile { display: flex; justify-content: space-between; font-size: 8.5pt; margin-bottom: 2.5mm }
  .strichcode { text-align: center }
  .nummer { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 11pt;
            letter-spacing: 0.1em; margin-top: 1.5mm }
  .hinweis { font-size: 7.5pt; margin-top: 2.5mm; text-align: center }
</style></head>
<body>
  <div class="absender">
    <strong>${escape(absender.name)}</strong><br>
    ${absender.anschrift.filter((z) => z.trim().length > 0).map(escape).join('<br>')}
  </div>

  <div class="art">${versand ? 'Versand' : 'Abholung im Laden'}</div>
  <div class="empfaenger">
    ${empfaengerBlock.map((z) => `<div>${escape(z)}</div>`).join('\n    ')}
  </div>

  <div class="fuss">
    <div class="zeile"><span>${escape(stueck)}</span><span>${escape(b.bestelltAm)}</span></div>
    <div class="strichcode">
      ${code128Svg(nummer)}
      <div class="nummer">${escape(nummer)}</div>
    </div>
    <div class="hinweis">${
      versand
        ? 'Die Sendungsnummer vergibt der Zusteller beim Einliefern.'
        : 'Zum Abholen bitte diese Nummer nennen.'
    }</div>
  </div>
</body></html>`;
}
