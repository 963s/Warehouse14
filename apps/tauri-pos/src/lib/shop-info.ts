/**
 * shop-info — the shop identity printed on every customer receipt (Kassenbon)
 * and shown in the on-screen receipt preview.
 *
 * GoBD / KassenSichV require the REAL shop name, full address, and USt-IdNr. on
 * the receipt. The live values come from `GET /api/shop-info` (Owner-editable,
 * system_settings, migration 0044); this bundled constant is the fallback for
 * the header fields that are safe to default (name, tagline, address).
 *
 * The USt-IdNr. and phone are DELIBERATELY empty here (Phase 7.2): a receipt must
 * NEVER print a placeholder VAT id (`DE123456789` on a Kassenbon is a GoBD
 * breach). When the server has no `shop.vat_id` configured, the receipt LOCKS
 * (see `isReceiptShopValid`) rather than printing a fake or blank one — the Owner
 * sets the real value in the Einstellungen / Belegdesigner.
 */

export interface ShopInfo {
  name: string;
  /** One short tagline under the name, e.g. trade line. Empty string hides it. */
  tagline: string;
  /** Each entry is one printed address line (street, then "PLZ Ort"). */
  address: readonly string[];
  /** USt-IdNr. (German VAT id). Empty when not configured — the receipt then locks. */
  vatId: string;
  /** Optional phone; printed as `Tel.: …` when set. */
  phone: string | null;
}

export const SHOP_INFO: ShopInfo = {
  name: 'WAREHOUSE 14',
  tagline: 'Antiquitäten · Briefmarken · Münzen',
  address: ['Schornbacher Weg 66', '73614 Schorndorf'],
  // NO placeholder VAT id / phone — an unconfigured USt-IdNr. must LOCK the
  // receipt, never print a fake one (GoBD). The real values live in the server
  // shop-info settings and flow in via `resolveShopInfo`.
  vatId: '',
  phone: null,
};

/** The `GET /api/shop-info` payload shape (system_settings, migration 0044). */
export interface ShopInfoApi {
  name: string;
  tagline: string;
  addressLine1: string;
  addressLine2: string;
  vatId: string;
  phone: string;
}

/**
 * Merge the API shop identity over the bundled fallback. The VAT id is taken
 * ONLY from the server (never the constant, which is empty) so an unconfigured
 * id resolves to empty and locks the receipt — it can never inject a placeholder.
 */
export function resolveShopInfo(api: ShopInfoApi | undefined): ShopInfo {
  if (!api) return SHOP_INFO;
  return {
    name: api.name || SHOP_INFO.name,
    tagline: api.tagline || SHOP_INFO.tagline,
    address: [api.addressLine1, api.addressLine2].filter((l) => l.length > 0),
    vatId: api.vatId.trim(),
    phone: api.phone.trim().length > 0 ? api.phone.trim() : null,
  };
}

/**
 * True when the shop identity is complete enough to print a GoBD-valid receipt.
 * A missing USt-IdNr. is the hard blocker (§14 UStG / GoBD): without it the
 * receipt is LOCKED rather than printed with a fake or blank VAT id.
 */
export function isReceiptShopValid(shop: ShopInfo): boolean {
  return shop.vatId.trim().length > 0;
}
