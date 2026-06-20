/**
 * SealGrid — the wall of brass Siegel, earned vs still-locked.
 *
 * Pure presentational over the evaluated seals (game/seals.ts → evaluateSeals).
 * An earned seal shows its lucide glyph in a brass chip with its title in full
 * ink; a locked seal is a faint dashed outline with a muted glyph and a thin
 * progress bar showing how close it is — honest, never a fabricated reward. A
 * fresh shop sees a wall of honest outlines, which is the point.
 *
 * Layout is a simple wrapped grid of fixed-width tiles, so it composes inside a
 * SectionCard without measuring. Tokens only; gold is never placed under text —
 * the brass `primary` carries the earned state.
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import {
  BookCheck,
  CalendarCheck,
  Flame,
  Scale,
  Sparkles,
  Trophy,
  type LucideIcon,
} from "lucide-react-native"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { type SealIcon, type SealState } from "./seals"

/** Resolve a seal's lucide icon id to the component. */
const SEAL_ICON: Record<SealIcon, LucideIcon> = {
  Sparkles,
  Flame,
  CalendarCheck,
  Trophy,
  Scale,
  BookCheck,
}

export interface SealGridProps {
  /** The evaluated seals (earned flag + progress), in display order. */
  seals: SealState[]
}

export function SealGrid({ seals }: SealGridProps): ReactNode {
  return (
    <View className="flex-row flex-wrap" style={{ marginHorizontal: -4 }}>
      {seals.map((s) => (
        <View key={s.definition.id} style={{ width: "33.333%", padding: 4 }}>
          <SealTile state={s} />
        </View>
      ))}
    </View>
  )
}

function SealTile({ state }: { state: SealState }): ReactNode {
  const t = useW14Theme()
  const Icon = SEAL_ICON[state.definition.icon]
  const earned = state.earned
  const pct = Math.round(state.progress * 100)

  return (
    <View
      className="items-center gap-1.5 rounded-md px-2 py-3"
      style={{
        backgroundColor: earned ? t.colors.primary + "14" : "transparent",
        borderWidth: 1,
        borderColor: earned ? t.colors.primary + "33" : t.colors.border,
        borderStyle: earned ? "solid" : "dashed",
        opacity: earned ? 1 : 0.9,
      }}
      accessibilityRole="image"
      accessibilityLabel={
        earned
          ? `Siegel erhalten: ${state.definition.title}`
          : `Siegel gesperrt: ${state.definition.title}, ${pct} Prozent`
      }
    >
      <View
        className="items-center justify-center rounded-full"
        style={{
          width: 36,
          height: 36,
          backgroundColor: earned ? t.colors.primary + "1f" : t.colors.border + "66",
        }}
      >
        <Icon size={20} color={earned ? t.colors.primary : t.colors.mutedForeground} />
      </View>

      <Text
        className="text-center text-xs font-semibold"
        style={earned ? undefined : { color: t.colors.mutedForeground }}
        numberOfLines={2}
      >
        {state.definition.title}
      </Text>

      {/* Locked seals show a faint progress sliver; earned seals don't need it. */}
      {!earned ? (
        <View
          className="w-full overflow-hidden rounded-full"
          style={{ height: 3, backgroundColor: t.colors.border }}
        >
          <View
            style={{
              height: "100%",
              width: `${pct}%`,
              backgroundColor: t.colors.mutedForeground,
            }}
          />
        </View>
      ) : null}
    </View>
  )
}
