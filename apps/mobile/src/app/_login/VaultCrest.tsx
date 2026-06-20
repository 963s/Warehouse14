/**
 * VaultCrest — the Owner OS brand mark for the login + intro surfaces.
 *
 * A vault glyph seated in a soft brass-tinted disc with a hairline ring and a
 * single decorative gold arc. It is the one place the app shows its face, so it
 * leans on the brand colour (brass = `primary`, which carries the brand and any
 * meaning) and uses gold strictly as decoration — the arc carries no text and no
 * meaning the owner must read, exactly as the tokens allow (DESIGN.md §4).
 *
 * Built only from `View` + the lucide `Vault` glyph + theme tokens — no binary
 * asset, no hardcoded hex — so it themes cleanly in light and dark and stays
 * owned by this surface. Two sizes: `sm` for the intro top bar, `lg` the login
 * hero. Decorative for accessibility (the screen titles carry the real label).
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import { Vault } from "lucide-react-native"

import { useW14Theme } from "@/warehouse14/theme"

export interface VaultCrestProps {
  /** `lg` — the login hero; `sm` — the intro top-bar mark. Default `lg`. */
  size?: "sm" | "lg"
}

export function VaultCrest({ size = "lg" }: VaultCrestProps): ReactNode {
  const t = useW14Theme()
  const lg = size === "lg"

  const disc = lg ? 96 : 40
  const ring = lg ? 112 : 48
  const glyph = lg ? t.icon.xl + 14 : t.icon.lg

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: ring, height: ring, alignItems: "center", justifyContent: "center" }}
    >
      {/* Decorative gold arc — a single hairline ring, gold used purely as
          flourish (never under text, never load-bearing). */}
      <View
        style={{
          position: "absolute",
          width: ring,
          height: ring,
          borderRadius: ring / 2,
          borderWidth: lg ? 1.5 : 1,
          borderColor: `${t.colors.gold}66`,
        }}
      />
      {/* The brass-tinted disc that seats the glyph. */}
      <View
        style={{
          width: disc,
          height: disc,
          borderRadius: disc / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: t.colors.card,
          borderWidth: 1,
          borderColor: t.colors.border,
        }}
      >
        <Vault size={glyph} color={t.colors.primary} strokeWidth={lg ? 1.75 : 2} />
      </View>
    </View>
  )
}
