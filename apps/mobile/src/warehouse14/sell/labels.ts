/**
 * labels — the German display vocabulary for the sell spine.
 *
 * One place for the Steuerschlüssel + Zahlungsart copy so the cart row, the
 * receipt preview and the fiscal-confirm sheet all read identically. No money,
 * no logic — just the human labels for the wire enums.
 */
import type { PaymentMethod, TaxTreatmentCode } from "@warehouse14/api-client"

/** Short Steuerschlüssel label for a dense badge ("19% MwSt", "§25a"). */
export const TAX_TREATMENT_SHORT: Record<TaxTreatmentCode, string> = {
  STANDARD_19: "19% MwSt",
  REDUCED_7: "7% MwSt",
  MARGIN_25A: "§25a Marge",
  INVESTMENT_GOLD_25C: "§25c Anlagegold",
  REVERSE_CHARGE_13B: "§13b Reverse-Charge",
  MIXED: "Gemischt",
}

/** Full Steuerschlüssel line for the receipt's legal VAT breakdown. */
export const TAX_TREATMENT_LONG: Record<TaxTreatmentCode, string> = {
  STANDARD_19: "Regelsteuersatz 19%",
  REDUCED_7: "Ermäßigter Satz 7%",
  MARGIN_25A: "Differenzbesteuerung §25a UStG",
  INVESTMENT_GOLD_25C: "Steuerbefreites Anlagegold §25c UStG",
  REVERSE_CHARGE_13B: "Steuerschuldnerschaft des Leistungsempfängers §13b UStG",
  MIXED: "Gemischte Steuersätze",
}

/** German label for a payment method. */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Bar",
  ZVT_CARD: "EC-/Kreditkarte",
  SUMUP: "SumUp",
  MOLLIE: "Mollie",
  STRIPE: "Stripe",
  EBAY: "eBay",
  BANK_TRANSFER: "Überweisung",
  VOUCHER: "Gutschein",
}

/**
 * Format a decimal VAT-rate string ("0.1900") as a de-DE percentage ("19 %").
 * Returns null for the rate-less treatments (§25a/§25c) so the receipt prints
 * the scheme name instead of a misleading "0 %".
 */
export function formatVatRate(rate: string | null): string | null {
  if (rate == null) return null
  const value = Number(rate)
  if (!Number.isFinite(value) || value === 0) return null
  const pct = value * 100
  // Whole percentages render without decimals (19 %, 7 %); keep one place only
  // if the rate genuinely has a fraction.
  const text = Number.isInteger(pct) ? String(pct) : pct.toLocaleString("de-DE")
  return `${text} %`
}
