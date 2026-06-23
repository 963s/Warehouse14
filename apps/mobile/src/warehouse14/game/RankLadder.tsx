/**
 * RankLadder — the full Aufstiegs-Leiter, every tier on one card.
 *
 * Where RankBadge is the compact crest, this is the WHOLE ladder for the Erfolge
 * surface: a row per rank (Lehrling → Schatzmeister), the held tier lit ink and
 * marked Aktuell, reached tiers in full ink, locked tiers dimmed with the streak
 * they unlock at. The held row carries a real progress gauge toward the next tier
 * (straight from rankProgress — never fabricated), and an honest „noch X Tage"
 * line. At the top rank the gauge is full and the line reads „Höchster Rang".
 *
 * Level-up celebration (DESIGN.md §6 emphasis spring): when `celebrate` is true,
 * the held tier's crest gives one settled brass pop on mount — the visual half of
 * the promotion moment (the screen fires the single Heavy haptic alongside). The
 * pop honours reduce-motion (no scale; the row is simply lit). Gold is never under
 * text — brass carries the held state; tokens only.
 */
import { type ReactNode, useEffect } from "react"
import { View } from "react-native"
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated"
import { Award, Check, Crown, Gem, Hammer, Lock, Medal, type LucideIcon } from "lucide-react-native"

import { Text } from "@/components/ui/text"
import { Card } from "@/components/ui/card"
import { RingGauge } from "@/warehouse14/ui/RingGauge"
import { duration, easing, emphasisSpring } from "@/warehouse14/ui/motion/tokens"
import { useReduceMotion } from "@/warehouse14/ui/motion/useReduceMotion"
import { useW14Theme } from "@/warehouse14/theme"
import { RANKS, type RankId, type RankProgress } from "./ranks"

/** lucide crest per rank, lowest → highest (mirrors RankBadge). */
const RANK_ICON: Record<RankId, LucideIcon> = {
  lehrling: Hammer,
  geselle: Medal,
  goldschmied: Gem,
  meister: Award,
  schatzmeister: Crown,
}

export interface RankLadderProps {
  /** The rank standing to render (from rankProgress). */
  rank: RankProgress
  /** Play the one-shot promotion pop on the held tier (the level-up moment). */
  celebrate?: boolean
}

export function RankLadder({ rank, celebrate = false }: RankLadderProps): ReactNode {
  const t = useW14Theme()

  // The held tier's „noch X Tage bis …" line — honest from the real toNextStreak.
  const nextHint =
    rank.next != null && rank.toNextStreak > 0
      ? `Noch ${rank.toNextStreak} ${rank.toNextStreak === 1 ? "Tag" : "Tage"} bis ${rank.next.title}`
      : rank.next == null
        ? "Höchster Rang erreicht"
        : `Schwelle zu ${rank.next?.title ?? ""} erreicht`

  return (
    <Card className="gap-3 px-4 py-4">
      {RANKS.map((r) => {
        const held = r.tier === rank.current.tier
        const reached = r.tier <= rank.current.tier
        return (
          <RankRow
            key={r.id}
            rankId={r.id}
            title={r.title}
            description={r.description}
            minStreak={r.minStreak}
            held={held}
            reached={reached}
            celebrate={celebrate && held}
          />
        )
      })}

      {/* The held tier's progress toward the next one real gauge, honest copy. */}
      <View className="mt-1 gap-1.5">
        <RingGauge
          value={rank.progress}
          color={t.colors.primary}
          caption={nextHint}
        />
        <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
          {rank.next != null
            ? `Aktuelle Serie: ${rank.streak} ${rank.streak === 1 ? "Tag" : "Tage"}`
            : `Serie: ${rank.streak} ${rank.streak === 1 ? "Tag" : "Tage"} Hüter der Schatzkammer`}
        </Text>
      </View>
    </Card>
  )
}

function RankRow({
  rankId,
  title,
  description,
  minStreak,
  held,
  reached,
  celebrate,
}: {
  rankId: RankId
  title: string
  description: string
  minStreak: number
  held: boolean
  reached: boolean
  celebrate: boolean
}): ReactNode {
  const t = useW14Theme()
  const reduceMotion = useReduceMotion()
  const Icon = RANK_ICON[rankId]

  // The crest tint: held + reached are ink; locked tiers are muted.
  const crestColor = reached ? t.colors.foreground : t.colors.mutedForeground

  // One-shot promotion pop on the held crest (emphasis spring), reduce-motion safe.
  const pop = useSharedValue(1)
  useEffect(() => {
    if (!celebrate || reduceMotion) return
    pop.value = 0.6
    pop.value = withSequence(
      withSpring(1.18, emphasisSpring),
      withTiming(1, { duration: duration.fast, easing: easing.standard }),
    )
  }, [celebrate, reduceMotion, pop])
  const popStyle = useAnimatedStyle(() => {
    "worklet"
    return { transform: [{ scale: pop.value }] }
  })

  return (
    <View
      className="flex-row items-center gap-3 rounded-md px-2 py-1.5"
      style={
        held
          ? { backgroundColor: t.colors.raised, borderRadius: t.radii.button }
          : undefined
      }
    >
      <Animated.View
        className="h-8 w-8 items-center justify-center"
        style={[popStyle]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon size={t.icon.md} color={crestColor} />
      </Animated.View>

      <View className="flex-1">
        <View className="flex-row items-center gap-1.5">
          <Text
            className="text-base font-semibold"
            style={reached ? undefined : { color: t.colors.mutedForeground }}
            numberOfLines={1}
          >
            {title}
          </Text>
          {held ? (
            // Fixed-size pill — never stretches vertically (the stretched pill
            // was the visual bug). Hard-capped height + self-center.
            <View
              className="self-center items-center justify-center rounded-md"
              style={{
                backgroundColor: t.colors.primary + "1f",
                paddingHorizontal: 6,
                height: 20,
              }}
            >
              <Text className="text-2xs font-bold" style={{ color: t.colors.primary }}>
                Aktuell
              </Text>
            </View>
          ) : null}
        </View>
        <Text
          className="text-muted-foreground text-2xs"
          numberOfLines={2}
        >
          {reached ? description : `Ab ${minStreak} ${minStreak === 1 ? "Tag" : "Tagen"} Serie`}
        </Text>
      </View>

      {/* Trailing status glyph: a check for a reached (not-held) tier, a lock for
          a still-locked one; the held tier needs no glyph (its Aktuell" pill says it). */}
      {!held ? (
        reached ? (
          <Check size={t.icon.sm} color={t.colors.foreground} />
        ) : (
          <Lock size={t.icon.sm} color={t.colors.mutedForeground} />
        )
      ) : null}
    </View>
  )
}
