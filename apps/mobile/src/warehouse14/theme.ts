/**
 * Warehouse14 design tokens — the ANTIQUE IDENTITY, ported to React Native.
 *
 * The house voice is an aged jeweller's ledger: warm cream paper, ink that is
 * never pure black, brass and gold accents, fine gold hairlines on every edge.
 * The brand lives in `packages/ui-kit` and the storefront (warehouse14-onlineshop);
 * those values are mirrored here as a typed theme — no web styling is imported.
 *
 * The mirror into `apps/mobile/global.css` (`--w14-*` vars → NativeWind utility
 * tokens) is 1:1 with this file. Token NAMES are stable across the redesign, so
 * every surface inherits the new look with no per-file churn.
 *
 * Rules carried over from the brand:
 *   • Colour only from this palette. The cream is AGED and warm, layered for
 *     depth — never flat, never the old black+yellow.
 *   • Radii small: {0, button 4, card 8} — antique, not bubbly.
 *   • Spacing on a 4px grid.
 *   • Touch target ≥44px; money-path actions ≥48px.
 *   • Type = Cormorant Garamond (display/headings) + Inter (body) +
 *     JetBrains Mono (tabular numerals).
 *   • GOLD (#bf9430) and the HAIRLINE (#cdb787) are DECORATIVE ONLY — never
 *     text, never a text-bearing fill. Use brass (`primary`) for emphasis text.
 *   • Text-bearing colours are darkened antique variants that clear WCAG AA on
 *     BOTH the cream bg and the card; the pure brand hues stay for decoration.
 */
import { useColorScheme } from "react-native"

export interface Palette {
  /** app background — aged warm cream (--w14-paper) */
  background: string
  /** cards / panels — the raised cream leaf (--w14-paper-card) */
  card: string
  /** sunken surface — inputs, wells, deep tray (--w14-paper-raised) */
  raised: string
  /** primary text — warm near-black ink (--w14-ink) */
  foreground: string
  /** captions / hints / meta — faded ink (--w14-ink-faded) */
  mutedForeground: string
  /** primary action fill, brass-deep; carries white text at AA (--w14-brass) */
  primary: string
  /** text/icon on the primary fill */
  primaryForeground: string
  /** positive / brand sage-green — AA as text + as a fill (--w14-sage) */
  verdigris: string
  /** destructive / price-down terracotta — AA as text + as a fill (--w14-terracotta) */
  destructive: string
  /** hairline borders — fine warm gold rule (--w14-hairline) */
  border: string
  /** focus ring = brass */
  ring: string
  /** DECORATIVE accent only — never behind text (--w14-gold) */
  gold: string
}

/**
 * LIGHT — the HERO theme. Warm aged cream paper, warm ink, brass + gold.
 * This is the default; the app opens here, not in the dark.
 *
 * Layered cream for depth (not one flat fill):
 *   paper #efece3 (canvas) · card #faf8f2 (raised leaf) · raised #e8e4da (sunken
 *   well / input). The grain primitive (global.css) adds the subtle paper tooth.
 */
export const lightPalette: Palette = {
  background: "#efece3",
  card: "#faf8f2",
  raised: "#e8e4da",
  foreground: "#17150f", // 15.45:1 on bg — warm near-black, never pure #000
  // Faded ink for captions/hints. Brand faded is #6e6b64 (exactly 4.5:1 — too
  // tight); nudged to #67645d so meta clears AA with margin on bg AND card.
  mutedForeground: "#67645d", // 5.00:1 bg · 5.56:1 card — AA
  // Brass-deep. The brand brass (#9a7726/#bf9430 gold) is decorative; the
  // text/fill brass is darkened so it clears AA as normal text on bg AND card,
  // and so white text on the brass fill clears AA too.
  primary: "#7e6228", // 4.85:1 bg · 5.40:1 card — AA as text
  primaryForeground: "#faf8f2", // warm cream on brass — 5.4:1 — AA
  // Sage green = positive / price-up. AA as text and as a fill with cream text.
  verdigris: "#3a6450", // 5.70:1 bg · 6.34:1 card · cream-on 6.7:1 — AA
  // Terracotta = destructive / price-down. Brand terracotta #c0492f is the
  // decorative price-down chip; the text-bearing variant is darkened to AA.
  destructive: "#b8442b", // 4.56:1 bg · 5.07:1 card · cream-on 5.4:1 — AA
  border: "#cdb787", // fine warm-gold hairline — decorative, not contrast-bound
  ring: "#7e6228",
  gold: "#bf9430", // decorative flourish only — never under text
}

/**
 * DARK — a WARM antique dark. Deep ink-brown paper, aged cream text, the same
 * brass + gold. NEVER the old #131519 black+yellow; this is candlelit walnut.
 *
 *   paper #17150f (canvas) · card #1f1c16 (raised) · raised #14110c (sunken).
 */
export const darkPalette: Palette = {
  background: "#17150f",
  card: "#1f1c16",
  raised: "#14110c",
  foreground: "#e9e7e1", // 14.76:1 on bg — warm aged cream, never cold white
  mutedForeground: "#a39d90", // 6.76:1 on bg — faded warm grey
  primary: "#d8b14e", // bright brass — 9.0:1 on bg — AA
  primaryForeground: "#1a1407", // deep ink on the brass fill — 9.0:1 — AA
  verdigris: "#5fae89", // warm sage, lifted for the dark canvas — 7.4:1 — AA
  destructive: "#e07a62", // warm terracotta, lifted — 6.4:1 on bg — AA
  // The single hairline that carries structure on the dark canvas: a dim warm
  // gold, lifted just enough to read against the walnut without glowing.
  border: "#4a4029", // warm-gold hairline on dark — calm, legible
  ring: "#d8b14e",
  gold: "#bf9430", // decorative flourish only
}

/**
 * Radii — antique, small. {0, button 4, card 8}. The brand storefront uses tight
 * corners; this is a sharper, more crafted feel than the old 8/12.
 */
export const radii = {
  none: 0,
  button: 4,
  card: 8,
} as const

/** 4px spacing grid. */
export const space = {
  x1: 4,
  x2: 8,
  x3: 12,
  x4: 16,
  x5: 20,
  x6: 24,
  x7: 32,
  x8: 40,
  x9: 48,
} as const

/** Minimum touch targets (WCAG 2.5.5). Money-path actions use `comfortable`. */
export const touch = {
  min: 44,
  comfortable: 48,
} as const

/**
 * Icon sizing — one scale, so a glyph is never a raw magic number.
 *
 *   xs 14 — a tiny glyph beside small text (a retry link, the offline bar).
 *   sm 16 — control / action glyph (buttons, inline-error heading, the X).
 *   md 18 — the STANDARD leading icon of a row / section / chevron.
 *   lg 20 — a larger glyph inside a chip (a seal, an award).
 *   xl 26 — the hero glyph in an empty / error state disc.
 */
export const icon = {
  xs: 14,
  sm: 16,
  md: 18,
  lg: 20,
  xl: 26,
} as const

/**
 * Font families loaded in the root layout (see fonts.ts).
 *
 *   display* — Cormorant Garamond, the antique DISPLAY serif. Screen titles,
 *     the hero KPI, section headlines. The elegant aged-paper voice.
 *   body/medium/semibold/bold — Inter, all UI + body text.
 *   mono/monoMedium — JetBrains Mono, tabular numerals (money, weights, IDs).
 */
export const fonts = {
  display: "CormorantGaramond_500Medium",
  displaySemibold: "CormorantGaramond_600SemiBold",
  displayBold: "CormorantGaramond_700Bold",
  body: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  mono: "JetBrainsMono_400Regular",
  monoMedium: "JetBrainsMono_500Medium",
} as const

/**
 * The type ramp, typed so a surface can read a step instead of re-deriving a
 * `fontSize`. The NativeWind `className` form stays primary; this mirror is for
 * the rare style-prop case (e.g. an animated value).
 *
 * Headings are the Cormorant display serif (the antique voice); body/meta are
 * Inter. Cormorant is a high-contrast serif that reads light at small sizes, so
 * display steps are sized up a touch and never used below the section heading.
 */
export const type = {
  display: { size: 28, family: fonts.displayBold }, // hero screen title / splash
  heroKpi: { size: 26, family: fonts.displaySemibold }, // the single big number
  title: { size: 22, family: fonts.displaySemibold }, // screen header
  section: { size: 16, family: fonts.semibold }, // SectionCard / group headers (Inter — small)
  body: { size: 14, family: fonts.body },
  label: { size: 12, family: fonts.body },
  micro: { size: 11, family: fonts.body },
} as const

export interface Theme {
  colors: Palette
  isDark: boolean
  radii: typeof radii
  space: typeof space
  touch: typeof touch
  fonts: typeof fonts
  icon: typeof icon
  type: typeof type
}

/** Active theme keyed off the OS colour scheme. Light is the hero default. */
export function useW14Theme(): Theme {
  const scheme = useColorScheme()
  const isDark = scheme === "dark"
  return {
    colors: isDark ? darkPalette : lightPalette,
    isDark,
    radii,
    space,
    touch,
    fonts,
    icon,
    type,
  }
}
