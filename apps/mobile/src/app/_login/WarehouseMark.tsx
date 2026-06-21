/**
 * WarehouseMark — the Owner OS brand mark for the login + intro surfaces.
 *
 * This is the one place the app shows its face, so it shows the GENUINE shop
 * logo — the same WAREHOUSE 14 mark the cashier already sees on the POS, shipped
 * as `splash-logo.png` (the brass-on-transparent rasterisation of
 * apps/tauri-pos/public/shop-logo.svg) — not an invented glyph. Seating it on
 * the login continues the splash seamlessly: the owner watches the very same
 * mark settle from the launch screen into the medallion.
 *
 * The medallion is built only from `View`s + theme tokens around the real logo
 * image: a soft brass radial bloom, two concentric hairline rings (the outer in
 * decorative gold, never under text), and a brass-tinted disc that seats the
 * mark. On the `lg` hero it breathes once on entrance — a single settled scale
 * pop from the emphasis spring — and then holds perfectly still (calm, never a
 * loop). Reduce-motion renders it static.
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
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated"

import { useW14Theme } from "@/warehouse14/theme"
import { duration, easing, emphasisSpring, useReduceMotion } from "@/warehouse14/ui"

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
  const bloom = lg ? 220 : 64
  const logo = lg ? 92 : 30

  // Entrance: the disc settles with one emphasis spring (hero only); the bloom
  // fades up just behind it so depth arrives a beat after the mark. Static on
  // reduce-motion. Never loops — premium is calm, not busy.
  const scale = useSharedValue(reduceMotion || !lg ? 1 : 0.92)
  const glow = useSharedValue(reduceMotion || !lg ? 1 : 0)
  useEffect(() => {
    if (reduceMotion || !lg) return
    scale.value = withSpring(1, emphasisSpring)
    glow.value = withDelay(
      duration.fast,
      withTiming(1, { duration: duration.slow, easing: easing.standard }),
    )
    // Run once on mount; the values are seeded for the static case above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const discStyle = useAnimatedStyle(() => {
    "worklet"
    return { transform: [{ scale: scale.value }] }
  })
  const bloomStyle = useAnimatedStyle(() => {
    "worklet"
    return { opacity: glow.value }
  })

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: ring, height: ring, alignItems: "center", justifyContent: "center" }}
    >
      {/* Brass radial bloom — soft depth behind the medallion. A stack of fading
          rings approximates a glow without a gradient dependency; gold-tinted,
          purely decorative, never behind text. */}
      {lg ? (
        <Animated.View
          pointerEvents="none"
          style={[
            bloomStyle,
            {
              position: "absolute",
              width: bloom,
              height: bloom,
              alignItems: "center",
              justifyContent: "center",
            },
          ]}
        >
          {[1, 0.74, 0.5].map((scaleF, i) => (
            <View
              key={i}
              style={{
                position: "absolute",
                width: bloom * scaleF,
                height: bloom * scaleF,
                borderRadius: (bloom * scaleF) / 2,
                backgroundColor: t.colors.primary,
                opacity: t.isDark ? 0.05 : 0.04,
              }}
            />
          ))}
        </Animated.View>
      ) : null}

      {/* Outer decorative gold ring — a single hairline flourish. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: lg ? 1.5 : 1,
          borderColor: `${t.colors.gold}59`,
        }}
      />

      {/* Inner brass hairline, just inside the gold — a second concentric line
          that gives the medallion engraved depth. */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          width: ring - (lg ? 9 : 4),
          height: ring - (lg ? 9 : 4),
          borderRadius: ring / 2,
          borderWidth: 1,
          borderColor: `${t.colors.primary}33`,
        }}
      />

      {/* The brass-tinted disc that seats the real logo. */}
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
