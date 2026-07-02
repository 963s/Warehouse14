/**
 * Stagger / StaggerItem — list + section entrance choreography.
 *
 * `<StaggerItem index={n}>` wraps one item so it fades + rises 8px over `base`,
 * delayed by `staggerDelay(n)` (capped so long lists stay snappy). `<Stagger>`
 * is the convenience container: it clones its direct children into StaggerItems
 * with auto-incrementing indices, so a static group cascades in with zero
 * bookkeeping.
 *
 * For long, virtualised lists prefer `StaggerItem` keyed off the row index from
 * FlashList/FlatList rather than `<Stagger>`, which only knows its static
 * children. Reduced motion routes through `itemEnter`, which degrades to an
 * opacity-only cross-fade with no per-item delay.
 *
 * Entrance gating: the choreography belongs to the ENTRANCE of a surface, not
 * to every later virtualised mount. A row that scrolls into view (or a fresh
 * search result replacing the last one) used to replay the fade + its stagger
 * delay — up to a second late for deep indices. So each StaggerItem decides
 * ONCE at mount whether it is part of an entrance burst (see `claimEntrance`);
 * late mounts render instantly, and deep indices drop the cascade delay.
 */
import { Children, isValidElement, useState, type ReactNode, type ReactElement } from "react"
import { type ViewProps } from "react-native"
import Animated from "react-native-reanimated"

import { itemEnter, itemExit } from "./transitions"
import { useReduceMotion } from "./useReduceMotion"

/** How long after a burst begins that mounting items still play the entrance. */
const ENTRANCE_WINDOW_MS = 1500
/** A quiet gap this long since the last StaggerItem mount starts a NEW burst
 *  (a freshly pushed screen, a late-arriving section) — those animate again. */
const BURST_GAP_MS = 400
/** Indices beyond this enter with ZERO cascade delay: on a long first page the
 *  deep rows land promptly instead of queueing toward the stagger cap. */
const CASCADE_INDEX_CAP = 12

// Module-level burst clock — StaggerItems mount in commit bursts (a screen
// entrance, a virtualised scroll fill). Items inside the entrance window of
// the current burst animate; everything later appears instantly.
let burstStartedAt = 0
let lastItemMountAt = 0

/**
 * Decide — once, at mount — whether this item is part of an entrance burst.
 * Called from a `useState` initializer, so a re-render never re-claims and a
 * StrictMode double-invoke lands in the same burst with the same answer.
 */
function claimEntrance(): boolean {
  const now = Date.now()
  if (now - lastItemMountAt > BURST_GAP_MS) burstStartedAt = now
  lastItemMountAt = now
  return now - burstStartedAt <= ENTRANCE_WINDOW_MS
}

export interface StaggerItemProps extends ViewProps {
  children: ReactNode
  /** Position in the list — drives the cascade delay. */
  index?: number
  /** Animate this item out when it unmounts. Default true. */
  exit?: boolean
}

export function StaggerItem({
  children,
  index = 0,
  exit = true,
  ...rest
}: StaggerItemProps): ReactNode {
  const reduceMotion = useReduceMotion()
  // Fixed at first mount: part of the entrance burst → play the (reduce-motion
  // aware) enter; a late virtualised mount → appear instantly, no replay.
  const [animate] = useState(claimEntrance)
  return (
    <Animated.View
      entering={
        animate ? itemEnter(index > CASCADE_INDEX_CAP ? 0 : index, reduceMotion) : undefined
      }
      exiting={exit ? itemExit(reduceMotion) : undefined}
      {...rest}
    >
      {children}
    </Animated.View>
  )
}

export interface StaggerProps extends ViewProps {
  children: ReactNode
  /** Starting index for the first child (e.g. when continuing after a header). */
  startIndex?: number
}

/**
 * Wraps each direct child in a `StaggerItem` with an auto-incrementing index.
 * Non-element children (strings, null) pass through untouched.
 */
export function Stagger({ children, startIndex = 0, ...rest }: StaggerProps): ReactNode {
  let i = startIndex
  return (
    <Animated.View {...rest}>
      {Children.map(children, (child) => {
        if (!isValidElement(child)) return child
        const idx = i++
        return (
          <StaggerItem key={(child as ReactElement).key ?? idx} index={idx}>
            {child}
          </StaggerItem>
        )
      })}
    </Animated.View>
  )
}
