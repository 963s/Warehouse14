/**
 * PLACEHOLDER content for the Phase-1 visual build.
 * Replaced by live /api/storefront/* data (catalog, metal-rates) in the
 * data-adapter step. Numbers/identity are illustrative only.
 */

export type MetalRate = {
  metal: string;
  symbol: string;
  pricePerGram: number;
  changePct: number;
};

export const metalRates: MetalRate[] = [
  { metal: "Gold", symbol: "XAU", pricePerGram: 76.42, changePct: 0.84 },
  { metal: "Silber", symbol: "XAG", pricePerGram: 0.92, changePct: 1.21 },
  { metal: "Platin", symbol: "XPT", pricePerGram: 31.78, changePct: -0.36 },
  { metal: "Palladium", symbol: "XPD", pricePerGram: 28.14, changePct: 0.42 },
];

export type Category = {
  slug: string;
  name: string;
  blurb: string;
  count: number;
  accent: string;
};

export const categories: Category[] = [
  { slug: "muenzen", name: "Münzen", blurb: "Anlage- & Sammlermünzen, weltweit geprüft", count: 1840, accent: "#bf9430" },
  { slug: "edelmetalle", name: "Edelmetalle", blurb: "Goldbarren & Silberbarren, LBMA-zertifiziert", count: 612, accent: "#9a7726" },
  { slug: "antiquitaeten", name: "Antiquitäten", blurb: "Geprüfte Einzelstücke mit Provenienz", count: 967, accent: "#7c6a52" },
  { slug: "schmuck", name: "Schmuck", blurb: "Gold, Silber & Vintage-Preziosen", count: 1203, accent: "#b08d57" },
  { slug: "briefmarken", name: "Briefmarken", blurb: "Deutschland, weltweit & thematisch", count: 2451, accent: "#6b7280" },
  { slug: "sammlerobjekte", name: "Sammlerobjekte", blurb: "Militaria, Dokumente & Raritäten", count: 738, accent: "#8a6a1f" },
];

export type Product = {
  id: string;
  name: string;
  category: string;
  metal: string;
  detail: string;
  priceEur: number;
  glyph: string;
  unique?: boolean;
};

export const featured: Product[] = [
  { id: "kr-2024", name: "Krügerrand 1 oz", category: "Goldmünze", metal: "Gold 999,9", detail: "Südafrika · 2024", priceEur: 2387.0, glyph: "moon", unique: true },
  { id: "phil-2024", name: "Wiener Philharmoniker", category: "Goldmünze", metal: "Gold 999,9", detail: "Österreich · 1 oz", priceEur: 2402.5, glyph: "music", unique: true },
  { id: "bar-100", name: "Goldbarren 100 g", category: "Edelmetall", metal: "Gold 999,9", detail: "LBMA · C. Hafner", priceEur: 7640.0, glyph: "bar" },
  { id: "rm-1876", name: "5 Mark Silber 1876", category: "Antike Münze", metal: "Silber 900", detail: "Deutsches Reich · A", priceEur: 189.0, glyph: "crown", unique: true },
  { id: "maple-2024", name: "Maple Leaf 1 oz", category: "Goldmünze", metal: "Gold 999,99", detail: "Kanada · 2024", priceEur: 2395.0, glyph: "leaf" },
  { id: "deco-585", name: "Art-Déco Armband", category: "Schmuck", metal: "Gold 585", detail: "um 1925 · Unikat", priceEur: 1450.0, glyph: "gem", unique: true },
];

export const stats = [
  { value: 12480, suffix: "+", label: "geprüfte Objekte" },
  { value: 38, prefix: "", suffix: "", label: "Jahre Erfahrung", note: "seit 1987" },
  { value: 4.9, decimals: 1, suffix: " ★", label: "aus 2.347 Bewertungen" },
  { value: 100, suffix: " %", label: "versichert & GoBD-konform" },
];

export const nav = [
  { label: "Kollektion", href: "#kollektion" },
  { label: "Münzen", href: "#kategorien" },
  { label: "Edelmetalle", href: "#kategorien" },
  { label: "Antiquitäten", href: "#kategorien" },
  { label: "Goldankauf", href: "#ankauf" },
  { label: "Über uns", href: "#vertrauen" },
];

/** Side-menu taxonomy (icon = lucide key resolved in the menu component). */
export const megaCategories = [
  { slug: "gold", name: "Gold", icon: "coins", count: 612, hint: "Barren & Anlagemünzen" },
  { slug: "silber", name: "Silber", icon: "circle-dot", count: 438, hint: "Barren & Münzen" },
  { slug: "muenzen", name: "Münzen", icon: "circle", count: 1840, hint: "Anlage & Numismatik" },
  { slug: "uhren", name: "Uhren", icon: "watch", count: 214, hint: "Vintage & Luxus" },
  { slug: "antiquitaeten", name: "Antiquitäten", icon: "landmark", count: 967, hint: "mit Provenienz" },
  { slug: "briefmarken", name: "Briefmarken", icon: "stamp", count: 2451, hint: "DE & weltweit" },
  { slug: "sammlungen", name: "Sammlungen", icon: "layers", count: 183, hint: "Konvolute & Nachlässe" },
  { slug: "raritaeten", name: "Raritäten", icon: "gem", count: 96, hint: "Einzelstücke" },
  { slug: "geschenke", name: "Geschenke", icon: "gift", count: 120, hint: "kuratiert" },
];

export const searchSuggestions = [
  "Krügerrand 1 oz",
  "Goldbarren 100 g",
  "Wiener Philharmoniker",
  "Silber Maple Leaf",
  "Antike Taschenuhr",
  "5 Mark Silber 1876",
];

export const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
