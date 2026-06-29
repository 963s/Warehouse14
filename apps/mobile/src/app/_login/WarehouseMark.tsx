/**
 * WarehouseMark — the Owner OS brand mark for the login + intro surfaces.
 *
 * This is the one place the app shows its face, so it shows the GENUINE shop
 * logo — the same WAREHOUSE 14 mark the cashier already sees on the POS, shipped
 * as `splash-logo.png` (the logo-on-transparent rasterisation of
 * apps/tauri-pos/public/shop-logo.svg) — not an invented glyph. Seating it on
 * the login continues the splash seamlessly: the owner watches the very same
 * mark settle from the launch screen into the medallion.
 *
 * The medallion is built only from `View`s + theme tokens around the real logo
 * image: a parchment disc that seats the mark, two concentric hairline rings
 * (the outer in decorative gilt, never under text), and the logo itself. On
 * the `lg` hero it breathes once on entrance — a single settled scale pop from
 * the emphasis spring — and then holds perfectly still (calm, never a loop).
 * Reduce-motion renders it static.
 *
 * Honesty: purely a brand surface. It is decorative for accessibility (the
 * screen titles carry the real, readable label), so it never competes with the
 * copy a screen reader announces.
 */
import { useEffect, type ReactNode } from "react"
import { Image } from "react-native"
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated"

import { emphasisSpring, useReduceMotion } from "@/warehouse14/ui"

// The genuine shop mark, brass on transparent (same asset as the splash) — the
// single source of truth for the brand everywhere in the app.
const LOGO = require("../../../assets/images/splash-logo.png")

export interface WarehouseMarkProps {
  /** `lg` — the login hero (breathes in); `sm` — the intro top-bar mark. */
  size?: "sm" | "lg"
}

export function WarehouseMark({ size = "lg" }: WarehouseMarkProps): ReactNode {
  const reduceMotion = useReduceMotion()
  const lg = size === "lg"

  // No medallion frame — the owner asked for the genuine WAREHOUSE 14 mark on
  // its own, not a disc or gilt ring around it. The asset is the framed brass
  // emblem; it carries itself on the warm paper ground.
  const mark = lg ? 251 : 48

  // Entrance: the disc settles with one emphasis spring (hero only). Static on
  // reduce-motion. Never loops — premium is calm, not busy.
  const scale = useSharedValue(reduceMotion || !lg ? 1 : 0.92)
  useEffect(() => {
    if (reduceMotion || !lg) return
    scale.value = withSpring(1, emphasisSpring)
    // Run once on mount; the value is seeded for the static case above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const discStyle = useAnimatedStyle(() => {
    "worklet"
    return { transform: [{ scale: scale.value }] }
  })

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={discStyle}
    >
      {/* The genuine WAREHOUSE 14 mark on its own — no disc, no gilt ring. The
          asset is the framed brass emblem; it carries itself on the warm paper
          ground and breathes in once on mount (hero only). */}
      <Image
        source={LOGO}
        accessibilityIgnoresInvertColors
        resizeMode="contain"
        style={{ width: mark, height: mark }}
      />
    </Animated.View>
  )
}
