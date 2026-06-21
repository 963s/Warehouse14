/**
 * useRankUpCelebration — arm the gold flood the moment the owner climbs a tier,
 * exactly once per rank, from REAL data.
 *
 * The rank is a pure function of the real streak (game/ranks.ts). This hook
 * watches the held rank and, on a genuine upward crossing observed WHILE enabled,
 * arms a one-shot `visible` flag for <GoldFlood> and pairs the bloom's peak with
 * the single Heavy haptic (DESIGN.md §7 — the one place Heavy is allowed). It
 * reuses the shared celebration store's once-per-milestone memory (keyed per rank
 * id) so a promotion never replays on a refetch, remount, or tab-hop.
 *
 * Honesty: the celebration is driven only by a real tier increase. A fresh mount
 * that already finds the owner at, say, Goldschmied does NOT fire — it adopts that
 * rank silently (marks it seen) so the flood only ever celebrates a climb the user
 * actually just caused, never a standing that predates this session. This mirrors
 * useBreakEvenCelebration's discipline exactly, so the two milestones feel the same.
 */
import { useCallback, useEffect, useRef, useState } from "react"

import { hasCelebrated, markCelebrated } from "./celebrationStore"
import { type RankId } from "./ranks"

/** The stable milestone key for first reaching a given rank tier. */
export function rankUpKey(rankId: RankId): string {
  return `rankup:${rankId}`
}

export interface RankUpCelebrationProps {
  /** Pass straight to <GoldFlood visible={…} />. */
  visible: boolean
  /** Pass straight to <GoldFlood onReachPeak={…} /> — fires the Heavy haptic. */
  onReachPeak: () => void
  /** Pass straight to <GoldFlood onDone={…} /> — disarms the one-shot. */
  onDone: () => void
  /** The rank id that was just reached (for the celebration copy), or null. */
  reachedRankId: RankId | null
}

export interface RankUpCelebrationOptions {
  /**
   * Master switch. When false the hook is inert (no detection, no flood) — used to
   * hold the celebration until the game state has actually settled, so a transient
   * first-load tier never counts as the "before" state.
   */
  enabled?: boolean
  /** Also fire the Heavy haptic (default true). Set false to keep it silent. */
  haptics?: boolean
  /** Fire the Heavy haptic (injected so the hook stays UI-agnostic + testable). */
  onHeavy?: () => void
}

/**
 * Watch the held rank tier and return the props to drive <GoldFlood>. Plays at
 * most once per rank, only on a genuine upward crossing observed while enabled.
 * `tier` is rank.current.tier; `rankId` is rank.current.id (both from rankProgress).
 */
export function useRankUpCelebration(
  tier: number,
  rankId: RankId,
  options: RankUpCelebrationOptions = {},
): RankUpCelebrationProps {
  const { enabled = true, haptics = true, onHeavy } = options

  const [visible, setVisible] = useState(false)
  const [reachedRankId, setReachedRankId] = useState<RankId | null>(null)
  // The previously observed tier. null until a settled first reading — so we never
  // treat "unknown → some tier" as a climb.
  const prevTierRef = useRef<number | null>(null)

  useEffect(() => {
    if (!enabled) return

    const prev = prevTierRef.current
    // First settled reading: adopt the current tier as the baseline WITHOUT
    // celebrating, and mark every rank up to here as already seen so a later climb
    // only fires for tiers crossed during this session.
    if (prev === null) {
      prevTierRef.current = tier
      const key = rankUpKey(rankId)
      if (!hasCelebrated(key)) markCelebrated(key)
      return
    }

    if (tier > prev) {
      prevTierRef.current = tier
      const key = rankUpKey(rankId)
      // markCelebrated is an atomic check-and-set: only the first observer wins,
      // so a double-mount can't double-fire.
      if (markCelebrated(key)) {
        setReachedRankId(rankId)
        setVisible(true)
      }
      return
    }

    // No climb (same tier, or a drop): keep the baseline current.
    prevTierRef.current = tier
  }, [tier, rankId, enabled])

  const onReachPeak = useCallback(() => {
    if (haptics) onHeavy?.()
  }, [haptics, onHeavy])

  const onDone = useCallback(() => {
    setVisible(false)
  }, [])

  return { visible, onReachPeak, onDone, reachedRankId }
}
