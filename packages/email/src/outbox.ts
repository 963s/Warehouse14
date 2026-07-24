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

import {
  emailCopy,
  normalizeEmailLocale,
  EMAIL_CONTACT_LINE,
  SHOP,
  type EmailCopy,
} from './copy.js';

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

/** One palette, named once, so light and dark cannot drift apart. */
const INK = '#1c1c1c';
const MUTED = '#6e6b64';
const GOLD = '#a3823b';
const PAPER = '#efece3';
const CARD = '#ffffff';
const RULE = '#ded8c9';

/**
 * The letterhead.
 *
 * The mark is pure black line art, so it sits on an explicitly WHITE card in
 * BOTH schemes rather than on the page. That is not an oversight about dark
 * mode: a letterhead is ink printed on paper, and a white card reads as paper
 * on a dark screen exactly as it does on a light one. Inverting it would be
 * the thing that looks broken.
 *
 * `width` is an attribute as well as a style because Outlook ignores the
 * style and would otherwise render the image at its full 360 pixels.
 */
function letterhead(c: EmailCopy): string {
  return (
    `<td style="background:${CARD};border-radius:14px;padding:26px 24px 20px;text-align:center;">` +
    `<img src="cid:${EMAIL_LOGO_CID}" width="176" alt="${SHOP.brand}" ` +
    'style="width:176px;max-width:100%;height:auto;display:block;margin:0 auto;border:0;">' +
    `<div style="font-family:Georgia,'Times New Roman',serif;font-size:11px;color:${MUTED};` +
    `margin-top:12px;letter-spacing:1.6px;text-transform:uppercase;">${c.tagline}</div>` +
    '</td>'
  );
}

/**
 * The signature, built so a thumb can use it.
 *
 * Every line that can act, acts: the number dials, the address opens a map,
 * the mailbox composes a reply. Most of these letters are read on a phone
 * while the reader is deciding whether to come in, and a signature they have
 * to retype by hand is one they do not use.
 */
function signature(c: EmailCopy): string {
  const link = (href: string, text: string) =>
    `<a href="${href}" style="color:${MUTED};text-decoration:none;border-bottom:1px solid ${RULE};">${text}</a>`;

  // EVERY element carrying an inline colour also carries the class that
  // overrides it in dark mode. Inline styles beat a class rule and do not
  // inherit past a child that sets its own colour, so a wrapper class is not
  // enough: the first version of this signature put the shop name in ink with
  // no class and it rendered black on near-black, invisible to any reader in
  // dark mode. The screenshot caught it; nothing else could have.
  return (
    `<div class="w14-ink" style="font-family:Georgia,'Times New Roman',serif;font-size:13px;` +
    `color:${INK};line-height:1.7;margin-bottom:10px;">` +
    `<strong style="font-weight:normal;letter-spacing:0.6px;">${SHOP.brand}</strong>` +
    `<div class="w14-muted" style="font-size:12px;color:${MUTED};">${SHOP.operator}</div>` +
    '</div>' +
    `<div class="w14-muted" style="font-size:12px;color:${MUTED};line-height:1.9;">` +
    `<div>${link(SHOP.mapUrl, `${SHOP.street}, ${SHOP.city}`)}</div>` +
    `<div>${link(`tel:${SHOP.phoneDial}`, SHOP.phoneHuman)}` +
    `&nbsp;&middot;&nbsp;${link(`mailto:${SHOP.email}`, SHOP.email)}</div>` +
    `<div>${c.openingHoursLabel}: ${c.openingHours}</div>` +
    '</div>' +
    `<div class="w14-muted" style="font-size:11px;color:${MUTED};line-height:1.6;margin-top:14px;">` +
    `USt IdNr ${SHOP.vatId}` +
    (c.courtesyNote ? `<br>${c.courtesyNote}` : '') +
    '</div>'
  );
}

/**
 * `preheader` is the grey line the inbox shows next to the subject before the
 * letter is opened. Left unset, clients scrape whatever text comes first,
 * which here is the alt text of the logo, so every letter previews as
 * "Warehouse 14 Warehouse 14". Setting it deliberately is one of the cheapest
 * things a transactional letter can do and one of the most often skipped.
 */
function htmlWrap(c: EmailCopy, bodyHtml: string, preheader: string): string {
  const align = c.dir === 'rtl' ? 'right' : 'left';
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    // Tells the client the letter has its own dark palette, so it renders
    // ours instead of force-inverting the colours itself.
    '<meta name="color-scheme" content="light dark">' +
    '<meta name="supported-color-schemes" content="light dark">' +
    '<style>' +
    'a{color:inherit}' +
    '@media (prefers-color-scheme:dark){' +
    '.w14-page{background:#14130f!important}' +
    '.w14-sheet{background:#1e1c17!important}' +
    '.w14-ink{color:#eae6da!important}' +
    '.w14-muted{color:#a6a091!important}' +
    '.w14-ref{background:#26231c!important;border-color:#3a3529!important}' +
    '.w14-rule{background:#3a3529!important}' +
    '.w14-gold{background:#c9a55c!important}' +
    '}' +
    '@media (max-width:600px){.w14-pad{padding:20px 18px!important}}' +
    '</style></head>' +
    `<body class="w14-page" style="margin:0;padding:0;background:${PAPER};` +
    '-webkit-text-size-adjust:100%;" dir="' +
    c.dir +
    '">' +
    // Hidden preview line. The zero-width joiners stop clients padding the
    // preview with the body text that follows.
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}` +
    '&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    `style="background:${PAPER};" class="w14-page"><tr><td align="center" style="padding:28px 12px;">` +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" ' +
    'style="width:100%;max-width:600px;"><tr>' +
    letterhead(c) +
    '</tr><tr><td style="height:20px;line-height:20px;font-size:0;">&nbsp;</td></tr><tr>' +
    `<td class="w14-sheet w14-pad" style="background:${CARD};border-radius:14px;padding:32px 30px;` +
    `font-family:Georgia,'Times New Roman',serif;color:${INK};text-align:${align};">` +
    `<div class="w14-ink" style="color:${INK};">${bodyHtml}</div>` +
    `<div class="w14-gold" style="height:2px;width:44px;background:${GOLD};margin:26px 0 20px;` +
    'font-size:0;line-height:0;">&nbsp;</div>' +
    `<div class="w14-muted">${signature(c)}</div>` +
    '</td></tr></table></td></tr></table></body></html>'
  );
}

function para(text: string): string {
  return `<p style="font-size:15.5px;line-height:1.65;margin:0 0 15px;color:inherit;">${text}</p>`;
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
    c.welcomeLead,
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
 * Ein Rundschreiben an die Kundschaft (0105) — der freie Text aus dem
 * Benachrichtigungszentrum, gegossen in denselben Briefkopf wie jeder andere
 * Brief, damit ein Dank oder ein Feiertagsgruss nicht wie eine fremde
 * Massenmail aussieht, sondern wie ein Brief aus DIESEM Laden.
 *
 * `title` und `body` kommen fertig in der Sprache des Empfaengers herein (der
 * Absender hat sie je Sprache verfasst oder auf Deutsch zurueckfallen lassen);
 * diese Funktion uebersetzt nichts, sie kleidet nur ein. Absaetze trennt eine
 * Leerzeile, ein einfacher Zeilenumbruch bleibt einer.
 */
export function composeBroadcast(
  title: string,
  body: string,
  name: string | null,
  locale?: string | null,
): ComposedEmail {
  const c = emailCopy(locale);
  const g = greet(c, name);
  const paras = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const text = `${g}\n\n${paras.join('\n\n')}\n\n${textFooter(c)}`;
  const html = htmlWrap(
    c,
    para(g) +
      paras.map((p) => para(escapeHtml(p).replace(/\n/g, '<br>'))).join(''),
    escapeHtml(title),
  );
  return {
    template: 'broadcast',
    subject: title,
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
      // The stub. Its own surface, a monospaced number and a gold edge, so
      // the one thing the reader must repeat at the counter is the one thing
      // the eye lands on first.
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="margin:4px 0 18px;"><tr>' +
      `<td class="w14-gold" width="3" style="background:${GOLD};border-radius:3px 0 0 3px;` +
      'font-size:0;line-height:0;">&nbsp;</td>' +
      `<td class="w14-ref" style="background:#faf8f2;border:1px solid ${RULE};border-left:0;` +
      'border-radius:0 10px 10px 0;padding:16px 20px;">' +
      `<div class="w14-muted" style="font-size:11px;color:${MUTED};letter-spacing:1.2px;` +
      `text-transform:uppercase;">${c.refLabel}</div>` +
      `<div class="w14-ink" style="font-size:22px;color:${INK};margin-top:4px;` +
      `font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:1px;" dir="ltr">` +
      `${orderNumber}</div>` +
      (totalEur
        ? `<div class="w14-muted" style="font-size:13px;color:${MUTED};margin-top:8px;">` +
          `${c.totalLabel}: ${totalEur} ${c.euro}</div>`
        : '') +
      '</td></tr></table>' +
      para(c.reservationClose),
    `${c.refLabel}: ${orderNumber}`,
  );
  return {
    template: 'reservation_confirmed',
    subject: c.reservationSubject(orderNumber),
    text,
    html,
    locale: normalizeEmailLocale(locale),
  };
}

/**
 * „Ihr Stück liegt bereit." Der Brief, der die Kundschaft an den Tresen holt.
 *
 * Spiegelt composeReservationConfirmed: dieselbe Nummernkarte, weil die
 * Reservierungsnummer wieder das Einzige ist, das der Mensch am Tresen laut
 * sagen muss. Kein Betrag hier, das war der Bestätigungsbrief; hier zählt nur
 * die Aufforderung zu kommen, samt Öffnungszeiten aus dem Fuß.
 */
export function composeOrderReady(
  name: string | null,
  orderNumber: string,
  locale?: string | null,
): ComposedEmail {
  const c = emailCopy(locale);
  const g = greet(c, name);
  const text =
    `${g}\n\n${c.readyLead}\n\n` +
    `${c.refLabel}: ${orderNumber}\n` +
    `\n${c.readyClose}\n\n${textFooter(c)}`;
  const html = htmlWrap(
    c,
    para(g) +
      para(c.readyLead) +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="margin:4px 0 18px;"><tr>' +
      `<td class="w14-gold" width="3" style="background:${GOLD};border-radius:3px 0 0 3px;` +
      'font-size:0;line-height:0;">&nbsp;</td>' +
      `<td class="w14-ref" style="background:#faf8f2;border:1px solid ${RULE};border-left:0;` +
      'border-radius:0 10px 10px 0;padding:16px 20px;">' +
      `<div class="w14-muted" style="font-size:11px;color:${MUTED};letter-spacing:1.2px;` +
      `text-transform:uppercase;">${c.refLabel}</div>` +
      `<div class="w14-ink" style="font-size:22px;color:${INK};margin-top:4px;` +
      `font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:1px;" dir="ltr">` +
      `${orderNumber}</div>` +
      '</td></tr></table>' +
      para(c.readyClose),
    `${c.refLabel}: ${orderNumber}`,
  );
  return {
    template: 'order_ready',
    subject: c.readySubject(orderNumber),
    text,
    html,
    locale: normalizeEmailLocale(locale),
  };
}

/**
 * „Wir haben Ihre Reservierung angenommen."
 *
 * Der einzige Brief zwischen dem Reservieren und dem Bereitliegen. Er sagt
 * das, was ein wartender Mensch wissen will: ein Mensch hat den Beleg gesehen
 * und zugesagt. Der interne Schritt „in Vorbereitung" bekommt bewusst KEINEN
 * Brief, weil sich für den Leser nichts ändert und ein Postfach kein
 * Arbeitsprotokoll ist.
 */
export function composeOrderAccepted(
  name: string | null,
  orderNumber: string,
  locale?: string | null,
): ComposedEmail {
  const c = emailCopy(locale);
  const g = greet(c, name);
  const text =
    `${g}\n\n${c.acceptedLead}\n\n` +
    `${c.refLabel}: ${orderNumber}\n` +
    `\n${c.acceptedClose}\n\n${textFooter(c)}`;
  const html = htmlWrap(
    c,
    para(g) +
      para(c.acceptedLead) +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="margin:4px 0 18px;"><tr>' +
      `<td class="w14-gold" width="3" style="background:${GOLD};border-radius:3px 0 0 3px;` +
      'font-size:0;line-height:0;">&nbsp;</td>' +
      `<td class="w14-ref" style="background:#faf8f2;border:1px solid ${RULE};border-left:0;` +
      'border-radius:0 10px 10px 0;padding:16px 20px;">' +
      `<div class="w14-muted" style="font-size:11px;color:${MUTED};letter-spacing:1.2px;` +
      `text-transform:uppercase;">${c.refLabel}</div>` +
      `<div class="w14-ink" style="font-size:22px;color:${INK};margin-top:4px;` +
      `font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:1px;" dir="ltr">` +
      `${orderNumber}</div>` +
      '</td></tr></table>' +
      para(c.acceptedClose),
    `${c.refLabel}: ${orderNumber}`,
  );
  return {
    template: 'order_accepted',
    subject: c.acceptedSubject(orderNumber),
    text,
    html,
    locale: normalizeEmailLocale(locale),
  };
}

/**
 * „Ein Stück ist aus Ihrer Reservierung herausgenommen worden."
 *
 * WARUM DIESER BRIEF PFLICHT IST
 * Bis zum 23.07.2026 konnte das Personal eine Bestellung nur ganz ablehnen. War
 * eines von drei Stücken beim Vorbereiten beschädigt, musste die ganze
 * Bestellung sterben — für die Kundschaft eine unnötige Absage. Jetzt lässt
 * sich EINE Position herausnehmen; dann ändert sich aber, was sie abholt und
 * was sie zahlt, und das darf sie nicht am Tresen erfahren.
 *
 * Der Brief nennt das Stück beim Namen und sagt, wie viele bleiben. Beides
 * kommt aus echten Daten; steht keine Zahl fest, wird auch keine behauptet.
 */
export function composeItemRemoved(
  name: string | null,
  orderNumber: string,
  stueckName: string,
  verbleibend: number,
  locale?: string | null,
): ComposedEmail {
  const c = emailCopy(locale);
  const g = greet(c, name);
  const lead = c.itemRemovedLead(stueckName);
  const rest = c.itemRemovedRemaining(verbleibend);
  const text =
    `${g}\n\n${lead}\n\n` +
    `${c.refLabel}: ${orderNumber}\n` +
    `\n${rest}\n${c.itemRemovedClose}\n\n${textFooter(c)}`;
  const html = htmlWrap(
    c,
    para(g) + para(lead) + para(`${c.refLabel}: ${orderNumber}`) + para(rest) + para(c.itemRemovedClose),
    `${c.refLabel}: ${orderNumber}`,
  );
  return {
    template: 'order_item_removed',
    subject: c.itemRemovedSubject(orderNumber),
    text,
    html,
    locale: normalizeEmailLocale(locale),
  };
}

/**
 * „Ihre Abholfrist ist verlängert worden."
 *
 * Die gute Nachricht des Paares. Wer anruft und sagt, er schaffe es erst
 * Samstag, bekommt das neue Datum SCHRIFTLICH statt eines Versprechens am
 * Telefon, an das sich am Samstag niemand erinnert.
 *
 * Das Datum wird in der Sprache des Lesers formatiert, damit der 25.07. nicht
 * als 07/25 ankommt.
 */
export function composeDeadlineExtended(
  name: string | null,
  orderNumber: string,
  deadline: Date,
  locale?: string | null,
): ComposedEmail {
  const c = emailCopy(locale);
  const g = greet(c, name);
  const loc = normalizeEmailLocale(locale);
  const datum = deadline.toLocaleDateString(loc, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const lead = c.deadlineExtendedLead(datum);
  const text =
    `${g}\n\n${lead}\n\n` +
    `${c.refLabel}: ${orderNumber}\n` +
    `\n${c.deadlineExtendedClose}\n\n${textFooter(c)}`;
  const html = htmlWrap(
    c,
    para(g) + para(lead) + para(`${c.refLabel}: ${orderNumber}`) + para(c.deadlineExtendedClose),
    `${c.refLabel}: ${orderNumber}`,
  );
  return {
    template: 'order_deadline_extended',
    subject: c.deadlineExtendedSubject(orderNumber),
    text,
    html,
    locale: loc,
  };
}

/**
 * „Ihre Reservierung läuft bald ab."
 *
 * Der Brief, der bis zum 23.07.2026 fehlte. Eine Reservierung verfiel nach drei
 * Tagen still: niemand wurde gewarnt, das Stück ging zurück in den Verkauf, und
 * die Vertrauensstufe zählte das Ausbleiben als Nichtabholung. Ein Mensch, der
 * nichts gehört hat, hat nichts versäumt.
 *
 * Die Frist steht als DATUM darin, nicht als „bald": ein Datum kann man sich in
 * den Kalender schreiben, ein „bald" nicht. Formatiert in der Sprache des
 * Lesers, damit der 25.07. nicht als 07/25 ankommt.
 */
export function composeExpiryReminder(
  name: string | null,
  orderNumber: string,
  deadline: Date,
  locale?: string | null,
): ComposedEmail {
  const c = emailCopy(locale);
  const loc = normalizeEmailLocale(locale);
  const when = new Intl.DateTimeFormat(loc, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Berlin',
  }).format(deadline);
  const g = greet(c, name);
  const lead = c.expiryReminderLead(when);
  const text =
    `${g}\n\n${lead}\n\n` +
    `${c.refLabel}: ${orderNumber}\n` +
    `\n${c.expiryReminderClose}\n\n${textFooter(c)}`;
  const html = htmlWrap(
    c,
    para(g) +
      para(lead) +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="margin:4px 0 18px;"><tr>' +
      `<td class="w14-gold" width="3" style="background:${GOLD};border-radius:3px 0 0 3px;` +
      'font-size:0;line-height:0;">&nbsp;</td>' +
      `<td class="w14-ref" style="background:#faf8f2;border:1px solid ${RULE};border-left:0;` +
      'border-radius:0 10px 10px 0;padding:16px 20px;">' +
      `<div class="w14-muted" style="font-size:11px;color:${MUTED};letter-spacing:1.2px;` +
      `text-transform:uppercase;">${c.refLabel}</div>` +
      `<div class="w14-ink" style="font-size:22px;color:${INK};margin-top:4px;` +
      `font-family:'SF Mono',Menlo,Consolas,monospace;letter-spacing:1px;" dir="ltr">` +
      `${orderNumber}</div>` +
      '</td></tr></table>' +
      para(c.expiryReminderClose),
    `${c.refLabel}: ${orderNumber}`,
  );
  return {
    template: 'reservation_expiry_reminder',
    subject: c.expiryReminderSubject(orderNumber),
    text,
    html,
    locale: loc,
  };
}

/**
 * Escape text that a human typed before it enters an HTML letter.
 *
 * Staff replies are free text. Without this, a colleague writing "Preis < 100"
 * silently truncates the letter at the angle bracket, and anything paste-like
 * from a browser could carry markup into a customer's inbox under our name.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A member of staff answering a support ticket.
 *
 * The subject deliberately keeps the customer's own wording and appends the
 * ticket number in brackets: `Re: Frage zur Abholung [TIC-2026-000001]`. That
 * one bracket does two jobs. The customer recognises their own words, and if
 * they later reply from a client that mangles threading headers, the poller
 * still finds the ticket from the subject alone.
 *
 * The body is whatever the colleague wrote, escaped and split on blank lines.
 * No template, no marketing: this is one person answering another.
 */
export function composeSupportReply(
  name: string | null,
  ticketNumber: string,
  customerSubject: string,
  bodyText: string,
  locale?: string | null,
): ComposedEmail {
  const c = emailCopy(locale);
  const g = greet(c, name);
  const clean = bodyText.replace(/\r\n/g, '\n').trim();

  const base = customerSubject.replace(/\s*\[TIC-\d{4}-\d{6}\]\s*$/i, '').trim();
  const subject = `${/^(re|aw|antw)\s*:/i.test(base) ? base : `Re: ${base}`} [${ticketNumber}]`;

  const text = `${g}\n\n${clean}\n\n${textFooter(c)}`;
  const html = htmlWrap(
    c,
    para(g) +
      clean
        .split(/\n{2,}/)
        .map((p) => para(escapeHtml(p).replace(/\n/g, '<br>')))
        .join('') +
      `<div style="font-size:11px;color:#6e6b64;margin-top:18px;" dir="ltr">${ticketNumber}</div>`,
    clean.split('\n')[0]?.slice(0, 120) ?? ticketNumber,
  );

  return { template: 'support_reply', subject, text, html, locale: normalizeEmailLocale(locale) };
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
  const html = htmlWrap(c, para(g) + para(lead) + para(c.cancelledClose), lead);
  return {
    template: 'reservation_cancelled',
    subject: c.cancelledSubject(orderId),
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
