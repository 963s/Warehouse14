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

/**
 * True when `raw` is a non-negative WEIGHT in grams — up to 3 fraction digits
 * (the gold scale is 3-dp; the `weight_grams NUMERIC(10,4)` column tolerates
 * more but the operator never types 4). Use this instead of `isMoneyInput`
 * (2-dp) for weight fields so a real gold weight like "7,965" is accepted.
 */
export function isWeightInput(raw: string): boolean {
  return isMoneyInput(raw, 3);
}

/**
 * Format a raw canonical weight string (e.g. the `"300.0000"` postgres NUMERIC
 * returns) for display: German comma, NO trailing zeros, max 3 fraction digits.
 * "300.0000" → "300", "7.965" → "7,965", "12.50" → "12,5". Empty/garbage → "".
 * The caller appends the unit (" g"). Display only — never feed back into math.
 */
export function formatGrams(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (s === '') return '';
  const n = Number(s.replace(',', '.'));
  if (!Number.isFinite(n)) return '';
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 }).format(n);
}

/**
 * Format a raw canonical money string for display in German: comma decimal,
 * dot thousands, always 2 fraction digits. "300.00" → "300,00", "1234.5" →
 * "1.234,50". The caller appends " €". Display only — money MATH stays on the
 * canonical decimal string, never this. Empty/garbage → "".
 */
export function formatEur(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (s === '') return '';
  const n = Number(s.replace(',', '.'));
  if (!Number.isFinite(n)) return '';
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}
