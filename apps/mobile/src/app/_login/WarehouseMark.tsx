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
import { Image, View } from "react-native"
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated"

import { useW14Theme } from "@/warehouse14/theme"
import { emphasisSpring, useReduceMotion } from "@/warehouse14/ui"

// The genuine shop mark, brass on transparent (same asset as the splash) — the
// single source of truth for the brand everywhere in the app.
const LOGO = require("../../../assets/images/splash-logo.png")

export interface WarehouseMarkProps {
  /** `lg` — the login hero (breathes in); `sm` — the intro top-bar mark. */
  size?: "sm" | "lg"
}

export function WarehouseMark({ size = "lg" }: WarehouseMarkProps): ReactNode {
  const t = useW14Theme()
  const reduceMotion = useReduceMotion()
  const lg = size === "lg"

  // Sizing scale — the hero is generous; the bar mark is compact.
  const disc = lg ? 132 : 44
  const ring = lg ? 150 : 50
  const logo = lg ? 92 : 30

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
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: ring, height: ring, alignItems: "center", justifyContent: "center" }}
    >
      {/* Bloom REMOVED the layered brass discs read as a glow behind the
          medallion, which the official store motion language forbids. The
          medallion now sits on the warm paper ground; depth comes from the
          concentric hairline rings below, never from a glow. */}
      {lg ? null : null}

      {/* Outer decorative gilt ring a single hairline flourish. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: lg ? 1.5 : 1,
          borderColor: `${t.colors.gilt}59`,
        }}
      />

      {/* Inner ink hairline, just inside the gilt a second concentric line
          that gives the medallion engraved depth. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: ring - (lg ? 9 : 4),
          height: ring - (lg ? 9 : 4),
          borderRadius: ring / 2,
          borderWidth: 1,
          borderColor: `${t.colors.foreground}26`,
        }}
      />

      {/* The parchment disc that seats the real logo. */}
      <Animated.View
        style={[
          discStyle,
          {
            width: disc,
            height: disc,
            borderRadius: disc / 2,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: t.colors.card,
            borderWidth: 1,
            borderColor: t.colors.border,
          },
        ]}
      >
        <Image
          source={LOGO}
          accessibilityIgnoresInvertColors
          resizeMode="contain"
          style={{
            width: logo,
            height: logo,
            // The asset is already brass; in light mode it carries itself, in
            // dark mode it reads warmly against the card. No tint so the genuine
            // mark stays exactly the colour the shop knows.
          }}
        />
      </Animated.View>
    </View>
  )
}
