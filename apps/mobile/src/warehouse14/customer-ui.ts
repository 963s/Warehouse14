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
  COMPLETED: "success",
  EXPIRED: "destructive",
  FAILED: "destructive",
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

/** Document-type options for the Ausweis capture form (DE-biased, like the POS). */
export const KYC_DOC_TYPE_OPTIONS: ReadonlyArray<{ value: KycDocumentType; label: string }> = [
  { value: "PERSONALAUSWEIS", label: "Personalausweis" },
  { value: "REISEPASS", label: "Reisepass (DE)" },
  { value: "ID_CARD_EU", label: "EU-Personalausweis" },
  { value: "PASSPORT_EU", label: "EU-Reisepass" },
  { value: "PASSPORT_NON_EU", label: "Reisepass Nicht-EU" },
]
