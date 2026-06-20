/**
 * StreakFlame — the «Serie» at a glance.
 *
 * Pure presentational over a StreakSummary (game/streak.ts → computeStreakSummary).
 * A flame glyph with the current run length, an honest state line (geschafft /
 * at-risk / no prior day), and the longest-run «Bestmarke» when one exists. The
 * flame burns brass while the run is alive and dims to muted when today is still
 * at risk — colour says the same thing as the copy. Nothing fabricated: 0 is
 * honestly "noch keine Serie".
 *
 * "sm" is a compact header chip (flame + number); "md" adds the state + Bestmarke
 * lines for a card. Tokens only.
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import { Flame } from "lucide-react-native"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { type StreakSummary } from "./streak"

export interface StreakFlameProps {
  /** The streak summary to render. */
  streak: StreakSummary
  /** "sm" = compact chip, "md" = full card body. Default "md". */
  size?: "sm" | "md"
}

function stateLine(s: StreakSummary): string {
  if (s.current <= 0) {
    return s.todayState === "kein-vortag" ? "Noch kein Vortag" : "Noch keine Serie"
  }
  const days = `${s.current} ${s.current === 1 ? "Tag" : "Tage"} in Folge`
  if (s.todayState === "geschafft") return `${days} · heute gehalten`
  if (s.todayState === "offen") return `${days} · heute noch offen`
  return days
}

export function StreakFlame({ streak, size = "md" }: StreakFlameProps): ReactNode {
  const t = useW14Theme()
  const isSm = size === "sm"
  // The flame burns brass while the run is alive and not at risk; it dims when
  // today still needs to beat yesterday, and is muted at 0.
  const alive = streak.current > 0
  const flameColor = !alive ? t.colors.mutedForeground : streak.atRisk ? t.colors.gold : t.colors.primary
  const glyph = isSm ? 16 : 22

  if (isSm) {
    return (
      <View
        className="flex-row items-center gap-1"
        accessibilityLabel={`Serie: ${streak.current} ${streak.current === 1 ? "Tag" : "Tage"}`}
      >
        <Flame size={glyph} color={flameColor} />
        <Text className="font-mono text-sm font-bold" style={{ color: flameColor }}>
          {streak.current}
        </Text>
      </View>
    )
  }

  return (
    <View className="flex-row items-center gap-3">
      <View
        className="items-center justify-center rounded-md"
        style={{ width: 44, height: 44, backgroundColor: flameColor + "1f" }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Flame size={glyph} color={flameColor} />
      </View>
      <View className="flex-1">
        <View className="flex-row items-baseline gap-1.5">
          <Text className="font-mono text-2xl font-bold" style={{ color: flameColor }}>
            {streak.current}
          </Text>
          <Text className="text-muted-foreground text-xs">
            {streak.current === 1 ? "Tag" : "Tage"} Serie
          </Text>
        </View>
        <Text className="text-muted-foreground text-xs" numberOfLines={1}>
          {stateLine(streak)}
        </Text>
        {streak.longest > streak.current && streak.longest > 0 ? (
          <Text className="text-muted-foreground mt-0.5" style={{ fontSize: 11 }} numberOfLines={1}>
            Bestmarke: {streak.longest} {streak.longest === 1 ? "Tag" : "Tage"}
          </Text>
        ) : null}
      </View>
    </View>
  )
}
