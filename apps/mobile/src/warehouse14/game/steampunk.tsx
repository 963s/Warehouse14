/**
 * Dashboard metric tiles — the owner's game dashboard. Each tile is a
 * parchment card with a real metric (from the same endpoints the current
 * dashboard uses), rendered in the store's design language.
 *
 * The visual language: parchment cards (the light-mode ground), a single
 * warm hairline border (the sanctioned edge use), mono numerals, and a
 * single functional colour per tile (verdigris for met/near-met, wax-red
 * for behind).
 *
 * The 12 panels mirror the owner's reference image:
 *   Tagesumsatz, Monatsumsatz, Fixkosten, Silberbestand, Goldbestand,
 *   Gewinn heute, Ankäufe heute, Verkaufte Artikel, Lagerwert,
 *   Expertisen, Monatsziele, Gesamtübersicht.
 *
 * Each tile gets a REAL number from the existing dashboard queries. When a
 * number is not available, the tile shows a clean "Gesperrt" state, never a
 * fabricated number.
 *
 * Previously these tiles used darkPalette (dark umber panels on the light
 * dashboard — a steampunk aesthetic that clashed with the store's parchment
 * identity). Now they use the light palette consistently.
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import { Text } from "@/components/ui/text"
import { lightPalette } from "@/warehouse14/theme"
import { CountUp } from "@/warehouse14/ui"

/** A metric gauge tile: the metric as a big mono number + a horizontal gauge
 *  bar + the target as a small hint. The bar fills verdigris (met), gilt
 *  (near), or wax-red (behind). */
export interface SteampunkTileProps {
  label: string
  value: number
  format: (v: number) => string
  target: string
  ratio: number // 0..1+ (current / target)
  /** Optional leading icon node (e.g. <MetalIcon metal="GOLD" />) */
  icon?: ReactNode
}

function ratioTone(ratio: number): string {
  if (ratio >= 1) return lightPalette.verdigris // met — sage
  if (ratio >= 0.7) return lightPalette.gilt // near — gilt
  return lightPalette.destructive // behind — wax-red
}

export function SteampunkTile({ label, value, format, target, ratio, icon }: SteampunkTileProps): ReactNode {
  const tone = ratioTone(ratio)
  const pct = Math.min(Math.round(ratio * 100), 100)

  return (
    <View
      style={{
        width: "48%",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: lightPalette.border,
        backgroundColor: lightPalette.card,
        padding: 14,
        gap: 6,
      }}
    >
      {/* Label row — optional icon + Bricolage medium panel title */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {icon ? <View style={{ marginRight: 2 }}>{icon}</View> : null}
        <Text
          numberOfLines={1}
          style={{ color: lightPalette.mutedForeground, fontSize: 12, fontFamily: "BricolageGrotesque_500Medium", flexShrink: 1 }}
        >
          {label}
        </Text>
      </View>

      {/* The big number — mono, the metric */}
      <CountUp
        value={value}
        format={format}
        style={{ color: lightPalette.foreground, fontSize: 22, fontFamily: "JetBrainsMono_500Medium" }}
      />

      {/* The gauge bar — a horizontal fill in the tone colour */}
      <View style={{ height: 5, borderRadius: 2.5, backgroundColor: lightPalette.raised, overflow: "hidden", marginTop: 2 }}>
        <View
          style={{
            height: "100%",
            width: `${pct}%`,
            backgroundColor: tone,
            borderRadius: 2.5,
          }}
        />
      </View>

      {/* Target hint */}
      <Text style={{ color: lightPalette.mutedForeground, fontSize: 11, fontFamily: "JetBrainsMono_400Regular" }}>
        {pct} % vom Ziel {target}
      </Text>
    </View>
  )
}

/** A "locked" tile — clean when data is unavailable. */
export function SteampunkLockedTile({ label }: { label: string }): ReactNode {
  return (
    <View
      style={{
        width: "48%",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: lightPalette.border,
        backgroundColor: lightPalette.card,
        padding: 14,
        gap: 6,
        minHeight: 90,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Text style={{ color: lightPalette.mutedForeground, fontSize: 12, fontFamily: "BricolageGrotesque_500Medium" }}>
        {label}
      </Text>
      <Text style={{ color: lightPalette.mutedForeground, fontSize: 13 }}>Gesperrt</Text>
    </View>
  )
}

/**
 * The treasure-map panel — a wide parchment card showing the overall
 * goal achievement as a percentage + a simple route from "Start" to "X marks
 * the spot" (the profit goal). The "path" is a dotted line. Honest:
 * the percentage is the real average of the individual tile ratios.
 */
export function SteampunkTreasureMap({ pct, label }: { pct: number; label: string }): ReactNode {
  const reached = pct >= 1
  const tone = reached ? lightPalette.verdigris : lightPalette.gilt
  return (
    <View
      style={{
        width: "100%",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: lightPalette.border,
        backgroundColor: lightPalette.card,
        padding: 18,
        gap: 10,
      }}
    >
      <Text style={{ color: lightPalette.mutedForeground, fontSize: 12, fontFamily: "BricolageGrotesque_500Medium" }}>
        Gesamtübersicht
      </Text>
      {/* The big percentage — the overall goal achievement */}
      <Text style={{ color: reached ? lightPalette.verdigris : lightPalette.foreground, fontSize: 30, fontFamily: "JetBrainsMono_500Medium" }}>
        {Math.round(pct * 100)} %
      </Text>
      <Text style={{ color: lightPalette.mutedForeground, fontSize: 13 }}>{label}</Text>
      {/* The dotted path: Start ──────── X */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
        <Text style={{ color: lightPalette.mutedForeground, fontSize: 11, fontFamily: "JetBrainsMono_400Regular" }}>Start</Text>
        <View
          style={{
            flex: 1,
            height: 2,
            borderRadius: 1,
            backgroundColor: reached ? lightPalette.verdigris : lightPalette.border,
          }}
        />
        <Text style={{ color: tone, fontSize: 13, fontWeight: "700" }}>X</Text>
      </View>
    </View>
  )
}

/** The grid container — tiles in a 2-column scroll on parchment. */
export function SteampunkGrid({ children }: { children: ReactNode }): ReactNode {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {children}
      </View>
    </View>
  )
}
