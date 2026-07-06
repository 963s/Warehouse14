/**
 * tse-vat — the DSFinV-K USt-Schlüssel (ID_UST) per tax treatment, and the
 * `amounts_per_vat_id` breakdown the TSE FINISH must sign (KassenSichV).
 *
 * The mapping is MIRRORED from the server's canonical source
 * (`apps/api-cloud/src/lib/dsfinvk-export.ts` → `UST_SCHLUESSEL`, fallback '7')
 * so the TSE signed body's `amounts_per_vat_id` and the DSFinV-K export can
 * never disagree for the same line — both are validated together against the
 * official Prüftool (Phase 6.6). NEVER invent a key here: if a key is wrong it
 * must be wrong in BOTH places and the Steuerberater corrects it once.
 *
 *   1 → 19,00 % Regelsteuersatz            ← STANDARD_19
 *   2 →  7,00 % ermäßigter Steuersatz      ← REDUCED_7
 *   5 →  0,00 % nicht steuerbar/steuerfrei  ← INVESTMENT_GOLD_25C (§25c)
 *   7 → Differenzbesteuerung §25a UStG      ← MARGIN_25A (+ server fallback)
 */
import type { TaxTreatmentCode } from '@warehouse14/api-client';

/**
 * vat_id = DSFinV-K ID_UST (integer). REVERSE_CHARGE_13B / MIXED are not in the
 * server's explicit map, so they fall to its '7' fallback — kept identical here
 * so the signed body never diverges from the DSFinV-K export for the same line.
 */
const UST_SCHLUESSEL: Readonly<Record<TaxTreatmentCode, number>> = {
  STANDARD_19: 1,
  REDUCED_7: 2,
  INVESTMENT_GOLD_25C: 5,
  MARGIN_25A: 7,
  REVERSE_CHARGE_13B: 7,
  MIXED: 7,
};

/** The DSFinV-K USt-Schlüssel (fiskaly standard_v1 vat_id) for a treatment. */
export function ustSchluessel(code: TaxTreatmentCode): number {
  return UST_SCHLUESSEL[code];
}

export interface VatAmount {
  /** DSFinV-K ID_UST — the fiskaly standard_v1 vat_id. */
  vatId: number;
  /** GROSS amount (incl. VAT) for this vat_id, in integer cents. */
  amountCents: number;
}

export interface VatBreakdownLine {
  appliedTaxTreatmentCode: TaxTreatmentCode;
  /** GROSS line total (incl. VAT) in integer cents. */
  lineTotalCents: number;
}

/**
 * Group a receipt's lines by DSFinV-K USt-Schlüssel and sum the GROSS amount
 * per key — the `amounts_per_vat_id` the TSE FINISH signs. The sum across all
 * entries equals the receipt total (== amounts_per_payment_type), which fiskaly
 * requires. Sorted by vatId so the signed body is deterministic.
 */
export function computeAmountsPerVatId(lines: ReadonlyArray<VatBreakdownLine>): VatAmount[] {
  const byKey = new Map<number, number>();
  for (const line of lines) {
    const key = ustSchluessel(line.appliedTaxTreatmentCode);
    byKey.set(key, (byKey.get(key) ?? 0) + line.lineTotalCents);
  }
  return [...byKey.entries()]
    .map(([vatId, amountCents]) => ({ vatId, amountCents }))
    .sort((a, b) => a.vatId - b.vatId);
}
