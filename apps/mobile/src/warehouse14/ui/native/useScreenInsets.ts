/**
 * useScreenInsets — the one safe-area helper every owner surface reads from.
 *
 * Surfaces kept hand-rolling `useSafeAreaInsets()` and then re-deriving the same
 * `insets.bottom + 12` sticky-bar padding and `insets.top` header offset in a
 * dozen places. This funnels that into a single typed hook so the canvas, the
 * sticky save bar, and floating actions all sit off the notch / home indicator
 * identically — and so the numbers come from the spacing grid, never a magic
 * literal.
 *
 * `raw` is the unmodified `EdgeInsets` (for the rare bespoke case). The derived
 * fields are the ones surfaces actually want:
 *
 *   screen.{top,bottom,left,right} — page padding that respects the notch and
 *      the home indicator. A scrolling body usually only needs `top` (as the
 *      content inset) and lets the sticky bar own the bottom.
 *   stickyBottom — bottom padding for a pinned bar / FAB: the home-indicator
 *      inset plus a comfortable gap, so the control never kisses the edge.
 *   contentBottom — bottom padding for the LAST item of a scroll body, so it
 *      clears the home indicator when there is no sticky bar.
 */
import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context"

import { space } from "@/warehouse14/theme"

export interface ScreenInsets {
  /** The raw safe-area edge insets, untouched. */
  raw: EdgeInsets
  /** Page padding that respects the notch / home indicator on every edge. */
  screen: { top: number; bottom: number; left: number; right: number }
  /** Bottom padding for a pinned bar or FAB (home-indicator inset + a gap). */
  stickyBottom: number
  /** Bottom padding for the last item of a scroll body (no sticky bar). */
  contentBottom: number
}

export interface ScreenInsetsOptions {
  /**
   * The comfortable gap added above the home indicator for a sticky bar.
   * Defaults to `space.x3` (12px) to match the existing sticky-bar pattern.
   */
  stickyGap?: number
  /**
   * Extra breathing room added to the scroll body's bottom inset.
   * Defaults to `space.x6` (24px).
   */
  contentGap?: number
}

/** Safe-area insets pre-derived into the paddings surfaces actually reach for. */
export function useScreenInsets(options: ScreenInsetsOptions = {}): ScreenInsets {
  const { stickyGap = space.x3, contentGap = space.x6 } = options
  const raw = useSafeAreaInsets()
  return {
    raw,
    screen: {
      top: raw.top,
      bottom: raw.bottom,
      left: raw.left,
      right: raw.right,
    },
    stickyBottom: raw.bottom + stickyGap,
    contentBottom: raw.bottom + contentGap,
  }
}
