/**
 * useBreakEvenCelebration — arm the gold flood the moment the month crosses into
 * profit, exactly once, from REAL data.
 *
 * Feed it the live break-even state (TreasureMap.brokeEven from
 * computeTreasureMap) plus the current month's start (schatzkammer.monthStartDay).
 * It detects the honest false→true crossing and, gated by the celebration store
 * so it fires once per month and never replays on a refetch/remount/tab-hop,
 * arms a one-shot `visible` flag for <GoldFlood> and pairs the bloom's peak with
 * a single Heavy haptic (the one place DESIGN.md §7 allows it).
 *
 * Honesty: the celebration is driven only by a real `brokeEven` turning true. We
 * never fire on first load merely because the month is already in profit — a
 * fresh mount that finds `brokeEven` already true marks the milestone as seen
 * WITHOUT playing, so the flood celebrates a crossing the user actually just
 * caused, not a state that predates this session.
 */
import { useCallback, useEffect, useRef, useState } from "react"

import { impactHeavy } from "../ui/native/haptics"
import { breakEvenKey, hasCelebrated, markCelebrated } from "./celebrationStore"

export interface BreakEvenCelebrationProps {
  /** Pass straight to <GoldFlood visible={…} />. */
  visible: boolean
  /** Pass straight to <GoldFlood onReachPeak={…} /> — fires the Heavy haptic. */
  onReachPeak: () => void
  /** Pass straight to <GoldFlood onDone={…} /> — disarms the one-shot. */
  onDone: () => void
}

export interface BreakEvenCelebrationOptions {
  /**
   * Master switch. When false the hook is inert (no detection, no flood) — used
   * to hold the celebration until the data has actually settled, so a transient
   * `false` during first load never counts as a "before" state.
   */
  enabled?: boolean
  /** Also fire the Heavy haptic (default true). Set false to keep it silent. */
  haptics?: boolean
}

/**
 * Watch a real break-even flag for the given month and return the props to drive
 * <GoldFlood>. Plays at most once per month, only on a genuine false→true
 * crossing observed while enabled.
 */
export function useBreakEvenCelebration(
  brokeEven: boolean,
  monthStart: string,
  options: BreakEvenCelebrationOptions = {},
): BreakEvenCelebrationProps {
  const { enabled = true, haptics = true } = options
  const key = breakEvenKey(monthStart)

  const [visible, setVisible] = useState(false)
  // The previously observed break-even value for THIS month key. null until we
  // have a settled first reading — so we never treat "unknown → true" as a cross.
  const prevRef = useRef<{ key: string; value: boolean } | null>(null)

  useEffect(() => {
    if (!enabled) return

    const prev = prevRef.current
    // Month changed (or first settled reading): record a baseline WITHOUT
    // celebrating. If the new month is already broke-even on first sight, mark it
    // seen so a later remount doesn't fire for a crossing the user didn't witness.
    if (prev === null || prev.key !== key) {
      prevRef.current = { key, value: brokeEven }
      if (brokeEven && !hasCelebrated(key)) {
        // Already in profit when we first looked — adopt it silently.
        markCelebrated(key)
      }
      return
    }

    // Same month, value moved false → true: a real crossing.
    if (!prev.value && brokeEven) {
      prevRef.current = { key, value: true }
      // markCelebrated is an atomic check-and-set: only the first observer wins,
      // so a double-mount can't double-fire.
      if (markCelebrated(key)) setVisible(true)
      return
    }

    // Any other transition: just keep the baseline current.
    prevRef.current = { key, value: brokeEven }
  }, [brokeEven, key, enabled])

  const onReachPeak = useCallback(() => {
    if (haptics) impactHeavy()
  }, [haptics])

  const onDone = useCallback(() => {
    setVisible(false)
  }, [])

  return { visible, onReachPeak, onDone }
}
