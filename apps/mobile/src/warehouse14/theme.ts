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
  mutedForeground: "#646b76",
  primary: "#9a751f",
  primaryForeground: "#ffffff",
  verdigris: "#157a4b",
  destructive: "#d63d49",
  border: "#e3e6eb",
  ring: "#9a751f",
  gold: "#bf9430",
}

export const darkPalette: Palette = {
  background: "#131519",
  card: "#1b1e24",
  foreground: "#e9ebee",
  mutedForeground: "#939aa3",
  primary: "#d8b14e",
  primaryForeground: "#1a1407",
  verdigris: "#2fb277",
  destructive: "#e15862",
  border: "#2c313a",
  ring: "#d8b14e",
  gold: "#bf9430",
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

/** Font families loaded in the root layout (see fonts.ts). */
export const fonts = {
  body: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  mono: "JetBrainsMono_400Regular",
  monoMedium: "JetBrainsMono_500Medium",
} as const

export interface Theme {
  colors: Palette
  isDark: boolean
  radii: typeof radii
  space: typeof space
  touch: typeof touch
  fonts: typeof fonts
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
  }
}
