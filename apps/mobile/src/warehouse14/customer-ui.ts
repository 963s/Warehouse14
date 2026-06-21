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

/** ISO-3166 alpha-2 → German country name, for the few we actually see. */
const COUNTRY_DE: Readonly<Record<string, string>> = {
  DE: "Deutschland",
  AT: "Österreich",
  CH: "Schweiz",
  FR: "Frankreich",
  NL: "Niederlande",
  BE: "Belgien",
  LU: "Luxemburg",
  IT: "Italien",
  ES: "Spanien",
  PL: "Polen",
}

/** Shape a structured-address blob can take (all fields optional). */
type StructuredAddress = {
  street?: unknown
  postalCode?: unknown
  city?: unknown
  country?: unknown
}

function asTrimmed(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Fold a structured-address object into a clean German one-liner:
 *   „Bahnhofstraße 31, 79576 Weil am Rhein, Deutschland". Country reads German
 * (DE → Deutschland); an unknown code falls back to the raw code (still no
 * English key leaks). Returns null when the object carries no usable field.
 */
function joinStructuredAddress(obj: StructuredAddress): string | null {
  const street = asTrimmed(obj.street)
  const postalCode = asTrimmed(obj.postalCode)
  const city = asTrimmed(obj.city)
  const countryRaw = asTrimmed(obj.country)
  const country = countryRaw
    ? (COUNTRY_DE[countryRaw.toUpperCase()] ?? countryRaw)
    : null

  const cityLine = [postalCode, city].filter(Boolean).join(" ")
  const parts = [street, cityLine || null, country].filter(
    (p): p is string => p != null && p.length > 0,
  )
  return parts.length > 0 ? parts.join(", ") : null
}

/**
 * Render a customer's `address` for display. Detects + folds a JSON structured
 * address into a German one-liner; otherwise returns the trimmed plain string.
 * `null` for empty/blank input — the caller decides the placeholder („—").
 */
export function formatCustomerAddress(address: string | null | undefined): string | null {
  const trimmed = asTrimmed(address)
  if (trimmed == null) return null
  // Only attempt a parse when it actually looks like a JSON object — cheap guard
  // so a normal street string never pays the try/catch.
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const folded = joinStructuredAddress(parsed as StructuredAddress)
        // A JSON object with no usable address field → show nothing rather than
        // the raw blob (never leak `{...}` with English keys to the owner).
        if (folded != null) return folded
        return null
      }
    } catch {
      // Not valid JSON after all — fall through and show the literal string.
    }
  }
  return trimmed
}

/**
 * The value to prefill the „Adresse" edit input with. Same folding as the
 * display path so the owner edits a clean one-liner, never raw JSON; empty
 * input prefills to "" (an honest blank field).
 */
export function addressInputValue(address: string | null | undefined): string {
  return formatCustomerAddress(address) ?? ""
}
