/**
 * PeriodSwitcher — the segmented control that scopes a report to a period
 * (Tag · Woche · Monat · Jahr, or any caller-supplied set).
 *
 * The standard way every insights surface lets the owner change the window a
 * chart aggregates over, so the control feels identical wherever it appears. A
 * single brass "thumb" slides under the active segment on the UI thread; the
 * change fires a `selection` haptic (DESIGN.md §7 — segment change) exactly
 * once. Built on RN Views + the theme + the motion tokens; no native dep.
 *
 * Motion (DESIGN.md §6): the thumb glides to the new segment over `fast` with
 * the standard easing — a calm, physical slide, never a snap. Reduced motion
 * drops the slide and the thumb simply re-renders in place.
 *
 * Honesty note: this control only changes which window the caller fetches; it
 * never invents data. The chart it drives is responsible for its own empty /
 * locked state when an aggregate for the chosen period is unavailable.
 */
import { type ReactNode, useState } from "react"
import { View, Pressable, type LayoutChangeEvent } from "react-native"
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { selection } from "@/warehouse14/ui/native"
import { duration, easing } from "@/warehouse14/ui/motion/tokens"
import { useReduceMotion } from "@/warehouse14/ui/motion/useReduceMotion"
import type { PeriodOption } from "./types"

export interface PeriodSwitcherProps<Id extends string = string> {
  /** The selectable periods, left→right. Two to ~five segments read best. */
  options: ReadonlyArray<PeriodOption<Id>>
  /** The currently-active period id (controlled). */
  value: Id
  /** Fires with the chosen id on a segment change (already de-duped by `value`). */
  onChange: (id: Id) => void
  /** Optional German label announced to screen readers for the whole control. */
  accessibilityLabel?: string
}

export function PeriodSwitcher<Id extends string = string>({
  options,
  value,
  onChange,
  accessibilityLabel = "Zeitraum",
}: PeriodSwitcherProps<Id>): ReactNode {
  const t = useW14Theme()
  const reduceMotion = useReduceMotion()

  // The track's inner content width (excludes the 2px padding on each side),
  // measured on layout so the thumb width is an exact fraction — no magic px.
  const [trackWidth, setTrackWidth] = useState(0)
  const count = Math.max(1, options.length)
  const segWidth = trackWidth > 0 ? trackWidth / count : 0

  const activeIndex = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  )

  // The thumb's x-offset within the padded track, animated on the UI thread.
  const offset = useSharedValue(0)

  const thumbStyle = useAnimatedStyle(() => {
    "worklet"
    return { transform: [{ translateX: offset.value }] }
  })

  // Drive the thumb whenever the active index or the measured width changes.
  // (Done in render via a shared-value write rather than an effect so the very
  // first measured layout positions the thumb without a frame of lag.)
  const target = activeIndex * segWidth
  if (reduceMotion) {
    offset.value = target
  } else if (offset.value !== target) {
    offset.value = withTiming(target, { duration: duration.fast, easing: easing.standard })
  }

  const onTrackLayout = (e: LayoutChangeEvent): void => {
    // Track padding is 2px each side (rounded-md inset); subtract it so the
    // thumb fills its segment exactly to the inner edges.
    const inner = e.nativeEvent.layout.width - 4
    setTrackWidth(inner > 0 ? inner : 0)
  }

  const handlePress = (id: Id): void => {
    if (id === value) return
    selection()
    onChange(id)
  }

  return (
    <View
      onLayout={onTrackLayout}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      className="h-9 flex-row rounded-md p-0.5"
      style={{ backgroundColor: t.colors.border }}
    >
      {/* The sliding thumb — a brass-tinted card the width of one segment. */}
      {segWidth > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: 2,
              bottom: 2,
              left: 2,
              width: segWidth,
              borderRadius: t.radii.button,
              backgroundColor: t.colors.card,
              borderWidth: 1,
              borderColor: t.colors.border,
            },
            thumbStyle,
          ]}
        />
      ) : null}

      {options.map((opt) => {
        const isActive = opt.id === value
        return (
          <Pressable
            key={opt.id}
            onPress={() => handlePress(opt.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={opt.a11yLabel ?? opt.label}
            className="flex-1 items-center justify-center"
            // 44px min height via the h-9 track + hit slop keeps the target honest
            hitSlop={{ top: 6, bottom: 6 }}
          >
            <Text
              className="text-sm"
              style={{
                color: isActive ? t.colors.foreground : t.colors.mutedForeground,
                fontFamily: isActive ? t.fonts.semibold : t.fonts.medium,
              }}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * The default four-period set every report can reuse, so the captions stay
 * identical app-wide. Caller maps each id to its own date-range fetch.
 */
export const DEFAULT_PERIODS: ReadonlyArray<PeriodOption<"day" | "week" | "month" | "year">> = [
  { id: "day", label: "Tag", a11yLabel: "Heute" },
  { id: "week", label: "Woche", a11yLabel: "Diese Woche" },
  { id: "month", label: "Monat", a11yLabel: "Dieser Monat" },
  { id: "year", label: "Jahr", a11yLabel: "Dieses Jahr" },
]

export type DefaultPeriodId = "day" | "week" | "month" | "year"
