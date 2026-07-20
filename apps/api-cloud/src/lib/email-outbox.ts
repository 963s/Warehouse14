/**
 * Transactional email — composition + outbox enqueue (migration 0088).
 *
 * Emails are COMPOSED at the moment of the business event and QUEUED in
 * email_outbox; the worker's smtp job delivers them when the SMTP env is
 * configured (SMTP_HOST/PORT/USER/PASS + MAIL_FROM). Until then they wait
 * honestly as PENDING — visible, verifiable, nothing silently dropped.
 *
 * Copy rules match the product spine: German, warm and precise, no
 * underscores and no dash separators in visible text. Templates are
 * deliberately text-first with a minimal parchment-toned HTML wrapper —
 * an antique dealer writes letters, not marketing banners.
 */

import { sql as drizzleSql } from 'drizzle-orm';

/** Minimal executor shape — works with app.db and with a withPii tx alike. */
type SqlExecutor = { execute: (q: ReturnType<typeof drizzleSql>) => Promise<unknown> };

export interface ComposedEmail {
  template: string;
  subject: string;
  text: string;
  html: string;
}

const BRAND = 'Warehouse 14';
const SHOP_LINE = 'Warehouse 14, Antiquitäten, Briefmarken und Münzen, Schorndorf';

function htmlWrap(bodyHtml: string): string {
  return (
    '<!doctype html><meta charset="utf-8">' +
    '<body style="margin:0;padding:0;background:#efece3;">' +
    '<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:Georgia,serif;color:#1c1c1c;">' +
    '<div style="font-size:22px;letter-spacing:1px;margin-bottom:4px;">WAREHOUSE 14</div>' +
    '<div style="font-size:12px;color:#6e6b64;margin-bottom:24px;">Edelmetalle und Sammlerstücke</div>' +
    '<div style="height:1px;background:#a3823b;margin-bottom:24px;"></div>' +
    bodyHtml +
    '<div style="height:1px;background:#d8d3c4;margin:28px 0 12px;"></div>' +
    `<div style="font-size:11px;color:#6e6b64;line-height:1.5;">${SHOP_LINE}</div>` +
    '</div></body>'
  );
}

function para(text: string): string {
  return `<p style="font-size:15px;line-height:1.6;margin:0 0 14px;">${text}</p>`;
}

function greet(name: string | null): string {
  const n = (name ?? '').trim();
  return n && n !== 'Gast' ? `Guten Tag ${n},` : 'Guten Tag,';
}

/** Welcome — sent once when an account is created (email or Google). */
export function composeWelcome(name: string | null): ComposedEmail {
  const g = greet(name);
  const text =
    `${g}\n\n` +
    `herzlich willkommen bei ${BRAND}. Ihr Konto ist eingerichtet.\n\n` +
    `Sie können ab sofort unsere Stücke durchstöbern, Favoriten merken und ` +
    `Reservierungen zur Abholung im Geschäft aufgeben. Jedes Stück ist ein ` +
    `Einzelstück, geprüft und kuratiert.\n\n` +
    `Wir freuen uns auf Ihren Besuch.\n\n${SHOP_LINE}`;
  const html = htmlWrap(
    para(g) +
      para(`herzlich willkommen bei ${BRAND}. Ihr Konto ist eingerichtet.`) +
      para(
        'Sie können ab sofort unsere Stücke durchstöbern, Favoriten merken und ' +
          'Reservierungen zur Abholung im Geschäft aufgeben. Jedes Stück ist ein ' +
          'Einzelstück, geprüft und kuratiert.',
      ) +
      para('Wir freuen uns auf Ihren Besuch.'),
  );
  return { template: 'welcome', subject: `Willkommen bei ${BRAND}`, text, html };
}

/** Reservation confirmation — the order number is the pickup reference. */
export function composeReservationConfirmed(
  name: string | null,
  orderId: string,
  itemCount: number,
  totalEur: string | null,
): ComposedEmail {
  const g = greet(name);
  const stueck = itemCount === 1 ? 'ein Stück' : `${itemCount} Stücke`;
  const totalLine = totalEur ? `Gesamtwert: ${totalEur} Euro.\n` : '';
  const text =
    `${g}\n\n` +
    `Ihre Reservierung ist eingegangen. Wir legen ${stueck} drei Tage für Sie zurück.\n\n` +
    `Reservierungsnummer: ${orderId}\n` +
    totalLine +
    `\nBitte nennen Sie die Reservierungsnummer bei der Abholung im Geschäft. ` +
    `Die Bezahlung erfolgt bequem vor Ort.\n\n${SHOP_LINE}`;
  const html = htmlWrap(
    para(g) +
      para(`Ihre Reservierung ist eingegangen. Wir legen ${stueck} drei Tage für Sie zurück.`) +
      `<div style="background:#ffffff;border:1px solid #d8d3c4;border-radius:8px;padding:14px 18px;margin:0 0 14px;">` +
      `<div style="font-size:12px;color:#6e6b64;">Reservierungsnummer</div>` +
      `<div style="font-size:17px;font-family:monospace;">${orderId}</div>` +
      (totalEur ? `<div style="font-size:13px;color:#4c4a45;margin-top:6px;">Gesamtwert: ${totalEur} Euro</div>` : '') +
      `</div>` +
      para(
        'Bitte nennen Sie die Reservierungsnummer bei der Abholung im Geschäft. ' +
          'Die Bezahlung erfolgt bequem vor Ort.',
      ),
  );
  return {
    template: 'reservation_confirmed',
    subject: `Ihre Reservierung ${orderId.slice(0, 8).toUpperCase()} bei ${BRAND}`,
    text,
    html,
  };
}

/** Cancellation notice — confirms the release, keeps the door open. */
export function composeReservationCancelled(name: string | null, orderId: string): ComposedEmail {
  const g = greet(name);
  const text =
    `${g}\n\n` +
    `Ihre Reservierung ${orderId} wurde storniert. Die Stücke sind wieder frei verfügbar.\n\n` +
    `Sie können jederzeit erneut reservieren. Wir sind gern für Sie da.\n\n${SHOP_LINE}`;
  const html = htmlWrap(
    para(g) +
      para(`Ihre Reservierung ${orderId} wurde storniert. Die Stücke sind wieder frei verfügbar.`) +
      para('Sie können jederzeit erneut reservieren. Wir sind gern für Sie da.'),
  );
  return {
    template: 'reservation_cancelled',
    subject: `Reservierung storniert, ${BRAND}`,
    text,
    html,
  };
}

/**
 * Queue a composed email. MUST run inside withPii (encrypt_pii needs the
 * session key) — pass the pii tx. Never throws into the caller's business
 * flow: a mail that cannot be queued must not break a sign-up or an order,
 * so callers wrap this in a best-effort try/catch.
 */
export async function enqueueEmail(
  tx: SqlExecutor,
  recipient: string,
  mail: ComposedEmail,
): Promise<void> {
  await tx.execute(drizzleSql`
    INSERT INTO email_outbox (recipient_encrypted, template, subject, body_text, body_html)
    VALUES (encrypt_pii(${recipient}), ${mail.template}, ${mail.subject}, ${mail.text}, ${mail.html})
  `);
}
