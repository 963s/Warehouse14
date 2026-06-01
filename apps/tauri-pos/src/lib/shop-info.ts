/**
 * shop-info — the shop identity printed on every customer receipt (Kassenbon).
 *
 * GoBD / KassenSichV require the REAL shop name, full address, and USt-IdNr.
 * on the receipt. These were previously hardcoded to a BERLIN placeholder
 * inside BezahlenDialog (`Musterstraße 1, 10115 Berlin`, VAT `DE000000000`) —
 * wrong city + invalid VAT id, a go-live blocker. They now live here as the
 * single source of truth.
 *
 * ⚠️ BASEL — before go-live, replace the three `<<…>>` placeholders below with
 * the shop's REAL street, USt-IdNr., and phone. The city is already correct
 * (Schorndorf 73614). The placeholders print VISIBLY (e.g. `<<STRASSE NR.>>`)
 * so a forgotten value fails loud on paper instead of printing a plausible but
 * wrong address.
 *
 * Phase 1.5: move these into `system_settings` so the Owner can edit them in
 * the Owner Desktop without rebuilding the app.
 */

export interface ShopInfo {
  name: string;
  /** Each entry is one printed address line (street, then "PLZ Ort"). */
  address: readonly string[];
  /** USt-IdNr. (German VAT id), e.g. `DE123456789`. */
  vatId: string;
  /** Optional phone; printed as `Tel.: …` when set. */
  phone: string | null;
}

export const SHOP_INFO: ShopInfo = {
  name: 'WAREHOUSE 14',
  address: ['<<STRASSE NR.>>', '73614 Schorndorf'],
  vatId: 'DE<<USt-IdNr.>>',
  phone: null,
};
