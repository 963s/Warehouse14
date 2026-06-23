/**
 * Steampunk dashboard tiles — the owner's game dashboard. Each tile is a panel
 * with a real metric (from the same endpoints the current dashboard uses),
 * rendered in a steampunk aesthetic on the design system.
 *
 * The visual language: dark warm-umber panels (the dark-mode ground, but even
 * in light mode the panels sit on a deep umber backdrop for contrast), gilt
 * thread borders (the sanctioned edge use), mono numerals, and a single
 * functional colour per tile (verdigris for met/near-met, wax-red for behind).
 *
 * The 12 panels mirror the owner's reference image:
 *   Tagesumsatz, Monatsumsatz, Fixkosten, Silberbestand, Goldbestand,
 *   Gewinn heute, Ankäufe heute, Verkaufte Artikel, Lagerwert,
 *   Expertisen, Monatsziele, Gesamtübersicht.
 *
 * Each tile gets a REAL number from the existing dashboard queries. When a
 * number is not available, the tile shows a clean "Gesperrt" state, never a
 * fabricated number.
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { CountUp } from "@/warehouse14/ui"

/** A steampunk gauge tile: the metric as a big mono number + a circular gauge
 *  ring + the target as a small hint. The ring fills verdigris (met), gilt
 *  (near), or wax-red (behind). */
export interface SteampunkTileProps {
  label: string
  value: number
  format: (v: number) => string
  target: string
  ratio: number // 0..1+ (current / target)
}

function ratioTone(ratio: number): { color: string; bg: string } {
  if (ratio >= 1) return { color: "#7bc4a0", bg: "#7bc4a01f" }
  if (ratio >= 0.7) return { color: "#c9a55c", bg: "#c9a55c1f" }
  return { color: "#e07a5e", bg: "#e07a5e1f" }
}

export function SteampunkTile({ label, value, format, target, ratio }: SteampunkTileProps): ReactNode {
  const tone = ratioTone(ratio)
  const pct = Math.min(Math.round(ratio * 100), 100)

  return (
    <View
      style={{
        width: "48%",
        borderRadius: 10,
        borderWidth: 1,
        borderColor: "#3a342a",
        backgroundColor: "#232019",
        padding: 12,
        gap: 6,
      }}
    >
      {/* Label — gilt small-caps, the steampunk panel title */}
      <Text
        numberOfLines={1}
        style={{ color: "#c9a55c", fontSize: 10, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase" }}
      >
        {label}
      </Text>

      {/* The big number — mono, the metric */}
      <CountUp
        value={value}
        format={format}
        style={{ color: "#efece3", fontSize: 22, fontFamily: "JetBrainsMono_500Medium" }}
      />

      {/* The gauge bar — a horizontal fill in the tone colour */}
      <View style={{ height: 6, borderRadius: 3, backgroundColor: "#100e0a", overflow: "hidden" }}>
        <View
          style={{
            height: "100%",
            width: `${pct}%`,
            backgroundColor: tone.color,
            borderRadius: 3,
          }}
        />
      </View>

      {/* Target hint */}
      <Text style={{ color: "#a39d90", fontSize: 9, fontFamily: "JetBrainsMono_400Regular" }}>
        {pct}% · Ziel {target}
      </Text>
    </View>
  )
}

/** A steampunk "locked" tile — clean when data is unavailable. */
export function SteampunkLockedTile({ label }: { label: string }): ReactNode {
  return (
    <View
      style={{
        width: "48%",
        borderRadius: 10,
        borderWidth: 1,
        borderColor: "#3a342a",
        backgroundColor: "#232019",
        padding: 12,
        gap: 6,
        minHeight: 90,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Text style={{ color: "#a39d90", fontSize: 10, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase" }}>
        {label}
      </Text>
      <Text style={{ color: "#6e6b64", fontSize: 11 }}>Gesperrt</Text>
    </View>
  )
}

/** The steampunk grid container — 12 tiles in a 2-column scroll on umber. */
export function SteampunkGrid({ children }: { children: ReactNode }): ReactNode {
  return (
    <View style={{ backgroundColor: "#1a1712", padding: 8, gap: 8, borderRadius: 12 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {children}
      </View>
    </View>
  )
}
