/**
 * RankBadge — the owner's standing as a small brass crest.
 *
 * Pure presentational over a RankProgress (game/ranks.ts → rankProgress). Shows
 * the rank's icon in a brass chip, the German title, and a row of tier dots (the
 * ladder Lehrling → Schatzmeister), with the held tier filled brass and higher
 * tiers as faint outlines. An optional `next` hint reads honestly ("noch 2 Tage
 * bis Goldschmied") straight from the real `toNextStreak`. No fabricated value:
 * everything shown is derived from a real streak the caller passed in.
 *
 * Sizes: "sm" for a header chip, "md" for a card hero. Gold is never used behind
 * text — the brass `primary` carries the crest; tokens only, no hardcoded hex.
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import { Award, Crown, Gem, Hammer, Medal, type LucideIcon } from "lucide-react-native"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { RANKS, type RankId, type RankProgress } from "./ranks"

/** lucide crest per rank, lowest → highest. */
const RANK_ICON: Record<RankId, LucideIcon> = {
  lehrling: Hammer,
  geselle: Medal,
  goldschmied: Gem,
  meister: Award,
  schatzmeister: Crown,
}

export interface RankBadgeProps {
  /** The rank standing to render (from rankProgress). */
  rank: RankProgress
  /** "sm" = compact header chip, "md" = card hero. Default "md". */
  size?: "sm" | "md"
  /** Show the "noch X Tage bis …"-hint under the title (default true at md). */
  showNext?: boolean
}

export function RankBadge({ rank, size = "md", showNext }: RankBadgeProps): ReactNode {
  const t = useW14Theme()
  const Icon = RANK_ICON[rank.current.id]
  const isSm = size === "sm"
  const chip = isSm ? 28 : 44
  const glyph = isSm ? 16 : 24
  const withNext = showNext ?? !isSm

  const nextHint =
    rank.next != null && rank.toNextStreak > 0
      ? `Noch ${rank.toNextStreak} ${rank.toNextStreak === 1 ? "Tag" : "Tage"} bis ${rank.next.title}`
      : rank.next == null
        ? "Höchster Rang erreicht"
        : null

  return (
    <View className="flex-row items-center gap-3">
      <View
        className="items-center justify-center rounded-md"
        style={{ width: chip, height: chip, backgroundColor: t.colors.primary + "1f" }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon size={glyph} color={t.colors.primary} />
      </View>

      <View className="flex-1">
        <Text
          className={isSm ? "text-sm font-semibold" : "text-lg font-bold"}
          numberOfLines={1}
          accessibilityLabel={`Rang: ${rank.current.title}`}
        >
          {rank.current.title}
        </Text>

        {!isSm ? (
          <Text className="text-muted-foreground text-xs" numberOfLines={2}>
            {rank.current.description}
          </Text>
        ) : null}

        {/* Tier dots the held tier filled, higher tiers faint outlines. */}
        <View className="mt-1.5 flex-row items-center gap-1.5">
          {RANKS.map((r) => {
            const reached = r.tier <= rank.current.tier
            return (
              <View
                key={r.id}
                className="rounded-full"
                style={{
                  width: 6,
                  height: 6,
                  backgroundColor: reached ? t.colors.primary : "transparent",
                  borderWidth: reached ? 0 : 1,
                  borderColor: t.colors.border,
                }}
              />
            )
          })}
        </View>

        {withNext && nextHint != null ? (
          <Text className="text-muted-foreground text-2xs mt-1" numberOfLines={1}>
            {nextHint}
          </Text>
        ) : null}
      </View>
    </View>
  )
}
