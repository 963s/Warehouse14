/**
 * Transactional email — composition + outbox enqueue (migration 0088).
 *
 * Emails are COMPOSED at the moment of the business event and QUEUED in
 * email_outbox; the worker's smtp job delivers them when the SMTP env is
 * configured (SMTP_HOST/PORT/USER/PASS + MAIL_FROM). Until then they wait
 * honestly as PENDING — visible, verifiable, nothing silently dropped.
 *
 * Copy is warm and precise, no underscores and no dash separators in visible
 * text. Templates are deliberately text first with a minimal parchment toned
 * HTML wrapper: an antique dealer writes letters, not marketing banners.
 *
 * EVERY LETTER IS WRITTEN IN THE READER'S LANGUAGE. The phrases live in
 * email-copy.ts, one exhaustive table per locale, so this file only decides
 * SHAPE (paragraphs, the reference card, the footer) and never wording. A
 * caller that knows nothing about the reader passes nothing and gets German,
 * which is the honest floor rather than a blank.
 */

import { sql as drizzleSql } from 'drizzle-orm';

import { emailCopy, normalizeEmailLocale, EMAIL_CONTACT_LINE, type EmailCopy } from './email-copy.js';

/** Minimal executor shape — works with app.db and with a withPii tx alike. */
type SqlExecutor = { execute: (q: ReturnType<typeof drizzleSql>) => Promise<unknown> };

export interface ComposedEmail {
  template: string;
  subject: string;
  text: string;
  html: string;
  /** ISO 639 1 code this letter is written in. Stored with the row. */
  locale: string;
}

/**
 * Footer of every letter: who operates the shop, how to reach them, and on a
 * translated letter one plain line saying German governs the contract. The
 * same courtesy clause the translated legal documents carry, for the same
 * reason: a translation must never be readable as altering the agreement.
 */
function footerLines(c: EmailCopy): string[] {
  return [
    c.operatorLine,
    EMAIL_CONTACT_LINE,
    `${c.openingHoursLabel}: ${c.openingHours}`,
    ...(c.courtesyNote ? [c.courtesyNote] : []),
  ];
}

/**
 * Content id of the letterhead image. The worker attaches the logo under this
 * name whenever the HTML references it, so composition here stays a pure
 * string function and the image bytes never travel through the database.
 */
export const EMAIL_LOGO_CID = 'w14logo';

/**
 * The letterhead.
 *
 * The mark is pure black line art on transparency, which is exactly the shape
 * that vanishes in a dark mode client, so it sits in an explicitly WHITE cell
 * rather than on the parchment. The alt text carries the wordmark for the
 * readers who block images, which on a transactional letter is a large
 * minority and not an edge case.
 *
 * `width` is set as an attribute as well as in CSS because Outlook ignores the
 * style and would otherwise render the image at its full 360 pixels.
 */
function letterhead(c: EmailCopy): string {
  return (
    '<div style="background:#ffffff;border:1px solid #e2ddd0;border-radius:10px;' +
    'padding:20px 24px 16px;margin-bottom:24px;text-align:center;">' +
    `<img src="cid:${EMAIL_LOGO_CID}" width="180" alt="Warehouse 14" ` +
    'style="width:180px;max-width:100%;height:auto;display:block;margin:0 auto;border:0;">' +
    `<div style="font-size:11px;color:#6e6b64;margin-top:10px;letter-spacing:0.4px;">${c.tagline}</div>` +
    '</div>'
  );
}

function htmlWrap(c: EmailCopy, bodyHtml: string): string {
  const align = c.dir === 'rtl' ? 'right' : 'left';
  return (
    '<!doctype html><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<body style="margin:0;padding:0;background:#efece3;" dir="${c.dir}">` +
    `<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:Georgia,serif;color:#1c1c1c;text-align:${align};">` +
    letterhead(c) +
    bodyHtml +
    '<div style="height:1px;background:#a3823b;margin:28px 0 12px;"></div>' +
    footerLines(c)
      .map((l) => `<div style="font-size:11px;color:#6e6b64;line-height:1.6;">${l}</div>`)
      .join('') +
    '</div></body>'
  );
}

function para(text: string): string {
  return `<p style="font-size:15px;line-height:1.6;margin:0 0 14px;">${text}</p>`;
}

/** Plain text footer, so the text part carries the same duties as the HTML. */
function textFooter(c: EmailCopy): string {
  return footerLines(c).join('\n');
}

/**
 * "Gast" is the placeholder a guest checkout writes, not a name anyone chose,
 * so it gets the nameless greeting rather than "Hello Guest".
 */
function greet(c: EmailCopy, name: string | null): string {
  const n = (name ?? '').trim();
  return n && n !== 'Gast' ? c.greetNamed(n) : c.greetPlain;
}

/** Welcome — sent once when an account is created (email or Google). */
export function composeWelcome(name: string | null, locale?: string | null): ComposedEmail {
  const c = emailCopy(locale);
  const g = greet(c, name);
  const text = `${g}\n\n${c.welcomeLead}\n\n${c.welcomeBody}\n\n${c.welcomeClose}\n\n${textFooter(c)}`;
  const html = htmlWrap(
    c,
    para(g) + para(c.welcomeLead) + para(c.welcomeBody) + para(c.welcomeClose),
  );
  return {
    template: 'welcome',
    subject: c.welcomeSubject,
    text,
    html,
    locale: normalizeEmailLocale(locale),
  };
}

/**
 * Reservation confirmation — the order number is the pickup reference.
 *
 * `orderNumber` is `BST-2026-000009` (0097), NOT the cart UUID. Before that
 * migration this took the raw id and the letter contradicted itself: the
 * body printed all thirty six characters while the subject printed the first
 * eight in capitals, so the reader was handed two different references for one
 * reservation and neither could be read down a telephone.
 */
export function composeReservationConfirmed(
  name: string | null,
  orderNumber: string,
  itemCount: number,
  totalEur: string | null,
  locale?: string | null,
): ComposedEmail {
  const c = emailCopy(locale);
  const g = greet(c, name);
  const lead = c.reservationLead(c.pieces(itemCount));
  const totalLine = totalEur ? `${c.totalLabel}: ${totalEur} ${c.euro}\n` : '';
  const text =
    `${g}\n\n${lead}\n\n` +
    `${c.refLabel}: ${orderNumber}\n` +
    totalLine +
    `\n${c.reservationClose}\n\n${textFooter(c)}`;
  // The reference sits in its own card, in a monospaced face, because it is
  // the one thing the reader has to repeat out loud at the counter.
  const html = htmlWrap(
    c,
    para(g) +
      para(lead) +
      '<div style="background:#ffffff;border:1px solid #d8d3c4;border-radius:8px;padding:14px 18px;margin:0 0 14px;">' +
      `<div style="font-size:12px;color:#6e6b64;">${c.refLabel}</div>` +
      `<div style="font-size:19px;font-family:monospace;letter-spacing:0.5px;" dir="ltr">${orderNumber}</div>` +
      (totalEur
        ? `<div style="font-size:13px;color:#4c4a45;margin-top:6px;">${c.totalLabel}: ${totalEur} ${c.euro}</div>`
        : '') +
      '</div>' +
      para(c.reservationClose),
  );
  return {
    template: 'reservation_confirmed',
    subject: c.reservationSubject(orderNumber),
    text,
    html,
    locale: normalizeEmailLocale(locale),
  };
}

/** Cancellation notice — confirms the release, keeps the door open. */
export function composeReservationCancelled(
  name: string | null,
  orderId: string,
  locale?: string | null,
): ComposedEmail {
  const c = emailCopy(locale);
  const g = greet(c, name);
  const lead = c.cancelledLead(orderId);
  const text = `${g}\n\n${lead}\n\n${c.cancelledClose}\n\n${textFooter(c)}`;
  const html = htmlWrap(c, para(g) + para(lead) + para(c.cancelledClose));
  return {
    template: 'reservation_cancelled',
    subject: c.cancelledSubject,
    text,
    html,
    locale: normalizeEmailLocale(locale),
  };
}

/**
 * Queue a composed email. MUST run inside withPii (encrypt_pii needs the
 * session key) — pass the pii tx. Never throws into the caller's business
 * flow: a mail that cannot be queued must not break a sign-up or an order,
 * so callers wrap this in a best-effort try/catch.
 *
 * `customerId` is what lets erasure find this letter later. Passing null is
 * allowed but should be rare and deliberate: a letter with no subject cannot
 * be withdrawn when that person invokes Art. 17, and before migration 0096
 * the column did not exist at all — which is precisely how an erased
 * customer came to be sent mail on 2026-07-22.
 */
export async function enqueueEmail(
  tx: SqlExecutor,
  recipient: string,
  mail: ComposedEmail,
  customerId: string | null,
): Promise<void> {
  await tx.execute(drizzleSql`
    INSERT INTO email_outbox (recipient_encrypted, template, subject, body_text, body_html, locale,
                              customer_id)
    VALUES (encrypt_pii(${recipient}), ${mail.template}, ${mail.subject}, ${mail.text},
            ${mail.html}, ${mail.locale}, ${customerId})
  `);
}
