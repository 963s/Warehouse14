/**
 * AchievementTimeline — the chronological „Meilensteine" of the shop.
 *
 * Pure presentational over the merged milestone entries (erfolge-ui →
 * buildMilestoneTimeline), newest first. Each entry is a rank-up („Zum X
 * aufgestiegen") or a seal earned („Siegel ‚…' verdient"), with the real day it
 * happened, drawn as a connected vertical timeline (a tinted node + a hairline
 * spine), so the owner reads their history top-to-bottom. Nothing is fabricated —
 * every date is a real finalized closing; with no milestones the surface renders
 * its honest empty state instead of this list.
 *
 * Built on the spine (Card, tokens). A rank-up node is brass (the bigger event);
 * a seal node is verdigris. Gold is never under text.
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import { Award, BadgeCheck, type LucideIcon } from "lucide-react-native"

import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { formatHistoryDate, type MilestoneEntry } from "./erfolge-ui"

const KIND_ICON: Record<MilestoneEntry["kind"], LucideIcon> = {
  "rank-up": Award,
  seal: BadgeCheck,
}

export interface AchievementTimelineProps {
  /** The merged, newest-first milestone entries (buildMilestoneTimeline). */
  entries: readonly MilestoneEntry[]
  /** Max rows to render (the rest are summarised). Default 8. */
  limit?: number
}

export function AchievementTimeline({ entries, limit = 8 }: AchievementTimelineProps): ReactNode {
  const shown = entries.slice(0, Math.max(0, limit))
  const hidden = entries.length - shown.length

  return (
    <Card className="gap-0 px-4 py-4">
      {shown.map((entry, i) => (
        <TimelineRow
          key={entry.key}
          entry={entry}
          first={i === 0}
          last={i === shown.length - 1 && hidden === 0}
        />
      ))}
      {hidden > 0 ? (
        <Text className="text-muted-foreground text-2xs mt-1.5" numberOfLines={1}>
          und {hidden} {hidden === 1 ? "weiterer Meilenstein" : "weitere Meilensteine"}
        </Text>
      ) : null}
    </Card>
  )
}

function TimelineRow({
  entry,
  first,
  last,
}: {
  entry: MilestoneEntry
  first: boolean
  last: boolean
}): ReactNode {
  const t = useW14Theme()
  const Icon = KIND_ICON[entry.kind]
  const accent = entry.kind === "rank-up" ? t.colors.primary : t.colors.verdigris

  return (
    <View
      className="flex-row gap-3"
      accessibilityRole="text"
      accessibilityLabel={`${entry.title}, ${formatHistoryDate(entry.businessDay)}`}
    >
      {/* The spine: a hairline above/below the node, hidden at the ends. */}
      <View className="items-center" style={{ width: 28 }}>
        <View
          style={{
            width: 1,
            height: 8,
            backgroundColor: first ? "transparent" : t.colors.border,
          }}
        />
        <View
          className="items-center justify-center rounded-full"
          style={{ width: 28, height: 28, backgroundColor: accent + "1f" }}
        >
          <Icon size={t.icon.sm} color={accent} />
        </View>
        <View
          style={{
            width: 1,
            flex: 1,
            minHeight: 8,
            backgroundColor: last ? "transparent" : t.colors.border,
          }}
        />
      </View>

      <View className="flex-1 pb-3 pt-1.5">
        <Text className="text-base font-semibold" numberOfLines={1}>
          {entry.title}
        </Text>
        <Text className="text-muted-foreground text-xs" numberOfLines={2}>
          {entry.detail}
        </Text>
        <Text className="text-muted-foreground text-2xs mt-0.5" numberOfLines={1}>
          {formatHistoryDate(entry.businessDay)}
        </Text>
      </View>
    </View>
  )
}
