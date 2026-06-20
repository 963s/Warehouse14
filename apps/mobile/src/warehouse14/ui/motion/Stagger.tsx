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
 */
import { Children, isValidElement, type ReactNode, type ReactElement } from "react"
import { type ViewProps } from "react-native"
import Animated from "react-native-reanimated"

import { itemEnter, itemExit } from "./transitions"
import { useReduceMotion } from "./useReduceMotion"

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
  return (
    <Animated.View
      entering={itemEnter(index, reduceMotion)}
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
