/**
 * Shared customer presentation — German labels + Badge variants for the KYC
 * (GwG) status, the trust level, and the KYC document types. The labels are the
 * single source from api-client (operator surfaces MUST render these, never the
 * raw SCREAMING_CASE enum); this module only adds the Badge variant mapping +
 * the document-type options for the capture form.
 */
import {
  CUSTOMER_KYC_STATUS_LABELS,
  CUSTOMER_TRUST_LEVEL_LABELS,
  type CustomerKycStatus,
  type CustomerLanguage,
  type CustomerTrustLevel,
  type KycDocumentType,
} from "@warehouse14/api-client"

import type { BadgeProps } from "@/components/ui/badge"

type BadgeVariant = NonNullable<BadgeProps["variant"]>

/** German KYC-status labels (re-exported from api-client for one import site). */
export const KYC_STATUS_LABEL: Readonly<Record<CustomerKycStatus, string>> =
  CUSTOMER_KYC_STATUS_LABELS

export const KYC_STATUS_VARIANT: Record<CustomerKycStatus, BadgeVariant> = {
  NOT_REQUIRED: "outline",
  PENDING: "secondary",
  CAPTURED: "secondary",
  VERIFIED: "success",
  EXPIRED: "destructive",
  REJECTED: "destructive",
}

/** German trust-level labels (re-exported from api-client). */
export const TRUST_LEVEL_LABEL: Readonly<Record<CustomerTrustLevel, string>> =
  CUSTOMER_TRUST_LEVEL_LABELS

export const TRUST_LEVEL_VARIANT: Record<CustomerTrustLevel, BadgeVariant> = {
  NEW: "outline",
  VERIFIED: "success",
  VIP: "default",
  SUSPICIOUS: "secondary",
  BANNED: "destructive",
}

/** Bevorzugte Sprache des Kunden — chip options for the intake/edit form. */
export const LANGUAGE_OPTIONS: ReadonlyArray<{ value: CustomerLanguage; label: string }> = [
  { value: "de", label: "Deutsch" },
  { value: "en", label: "Englisch" },
  { value: "ar", label: "Arabisch" },
]

/** Document-type options for the Ausweis capture form (DE-biased, like the POS). */
export const KYC_DOC_TYPE_OPTIONS: ReadonlyArray<{ value: KycDocumentType; label: string }> = [
  { value: "PERSONALAUSWEIS", label: "Personalausweis" },
  { value: "REISEPASS", label: "Reisepass (DE)" },
  { value: "ID_CARD_EU", label: "EU-Personalausweis" },
  { value: "PASSPORT_EU", label: "EU-Reisepass" },
  { value: "PASSPORT_NON_EU", label: "Reisepass Nicht-EU" },
]

// ───────────────────────────────────────────────────────────────────────────
// Adresse — honest rendering of a free-form address string.
//
// `customer.address` is a free-text `string | null` in the API contract. The
// mobile intake stores a plain one-line string, but a POS- / seed-created
// customer stores a JSON-serialised structured address, e.g.
//   {"street":"Bahnhofstraße 31","postalCode":"79576","city":"Weil am Rhein","country":"DE"}
// Rendering that raw leaks English developer keys (street/postalCode/…) into
// the owner UI. So before display we detect that shape and fold it into a clean
// German one-liner; anything else is returned verbatim (the owner's own text).
// Pure + total: never throws, returns null only for genuinely empty input.
// ───────────────────────────────────────────────────────────────────────────

// Die Anschrift-Faltung lebt in @warehouse14/i18n-de, damit Telefon und Kasse
// dieselbe Zeile zeigen. Hier nur re-exportiert, damit die Bildschirme ihre eine
// Import-Adresse behalten.
import { formatCustomerAddress } from "@warehouse14/i18n-de"

export { formatCustomerAddress }

/**
 * The value to prefill the „Adresse" edit input with. Same folding as the
 * display path so the owner edits a clean one-liner, never raw JSON; empty
 * input prefills to "" (an honest blank field).
 */
export function addressInputValue(address: string | null | undefined): string {
  return formatCustomerAddress(address) ?? ""
}
