/**
 * PaperGrain — the subtle aged-paper texture behind the antique cream.
 *
 * The house canvas is AGED warm paper, not a flat fill (DESIGN.md §1, §5):
 * depth comes from a layered cream plus this faint tooth. On the web export the
 * `paper` / `paper-card` className utilities (global.css) paint a CSS fleck
 * gradient; React Native has no per-view gradient, so a native screen drops this
 * primitive as an absolute-fill overlay of near-invisible warm flecks built from
 * plain Views — no SVG, no image, no native dependency.
 *
 * It is pure decoration: `pointerEvents="none"` so it never eats a touch, and
 * hidden from the accessibility tree. The flecks are a deterministic sparse
 * field (a fixed pseudo-random pattern, not re-rolled per render) so the grain
 * is stable across renders and identical on every device — an antique sheet, not
 * TV static. Opacity is a hair above nothing; it must never touch contrast.
 *
 * Usage: place once as the first child of a screen root that fills the canvas,
 * behind the content. The content sits above it in normal flow.
 *
 *   <View className="flex-1 bg-background">
 *     <PaperGrain />
 *     …screen…
 *   </View>
 */
import { type ReactNode, useMemo } from "react"
import { StyleSheet, View, type ViewStyle } from "react-native"

import { useW14Theme } from "@/warehouse14/theme"

export interface PaperGrainProps {
  /**
   * Which surface the grain sits over — picks the fleck tint + density:
   *   "paper" (default) — over the app background canvas.
   *   "card"            — over a raised card/sheet (a touch fainter).
   */
  surface?: "paper" | "card"
  /**
   * Overall opacity multiplier on the whole grain layer (0..1). Default 1 keeps
   * the already-faint base; lower it for an even quieter panel. Never raise the
   * base flecks — the texture must stay below the threshold that affects text.
   */
  intensity?: number
}

/**
 * A fixed, deterministic sparse fleck field over a 100×100 normalised cell that
 * is tiled by the absolute layout. Coordinates are pre-rolled percentages so the
 * pattern is stable (no Math.random at render) and reads as paper, not noise.
 * Each entry: [leftPct, topPct, sizePx, toneStep] where toneStep 0 = darker
 * warm fleck, 1 = lighter warm fleck.
 */
const FLECKS: ReadonlyArray<readonly [number, number, number, 0 | 1]> = [
  [4, 7, 1.5, 0],
  [12, 22, 1, 1],
  [9, 41, 1.5, 0],
  [17, 63, 1, 1],
  [6, 84, 1.5, 0],
  [23, 11, 1, 1],
  [28, 34, 1.5, 0],
  [33, 57, 1, 1],
  [26, 78, 1.5, 0],
  [38, 92, 1, 1],
  [44, 16, 1.5, 0],
  [49, 38, 1, 1],
  [42, 51, 1.5, 0],
  [54, 69, 1, 1],
  [47, 87, 1.5, 0],
  [61, 9, 1, 1],
  [66, 28, 1.5, 0],
  [59, 46, 1, 1],
  [71, 61, 1.5, 0],
  [64, 81, 1, 1],
  [77, 18, 1.5, 0],
  [82, 36, 1, 1],
  [74, 54, 1.5, 0],
  [87, 72, 1, 1],
  [79, 94, 1.5, 0],
  [93, 13, 1, 1],
  [96, 44, 1.5, 0],
  [89, 66, 1, 1],
  [98, 88, 1.5, 0],
  [2, 31, 1, 1],
  [14, 49, 1.5, 0],
  [31, 24, 1, 1],
  [52, 4, 1.5, 0],
  [69, 39, 1, 1],
  [84, 56, 1.5, 0],
] as const

export function PaperGrain({ surface = "paper", intensity = 1 }: PaperGrainProps): ReactNode {
  const { isDark } = useW14Theme()

  const flecks = useMemo(() => {
    // Warm fleck tints. Light theme: a faint walnut-brown tooth over cream.
    // Dark theme: a faint amber tooth over walnut — same warmth, lifted.
    const darkTone = isDark ? "rgba(216,177,78," : "rgba(120,98,40,"
    const lightTone = isDark ? "rgba(233,231,225," : "rgba(255,250,240,"
    // Base alphas: well below the threshold that could shift perceived contrast.
    const baseDarkA = (surface === "card" ? 0.02 : 0.03) * intensity
    const baseLightA = (surface === "card" ? 0.015 : 0.022) * intensity
    // Build the full per-fleck ViewStyle here (not in JSX) so each <View>
    // receives a precomputed style object — same dynamic-style pattern the spine
    // uses (Skeleton). Position/size/colour are data-driven, never magic.
    return FLECKS.map(([left, top, size, toneStep]): ViewStyle => {
      const color = toneStep === 0 ? `${darkTone}${baseDarkA})` : `${lightTone}${baseLightA})`
      return {
        position: "absolute",
        left: `${left}%`,
        top: `${top}%`,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
      }
    })
  }, [isDark, surface, intensity])

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {flecks.map((style, i) => (
        <View key={i} style={style} />
      ))}
    </View>
  )
}
