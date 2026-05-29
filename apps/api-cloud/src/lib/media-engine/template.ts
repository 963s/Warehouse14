/**
 * Luxury marketing-card template (ADR/Decision #48 — Omnichannel Media Engine).
 *
 * We DON'T draw on a canvas. We describe the card as an HTML/CSS element tree
 * that Satori turns into an SVG (see render.ts). This module is pure + has no
 * Satori/Sharp import, so the layout is unit-testable on its own.
 *
 * The element shape matches what Satori consumes (`{ type, props }`); we keep a
 * local structural type instead of pulling in React just for the node type.
 */

/** Minimal Satori-compatible element node (a structural subset of ReactElement). */
export interface SatoriNode {
  type: string;
  props: {
    style?: Record<string, string | number>;
    children?: SatoriNode | string | Array<SatoriNode | string>;
    [key: string]: unknown;
  };
}

export interface ProductCardMeta {
  sku: string;
  title: string;
  weightGrams?: string | null;
  karat?: string | null;
  priceEur?: string | null;
}

export interface CardTheme {
  width: number;
  height: number;
  background: string;
  accent: string;
  text: string;
  /** Brand wordmark shown in the footer. */
  brand: string;
}

export const DEFAULT_CARD_THEME: CardTheme = {
  width: 1080,
  height: 1080,
  background: '#0f0d0a',
  accent: '#c9a14a',
  text: '#f5f1e6',
  brand: 'WAREHOUSE 14',
};

function el(type: string, props: SatoriNode['props']): SatoriNode {
  return { type, props };
}

/** Compose the chips line ("18 kt · 3.20 g · SKU") from the present fields. */
export function buildSpecLine(meta: ProductCardMeta): string {
  const parts: string[] = [];
  if (meta.karat && meta.karat.trim().length > 0) parts.push(meta.karat.trim());
  if (meta.weightGrams && meta.weightGrams.trim().length > 0)
    parts.push(`${meta.weightGrams.trim()} g`);
  parts.push(meta.sku);
  return parts.join('  ·  ');
}

/**
 * Build the luxury card element tree. The product cutout is composited later by
 * Sharp into the empty hero area, so the template reserves vertical space for it
 * (no <img> here — Satori would need the bytes inline; Sharp does it faster).
 */
export function buildProductCardElement(
  meta: ProductCardMeta,
  theme: CardTheme = DEFAULT_CARD_THEME,
): SatoriNode {
  const specLine = buildSpecLine(meta);

  return el('div', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      width: `${theme.width}px`,
      height: `${theme.height}px`,
      backgroundColor: theme.background,
      color: theme.text,
      fontFamily: 'Inter',
      padding: '64px',
      position: 'relative',
    },
    children: [
      // Top accent rule + brand.
      el('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
        children: [
          el('div', {
            style: { fontSize: '34px', letterSpacing: '8px', color: theme.accent, fontWeight: 700 },
            children: theme.brand,
          }),
          el('div', {
            style: { fontSize: '24px', letterSpacing: '4px', color: theme.text, opacity: 0.6 },
            children: 'BOUTIQUE',
          }),
        ],
      }),
      // Hero spacer — the cutout is composited over this region by Sharp.
      el('div', { style: { display: 'flex', flexGrow: 1 }, children: '' }),
      // Title + spec line + price.
      el('div', {
        style: { display: 'flex', flexDirection: 'column' },
        children: [
          el('div', {
            style: { fontSize: '64px', fontWeight: 700, lineHeight: 1.1, marginBottom: '16px' },
            children: meta.title,
          }),
          el('div', {
            style: { fontSize: '30px', letterSpacing: '2px', color: theme.accent },
            children: specLine,
          }),
          meta.priceEur && meta.priceEur.trim().length > 0
            ? el('div', {
                style: { fontSize: '52px', fontWeight: 700, marginTop: '24px' },
                children: `${meta.priceEur} €`,
              })
            : el('div', { style: { display: 'flex' }, children: '' }),
        ],
      }),
    ],
  });
}
