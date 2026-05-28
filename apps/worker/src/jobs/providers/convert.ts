/**
 * Unit + formatting helpers shared by the price providers.
 *
 * Spot vendors quote per TROY OUNCE; the engine stores per GRAM (€/g) at 4 dp
 * to match `metal_prices.price_per_gram_eur NUMERIC(15,4)`. These are market
 * quotes (a price *feed*), not ledger postings — the fiscal money math
 * (Schmelzwert, Ankauf rate) is computed downstream in NUMERIC/`Money`, so a
 * 4 dp rounded feed value is the correct precision here.
 */

/** Grams in one troy ounce (exact, per the international troy system). */
export const TROY_OUNCE_GRAMS = 31.1034768;

/** Round a number to a fixed-dp decimal string (default 4 dp). */
export function toDecimalString(value: number, dp = 4): string {
  if (!Number.isFinite(value)) {
    throw new Error(`non-finite price: ${value}`);
  }
  return value.toFixed(dp);
}

/** Convert a per-troy-ounce price into a per-gram decimal string. */
export function perOunceToPerGram(pricePerOunce: number, dp = 4): string {
  if (!Number.isFinite(pricePerOunce) || pricePerOunce <= 0) {
    throw new Error(`non-positive per-ounce price: ${pricePerOunce}`);
  }
  return toDecimalString(pricePerOunce / TROY_OUNCE_GRAMS, dp);
}
