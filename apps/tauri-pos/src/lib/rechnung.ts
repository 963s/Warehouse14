/**
 * rechnung — eine VORLÄUFIGE Rechnung zu einer Abhol-Bestellung.
 *
 * BASELS WUNSCH, 24.07.2026
 * „طباعة فاتورة للزبون حتى بدون TSE موقتا تطبع اوسفالت TSE لما يحي ويدفع نطبعلو
 *  فاتورة من المحل طبعاً اختيارية" — dem Kunden auch OHNE TSE eine Rechnung
 * drucken können, freiwillig; wenn die TSE da ist und er zahlt, kommt der
 * richtige Kassenbon.
 *
 * DIE EINE EHRLICHKEIT, DIE HIER ALLES TRÄGT
 * Dies ist KEIN steuerlicher Beleg. Solange die TSE nicht aktiv ist, gibt es
 * keinen signierten Kassenbon nach §146a AO — und ein Dokument, das so täte,
 * als wäre es einer, wäre genau die Lüge, die dieses Haus nicht führt. Deshalb
 * steht in fetter, nicht zu übersehender Schrift auf jedem Blatt: vorläufig,
 * ohne Signatur, der fiskalische Bon folgt bei der Bezahlung. Der Kunde bekommt
 * eine ehrliche Übersicht seiner reservierten Stücke, nicht einen gefälschten
 * Kassenbon.
 *
 * Schwarz auf Weiss, nicht in den Bildschirmfarben: eine Rechnung wird gedruckt,
 * nicht angeschaut, und Pergament auf Papier ist nur teure Tinte.
 */
import type { OrderView } from '@warehouse14/api-client';

export interface RechnungAbsender {
  name: string;
  anschrift: readonly string[];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Cent-genau aus dem Server-String, in deutsches Format. */
function euro(value: string): string {
  const n = Number(value);
  if (Number.isNaN(n)) return `${value} €`;
  return `${n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/**
 * Prüft, ob genug für eine Rechnung da ist. Gibt fehlende Angaben als deutsche
 * Sätze zurück; leere Liste heisst: es kann gedruckt werden.
 */
export function fehltFuerRechnung(order: OrderView): string[] {
  const fehlt: string[] = [];
  if (!order.orderNumber?.trim()) fehlt.push('Ohne Bestellnummer lässt sich keine Rechnung drucken.');
  if (order.lines.length === 0) fehlt.push('Diese Bestellung hat keine Positionen.');
  return fehlt;
}

/**
 * Das druckfertige HTML. Absender sind die ECHTEN Ladendaten (oder der geprüfte
 * Rückfall aus resolveShopInfo) — nie eine erfundene Anschrift.
 */
export function rechnungHtml(absender: RechnungAbsender, order: OrderView): string {
  const nummer = escapeHtml(order.orderNumber ?? '');
  const datum = new Date(order.createdAt).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const heute = new Date().toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const empfaenger = order.contactName ? escapeHtml(order.contactName) : 'Kundschaft';

  const zeilen = order.lines
    .map((l) => {
      const menge = l.quantity > 1 ? `${l.quantity} × ` : '';
      const sku = l.sku ? `<span class="sku">${escapeHtml(l.sku)}</span>` : '';
      return (
        '<tr>' +
        `<td class="pos">${sku}${menge}${escapeHtml(l.name)}</td>` +
        `<td class="preis">${euro(l.unitPriceEur)}</td>` +
        '</tr>'
      );
    })
    .join('');

  const absenderZeile = [absender.name, ...absender.anschrift].map(escapeHtml).join(' · ');

  return (
    '<!doctype html><html lang="de"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>Vorläufige Rechnung ${nummer}</title>` +
    '<style>' +
    '@page{size:A5;margin:14mm}' +
    "*{box-sizing:border-box;font-family:Georgia,'Times New Roman',serif}" +
    'body{margin:0;color:#111;background:#fff;font-size:12px;line-height:1.5}' +
    '.wm{font-size:20px;font-weight:700;letter-spacing:.02em;margin:0 0 2px}' +
    '.sub{color:#555;margin:0 0 14px;font-size:11px}' +
    '.warn{border:2px solid #111;padding:8px 10px;margin:0 0 16px;font-weight:700;font-size:11.5px;line-height:1.4}' +
    '.meta{display:flex;justify-content:space-between;gap:12px;margin:0 0 14px;font-size:11.5px}' +
    '.meta b{font-weight:700}' +
    'table{width:100%;border-collapse:collapse;margin:0 0 12px}' +
    'th{text-align:left;border-bottom:1.5px solid #111;padding:6px 4px;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em}' +
    'td{padding:7px 4px;border-bottom:1px solid #ddd;vertical-align:top}' +
    '.preis{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}' +
    'th.preis{text-align:right}' +
    '.sku{display:block;color:#777;font-size:10px;font-family:monospace}' +
    '.sum{display:flex;justify-content:flex-end;gap:16px;font-size:15px;font-weight:700;padding:8px 4px;border-top:2px solid #111}' +
    '.foot{margin-top:22px;color:#555;font-size:10.5px;line-height:1.5;border-top:1px solid #ccc;padding-top:8px}' +
    '</style></head><body>' +
    `<p class="wm">${escapeHtml(absender.name)}</p>` +
    `<p class="sub">${escapeHtml(absender.anschrift.join(', '))}</p>` +
    '<div class="warn">Vorläufige Rechnung. Kein steuerlicher Beleg. ' +
    'Dieses Dokument trägt keine Signatur nach §146a AO. Der fiskalische ' +
    'Kassenbon wird bei der Bezahlung im Geschäft erstellt.</div>' +
    '<div class="meta">' +
    `<div><b>Empfänger</b><br>${empfaenger}</div>` +
    `<div style="text-align:right"><b>Bestellnummer</b><br>${nummer}<br>` +
    `<span style="color:#555">reserviert am ${datum}</span></div>` +
    '</div>' +
    '<table><thead><tr><th>Position</th><th class="preis">Preis</th></tr></thead>' +
    `<tbody>${zeilen}</tbody></table>` +
    `<div class="sum"><span>Gesamt</span><span>${euro(order.totalEur)}</span></div>` +
    `<div class="foot">${absenderZeile}<br>` +
    `Ausgedruckt am ${heute}. Alle Preise inkl. gesetzlicher MwSt. ` +
    'Zahlung bei Abholung im Geschäft.</div>' +
    '</body></html>'
  );
}
