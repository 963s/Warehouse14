/**
 * StreakHistoryList — every historical „Serie", as an honest run timeline.
 *
 * Pure presentational over the runs from game/history.ts (computeGameHistory →
 * runs, already sorted longest-first). Each row is one run: a flame glyph, its
 * length in days, its date span, the peak rank it reached, and a proportional bar
 * measured against the LONGEST run on record (so the wall reads as a real ranking
 * of the shop's best stretches). The still-live current run is marked „Läuft".
 * Nothing is fabricated — every length and date is a real finalized day.
 *
 * Built on the spine (Card, RingGauge-style bar, tokens). Brass carries the run;
 * verdigris marks the live one; gold is never under text.
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import { Flame } from "lucide-react-native"

import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { daysLabel, formatRunSpan } from "./erfolge-ui"
import { type StreakRun } from "./history"

export interface StreakHistoryListProps {
  /** The historical runs, longest-first (computeGameHistory.runs). */
  runs: readonly StreakRun[]
  /** The longest run length on record — the bar's denominator. */
  longestRun: number
  /** Max rows to render (the rest are summarised). Default 6. */
  limit?: number
}

export function StreakHistoryList({
  runs,
  longestRun,
  limit = 6,
}: StreakHistoryListProps): ReactNode {
  const shown = runs.slice(0, Math.max(0, limit))
  const hidden = runs.length - shown.length
  const denom = longestRun > 0 ? longestRun : 1

  return (
    <Card className="gap-3 px-4 py-4">
      {shown.map((run, i) => (
        <RunRow key={`${run.startDay}-${run.endDay}-${i}`} run={run} ratio={run.length / denom} />
      ))}
      {hidden > 0 ? (
        <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
          und {hidden} {hidden === 1 ? "weitere Serie" : "weitere Serien"}
        </Text>
      ) : null}
    </Card>
  )
}

function RunRow({ run, ratio }: { run: StreakRun; ratio: number }): ReactNode {
  const t = useW14Theme()
  const accent = run.isCurrent ? t.colors.verdigris : t.colors.primary
  const pct = Math.max(0, Math.min(1, ratio)) * 100

  return (
    <View
      className="gap-1.5"
      accessibilityRole="text"
      accessibilityLabel={`Serie ${daysLabel(run.length)}, ${formatRunSpan(run)}, Rang ${run.peakRank.title}${run.isCurrent ? ", läuft" : ""}`}
    >
      <View className="flex-row items-center gap-2.5">
        <Flame size={t.icon.sm} color={accent} />
        <Text className="font-mono-medium text-base" style={{ color: accent }}>
          {run.length}
        </Text>
        <Text className="text-muted-foreground text-xs">{run.length === 1 ? "Tag" : "Tage"}</Text>
        <View className="flex-1" />
        {run.isCurrent ? (
          <View
            className="rounded-md px-1.5 py-0.5"
            style={{ backgroundColor: t.colors.verdigris + "1f" }}
          >
            <Text className="text-2xs font-semibold" style={{ color: t.colors.verdigris }}>
              Läuft
            </Text>
          </View>
        ) : (
          <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
            {run.peakRank.title}
          </Text>
        )}
      </View>

      {/* Proportional bar vs the longest run a real ranking of the best stretches. */}
      <View
        className="w-full overflow-hidden rounded-full"
        style={{ height: 6, backgroundColor: t.colors.border }}
      >
        <View style={{ height: "100%", width: `${pct}%`, backgroundColor: accent }} />
      </View>

      <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
        {formatRunSpan(run)}
      </Text>
    </View>
  )
}
