/**
 * storefront-data.ts - the single seam between pages and the backend.
 *
 * Structure:
 *   1. Primitive type aliases
 *   2. Domain types (mirror the live backend contract)
 *   3. StorefrontData interface (all functions async)
 *   4. Placeholder implementation (deterministic fixtures)
 *   5. HTTP implementation stub (fetch-based, swap in with NEXT_PUBLIC_DATA_SOURCE=live)
 *   6. Default export `data` - selected by env variable
 *
 * Pages import ONLY from this file. Swapping placeholder -> live never
 * touches call sites because every function is async and shapes are identical.
 *
 * Money/weight/fineness are DECIMAL STRINGS throughout. Use eur() to format.
 * Metal-rate numbers are the one exception (display-only ticker math).
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. Primitive aliases
// ─────────────────────────────────────────────────────────────────────────────

/** Decimal string, e.g. "2387.00" - never a JS number for money. */
export type DecimalString = string;
/** Weight in grams, e.g. "31.1035". */
export type WeightString = string;
/** ISO 8601 timestamp string. */
export type ISO = string;

// ─────────────────────────────────────────────────────────────────────────────
// 2. Domain types
// ─────────────────────────────────────────────────────────────────────────────

export interface ProductImage {
  /** Absolute URL: `${R2_PUBLIC_URL_BASE}/${r2Key}`. In placeholder mode: a CSS gradient sentinel. */
  url: string;
  altDe: string | null;
  isPrimary: boolean;
  order: number;
}

/** Lightweight shape for grid cards and search results. */
export interface ProductSummary {
  id: string;
  slug: string | null;                  // href falls back to /artikel/p-${sku}
  sku: string;
  name: string;
  listPriceEur: DecimalString;
  currency: "EUR";
  metal: string | null;
  weightGrams: WeightString | null;
  finenessDecimal: DecimalString | null;
  yearMintedFrom: number | null;
  yearMintedTo: number | null;
  originCountry: string | null;
  primaryImage: ProductImage | null;
  primaryCategory: { id: string; slug: string; nameDe: string } | null;
}

/** Full detail page shape - extends the grid card. */
export interface ProductDetail extends ProductSummary {
  descriptionDe: string | null;
  descriptionEn: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  schemaOrgType: string | null;         // drives JSON-LD @type
  period: string | null;
  catalogReference: string | null;
  publishedAt: ISO | null;
  images: ProductImage[];               // full gallery
}

/** Hierarchical category node; children depth ≤ 2 in V1. */
export interface CategoryNode {
  id: string;
  slug: string;
  nameDe: string;
  nameEn: string | null;
  descriptionDe: string | null;
  schemaOrgType: string | null;
  children: CategoryNode[];
}

export interface BusinessLocation {
  id: string;
  slug: string;
  name: string;
  addressLines: string[];
  city: string;
  postalCode: string;
  countryCode: string;
  publicPhone: string | null;
  publicEmail: string | null;
  latitude: number | null;
  longitude: number | null;
  openingHours: unknown | null;
  isPickupLocation: boolean;
}

/** Numbers are OK here - display-only ticker math. */
export interface MetalRate {
  metal: "gold" | "silver" | "platinum" | "palladium";
  label: string;                        // "Gold" | "Silber" | "Platin" | "Palladium"
  pricePerGramEur: number;
  changePct: number;
  updatedAt: ISO | null;
}

export interface CartItem {
  id: string;
  productId: string;
  unitPriceEur: DecimalString;
  quantity: number;
  addedAt: ISO;
}

export interface Cart {
  id: string;
  status: "ACTIVE" | "CHECKOUT" | "ABANDONED" | "CONVERTED";
  items: CartItem[];
  totalEur: DecimalString;
  checkoutExpiresAt: ISO | null;
  createdAt: ISO;
}

export interface Address {
  recipientName: string;
  line1: string;
  line2?: string;
  postalCode: string;
  city: string;
  country: string;                      // ISO 3166-1 alpha-2, uppercase
}

export interface CheckoutResult {
  cartId: string;
  paymentIntentId: string;
  provider: "STRIPE";
  providerIntentId: string;
  amountEur: DecimalString;
  clientSecret: string;
  expiresAt: ISO;
}

export interface OrderSummary {
  id: string;
  createdAt: ISO;
  totalEur: DecimalString;
  status: string;
  shippingStatus: string;
  itemCount: number;
}

export interface OrderDetail extends OrderSummary {
  items: { name: string; unitPriceEur: DecimalString; quantity: number }[];
  shippingAddress: Address | null;
}

export interface ShopIdentity {
  name: string;
  tagline: string;
  addressLine1: string;
  addressLine2: string;
  vatId: string;
  phone: string;
  email: string;
}

// ── Appointments (public booking) ────────────────────────────────────────────

/** Mirrors the backend `appointment_type` PG enum (public-bookable subset). */
export type AppointmentType = "VIEWING" | "BUYBACK_EVAL" | "CONSULTATION" | "PICKUP";

export interface AppointmentSlot {
  startsAt: ISO;
  available: boolean;
}

/** GET /api/storefront/appointments/slots?date=YYYY-MM-DD&type=… */
export interface AppointmentSlotsResult {
  date: string; // "YYYY-MM-DD" echo of the request
  slots: AppointmentSlot[];
}

/** POST /api/storefront/appointments/book request body. */
export interface AppointmentBookingRequest {
  type: AppointmentType;
  startsAt: ISO;
  name: string; // 2..120
  phone: string; // 6..32
  email?: string;
  note?: string; // 0..500
}

/** 201 response — deliberately NO PII echo beyond the booked slot. */
export interface AppointmentBookingResult {
  id: string;
  type: AppointmentType;
  startsAt: ISO;
  status: "SCHEDULED";
}

export interface ProductQuery {
  limit?: number;
  offset?: number;
  category?: string;                    // category slug
  metal?: string;
  q?: string;                           // full-text
  minPriceEur?: number;
  maxPriceEur?: number;
  sort?: "published_desc" | "price_asc" | "price_desc" | "year_desc";
}

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. StorefrontData interface
// ─────────────────────────────────────────────────────────────────────────────

export interface StorefrontData {
  // catalog - RSC-friendly, cacheable
  listProducts(q: ProductQuery): Promise<Paged<ProductSummary>>;
  getProductBySlug(slug: string): Promise<ProductDetail | null>;
  listCategories(): Promise<CategoryNode[]>;
  getCategoryBySlug(slug: string): Promise<CategoryNode | null>;
  listLocations(): Promise<BusinessLocation[]>;
  getMetalRates(): Promise<MetalRate[]>;
  getShopIdentity(): Promise<ShopIdentity>;
  listPublishedSlugs(): Promise<{ slug: string; updatedAt: ISO | null }[]>;

  // auth - client, cookie-bearing
  signUp(b: {
    email: string;
    password: string;
    fullName: string;
    phone?: string;
    preferredLanguage?: "de" | "en" | "ar";
    marketingConsent?: boolean;
  }): Promise<{ shopperId: string; customerId: string; emailVerified: false }>;
  signIn(b: {
    email: string;
    password: string;
  }): Promise<{ shopperId: string; emailVerified: boolean; sessionExpiresAt: ISO }>;
  signOut(): Promise<{ ok: true }>;
  getAccount(): Promise<{
    fullName: string;
    emailMasked: string;
    preferredLanguage: string;
    marketingConsent: boolean;
    address: Address | null;
  } | null>;
  updateAccount(
    b: Partial<{
      fullName: string;
      preferredLanguage: "de" | "en" | "ar";
      marketingConsent: boolean;
      address: Address;
    }>,
  ): Promise<void>;

  // cart - client, cookie-bearing
  getCart(): Promise<Cart>;
  addToCart(productId: string): Promise<Cart>;
  removeFromCart(cartItemId: string): Promise<Cart>;
  checkout(b: {
    shippingAddress: Address;
    billingAddress?: Address;
    paymentMethodTypes?: Array<"card" | "sepa_debit" | "klarna" | "ideal" | "giropay">;
  }): Promise<CheckoutResult>;

  // orders - client, cookie-bearing
  listOrders(): Promise<OrderSummary[]>;
  getOrder(id: string): Promise<OrderDetail | null>;

  // leads / forms - public
  submitGoldankaufLead(b: {
    name: string;
    email: string;
    phone?: string;
    itemType?: string;
    weightEstimateGrams?: number;
    description: string;
    photoR2Keys?: string[];
  }): Promise<{ ok: true; leadId: string }>;
  subscribeNewsletter(email: string): Promise<{ ok: true }>;
  submitContact(b: {
    name: string;
    email: string;
    message: string;
  }): Promise<{ ok: true }>;

  // appointments - public booking (server-side rate-limited)
  getAppointmentSlots(date: string, type: AppointmentType): Promise<AppointmentSlotsResult>;
  bookAppointment(b: AppointmentBookingRequest): Promise<AppointmentBookingResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Placeholder implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A gradient-placeholder image. The <ProductImage> component checks url for
 * the "gradient:" sentinel and renders a parchment tile instead of an <img>.
 */
function gradientImage(emoji: string, altDe: string): ProductImage {
  return {
    url: `gradient:${emoji}`,
    altDe,
    isPrimary: true,
    order: 0,
  };
}

// ── Categories ──────────────────────────────────────────────────────────────

const CATEGORIES: CategoryNode[] = [
  {
    id: "cat-gold",
    slug: "gold",
    nameDe: "Gold",
    nameEn: "Gold",
    descriptionDe: "Anlagemünzen und Barren aus purem Gold, LBMA-zertifiziert.",
    schemaOrgType: "ProductCategory",
    children: [
      {
        id: "cat-goldmuenzen",
        slug: "goldmuenzen",
        nameDe: "Goldmünzen",
        nameEn: "Gold Coins",
        descriptionDe: "Klassische Anlagemünzen weltweit geprüft.",
        schemaOrgType: "ProductCategory",
        children: [],
      },
      {
        id: "cat-goldbarren",
        slug: "goldbarren",
        nameDe: "Goldbarren",
        nameEn: "Gold Bars",
        descriptionDe: "Barren von 1 g bis 1 kg, alle LBMA-zertifiziert.",
        schemaOrgType: "ProductCategory",
        children: [],
      },
    ],
  },
  {
    id: "cat-silber",
    slug: "silber",
    nameDe: "Silber",
    nameEn: "Silver",
    descriptionDe: "Silbermünzen und Barren, mehrwertsteuerfrei nach §25a UStG.",
    schemaOrgType: "ProductCategory",
    children: [
      {
        id: "cat-silbermuenzen",
        slug: "silbermuenzen",
        nameDe: "Silbermünzen",
        nameEn: "Silver Coins",
        descriptionDe: "Anlage- und Sammlermünzen in Silber.",
        schemaOrgType: "ProductCategory",
        children: [],
      },
    ],
  },
  {
    id: "cat-muenzen",
    slug: "muenzen",
    nameDe: "Münzen",
    nameEn: "Coins",
    descriptionDe: "Historische und numismatische Münzen aus Deutschland und der Welt.",
    schemaOrgType: "ProductCategory",
    children: [],
  },
  {
    id: "cat-antiquitaeten",
    slug: "antiquitaeten",
    nameDe: "Antiquitäten",
    nameEn: "Antiques",
    descriptionDe: "Geprüfte Einzelstücke mit dokumentierter Provenienz.",
    schemaOrgType: "ProductCategory",
    children: [],
  },
  {
    id: "cat-schmuck",
    slug: "schmuck",
    nameDe: "Schmuck",
    nameEn: "Jewellery",
    descriptionDe: "Gold, Silber und Vintage-Preziosen aus verschiedenen Epochen.",
    schemaOrgType: "ProductCategory",
    children: [],
  },
  {
    id: "cat-briefmarken",
    slug: "briefmarken",
    nameDe: "Briefmarken",
    nameEn: "Stamps",
    descriptionDe: "Deutschland, weltweit und thematische Sammlungen.",
    schemaOrgType: "ProductCategory",
    children: [],
  },
  {
    id: "cat-uhren",
    slug: "uhren",
    nameDe: "Uhren",
    nameEn: "Watches",
    descriptionDe: "Vintage-Taschenuhren und klassische Armbanduhren.",
    schemaOrgType: "ProductCategory",
    children: [],
  },
  {
    id: "cat-sammlerobjekte",
    slug: "sammlerobjekte",
    nameDe: "Sammlerobjekte",
    nameEn: "Collectibles",
    descriptionDe: "Militaria, historische Dokumente und seltene Raritäten.",
    schemaOrgType: "ProductCategory",
    children: [],
  },
  {
    id: "cat-platin",
    slug: "platin",
    nameDe: "Platin",
    nameEn: "Platinum",
    descriptionDe: "Platinmünzen und Barren als Wertanlage.",
    schemaOrgType: "ProductCategory",
    children: [],
  },
];

// ── Products ─────────────────────────────────────────────────────────────────

const PRODUCTS: ProductDetail[] = [
  {
    id: "prod-kruegerrand-2024",
    slug: "kruegerrand-1oz-gold-2024",
    sku: "GC-KR-1OZ-2024",
    name: "Krügerrand 1 oz Gold 2024",
    listPriceEur: "2387.00",
    currency: "EUR",
    metal: "Gold",
    weightGrams: "31.1035",
    finenessDecimal: "0.9999",
    yearMintedFrom: 2024,
    yearMintedTo: 2024,
    originCountry: "ZA",
    primaryImage: gradientImage("🌕", "Krügerrand 1 oz Gold 2024"),
    primaryCategory: { id: "cat-goldmuenzen", slug: "goldmuenzen", nameDe: "Goldmünzen" },
    descriptionDe:
      "Der Krügerrand ist die meistverkaufte Anlagemünze der Welt. Geprägt seit 1967 in Südafrika aus 999,9er Feingold, enthält jede Unze exakt 31,1035 g Feingold. Ideal als Wertanlage und zum physischen Vermögensschutz.",
    descriptionEn:
      "The Krugerrand is the world's best-selling bullion coin. Minted in South Africa since 1967 from .9999 fine gold, each coin contains exactly 31.1035 g of fine gold.",
    seoTitle: "Krügerrand 1 oz Gold 2024 kaufen | warehouse14",
    seoDescription:
      "Krügerrand 1 oz Gold 2024 zum fairen Tagespreis. 999,9er Feingold, LBMA-zertifiziert, versicherter Versand.",
    schemaOrgType: "Product",
    period: null,
    catalogReference: "KR-1OZ",
    publishedAt: "2026-05-01T10:00:00.000Z",
    images: [gradientImage("🌕", "Krügerrand Vorderseite"), { url: "gradient:🦁", altDe: "Krügerrand Rückseite", isPrimary: false, order: 1 }],
  },
  {
    id: "prod-philharmoniker-2024",
    slug: "wiener-philharmoniker-1oz-gold-2024",
    sku: "GC-WP-1OZ-2024",
    name: "Wiener Philharmoniker 1 oz Gold 2024",
    listPriceEur: "2402.50",
    currency: "EUR",
    metal: "Gold",
    weightGrams: "31.1035",
    finenessDecimal: "0.9999",
    yearMintedFrom: 2024,
    yearMintedTo: 2024,
    originCountry: "AT",
    primaryImage: gradientImage("🎼", "Wiener Philharmoniker 1 oz Gold"),
    primaryCategory: { id: "cat-goldmuenzen", slug: "goldmuenzen", nameDe: "Goldmünzen" },
    descriptionDe:
      "Die Wiener Philharmoniker zählen zu den beliebtesten Anlagemünzen Europas. Geprägt von der Österreichischen Münze in 999,9er Feingold, zeigt die Münze die weltberühmten Instrumente des Wiener Philharmonikerorchesters.",
    descriptionEn: null,
    seoTitle: "Wiener Philharmoniker 1 oz Gold 2024 | warehouse14",
    seoDescription:
      "Wiener Philharmoniker 1 oz Gold 2024 zum Tagespreis. 999,9er Feingold, Österreichische Münze Wien.",
    schemaOrgType: "Product",
    period: null,
    catalogReference: "WP-1OZ",
    publishedAt: "2026-05-02T10:00:00.000Z",
    images: [gradientImage("🎼", "Wiener Philharmoniker Vorderseite")],
  },
  {
    id: "prod-goldbarren-100g",
    slug: "goldbarren-100g-lbma",
    sku: "GB-100G-CH",
    name: "Goldbarren 100 g",
    listPriceEur: "7640.00",
    currency: "EUR",
    metal: "Gold",
    weightGrams: "100.00",
    finenessDecimal: "0.9999",
    yearMintedFrom: null,
    yearMintedTo: null,
    originCountry: "DE",
    primaryImage: gradientImage("🟨", "Goldbarren 100 g C. Hafner"),
    primaryCategory: { id: "cat-goldbarren", slug: "goldbarren", nameDe: "Goldbarren" },
    descriptionDe:
      "Gegossener Goldbarren 100 g in 999,9er Feingold, geprägt von C. Hafner (Pforzheim). LBMA-zertifiziert, mit Seriennummer und Echtheitszertifikat. Ideal zur Wertanlage in kleinen Schritten.",
    descriptionEn: null,
    seoTitle: "Goldbarren 100 g kaufen | LBMA-zertifiziert | warehouse14",
    seoDescription:
      "Goldbarren 100 g (999,9er Feingold), LBMA-zertifiziert, C. Hafner. Mit Echtheitszertifikat.",
    schemaOrgType: "Product",
    period: null,
    catalogReference: "HAFNER-100G",
    publishedAt: "2026-05-03T09:00:00.000Z",
    images: [gradientImage("🟨", "Goldbarren 100 g Vorderseite"), { url: "gradient:📜", altDe: "Echtheitszertifikat", isPrimary: false, order: 1 }],
  },
  {
    id: "prod-5mark-1876",
    slug: "5-mark-silber-1876-deutsches-reich",
    sku: "HC-5M-1876-A",
    name: "5 Mark Silber 1876-A",
    listPriceEur: "189.00",
    currency: "EUR",
    metal: "Silber",
    weightGrams: "27.7770",
    finenessDecimal: "0.9000",
    yearMintedFrom: 1876,
    yearMintedTo: 1876,
    originCountry: "DE",
    primaryImage: gradientImage("👑", "5 Mark Silber 1876 Deutsches Reich"),
    primaryCategory: { id: "cat-muenzen", slug: "muenzen", nameDe: "Münzen" },
    descriptionDe:
      "5 Mark des Deutschen Reiches, Jahrgang 1876, Prägestätte Berlin (Münzzeichen A). Erhaltung sehr schön. Silbergehalt 90 %, 27,777 g Feingewicht. Numismatisch bedeutsames Stück aus der Gründerzeit.",
    descriptionEn: null,
    seoTitle: "5 Mark Silber 1876 Deutsches Reich kaufen | warehouse14",
    seoDescription:
      "Seltene 5 Mark Silbermünze von 1876. Deutsches Reich, Prägestätte Berlin. Numismatische Rarität.",
    schemaOrgType: "CollectibleProduct",
    period: "Deutsches Kaiserreich (1871-1918)",
    catalogReference: "Jäger 97",
    publishedAt: "2026-05-04T08:00:00.000Z",
    images: [gradientImage("👑", "5 Mark 1876 Vorderseite"), { url: "gradient:⚜️", altDe: "5 Mark 1876 Rückseite", isPrimary: false, order: 1 }],
  },
  {
    id: "prod-maple-leaf-2024",
    slug: "maple-leaf-1oz-gold-2024",
    sku: "GC-ML-1OZ-2024",
    name: "Maple Leaf 1 oz Gold 2024",
    listPriceEur: "2395.00",
    currency: "EUR",
    metal: "Gold",
    weightGrams: "31.1035",
    finenessDecimal: "0.99999",
    yearMintedFrom: 2024,
    yearMintedTo: 2024,
    originCountry: "CA",
    primaryImage: gradientImage("🍁", "Maple Leaf 1 oz Gold 2024"),
    primaryCategory: { id: "cat-goldmuenzen", slug: "goldmuenzen", nameDe: "Goldmünzen" },
    descriptionDe:
      "Der kanadische Maple Leaf gilt als eine der reinsten Anlagemünzen der Welt, geprägt in 99,999er Feingold (Five Nines). Das einzigartige Sicherheitsmerkmal des mikrogefrästen Ahornblattes schützt vor Fälschungen.",
    descriptionEn: null,
    seoTitle: "Maple Leaf 1 oz Gold 2024 kaufen | warehouse14",
    seoDescription:
      "Maple Leaf 1 oz Gold 2024. 99,999er Feingold, Royal Canadian Mint. Hologramm-Sicherheitsmerkmal.",
    schemaOrgType: "Product",
    period: null,
    catalogReference: "ML-1OZ",
    publishedAt: "2026-05-05T10:00:00.000Z",
    images: [gradientImage("🍁", "Maple Leaf Vorderseite")],
  },
  {
    id: "prod-deco-armband",
    slug: "art-deco-armband-gold-585-1925",
    sku: "SCH-ARM-585-1925",
    name: "Art-Déco Armband Gold 585",
    listPriceEur: "1450.00",
    currency: "EUR",
    metal: "Gold",
    weightGrams: "18.40",
    finenessDecimal: "0.5850",
    yearMintedFrom: 1920,
    yearMintedTo: 1930,
    originCountry: "DE",
    primaryImage: gradientImage("💛", "Art-Déco Armband Gold 585"),
    primaryCategory: { id: "cat-schmuck", slug: "schmuck", nameDe: "Schmuck" },
    descriptionDe:
      "Elegantes Art-Déco Armband aus 585er Gelbgold, gefertigt um 1925. Filigrane geometrische Glieder, typisch für die dekorative Formensprache der 1920er Jahre. Unikat, geprüft und bewertet. Mit Punzen.",
    descriptionEn: null,
    seoTitle: "Art-Déco Armband Gold 585, um 1925 | warehouse14",
    seoDescription:
      "Seltenes Art-Déco Armband aus 585er Gelbgold, um 1925. Unikat mit Provenienz.",
    schemaOrgType: "CollectibleProduct",
    period: "Art Déco (ca. 1920-1935)",
    catalogReference: null,
    publishedAt: "2026-05-06T11:00:00.000Z",
    images: [gradientImage("💛", "Art-Déco Armband Gesamtansicht"), { url: "gradient:🔍", altDe: "Punzen-Detail", isPrimary: false, order: 1 }],
  },
  {
    id: "prod-silber-maple-2024",
    slug: "maple-leaf-1oz-silber-2024",
    sku: "SC-ML-1OZ-2024",
    name: "Maple Leaf 1 oz Silber 2024",
    listPriceEur: "32.50",
    currency: "EUR",
    metal: "Silber",
    weightGrams: "31.1035",
    finenessDecimal: "0.9999",
    yearMintedFrom: 2024,
    yearMintedTo: 2024,
    originCountry: "CA",
    primaryImage: gradientImage("🍂", "Maple Leaf 1 oz Silber 2024"),
    primaryCategory: { id: "cat-silbermuenzen", slug: "silbermuenzen", nameDe: "Silbermünzen" },
    descriptionDe:
      "Der Silber Maple Leaf ist eine der bekanntesten Silbermünzen weltweit. 999,9er Feinsilber, 1 oz Gewicht, geprägt von der Royal Canadian Mint. Differenzbesteuerung nach §25a UStG.",
    descriptionEn: null,
    seoTitle: "Maple Leaf 1 oz Silber 2024 kaufen | warehouse14",
    seoDescription:
      "Silber Maple Leaf 1 oz 2024. 999,9er Feinsilber, differenzbesteuert §25a UStG.",
    schemaOrgType: "Product",
    period: null,
    catalogReference: "SC-ML-1OZ",
    publishedAt: "2026-05-07T10:00:00.000Z",
    images: [gradientImage("🍂", "Silber Maple Leaf Vorderseite")],
  },
  {
    id: "prod-taschenuhr-1890",
    slug: "antike-taschenuhr-gold-1890",
    sku: "UHR-TU-585-1890",
    name: "Antike Taschenuhr Gold 585, 1890",
    listPriceEur: "680.00",
    currency: "EUR",
    metal: "Gold",
    weightGrams: "62.50",
    finenessDecimal: "0.5850",
    yearMintedFrom: 1885,
    yearMintedTo: 1895,
    originCountry: "CH",
    primaryImage: gradientImage("⌚", "Antike Taschenuhr Gold 585"),
    primaryCategory: { id: "cat-uhren", slug: "uhren", nameDe: "Uhren" },
    descriptionDe:
      "Seltene Savonnette-Taschenuhr aus 585er Gelbgold, Schweizer Werk, um 1890. Guillochiertes Zifferblatt mit Emailindizes, Ankerhemmung, 17 Rubine. Läuft und schlägt. Vollständig geprüft.",
    descriptionEn: null,
    seoTitle: "Antike Taschenuhr Gold 585, Schweiz 1890 | warehouse14",
    seoDescription:
      "Rare Savonnette-Taschenuhr aus 585er Gelbgold, Schweizer Werk, um 1890. Vollständig geprüft.",
    schemaOrgType: "CollectibleProduct",
    period: "Historismus (ca. 1880-1900)",
    catalogReference: null,
    publishedAt: "2026-05-08T09:00:00.000Z",
    images: [gradientImage("⌚", "Taschenuhr Zifferblatt"), { url: "gradient:⚙️", altDe: "Werk-Detail", isPrimary: false, order: 1 }],
  },
  {
    id: "prod-platin-koala-2023",
    slug: "platin-koala-1oz-2023",
    sku: "PC-KOA-1OZ-2023",
    name: "Platin Koala 1 oz 2023",
    listPriceEur: "960.00",
    currency: "EUR",
    metal: "Platin",
    weightGrams: "31.1035",
    finenessDecimal: "0.9995",
    yearMintedFrom: 2023,
    yearMintedTo: 2023,
    originCountry: "AU",
    primaryImage: gradientImage("🐨", "Platin Koala 1 oz 2023"),
    primaryCategory: { id: "cat-platin", slug: "platin", nameDe: "Platin" },
    descriptionDe:
      "Der australische Platin Koala wird jährlich mit wechselndem Motiv von der Perth Mint ausgegeben. 999,5er Feingold, 1 oz. Geringe Mintage, ideal für Sammler und Anleger.",
    descriptionEn: null,
    seoTitle: "Platin Koala 1 oz 2023 kaufen | warehouse14",
    seoDescription:
      "Platin Koala 1 oz 2023 von der Perth Mint. 999,5er Platin, geringe Mintage.",
    schemaOrgType: "Product",
    period: null,
    catalogReference: "PK-1OZ-2023",
    publishedAt: "2026-05-09T10:00:00.000Z",
    images: [gradientImage("🐨", "Platin Koala Vorderseite")],
  },
  {
    id: "prod-goldbarren-1g",
    slug: "goldbarren-1g-lbma",
    sku: "GB-001G-CH",
    name: "Goldbarren 1 g",
    listPriceEur: "82.00",
    currency: "EUR",
    metal: "Gold",
    weightGrams: "1.00",
    finenessDecimal: "0.9999",
    yearMintedFrom: null,
    yearMintedTo: null,
    originCountry: "DE",
    primaryImage: gradientImage("✨", "Goldbarren 1 g"),
    primaryCategory: { id: "cat-goldbarren", slug: "goldbarren", nameDe: "Goldbarren" },
    descriptionDe:
      "Miniaturbarren aus 999,9er Feingold, 1 g Gewicht. LBMA-zertifiziert, geprägt von C. Hafner, mit Seriennummer. Perfekter Einstieg in die Goldanlage oder als Geschenk.",
    descriptionEn: null,
    seoTitle: "Goldbarren 1 g kaufen | LBMA-zertifiziert | warehouse14",
    seoDescription:
      "Goldbarren 1 g, 999,9er Feingold, LBMA-zertifiziert. Ideal als Geschenk oder Einstieg in die Goldanlage.",
    schemaOrgType: "Product",
    period: null,
    catalogReference: "HAFNER-1G",
    publishedAt: "2026-05-10T09:00:00.000Z",
    images: [gradientImage("✨", "Goldbarren 1 g Vorderseite")],
  },
  {
    id: "prod-briefmarke-dr",
    slug: "briefmarken-konvolut-deutsches-reich",
    sku: "BM-DR-KON-001",
    name: "Briefmarken Konvolut Deutsches Reich",
    listPriceEur: "240.00",
    currency: "EUR",
    metal: null,
    weightGrams: null,
    finenessDecimal: null,
    yearMintedFrom: 1872,
    yearMintedTo: 1945,
    originCountry: "DE",
    primaryImage: gradientImage("📮", "Briefmarken Konvolut Deutsches Reich"),
    primaryCategory: { id: "cat-briefmarken", slug: "briefmarken", nameDe: "Briefmarken" },
    descriptionDe:
      "Umfangreiches Konvolut aus ca. 150 Briefmarken des Deutschen Reichs, 1872-1945. Enthält Freimarken, Sonderausgaben und Infla-Zeit. Alle auf Echtheit geprüft, mit Michel-Nummern.",
    descriptionEn: null,
    seoTitle: "Briefmarken Konvolut Deutsches Reich | warehouse14",
    seoDescription:
      "Ca. 150 geprüfte Briefmarken Deutsches Reich, 1872-1945. Mit Michel-Nummern.",
    schemaOrgType: "CollectibleProduct",
    period: "Deutsches Reich (1872-1945)",
    catalogReference: "Michel DE",
    publishedAt: "2026-05-11T08:00:00.000Z",
    images: [gradientImage("📮", "Briefmarken Konvolut Gesamtansicht")],
  },
  {
    id: "prod-silberbarren-500g",
    slug: "silberbarren-500g",
    sku: "SB-500G-PB",
    name: "Silberbarren 500 g",
    listPriceEur: "478.00",
    currency: "EUR",
    metal: "Silber",
    weightGrams: "500.00",
    finenessDecimal: "0.9990",
    yearMintedFrom: null,
    yearMintedTo: null,
    originCountry: "DE",
    primaryImage: gradientImage("🪙", "Silberbarren 500 g"),
    primaryCategory: { id: "cat-silber", slug: "silber", nameDe: "Silber" },
    descriptionDe:
      "Gegossener Silberbarren 500 g in 999er Feinsilber von Umicore. LBMA-zertifiziert, mit Prägung. Differenzbesteuerung nach §25a UStG. Ideal für die mittelgroße Silberanlage.",
    descriptionEn: null,
    seoTitle: "Silberbarren 500 g kaufen | warehouse14",
    seoDescription:
      "Silberbarren 500 g, 999er Feinsilber, Umicore, LBMA-zertifiziert. Differenzbesteuerung §25a.",
    schemaOrgType: "Product",
    period: null,
    catalogReference: "UMICORE-500G",
    publishedAt: "2026-05-12T10:00:00.000Z",
    images: [gradientImage("🪙", "Silberbarren 500 g Vorderseite")],
  },
];

// ── Additional catalogue (antiques, jewellery, watches, rare coins) ──────────
// Built compactly; the real photos are wired in via REAL_PHOTO_SLUGS below.
function mkProduct(p: {
  slug: string; sku: string; name: string; price: string; metal: string | null;
  weightGrams?: string | null; fineness?: string | null; year?: number | null;
  catSlug: string; catName: string; period?: string | null; desc: string;
}): ProductDetail {
  return {
    id: p.slug, slug: p.slug, sku: p.sku, name: p.name, listPriceEur: p.price, currency: "EUR",
    metal: p.metal, weightGrams: p.weightGrams ?? null, finenessDecimal: p.fineness ?? null,
    yearMintedFrom: p.year ?? null, yearMintedTo: null, originCountry: "DE",
    primaryImage: gradientImage("🔎", p.name),
    primaryCategory: { id: `cat-${p.catSlug}`, slug: p.catSlug, nameDe: p.catName },
    descriptionDe: p.desc, descriptionEn: null,
    seoTitle: `${p.name} kaufen | warehouse14`, seoDescription: p.desc.slice(0, 155),
    schemaOrgType: "Product", period: p.period ?? null, catalogReference: p.sku,
    publishedAt: "2026-05-22T09:00:00.000Z", images: [gradientImage("🔎", p.name)],
  };
}

PRODUCTS.push(
  mkProduct({ slug: "silberthaler-maria-theresia", sku: "MT-1780-NB", name: "Maria-Theresien-Taler 1780", price: "52.00", metal: "Silber 833", weightGrams: "28.0668", fineness: "0.8330", year: 1780, catSlug: "silbermuenzen", catName: "Silbermünzen", period: "Nachprägung", desc: "Der berühmte Maria-Theresien-Taler, bis heute geprägte Handelsmünze aus 833er Silber, 28,07 g. Geprüft und in sammelwürdiger Erhaltung." }),
  mkProduct({ slug: "golddukaten-habsburg", sku: "DUK-986", name: "Golddukaten Habsburg", price: "238.00", metal: "Gold 986", weightGrams: "3.4900", fineness: "0.9860", catSlug: "goldmuenzen", catName: "Goldmünzen", period: "Anlageprägung", desc: "Klassischer Dukaten aus 986er Feingold, 3,49 g. Historische Anlagemünze der k. u. k. Münzprägung, einzeln geprüft." }),
  mkProduct({ slug: "damenring-gold-saphir", sku: "RG-750-SAP", name: "Damenring Gold 750 mit Saphir", price: "940.00", metal: "Gold 750", weightGrams: "4.20", fineness: "0.7500", catSlug: "schmuck", catName: "Schmuck", period: "Unikat", desc: "Handgefertigter Damenring aus 750er Gelbgold mit einem fein gefassten blauen Saphir. Ein Einzelstück, gutachterlich geprüft." }),
  mkProduct({ slug: "brillantring-weissgold", sku: "RG-585-BRI", name: "Brillantring Weißgold 585", price: "1680.00", metal: "Weißgold 585", weightGrams: "3.80", fineness: "0.5850", catSlug: "schmuck", catName: "Schmuck", period: "Unikat", desc: "Eleganter Brillantring aus 585er Weißgold mit funkelndem Besatz. Unikat mit Expertise, gereinigt und geprüft." }),
  mkProduct({ slug: "goldbrosche-jugendstil", sku: "BR-585-JST", name: "Goldbrosche Jugendstil", price: "560.00", metal: "Gold 585", catSlug: "schmuck", catName: "Schmuck", period: "um 1905", desc: "Florale Goldbrosche im Jugendstil, um 1905, aus 585er Gold. Originalarbeit der Epoche, ein dekoratives Sammlerstück mit Provenienz." }),
  mkProduct({ slug: "herren-taschenuhr-silber-1900", sku: "TU-800-1900", name: "Herren-Taschenuhr Silber, um 1900", price: "385.00", metal: "Silber 800", catSlug: "uhren", catName: "Uhren", period: "um 1900", desc: "Mechanische Sprungdeckel-Taschenuhr aus 800er Silber, um 1900. Voll funktionsfähiges Ankerwerk, gangbar und gereinigt." }),
  mkProduct({ slug: "armbanduhr-vintage-automatik", sku: "AU-VINT-AUTO", name: "Vintage Armbanduhr, Automatik", price: "1490.00", metal: "Edelstahl", catSlug: "uhren", catName: "Uhren", period: "1960er", desc: "Klassische Herren-Armbanduhr mit Automatikwerk aus den 1960er Jahren. Revidiert, gangbar und mit Originalzifferblatt." }),
  mkProduct({ slug: "kaminuhr-bronze-1880", sku: "KU-BRZ-1880", name: "Kaminuhr Bronze, um 1880", price: "980.00", metal: "Bronze, vergoldet", catSlug: "antiquitaeten", catName: "Antiquitäten", period: "um 1880", desc: "Repräsentative Kaminuhr aus vergoldeter Bronze, um 1880. Aufwendig ziseliertes Gehäuse, Pendulenwerk geprüft, ein Schmuckstück fürs Interieur." }),
  mkProduct({ slug: "porzellanvase-antik", sku: "PV-19JH", name: "Antike Porzellanvase, 19. Jh.", price: "720.00", metal: "Porzellan", catSlug: "antiquitaeten", catName: "Antiquitäten", period: "19. Jahrhundert", desc: "Handbemalte Porzellanvase des 19. Jahrhunderts. Feine Malerei, unbeschädigt, ein elegantes Einzelstück mit Geschichte." }),
  mkProduct({ slug: "tabatiere-silber", sku: "TAB-800", name: "Silberne Tabatiere", price: "420.00", metal: "Silber 800", catSlug: "antiquitaeten", catName: "Antiquitäten", period: "19. Jh.", desc: "Fein gravierte Tabatiere (Schnupftabakdose) aus 800er Silber, 19. Jahrhundert. Punziert, in gepflegtem Sammlerzustand." }),
);

// Real product photographs (Wikimedia Commons, freely licensed) replace the
// placeholder gradient tiles wherever a downloaded photo exists. The data is
// otherwise unchanged, the gallery simply leads with the real image.
const REAL_PHOTO_SLUGS = new Set<string>([
  "kruegerrand-1oz-gold-2024",
  "wiener-philharmoniker-1oz-gold-2024",
  "goldbarren-100g-lbma",
  "5-mark-silber-1876-deutsches-reich",
  "art-deco-armband-gold-585-1925",
  "maple-leaf-1oz-silber-2024",
  "antike-taschenuhr-gold-1890",
  "platin-koala-1oz-2023",
  "briefmarken-konvolut-deutsches-reich",
  "silberbarren-500g",
  "silberthaler-maria-theresia",
  "golddukaten-habsburg",
  "damenring-gold-saphir",
  "brillantring-weissgold",
  "goldbrosche-jugendstil",
  "herren-taschenuhr-silber-1900",
  "armbanduhr-vintage-automatik",
  "kaminuhr-bronze-1880",
  "porzellanvase-antik",
  "tabatiere-silber",
]);
for (const p of PRODUCTS) {
  if (p.slug && REAL_PHOTO_SLUGS.has(p.slug)) {
    const photo: ProductImage = { url: `/img/products/${p.slug}.jpg`, altDe: p.name, isPrimary: true, order: 0 };
    p.primaryImage = photo;
    p.images = [photo];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toSummary(p: ProductDetail): ProductSummary {
  const { descriptionDe, descriptionEn, seoTitle, seoDescription, schemaOrgType,
          period, catalogReference, publishedAt, images, ...summary } = p;
  return summary;
}

function filterProducts(items: ProductDetail[], q: ProductQuery): ProductDetail[] {
  let result = [...items];

  if (q.category) {
    result = result.filter(
      (p) =>
        p.primaryCategory?.slug === q.category ||
        // also match parent slug for flat lookups
        CATEGORIES.find((c) => c.slug === q.category)?.children
          .some((ch) => ch.slug === p.primaryCategory?.slug),
    );
  }

  if (q.metal) {
    const m = q.metal.toLowerCase();
    result = result.filter((p) => p.metal?.toLowerCase().includes(m));
  }

  if (q.q) {
    const needle = q.q.toLowerCase();
    result = result.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.sku.toLowerCase().includes(needle) ||
        p.descriptionDe?.toLowerCase().includes(needle) ||
        p.primaryCategory?.nameDe.toLowerCase().includes(needle),
    );
  }

  if (q.minPriceEur != null) {
    result = result.filter((p) => parseFloat(p.listPriceEur) >= q.minPriceEur!);
  }

  if (q.maxPriceEur != null) {
    result = result.filter((p) => parseFloat(p.listPriceEur) <= q.maxPriceEur!);
  }

  switch (q.sort) {
    case "price_asc":
      result.sort((a, b) => parseFloat(a.listPriceEur) - parseFloat(b.listPriceEur));
      break;
    case "price_desc":
      result.sort((a, b) => parseFloat(b.listPriceEur) - parseFloat(a.listPriceEur));
      break;
    case "year_desc":
      result.sort((a, b) => (b.yearMintedFrom ?? 0) - (a.yearMintedFrom ?? 0));
      break;
    case "published_desc":
    default:
      result.sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
      break;
  }

  return result;
}

// ── In-memory placeholder cart ────────────────────────────────────────────────

let _cart: Cart = {
  id: "cart-placeholder-000",
  status: "ACTIVE",
  items: [],
  totalEur: "0.00",
  checkoutExpiresAt: null,
  createdAt: new Date().toISOString(),
};

function recalcCart(cart: Cart): Cart {
  const total = cart.items.reduce(
    (sum, item) => sum + parseFloat(item.unitPriceEur) * item.quantity,
    0,
  );
  return { ...cart, totalEur: total.toFixed(2) };
}

// ── Placeholder appointment slots (deterministic) ────────────────────────────

/**
 * Mirror of the backend default in system_settings 'appointments.business_hours':
 * {"mo-fr":["10:00","18:00"],"sa":["10:00","14:00"],"so":null} — 30-min slots.
 */
function placeholderBusinessHours(date: string): [string, string] | null {
  const day = new Date(`${date}T12:00:00`).getDay(); // 0 = Sunday
  if (day === 0) return null;
  if (day === 6) return ["10:00", "14:00"];
  return ["10:00", "18:00"];
}

/** Tiny deterministic hash so placeholder availability is stable per slot. */
function slotSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 9973;
  return h;
}

function placeholderSlots(date: string, type: AppointmentType): AppointmentSlot[] {
  const hours = placeholderBusinessHours(date);
  if (!hours) return [];
  const [oH, oM] = hours[0].split(":").map(Number);
  const [cH, cM] = hours[1].split(":").map(Number);
  const dayStart = new Date(`${date}T00:00:00`);
  const slots: AppointmentSlot[] = [];
  for (let m = oH * 60 + oM; m + 30 <= cH * 60 + cM; m += 30) {
    const d = new Date(dayStart);
    d.setMinutes(m);
    slots.push({
      startsAt: d.toISOString(),
      // ~1 in 4 slots reads "vergeben" so the unavailable state is exercised.
      available: slotSeed(`${date}|${type}|${m}`) % 4 !== 0,
    });
  }
  return slots;
}

// ── Placeholder implementation ────────────────────────────────────────────────

export const placeholderData: StorefrontData = {
  // ── catalog ──────────────────────────────────────────────────────────────

  async listProducts(q) {
    const limit = q.limit ?? 24;
    const offset = q.offset ?? 0;
    const filtered = filterProducts(PRODUCTS, q);
    return Promise.resolve({
      items: filtered.slice(offset, offset + limit).map(toSummary),
      total: filtered.length,
      limit,
      offset,
    });
  },

  async getProductBySlug(slug) {
    const p = PRODUCTS.find((x) => x.slug === slug || `p-${x.sku}` === slug);
    return Promise.resolve(p ?? null);
  },

  async listCategories() {
    return Promise.resolve(CATEGORIES);
  },

  async getCategoryBySlug(slug) {
    function findNode(nodes: CategoryNode[]): CategoryNode | null {
      for (const n of nodes) {
        if (n.slug === slug) return n;
        const found = findNode(n.children);
        if (found) return found;
      }
      return null;
    }
    return Promise.resolve(findNode(CATEGORIES));
  },

  async listLocations() {
    return Promise.resolve([
      {
        id: "loc-schorndorf",
        slug: "schorndorf",
        name: "warehouse14 Schorndorf",
        addressLines: ["Musterstraße 14", "73614 Schorndorf"],
        city: "Schorndorf",
        postalCode: "73614",
        countryCode: "DE",
        publicPhone: "+49 (0)7181 000000",
        publicEmail: "info@warehouse14.de",
        latitude: 48.8054,
        longitude: 9.5267,
        openingHours: {
          mo: "10:00-18:00",
          tu: "10:00-18:00",
          we: "10:00-18:00",
          th: "10:00-18:00",
          fr: "10:00-18:00",
          sa: "10:00-14:00",
        },
        isPickupLocation: true,
      },
    ]);
  },

  async getMetalRates() {
    return Promise.resolve([
      { metal: "gold",      label: "Gold",      pricePerGramEur: 76.42,  changePct:  0.84, updatedAt: new Date().toISOString() },
      { metal: "silver",    label: "Silber",    pricePerGramEur:  0.92,  changePct:  1.21, updatedAt: new Date().toISOString() },
      { metal: "platinum",  label: "Platin",    pricePerGramEur: 31.78,  changePct: -0.36, updatedAt: new Date().toISOString() },
      { metal: "palladium", label: "Palladium", pricePerGramEur: 28.14,  changePct:  0.42, updatedAt: new Date().toISOString() },
    ]);
  },

  async getShopIdentity() {
    return Promise.resolve({
      name: "warehouse14",
      tagline: "Das Kontor für Gold, seltene Münzen und geprüfte Antiquitäten.",
      addressLine1: "Musterstraße 14",
      addressLine2: "73614 Schorndorf",
      vatId: "USt-IdNr folgt",
      phone: "+49 (0)7181 000000",
      email: "info@warehouse14.de",
    });
  },

  async listPublishedSlugs() {
    return Promise.resolve(
      PRODUCTS.filter((p) => p.slug != null).map((p) => ({
        slug: p.slug as string,
        updatedAt: p.publishedAt,
      })),
    );
  },

  // ── auth (placeholder - always succeeds with fixed IDs) ──────────────────

  async signUp(_b) {
    return Promise.resolve({
      shopperId: "shopper-placeholder-001",
      customerId: "customer-placeholder-001",
      emailVerified: false as const,
    });
  },

  async signIn(_b) {
    return Promise.resolve({
      shopperId: "shopper-placeholder-001",
      emailVerified: true,
      sessionExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
  },

  async signOut() {
    return Promise.resolve({ ok: true as const });
  },

  async getAccount() {
    return Promise.resolve(null);
  },

  async updateAccount(_b) {
    return Promise.resolve();
  },

  // ── cart (placeholder - in-memory) ───────────────────────────────────────

  async getCart() {
    return Promise.resolve({ ..._cart });
  },

  async addToCart(productId) {
    const product = PRODUCTS.find((p) => p.id === productId);
    if (!product) throw new Error(`Produkt nicht gefunden: ${productId}`);
    const existing = _cart.items.find((i) => i.productId === productId);
    if (existing) {
      _cart = {
        ..._cart,
        items: _cart.items.map((i) =>
          i.productId === productId ? { ...i, quantity: i.quantity + 1 } : i,
        ),
      };
    } else {
      _cart = {
        ..._cart,
        items: [
          ..._cart.items,
          {
            id: `ci-${productId}-${Date.now()}`,
            productId,
            unitPriceEur: product.listPriceEur,
            quantity: 1,
            addedAt: new Date().toISOString(),
          },
        ],
      };
    }
    _cart = recalcCart(_cart);
    return Promise.resolve({ ..._cart });
  },

  async removeFromCart(cartItemId) {
    _cart = recalcCart({
      ..._cart,
      items: _cart.items.filter((i) => i.id !== cartItemId),
    });
    return Promise.resolve({ ..._cart });
  },

  async checkout(_b) {
    const now = new Date();
    const expires = new Date(now.getTime() + 15 * 60 * 1000);
    return Promise.resolve({
      cartId: _cart.id,
      paymentIntentId: "pi-placeholder-001",
      provider: "STRIPE" as const,
      providerIntentId: "pi_3placeholder",
      amountEur: _cart.totalEur,
      clientSecret: "placeholder_secret_for_dev",
      expiresAt: expires.toISOString(),
    });
  },

  // ── orders (placeholder - empty list) ────────────────────────────────────

  async listOrders() {
    return Promise.resolve([]);
  },

  async getOrder(_id) {
    return Promise.resolve(null);
  },

  // ── leads / forms ─────────────────────────────────────────────────────────

  async submitGoldankaufLead(_b) {
    return Promise.resolve({ ok: true as const, leadId: `lead-${Date.now()}` });
  },

  async subscribeNewsletter(_email) {
    return Promise.resolve({ ok: true as const });
  },

  async submitContact(_b) {
    return Promise.resolve({ ok: true as const });
  },

  // ── appointments (placeholder - deterministic fake slots) ─────────────────

  async getAppointmentSlots(date, type) {
    return Promise.resolve({ date, slots: placeholderSlots(date, type) });
  },

  async bookAppointment(b) {
    return Promise.resolve({
      id: `apt-placeholder-${slotSeed(`${b.type}|${b.startsAt}`)}`,
      type: b.type,
      startsAt: b.startsAt,
      status: "SCHEDULED" as const,
    });
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 5. HTTP implementation stub
// ─────────────────────────────────────────────────────────────────────────────

export class StorefrontError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`Storefront API error ${status}`);
  }
}

/**
 * The api origin for SERVER-side data fetches (RSC + route handlers). In the
 * private internal deployment, INTERNAL_API_URL (e.g. http://api:3001 on the
 * Docker network) is preferred so catalog data never leaves the box; locally it
 * falls back to NEXT_PUBLIC_API_URL (http://localhost:3001). The hard-coded prod
 * URL is only a last-resort default, never used when either env is set.
 */
function serverApiBase(): string {
  // BROWSER: same-origin by default ("" → the storefront's own /api/* proxy
  // routes, e.g. the appointments booking proxy) unless NEXT_PUBLIC_API_URL was
  // baked at build time (local dev against :3001). The private internal deploy
  // bakes no public api URL, so client calls stay on the storefront origin and
  // never need CORS.
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_API_URL ?? "";
  }
  // SERVER (RSC + route handlers): prefer the internal Docker-network URL.
  return (
    process.env.INTERNAL_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "https://api.warehouse14.de"
  );
}

async function apiGet<T>(
  path: string,
  opts?: { revalidate?: number; noStore?: boolean },
): Promise<T | null> {
  const base = serverApiBase();
  const nextOpts: RequestInit["next"] = opts?.noStore
    ? undefined
    : opts?.revalidate != null
      ? { revalidate: opts.revalidate }
      : undefined;

  const res = await fetch(`${base}${path}`, {
    credentials: "include",
    cache: opts?.noStore ? "no-store" : undefined,
    next: nextOpts,
  });

  // 404 → "no such resource" is a normal, expected signal (e.g. unknown slug,
  // or an endpoint that does not exist in this backend version). The caller
  // decides the fallback. 401/403 mean the resource requires a session the
  // current (often anonymous, SSR) request does not carry — for a *read* that
  // is also "unavailable to me right now", not a hard failure, so we degrade
  // to null and let the caller fall back rather than 500 the whole page.
  if (res.status === 404 || res.status === 401 || res.status === 403) return null;
  if (!res.ok) {
    throw new StorefrontError(res.status, await res.json().catch(() => ({})));
  }
  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Live-contract adapters
//
// The backend's public product projection (`toStorefrontProduct`) now surfaces
// an `imageUrls` array (primary-first) of API-relative photo paths, shaped
// `/api/photos/<photoId>/{raw,thumb}` — the same public-by-UUID photo route the
// POS catalog already consumes (see products-list.ts `primaryPhotoThumbUrl`).
// The Next.js components expect `primaryImage` + `images` to always be present
// (`PhotoGallery` does `[...images]`, which throws on `undefined`). These
// adapters normalise the wire shape into the UI shape so a live product never
// crashes a page, with a graceful parchment fallback when a product has no photo.
//
// Image strategy (in priority order):
//   1. `imageUrls` — the live contract (primary-first). API-relative paths are
//      prefixed with NEXT_PUBLIC_API_URL so the public /raw + /thumb routes
//      resolve cross-origin from the storefront. Already-absolute URLs (an
//      absolute PHOTOS_PUBLIC_BASE_URL the api may emit) pass through untouched.
//   2. `photos[]` / `primaryPhoto` — a richer object shape, if a future endpoint
//      ever carries alt text + flags directly.
//   3. R2 keys via `${R2_PUBLIC_URL_BASE}/${r2Key}` — legacy CDN fallback.
// When none resolve we hand back `null` / `[]` and <ProductImage> renders its
// graceful parchment tile. We never hardcode `/img/products/*` for live data —
// those local fixtures belong to placeholder mode only.
// ─────────────────────────────────────────────────────────────────────────────

/** Public R2 CDN base, e.g. https://media.warehouse14.de. Empty in dev. */
const R2_PUBLIC_URL_BASE = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL_BASE ?? "").replace(/\/+$/, "");

/**
 * Resolve any storefront photo reference to a URL Next/Image can load.
 *   • absolute (http/https) → returned untouched (absolute PHOTOS_PUBLIC_BASE_URL)
 *   • api-relative ("/api/photos/<id>/thumb") → kept SAME-ORIGIN so it routes
 *     through the storefront's own photo-proxy (app/api/photos/[id]/[variant]),
 *     which streams the public rendition from INTERNAL_API_URL. The browser
 *     therefore never contacts the api host directly.
 *   • anything else (already a full path on the same origin) → left as-is
 */
function resolveImageUrl(ref: string): string {
  if (/^https?:\/\//i.test(ref)) return ref;
  if (ref.startsWith("/api/")) return ref;
  return ref;
}

/** A single photo as it *might* arrive from a future image-bearing endpoint. */
interface WirePhoto {
  r2Key?: string | null;
  url?: string | null;
  altDe?: string | null;
  altTextDe?: string | null;
  isPrimary?: boolean | null;
  displayOrder?: number | null;
  order?: number | null;
}

/** Resolve a wire photo to an absolute URL, or null if it can't be built. */
function photoUrl(p: WirePhoto): string | null {
  if (p.url) return resolveImageUrl(p.url); // absolute or api-relative
  if (p.r2Key && R2_PUBLIC_URL_BASE) return `${R2_PUBLIC_URL_BASE}/${p.r2Key}`;
  return null;
}

function toProductImage(p: WirePhoto): ProductImage | null {
  const url = photoUrl(p);
  if (!url) return null;
  return {
    url,
    altDe: p.altDe ?? p.altTextDe ?? null,
    isPrimary: Boolean(p.isPrimary),
    order: p.displayOrder ?? p.order ?? 0,
  };
}

/**
 * Map the live `imageUrls` contract → the UI `ProductImage[]` shape.
 *
 * The array is PRIMARY-FIRST, so index 0 is the primary and the index doubles
 * as `order`. Each entry is either a bare path string (`/api/photos/<id>/thumb`)
 * or an object exposing `{ raw?, thumb?, url? }`; we prefer the full-resolution
 * `raw` for the gallery and fall back to `thumb`/`url`. The product `name` seeds
 * a reasonable German alt text since the wire carries none.
 */
function imagesFromImageUrls(raw: unknown[], productName: string): ProductImage[] {
  const out: ProductImage[] = [];
  raw.forEach((entry, i) => {
    let ref: string | null = null;
    if (typeof entry === "string") {
      ref = entry;
    } else if (entry && typeof entry === "object") {
      const e = entry as { raw?: unknown; thumb?: unknown; url?: unknown };
      const pick = [e.raw, e.url, e.thumb].find((v) => typeof v === "string" && v.length > 0);
      ref = typeof pick === "string" ? pick : null;
    }
    if (!ref) return;
    out.push({
      url: resolveImageUrl(ref),
      altDe: productName || null,
      isPrimary: i === 0,
      order: i,
    });
  });
  return out;
}

/**
 * Normalise a raw backend product (StorefrontProduct schema shape) into the
 * storefront's ProductSummary/ProductDetail. Tolerates the live contract
 * (`imageUrls`, primary-first), a richer one (photos[]/primaryPhoto), and the
 * legacy no-image contract (graceful parchment fallback).
 */
function normaliseProduct<T extends ProductSummary>(raw: unknown): T {
  const r = raw as Record<string, unknown> & {
    imageUrls?: unknown;
    photos?: WirePhoto[];
    primaryPhoto?: WirePhoto;
    name?: unknown;
  };
  const name = typeof r.name === "string" ? r.name : "";

  // 1. Live contract: primary-first `imageUrls`.
  let gallery: ProductImage[] = Array.isArray(r.imageUrls)
    ? imagesFromImageUrls(r.imageUrls, name)
    : [];

  // 2. Richer object shape, if ever present.
  if (gallery.length === 0 && Array.isArray(r.photos)) {
    gallery = r.photos.map(toProductImage).filter((x): x is ProductImage => x !== null);
  }

  const primaryImage: ProductImage | null =
    gallery.find((g) => g.isPrimary) ??
    (r.primaryPhoto ? toProductImage(r.primaryPhoto) : null) ??
    gallery[0] ??
    null;

  return {
    ...(raw as T),
    primaryImage,
    // `images` is the detail-shape gallery; always an array so PhotoGallery's
    // `[...images]` never throws (harmless extra field on a summary).
    images: gallery,
  } as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const base = serverApiBase();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new StorefrontError(res.status, await res.json().catch(() => ({})));
  return res.json() as Promise<T>;
}

async function apiDelete<T>(path: string): Promise<T> {
  const base = serverApiBase();
  const res = await fetch(`${base}${path}`, {
    method: "DELETE",
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) throw new StorefrontError(res.status, await res.json().catch(() => ({})));
  return res.json() as Promise<T>;
}

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const base = serverApiBase();
  const res = await fetch(`${base}${path}`, {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new StorefrontError(res.status, await res.json().catch(() => ({})));
  return res.json() as Promise<T>;
}

export const httpData: StorefrontData = {
  async listProducts(q) {
    const params = new URLSearchParams();
    if (q.limit != null) params.set("limit", String(q.limit));
    if (q.offset != null) params.set("offset", String(q.offset));
    if (q.category) params.set("category", q.category);
    if (q.metal) params.set("metal", q.metal);
    if (q.q) params.set("q", q.q);
    if (q.minPriceEur != null) params.set("minPriceEur", String(q.minPriceEur));
    if (q.maxPriceEur != null) params.set("maxPriceEur", String(q.maxPriceEur));
    if (q.sort) params.set("sort", q.sort);
    const result = await apiGet<Paged<ProductSummary>>(
      `/api/storefront/products?${params}`,
      { revalidate: 60 },
    );
    if (!result) return { items: [], total: 0, limit: q.limit ?? 24, offset: q.offset ?? 0 };
    // Backend omits image fields — normalise so cards never read undefined.
    return { ...result, items: result.items.map((p) => normaliseProduct<ProductSummary>(p)) };
  },

  async getProductBySlug(slug) {
    const raw = await apiGet<ProductDetail>(`/api/storefront/products/${slug}`, { revalidate: 60 });
    if (!raw) return null;
    // Guarantee `images` is an array — PhotoGallery does `[...images]`.
    return normaliseProduct<ProductDetail>(raw);
  },

  async listCategories() {
    const res = await apiGet<{ roots: CategoryNode[] }>("/api/storefront/categories", {
      revalidate: 300,
    });
    return res?.roots ?? [];
  },

  async getCategoryBySlug(slug) {
    // The backend exposes only the full tree (`GET /api/storefront/categories`);
    // there is no per-slug endpoint. Fetch the tree and walk it client-side.
    const res = await apiGet<{ roots: CategoryNode[] }>("/api/storefront/categories", {
      revalidate: 300,
    });
    const roots = res?.roots ?? [];
    const find = (nodes: CategoryNode[]): CategoryNode | null => {
      for (const n of nodes) {
        if (n.slug === slug) return n;
        const hit = find(n.children);
        if (hit) return hit;
      }
      return null;
    };
    return find(roots);
  },

  async listLocations() {
    const res = await apiGet<{ items: BusinessLocation[] }>("/api/storefront/locations", {
      revalidate: 3600,
    });
    return res?.items ?? [];
  },

  async getMetalRates() {
    // NOTE: there is no *public* metal-prices endpoint yet. `/api/metal-prices/*`
    // exists but is staff-auth-gated, and `/api/storefront/metal-prices` is not
    // implemented (404). Until a public ticker route lands, this degrades to an
    // empty array and the <MetalTicker> simply renders nothing. (apiGet maps the
    // 404 to null for us.)
    const res = await apiGet<{ rates: MetalRate[] }>("/api/storefront/metal-prices", {
      revalidate: 30,
    });
    return res?.rates ?? [];
  },

  async getShopIdentity() {
    // `/api/shop-info` requires a staff session, so an anonymous storefront SSR
    // request gets 401 → apiGet returns null → we serve the static identity
    // fallback. Also note the backend payload has NO `email` field, so even an
    // authenticated read would need this default for `email`.
    const res = await apiGet<Partial<ShopIdentity>>("/api/shop-info", { revalidate: 3600 });
    const fallback: ShopIdentity = {
      name: "warehouse14",
      tagline: "Das Kontor für Gold, seltene Münzen und geprüfte Antiquitäten.",
      addressLine1: "",
      addressLine2: "",
      vatId: "",
      phone: "",
      email: "info@warehouse14.de",
    };
    return res ? { ...fallback, ...res } : fallback;
  },

  async listPublishedSlugs() {
    // No dedicated sitemap endpoint exists; `/products/published-slugs` collides
    // with the `/products/:slug` route. Derive slugs from the public catalog
    // instead — one paginated sweep up to the API's 100-item cap (V1 inventory
    // is well under this; revisit with a cursor if the catalog outgrows it).
    const res = await apiGet<Paged<ProductSummary>>(
      "/api/storefront/products?limit=100",
      { revalidate: 300 },
    );
    return (res?.items ?? [])
      .filter((p) => p.slug != null)
      .map((p) => ({ slug: p.slug as string, updatedAt: null as ISO | null }));
  },

  async signUp(b) {
    return apiPost("/api/storefront/auth/sign-up", b);
  },

  async signIn(b) {
    return apiPost("/api/storefront/auth/sign-in", b);
  },

  async signOut() {
    return apiPost("/api/storefront/auth/sign-out", {});
  },

  async getAccount() {
    return apiGet("/api/storefront/account", { noStore: true });
  },

  async updateAccount(b) {
    await apiPatch("/api/storefront/account", b);
  },

  async getCart() {
    const res = await apiGet<Cart>("/api/storefront/cart", { noStore: true });
    return (
      res ?? {
        id: "",
        status: "ACTIVE",
        items: [],
        totalEur: "0.00",
        checkoutExpiresAt: null,
        createdAt: new Date().toISOString(),
      }
    );
  },

  async addToCart(productId) {
    return apiPost("/api/storefront/cart/items", { productId });
  },

  async removeFromCart(cartItemId) {
    return apiDelete(`/api/storefront/cart/items/${cartItemId}`);
  },

  async checkout(b) {
    return apiPost("/api/storefront/cart/checkout", b);
  },

  async listOrders() {
    const res = await apiGet<OrderSummary[]>("/api/storefront/orders", { noStore: true });
    return res ?? [];
  },

  async getOrder(id) {
    return apiGet<OrderDetail>(`/api/storefront/orders/${id}`, { noStore: true });
  },

  async submitGoldankaufLead(b) {
    return apiPost("/api/storefront/goldankauf-lead", b);
  },

  async subscribeNewsletter(email) {
    return apiPost("/api/storefront/newsletter", { email });
  },

  async submitContact(b) {
    return apiPost("/api/storefront/contact", b);
  },

  // ── appointments (CONTRACT: public slots + book) ───────────────────────────

  async getAppointmentSlots(date, type) {
    // Availability is volatile — never cache. A 404/401/403 (apiGet → null,
    // e.g. backend without the endpoint yet) degrades to "no slots" instead
    // of crashing the booking page.
    const params = new URLSearchParams({ date, type });
    const res = await apiGet<AppointmentSlotsResult>(
      `/api/storefront/appointments/slots?${params}`,
      { noStore: true },
    );
    return res ?? { date, slots: [] };
  },

  async bookAppointment(b) {
    // 409 (slot taken) / 400 (invalid/outside hours) / 429 (rate limit) reach
    // the caller as StorefrontError with `.status` — the page maps them to
    // honest German messages and refreshes the slot grid on 409.
    return apiPost<AppointmentBookingResult>("/api/storefront/appointments/book", b);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 6. Default export - selected by env variable
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The one import every page uses.
 *
 *   import { data } from "@/lib/storefront-data";
 *
 * Set NEXT_PUBLIC_DATA_SOURCE=live (e.g. in .env.local) to switch to the HTTP
 * adapter. Everything else uses the deterministic placeholder.
 */
export const data: StorefrontData =
  process.env.NEXT_PUBLIC_DATA_SOURCE === "live" ? httpData : placeholderData;

// ─────────────────────────────────────────────────────────────────────────────
// 7. Formatting helpers (re-export from here so callers import one module)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a DecimalString as a German EUR currency string.
 *
 *   eur("2387.00") → "2.387,00 €"
 */
export function eur(value: DecimalString | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
}

/**
 * Format a WeightString in grams with German locale.
 *
 *   grams("31.1035") → "31,1035 g"
 */
export function grams(value: WeightString | number, decimals = 4): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return `${new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(n)} g`;
}

/**
 * Fineness decimal to human display string.
 *
 *   fineness("0.9999") → "999,9/1000"
 */
export function fineness(value: DecimalString | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  const thousands = n * 1000;
  return `${new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(thousands)}/1000`;
}

/**
 * Build the canonical product href.
 * Callers never need to know the fallback rule.
 */
export function productHref(p: Pick<ProductSummary, "slug" | "sku">): string {
  return `/artikel/${p.slug ?? `p-${p.sku}`}`;
}
