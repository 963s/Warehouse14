/**
 * Warehouse14 design tokens, ported to React Native.
 *
 * The web app's source of truth is packages/ui-kit/src/tokens.css. The ui-kit
 * itself is DOM/CSS and cannot run in React Native, so only the token VALUES
 * are mirrored here as a typed theme — no web styling is imported.
 *
 * Rules carried over from the web tokens:
 *   • Colour only from this palette.
 *   • Radii ONLY {0, button 8, card 12}.
 *   • Spacing on a 4px grid.
 *   • Touch target ≥44px; money-path actions ≥48px.
 *   • Type = Inter (display + body) + JetBrains Mono (mono). Cormorant is a
 *     legacy comment only — not used.
 *   • GOLD (#bf9430) is DECORATIVE ONLY — never text or a text-bearing fill.
 *     Use brass `accent` for anything carrying text.
 */
import { useColorScheme } from "react-native"

export interface Palette {
  /** app background (--w14-parchment) */
  background: string
  /** cards / panels (--w14-parchment-2) */
  card: string
  /** primary text (--w14-ink) */
  foreground: string
  /** captions / hints / meta (--w14-ink-faded) */
  mutedForeground: string
  /** primary action fill, brass (--w14-accent) */
  primary: string
  /** text/icon on the primary fill */
  primaryForeground: string
  /** positive / brand verdigris (--w14-verdigris) */
  verdigris: string
  /** destructive (--w14-wax-red) */
  destructive: string
  /** hairline borders (--w14-rule) */
  border: string
  /** focus ring = accent */
  ring: string
  /** DECORATIVE accent only — never behind text (--w14-gold) */
  gold: string
}

export const lightPalette: Palette = {
  background: "#f5f6f8",
  card: "#ffffff",
  foreground: "#16191d",
  mutedForeground: "#646b76", // 4.97:1 on bg — AA
  // Brass, darkened from the web #9a751f (which was only 3.93:1 on the parchment
  // canvas) so text-bearing brass clears WCAG AA (4.5:1) on BOTH bg and card —
  // 4.77 / 5.15. DESIGN.md §4 makes brass the text-emphasis colour, so it must
  // pass as normal text, not just large.
  primary: "#8a6819",
  primaryForeground: "#ffffff", // 5.15:1 on the new brass fill — AA
  verdigris: "#157a4b", // 4.96:1 on bg — AA
  // Wax red, nudged darker from #d63d49 (4.20:1) to clear AA for the small
  // destructive text in InlineError/FormField — 4.54 / 4.91.
  destructive: "#cf3742",
  border: "#e3e6eb",
  ring: "#8a6819",
  gold: "#bf9430", // decorative only — never under text, so not contrast-bound
}

export const darkPalette: Palette = {
  background: "#131519",
  card: "#1b1e24",
  foreground: "#e9ebee", // 15.30:1 on bg — AA
  mutedForeground: "#939aa3", // 6.43:1 on bg — AA
  primary: "#d8b14e", // 8.98:1 on bg — AA
  primaryForeground: "#1a1407", // 9.00:1 on the brass fill — AA
  verdigris: "#2fb277", // 6.75:1 on bg — AA
  destructive: "#e15862", // 5.03:1 on bg — AA
  // Lifted from #2c313a (1.28:1 on card — nearly invisible) to #363c47 so the
  // single hairline that carries all structure on the dark canvas is actually
  // legible (1.65/1.51) while staying calm and flat. DESIGN.md §5.
  border: "#363c47",
  ring: "#d8b14e",
  gold: "#bf9430", // decorative only
}

/** Radii — the only three allowed values. */
export const radii = {
  none: 0,
  button: 8,
  card: 12,
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
 * Icon sizing — one scale, so a glyph is never a raw magic number (DESIGN.md
 * §3 calls for consistent icon sizing across the kit). Lucide takes a `size`
 * number; pull from here.
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

/** Font families loaded in the root layout (see fonts.ts). */
export const fonts = {
  body: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  mono: "JetBrainsMono_400Regular",
  monoMedium: "JetBrainsMono_500Medium",
} as const

/**
 * The type ramp (DESIGN.md §3), typed so a surface can read a step instead of
 * re-deriving a `fontSize`. The NativeWind `className` form stays the primary
 * way to set type; this mirror is for the rare style-prop case (e.g. an
 * animated value) so the ramp is never re-invented with a magic number.
 *
 * Each step is the rendered size in px and the Inter face that the matching
 * weight class resolves to (see global.css). `micro` is the 11px hint, exposed
 * to NativeWind as `text-2xs`.
 */
export const type = {
  heroKpi: { size: 24, family: fonts.bold },
  title: { size: 20, family: fonts.bold },
  section: { size: 16, family: fonts.semibold },
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

/** Active theme keyed off the OS colour scheme. */
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
