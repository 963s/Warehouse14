/**
 * Single source for the house's direct-contact channels.
 *
 * WhatsApp lives in its correct places (Nachlass band, Ankauf section,
 * Termin page, Kontakt page) — never as a floating bubble. Every caller
 * imports the number and link builder from HERE so the day the owner sets
 * the real number, one line changes and the whole storefront follows.
 */

/**
 * PLACEHOLDER — the owner will set the real WhatsApp business number here.
 * Format: country code + number, digits only, no "+", no spaces
 * (wa.me requires exactly this shape).
 */
export const WHATSAPP_NUMBER = "4917100000000";

/** Default opening message — a polite, neutral valuation request. */
export const WHATSAPP_MESSAGE =
  "Guten Tag, ich möchte etwas bewerten lassen.";

/**
 * Builds the wa.me deep link, optionally with a context-specific message
 * (e.g. the Termin page asks for an appointment instead of a valuation).
 */
export function waLink(message: string = WHATSAPP_MESSAGE): string {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}
