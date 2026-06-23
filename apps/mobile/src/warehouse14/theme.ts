/**
 * Warehouse14 design tokens — the OFFICIAL STORE design system, ported to RN.
 *
 * The public webshop (warehouse14-onlineshop globals.css) is the single source
 * of truth. This file mirrors it exactly as a typed theme — no web styling is
 * imported. The mirror into `apps/mobile/global.css` (`--w14-*` vars → NativeWind
 * utility tokens) is 1:1 with this file.
 *
 * PHILOSOPHY (binding — understand before any colour choice):
 *   • One warm paper ground + one ink + hairlines. Aged paper, NEVER bright
 *     white. Layered for depth.
 *   • GILT (gold) = a thread / an edge / a seal ONLY. NEVER a fill, NEVER a
 *     background, NEVER body text. Hairlines, underline-draws, the ◆ diamond,
 *     badge borders, tiny dots.
 *   • Functional colours carry MEANING only: verdigris = positive/up/alive,
 *     wax-red = error/down. Never decoration.
 *   • LIGHT ONLY. The store has no dark mode.
 *   • Type = Bricolage Grotesque (display/headings) + Inter (body) +
 *     JetBrains Mono (tabular numerals). All self-hosted (DSGVO, zero CDN).
 */
import { useColorScheme } from "react-native"

import { useThemeMode } from "./theme-preference"

export interface Palette {
  /** app background — warm cream parchment (--w14-parchment) */
  background: string
  /** cards / panels — half-step lighter than the ground (--w14-parchment-2) */
  card: string
  /** raised / hover — a hair deeper than the ground (--w14-parchment-3) */
  raised: string
  /** primary text — near-black ink (--w14-ink) */
  foreground: string
  /** secondary text (--w14-ink-aged) */
  inkAged: string
  /** captions / hints / meta — faint ink (--w14-ink-faded) */
  mutedForeground: string
  /** primary action fill = INK (the house accent; gold is a thread only) */
  primary: string
  /** text/icon on the primary fill (parchment-2) */
  primaryForeground: string
  /** positive / price-up patina green (--w14-verdigris) */
  verdigris: string
  /** destructive / price-down sealing-wax red (--w14-wax-red) */
  destructive: string
  /** soft hairline borders (--w14-rule) */
  border: string
  /** focus ring = ink */
  ring: string
  /** DECORATIVE gilt thread only — NEVER behind text (--w14-gilt) */
  gilt: string
  /** pressed / hover gilt (--w14-gilt-deep) */
  giltDeep: string
  /** Legacy alias for `gilt` — decorative thread/edge/seal. Kept so existing
   *  surfaces that read `colors.gold` keep compiling while they migrate. */
  gold: string
  /** deep warm olive (--w14-forest, rare) */
  forest: string
  /** terracotta (--w14-terra, rare warmth) */
  terra: string
}

/**
 * LIGHT — the ONLY theme. Warm aged cream paper, warm ink, gilt thread.
 *
 * Layered cream for depth (not one flat fill):
 *   parchment #efece3 (canvas) · parchment-2 #f8f6f1 (cards) · parchment-3
 *   #e6e2d6 (raised/hover). The grain primitive (global.css) adds the subtle
 *   paper tooth.
 */
export const lightPalette: Palette = {
  background: "#efece3",
  card: "#f8f6f1",
  raised: "#e6e2d6",
  foreground: "#1c1c1c", // near-black ink, never pure #000
  inkAged: "#4c4a45", // secondary text
  mutedForeground: "#6e6b64", // faint / meta
  // INK is the house accent — the official store uses ink as the primary
  // action fill, with gilt reserved for thread/edge/seal.
  primary: "#1c1c1c",
  primaryForeground: "#f8f6f1",
  verdigris: "#3f6b54", // positive / price-up
  destructive: "#c0492f", // negative / price-down
  border: "#e9e7e1", // soft hairline structure, not decoration
  ring: "#1c1c1c", // ink focus ring
  gilt: "#a3823b", // DECORATIVE thread/edge/seal NEVER a fill or text
  giltDeep: "#876a2c", // pressed / hover gilt
  // Legacy `gold` alias — mirrors the official store remap (DESIGN-SYSTEM.md §2
  // "Legacy"): the old gold token now resolves to quiet ink-umber, so any stale
  // `colors.gold` call site reads as ink, NEVER yellow. This MUST match
  // global.css `--w14-gold: #2e2b26`. For decorative gold use `gilt`; for
  // text-bearing emphasis use `primary` (ink).
  gold: "#2e2b26",
  forest: "#46583f",
  terra: "#a4633c",
}

/**
 * DARK — a warm dark mode on the SAME design system. Deep umber ground (never
 * pure black), warm parchment-tinted text, gilt as thread/edge/seal only,
 * functional green/red lifted for AA contrast on the dark canvas. Mirrors the
 * light palette's structure 1:1 so every surface renders correctly in both
 * modes via the same tokens.
 */
export const darkPalette: Palette = {
  background: "#1a1712", // deep warm umber, never pure #000
  card: "#232019", // raised umber leaf (half-step lighter)
  raised: "#100e0a", // sunken well / hover (deeper than the ground)
  foreground: "#efece3", // warm parchment text (the light ink)
  inkAged: "#c4bfb2", // secondary text
  mutedForeground: "#a39d90", // faint / meta text
  // Primary action = warm parchment (the dark-mode ink: light on dark).
  primary: "#efece3",
  primaryForeground: "#1a1712",
  verdigris: "#7bc4a0", // sage green lifted for AA on dark
  destructive: "#e07a5e", // wax-red lifted for AA on dark
  border: "#3a342a", // warm umber hairline
  ring: "#efece3", // light focus ring on dark
  gilt: "#c9a55c", // gilt lifted slightly for visibility on dark
  giltDeep: "#a3823b",
  gold: "#1a1712", // legacy alias mirrors the ground (quiet, not yellow)
  forest: "#7bc4a0",
  terra: "#d49a6e",
}

/**
 * Radii — ONE system. button 8 / card 12 / xl2 20. The official store scale.
 */
export const radii = {
  none: 0,
  button: 8,
  card: 12,
  xl2: 20,
} as const

/** 8pt spacing ladder (the store grid), with finer steps kept for back-compat. */
export const space = {
  x1: 8,
  x2: 16,
  x3: 24,
  x4: 40,
  x5: 64,
  x6: 96,
  x7: 128,
  // finer steps (kept so existing surfaces that pad with 4/12/20/32/48 keep
  // compiling while they migrate to the 8pt ladder)
  x1_2: 4,
  x1_5: 12,
  x2_5: 20,
  x3_5: 32,
  x4_5: 48,
  // legacy aliases (old 4px-grid names) — still on the ladder, no churn
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
 *   display* — Bricolage Grotesque, the DISPLAY grotesque. Screen titles,
 *     the hero KPI, section headlines. The confident house display voice.
 *   body/medium/semibold/bold — Inter, all UI + body text.
 *   mono/monoMedium — JetBrains Mono, tabular numerals (money, weights, IDs).
 */
export const fonts = {
  display: "BricolageGrotesque_500Medium",
  displaySemibold: "BricolageGrotesque_600SemiBold",
  displayBold: "BricolageGrotesque_700Bold",
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
 * Sizes map the store's fluid clamp scale to fixed px at the iOS/Android base
 * (16px body), grown for headings so the display grotesque carries weight.
 * Body/meta are Inter. Display steps are Bricolage Grotesque.
 */
export const type = {
  display: { size: 32, family: fonts.displayBold }, // hero screen title / splash (H1)
  heroKpi: { size: 30, family: fonts.displaySemibold }, // the single big number
  title: { size: 24, family: fonts.displaySemibold }, // screen header (H2/H3)
  section: { size: 17, family: fonts.semibold }, // SectionCard / group headers (Inter)
  lead: { size: 18, family: fonts.body }, // lead paragraph
  body: { size: 16, family: fonts.body },
  label: { size: 13, family: fonts.body },
  micro: { size: 12, family: fonts.body },
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

/** Active theme. Respects the owner's explicit choice (Hell/Dunkel/System):
 *  when 'system' it follows useColorScheme; when 'light' or 'dark' it overrides.
 *  Both palettes are on the same design system. */
export function useW14Theme(): Theme {
  const scheme = useColorScheme()
  const mode = useThemeMode()
  const isDark = mode === "dark" || (mode === "system" && scheme === "dark")
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
