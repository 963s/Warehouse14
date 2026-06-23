/**
 * Belegtext-Editor - pure labels + ordering + validation for the receipt-legal-
 * text editor in Einstellungen. No React, no I/O: a screen imports these so the
 * UI stays a thin shell over the verified `belegtextApi` contract.
 *
 * The truth source is the backend: GET /api/belegtext-templates (currentOnly)
 * lists the CURRENT row per (kind, language); POST publishes a new version,
 * closing the previous one in one TX and audit-logging `belegtext.published`.
 * That publish is Owner + step-up AND mTLS-paired-device only - a real fiscal
 * write, because the text it stores prints on every GoBD-relevant Beleg. So the
 * editor treats it with the same gravity as a money commit (FiscalConfirmSheet).
 *
 * Honesty: a kind with no CURRENT row is shown as „Noch nicht hinterlegt", never
 * with an invented body. We do not fabricate a fallback text; the receipt
 * printer resolves its own default server-side.
 */
import {
  BELEGTEXT_KIND_LABELS,
  type BelegtextKind,
  type BelegtextRow,
} from "@warehouse14/api-client"

/**
 * The kinds an owner actually curates from the phone, in a deliberate reading
 * order: the two legal headers/footers that frame every Beleg, then the per-
 * Steuerschlüssel clauses, then the Ankauf declaration. We intentionally do NOT
 * surface every wire kind (e.g. REVERSE_CHARGE_13B) - only the ones a salon/
 * second-hand owner edits - but an unknown kind that DOES come back from the
 * server is still rendered (see mergeBelegtextRows) so nothing is hidden.
 */
export const BELEGTEXT_EDITOR_ORDER: readonly BelegtextKind[] = [
  "GENERIC_HEADER",
  "GENERIC_FOOTER",
  "MARGIN_25A",
  "STANDARD_19",
  "REDUCED_7",
  "INVESTMENT_GOLD_25C",
  "KLEINUNTERNEHMER_19",
  "ANKAUFBELEG_DECLARATION",
]

/** A short German one-liner under each kind explaining WHERE it appears. */
export const BELEGTEXT_KIND_HELP: Readonly<Record<BelegtextKind, string>> = {
  GENERIC_HEADER: "Kopfzeile über jedem Beleg (Firmierung, Adresse).",
  GENERIC_FOOTER: "Fußzeile unter jedem Beleg (Dank, Hinweise).",
  MARGIN_25A: "Pflichthinweis bei Differenzbesteuerung (§ 25a UStG).",
  STANDARD_19: "Hinweis bei voller Umsatzsteuer (19 %).",
  REDUCED_7: "Hinweis beim ermäßigten Satz (7 %).",
  INVESTMENT_GOLD_25C: "Steuerbefreiung für Anlagegold (§ 25c UStG).",
  KLEINUNTERNEHMER_19: "Kleinunternehmer-Hinweis (§ 19 UStG).",
  ANKAUFBELEG_DECLARATION: "Erklärung auf dem Ankaufbeleg (Herkunft, Identität).",
  REVERSE_CHARGE_13B: "Steuerschuldnerschaft des Leistungsempfängers (§ 13b).",
}

/** The German label for a kind (re-exported from the contract for one import). */
export function belegtextKindLabel(kind: BelegtextKind): string {
  return BELEGTEXT_KIND_LABELS[kind]
}

/** The short help line for a kind (empty string for an unmapped future kind). */
export function belegtextKindHelp(kind: BelegtextKind): string {
  return BELEGTEXT_KIND_HELP[kind] ?? ""
}

/** Max body length the editor accepts - generous, but a fat-finger guard. */
export const BELEGTEXT_MAX_LEN = 4000

export interface BelegtextValidation {
  ok: boolean
  /** Trimmed text that would be sent (never the raw draft). */
  value: string
  /** A German reason when `ok` is false, else null. */
  error: string | null
}

/**
 * Validate a draft body before publish. The server requires a non-empty text;
 * we trim, reject an empty/whitespace draft and an over-long one, and reject a
 * no-op (identical to the current text) so we never publish a meaningless new
 * version that only churns the audit log.
 */
export function validateBelegtextDraft(
  draft: string,
  currentBody: string | null,
): BelegtextValidation {
  const value = draft.trim()
  if (value.length === 0) {
    return { ok: false, value, error: "Bitte einen Text eingeben." }
  }
  if (value.length > BELEGTEXT_MAX_LEN) {
    return {
      ok: false,
      value,
      error: `Höchstens ${BELEGTEXT_MAX_LEN.toLocaleString("de-DE")} Zeichen.`,
    }
  }
  if (currentBody != null && value === currentBody.trim()) {
    return { ok: false, value, error: "Text ist unverändert, nichts zu speichern." }
  }
  return { ok: true, value, error: null }
}

/** One row of the editor list: a kind + its CURRENT body (or null when unset). */
export interface BelegtextEditorRow {
  kind: BelegtextKind
  label: string
  help: string
  /** The live CURRENT body text, or null when no version is hinterlegt yet. */
  body: string | null
  /** When this version began (ISO), for an honest „seit"-stamp. null when unset. */
  validFrom: string | null
}

/**
 * Merge the curated editor order with whatever the server actually returned
 * (currentOnly list). Each curated kind gets its live body if present, else
 * null. Any extra kind the server returns that is NOT in the curated order is
 * appended at the end so a server-side addition is never silently dropped.
 */
export function buildBelegtextRows(items: readonly BelegtextRow[]): BelegtextEditorRow[] {
  // Latest CURRENT row per kind (the list is currentOnly + desc validFrom, so
  // the first sighting per kind is the freshest).
  const byKind = new Map<BelegtextKind, BelegtextRow>()
  for (const row of items) {
    if (!byKind.has(row.kind)) byKind.set(row.kind, row)
  }

  const seen = new Set<BelegtextKind>()
  const rows: BelegtextEditorRow[] = []

  for (const kind of BELEGTEXT_EDITOR_ORDER) {
    seen.add(kind)
    const live = byKind.get(kind)
    rows.push({
      kind,
      label: belegtextKindLabel(kind),
      help: belegtextKindHelp(kind),
      body: live?.bodyText ?? null,
      validFrom: live?.validFrom ?? null,
    })
  }

  // Append any server kind we did not curate, so nothing is hidden.
  for (const [kind, live] of byKind) {
    if (seen.has(kind)) continue
    rows.push({
      kind,
      label: belegtextKindLabel(kind),
      help: belegtextKindHelp(kind),
      body: live.bodyText,
      validFrom: live.validFrom,
    })
  }

  return rows
}

/** A compact single-line preview of a body (collapsed whitespace, truncated). */
export function belegtextPreview(body: string | null, max = 80): string {
  if (body == null) return "Noch nicht hinterlegt"
  const oneLine = body.replace(/\s+/g, " ").trim()
  if (oneLine.length === 0) return "Noch nicht hinterlegt"
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine
}

/** A de-DE „seit"-stamp for a CURRENT version's validFrom, or null. */
export function belegtextSinceLabel(validFrom: string | null): string | null {
  if (validFrom == null) return null
  const d = new Date(validFrom)
  if (Number.isNaN(d.getTime())) return null
  return `seit ${d.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })}`
}
