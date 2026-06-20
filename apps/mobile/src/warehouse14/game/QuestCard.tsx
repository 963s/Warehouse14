/**
 * QuestCard — today's daily quest, rendered honestly.
 *
 * Pure presentational over an ActiveQuest (game/quests.ts → activeQuestForDay).
 * Shows the quest icon, its German title + one-liner, a progress gauge, and a
 * de-DE value/target line in the quest's own unit (cents via formatCents, plain
 * counts otherwise). When the goal is met it flips to a verdigris "geschafft"
 * state. Nothing is fabricated — value is the live metric, target a known
 * constant or the real yesterday figure.
 *
 * Built on the spine's RingGauge + the de-DE money helper; tokens only.
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import { CircleCheckBig, Gem, Stamp, Swords, Tags, Target, type LucideIcon } from "lucide-react-native"

import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { formatCents } from "@/warehouse14/api"
import { RingGauge } from "@/warehouse14/ui/RingGauge"
import { useW14Theme } from "@/warehouse14/theme"
import { type ActiveQuest, type QuestIcon } from "./quests"

const QUEST_ICON: Record<QuestIcon, LucideIcon> = {
  Swords,
  Target,
  Gem,
  Tags,
  Stamp,
}

export interface QuestCardProps {
  /** The active quest to render. */
  quest: ActiveQuest
}

/** Format a quest value/target pair per its unit, de-DE, honest. */
function formatPair(quest: ActiveQuest): string {
  if (quest.unit === "cents") {
    return `${formatCents(quest.value)} / ${formatCents(quest.target)}`
  }
  if (quest.unit === "count-down") {
    // A backlog to clear: show how many remain above the target.
    const remaining = Math.max(0, quest.value - quest.target)
    return remaining === 1 ? "1 offen" : `${remaining} offen`
  }
  return `${quest.value} / ${quest.target}`
}

export function QuestCard({ quest }: QuestCardProps): ReactNode {
  const t = useW14Theme()
  const Icon = quest.done ? CircleCheckBig : QUEST_ICON[quest.icon]
  const accent = quest.done ? t.colors.verdigris : t.colors.primary

  return (
    <Card className="gap-3 px-4 py-4">
      <View className="flex-row items-center gap-2.5">
        <View
          className="h-8 w-8 items-center justify-center rounded-md"
          style={{ backgroundColor: accent + "1f" }}
        >
          <Icon size={18} color={accent} />
        </View>
        <View className="flex-1">
          <Text className="text-base font-semibold" numberOfLines={1}>
            {quest.title}
          </Text>
          <Text className="text-muted-foreground text-xs" numberOfLines={2}>
            {quest.done ? "Geschafft — heute erledigt." : quest.description}
          </Text>
        </View>
      </View>

      <RingGauge
        value={quest.progress}
        color={accent}
        label={formatPair(quest)}
        caption={
          quest.done
            ? "Tagesquest abgeschlossen"
            : quest.unit === "count-down"
              ? "noch abzuarbeiten"
              : "Fortschritt heute"
        }
      />
    </Card>
  )
}
