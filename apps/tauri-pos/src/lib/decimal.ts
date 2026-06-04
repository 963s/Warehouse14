/**
 * decimal — operator-friendly money parsing for the POS.
 *
 * German operators type the decimal separator as a COMMA ("10,20"). Every money
 * field must accept that and emit the canonical dot-decimal string the backend
 * expects (`^\d+(\.\d{1,N})?$`). This is the single source of truth for that
 * conversion so no input forgets it. (EuroInput has its own inline copy for the
 * Kasse sheet; this util covers the catalogue / pricing / override fields.)
 */

/**
 * Normalise raw operator text to a canonical dot-decimal string.
 * Accepts a comma or a dot as the separator, strips everything else, and keeps
 * at most `maxFrac` fraction digits. Returns "" for empty/garbage input.
 */
export function normalizeDecimal(raw: string, maxFrac = 2): string {
  const cleaned = raw.replace(/[^\d.,]/g, '').replace(/,/g, '.');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  const head = cleaned.slice(0, dot);
  const tail = cleaned
    .slice(dot + 1)
    .replace(/\./g, '')
    .slice(0, maxFrac);
  return `${head}.${tail}`;
}

/**
 * True when `raw` (comma or dot) is a non-negative money amount with between
 * one and `maxFrac` fraction digits and at least one whole digit.
 */
export function isMoneyInput(raw: string, maxFrac = 2): boolean {
  const n = normalizeDecimal(raw, maxFrac);
  return new RegExp(`^\\d+(?:\\.\\d{1,${maxFrac}})?$`).test(n);
}
