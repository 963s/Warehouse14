/**
 * shop-info — the shop identity printed on every customer receipt (Kassenbon)
 * and shown in the on-screen receipt preview.
 *
 * GoBD / KassenSichV require the REAL shop name, full address, and USt-IdNr.
 * on the receipt. These were previously hardcoded to a BERLIN placeholder
 * inside BezahlenDialog (`Musterstraße 1, 10115 Berlin`, VAT `DE000000000`).
 * They now live here as the single source of truth.
 *
 * ⚠️ PROVISIONAL DATA — the address is real (Schornbacher Weg 66, 73614
 * Schorndorf) but `vatId` and `phone` are DUMMY placeholders. BASEL: replace
 * `vatId` with the shop's real USt-IdNr. and `phone` with the real number
 * before go-live (a wrong VAT id on a Kassenbon is a GoBD breach).
 *
 * Phase 1.5: move these into `system_settings` so the Owner can edit them in
 * the Owner Desktop without rebuilding the app.
 */

export interface ShopInfo {
  name: string;
  /** One short tagline under the name, e.g. trade line. Empty string hides it. */
  tagline: string;
  /** Each entry is one printed address line (street, then "PLZ Ort"). */
  address: readonly string[];
  /** USt-IdNr. (German VAT id), e.g. `DE123456789`. */
  vatId: string;
  /** Optional phone; printed as `Tel.: …` when set. */
  phone: string | null;
}

export const SHOP_INFO: ShopInfo = {
  name: 'WAREHOUSE 14',
  tagline: 'Gold · Münzen · Antiquitäten',
  address: ['Schornbacher Weg 66', '73614 Schorndorf'],
  // DUMMY — replace with the real USt-IdNr. before go-live.
  vatId: 'DE123456789',
  // DUMMY — replace with the real shop phone before go-live.
  phone: '+49 7181 0000000',
};
