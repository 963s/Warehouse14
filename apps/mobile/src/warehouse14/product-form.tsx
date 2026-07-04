/**
 * Shared building blocks for the product „Neu"/„Bearbeiten"-Formulare.
 *
 * The intake and the edit surface collect overlapping fields (Name, Zustand,
 * Listenpreis, Kategorie …) and must read pixel-identical, so this module owns
 * the controls and the field-level validation in one place. Both screens then
 * differ only in the api-client call they fire.
 *
 * Controls compose the spine — never fork it:
 *   • `ChipSelect` — the single-choice chip row (Artikelart, Metall, Zustand,
 *     Steuerbehandlung). Each tap fires the selection haptic (DESIGN.md §7) and
 *     presses with the shared scale. Kept generic + backward-compatible because
 *     `customer-form` reuses it for the Sprache field.
 *   • `MoneyField` — a decimal-pad amount input wired through the spine's
 *     `FormField` chrome with a right-aligned unit affordance. The affordance
 *     defaults to „€" so an amount reads like money, but is honest about its
 *     value: pass `suffix="g"` for a gram weight, or `suffix={null}` for a pure
 *     ratio (Feinheit) so no unit is overlaid at all. Validates to the de-DE/
 *     decimal wire shape.
 *   • `MetalWeightField` — Gewicht (g) + Feinheit side by side, decimal-pad, with
 *     a live Feingewicht hint (Gewicht × Feinheit) so the operator sees the melt
 *     basis as they type. Honest: the hint only shows once both are real numbers,
 *     and neither field wears a „€" — Gewicht shows „g", Feinheit shows nothing.
 *   • `CategoryPicker` — a searchable single-choice picker (a row of chips would
 *     wall off the screen with a deep taxonomy). Filters as you type; the
 *     selected node is pinned at the top with a verdigris check.
 *
 * Validation is field-level and German: each `validate…` returns an error MAP
 * keyed by field, so a screen paints exactly the offending input red via the
 * spine's `FormField` and the operator sees which line to fix — never one opaque
 * banner for a typo two fields up. `first…Error` gives the banner copy + the
 * Error haptic. Money is on the wire as a decimal EUR STRING here (the products
 * API takes „199.90", not cents) — `MoneyField` keeps that contract and we never
 * fabricate a value (DESIGN.md honesty rule): an empty optional field stays empty.
 */
import {
  type ComponentRef,
  type ReactNode,
  type RefObject,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { ScrollView, View, type TextInputProps } from "react-native"
import Animated, {
  Extrapolation,
  FadeIn,
  interpolate,
  interpolateColor,
  runOnJS,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated"
import { ChevronDown } from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { FormField } from "@/warehouse14/ui"
import { duration, PressableScale, timingHover, useReduceMotion } from "@/warehouse14/ui/motion"
import * as haptics from "@/warehouse14/ui/native/haptics"

/** The imperative handle of the spine's `Input` wrapper — a TextInput instance,
 *  derived from the component so we never import the restricted RN symbol. */
export type InputRef = ComponentRef<typeof Input>

// ── Wire-shape guards (shared by the screens' validators) ────────────────────

/** Decimal money/weight: up to 16 integer + 2 fractional digits (the wire shape
 *  the products API accepts — „199.90", not cents). */
export const DECIMAL_RE = /^\d{1,16}(\.\d{1,2})?$/
/** Feinheit 0..1 with up to 4 fractional digits (mirrors the server FinenessString). */
export const FINENESS_RE = /^(0(\.\d{1,4})?|1(\.0{1,4})?)$/

/** A decimal-string amount > 0 (a list/Einkaufspreis of „0" is not a real price). */
export function isPositiveDecimal(value: string): boolean {
  const v = value.trim()
  return DECIMAL_RE.test(v) && Number(v) > 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Field — a labelled form row. Kept as a thin alias over the spine `FormField`
// so existing call sites (`<Field label hint>…children`) keep working while the
// label/hint/error chrome now comes from the one shared component.
// ─────────────────────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  required,
  error,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  error?: string | null
  children: ReactNode
}): ReactNode {
  return (
    <FormField label={label} hint={hint} required={required} error={error}>
      {children}
    </FormField>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ChipSelect — single-choice chip row. Generic over the value so it serves every
// intake enum without a cast at the call site. Each chip presses with the shared
// scale and ticks the selection haptic; the active chip is brass (`default`).
// ─────────────────────────────────────────────────────────────────────────────

export function ChipSelect<T extends string>({
  options,
  value,
  onChange,
  allowClear = false,
  clearLabel = "Keins",
}: {
  options: ReadonlyArray<{ value: T; label: string }>
  value: T | null
  onChange: (value: T | null) => void
  /** Render a leading chip that resets the field to null. */
  allowClear?: boolean
  clearLabel?: string
}): ReactNode {
  const t = useW14Theme()
  // The visible pill stays small (Badge px-2.5 py-0.5), but the TAP surface must
  // clear the 44px WCAG floor — minHeight on the wrapper grows the hit area, not
  // the chip. minHeight (not hitSlop) keeps vertical precision inside the wrap.
  const tapFloor = { minHeight: t.touch.min, justifyContent: "center" as const }
  const pick = (next: T | null) => {
    haptics.selection()
    onChange(next)
  }
  return (
    <View className="flex-row flex-wrap gap-2">
      {allowClear ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
          accessibilityState={{ selected: value === null }}
          onPress={() => pick(null)}
          style={tapFloor}
        >
          <Badge variant={value === null ? "default" : "outline"}>
            <Text>{clearLabel}</Text>
          </Badge>
        </PressableScale>
      ) : null}
      {options.map((opt) => (
        <PressableScale
          key={opt.value}
          accessibilityRole="button"
          accessibilityLabel={opt.label}
          accessibilityState={{ selected: value === opt.value }}
          onPress={() => pick(opt.value)}
          style={tapFloor}
        >
          <Badge variant={value === opt.value ? "default" : "outline"}>
            <Text>{opt.label}</Text>
          </Badge>
        </PressableScale>
      ))}
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// WheelPicker — an iOS-style rotating wheel for a single choice. A drop-in for
// ChipSelect when the list is long enough that a wrap of chips becomes a wall of
// printed text: one value rests under a gilt band, the neighbours recede with
// depth, and the owner spins to the value instead of reading every option at
// once. Pure reanimated scroll — no native dependency.
// ─────────────────────────────────────────────────────────────────────────────

const WHEEL_ITEM_H = 44
const WHEEL_VISIBLE = 3 // odd → one centred row plus one above + below; compact, not a wall
const WHEEL_CENTER = Math.floor(WHEEL_VISIBLE / 2)

// Mechanical detent — one selection tick (the subtle iOS "click" + rattle) each
// time a new row snaps under the band. Fired from the scroll worklet via runOnJS
// so the wheel feels like a physical dial, not a silent scroll.
function wheelTick(): void {
  haptics.selection()
}

/**
 * The wheel's REST detector — the physics of "the stop IS the confirmation".
 *
 * Committing only on `onMomentumScrollEnd` has a hole the owner felt daily: a
 * slow drag released WITHOUT a fling never fires that event on iOS, so the
 * chosen row silently never committed until he tapped the field again. Instead,
 * every scroll event refreshes this debounce; only when the wheel has truly
 * RESTED (no event for SETTLE_MS — covers momentum end, a no-fling release, and
 * the snap tail) does the centred row commit. Any new touch cancels the pending
 * commit, so someone still browsing back and forth is never interrupted — the
 * wheel decides nothing while a finger is on it or it is still moving.
 */
const WHEEL_SETTLE_MS = 200

function useWheelSettle(onSettle: (index: number) => void): {
  noteScroll: (offsetY: number) => void
  cancelSettle: () => void
} {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastY = useRef(0)
  const onSettleRef = useRef(onSettle)
  onSettleRef.current = onSettle
  const cancelSettle = useCallback(() => {
    if (timer.current != null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])
  const noteScroll = useCallback((offsetY: number) => {
    lastY.current = offsetY
    if (timer.current != null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      onSettleRef.current(Math.round(lastY.current / WHEEL_ITEM_H))
    }, WHEEL_SETTLE_MS)
  }, [])
  // Never fire a stale commit after unmount.
  useEffect(() => cancelSettle, [cancelSettle])
  return { noteScroll, cancelSettle }
}

// A wheel inside a Dialog (a separate iOS window where gesture-handler does not
// coordinate) loses its vertical pan to the enclosing ScrollView. The scroll
// container provides this setter; an open wheel calls it to freeze the parent
// scroll so the spin reaches the wheel. No provider → a harmless no-op.
export const WheelScrollLock = createContext<((locked: boolean) => void) | null>(null)

export function WheelPicker<T extends string>({
  options,
  value,
  onChange,
  defaultToFirst = true,
  placeholder = "Wählen",
}: {
  options: ReadonlyArray<{ value: T; label: string }>
  value: T | null
  onChange: (value: T) => void
  /**
   * Auto-commit the first option on mount so a required field always reads a
   * real value. Set FALSE for fields where the owner must deliberately choose —
   * a silent default would mis-classify the article (e.g. Artikelart).
   */
  defaultToFirst?: boolean
  /** Collapsed-row prompt shown in muted ink while nothing is chosen yet. */
  placeholder?: string
}): ReactNode {
  const t = useW14Theme()
  const [open, setOpen] = useState(false)
  const lockScroll = useContext(WheelScrollLock)
  // Distinguish "no real choice yet" from "the first option" — Math.max(0, …)
  // below clamps the wheel position to 0, but the collapsed row must still read
  // as an empty prompt, not as options[0].
  const hasValue = value != null && options.some((o) => o.value === value)
  // Show the prompt ONLY when the field truly has no value and won't auto-fill.
  // A defaultToFirst field renders options[0] on the very first frame (before the
  // mount effect commits it) so the placeholder never flashes.
  const showPlaceholder = !hasValue && !defaultToFirst
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )
  const selected = options[selectedIndex]
  const scrollY = useSharedValue(selectedIndex * WHEEL_ITEM_H)
  const lastTick = useSharedValue(selectedIndex)
  const chevron = useSharedValue(0)
  const reduceMotion = useReduceMotion()

  // The gilt band warms for a beat when a settled choice commits — the eye
  // reads "gespeichert" without a popup. Reduce-motion skips the pulse.
  const bandPulse = useSharedValue(0)
  // Self-tidy: a comfortable moment after a settled commit (and only if the
  // owner hasn't touched the wheel again) the panel folds itself away — the
  // collapsed row showing the chosen value IS the receipt. Any interaction
  // cancels it, so browsing is never yanked shut mid-thought.
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelCollapse = useCallback(() => {
    if (collapseTimer.current != null) {
      clearTimeout(collapseTimer.current)
      collapseTimer.current = null
    }
  }, [])

  const closeWheel = useCallback(() => {
    chevron.value = reduceMotion ? 0 : withTiming(0, timingHover("fast"))
    setOpen(false)
    lockScroll?.(false)
  }, [chevron, reduceMotion, lockScroll])

  const commit = useCallback(
    (rawIndex: number) => {
      const i = Math.min(options.length - 1, Math.max(0, rawIndex))
      const next = options[i]
      if (next && next.value !== value) {
        haptics.selection()
        onChange(next.value)
        if (!reduceMotion) {
          bandPulse.value = withSequence(
            withTiming(1, { duration: 140 }),
            withTiming(0, { duration: 420 }),
          )
        }
      }
      // Rested = confirmed (changed or re-confirmed the same) → fold away soon.
      cancelCollapse()
      collapseTimer.current = setTimeout(() => {
        collapseTimer.current = null
        closeWheel()
      }, 650)
    },
    [options, value, onChange, reduceMotion, bandPulse, cancelCollapse, closeWheel],
  )

  const { noteScroll, cancelSettle } = useWheelSettle(commit)
  // A finger back on the wheel means "still choosing" — nothing commits, nothing folds.
  const onWheelTouch = useCallback(() => {
    cancelSettle()
    cancelCollapse()
  }, [cancelSettle, cancelCollapse])
  useEffect(() => cancelCollapse, [cancelCollapse])

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y
      const idx = Math.round(e.contentOffset.y / WHEEL_ITEM_H)
      if (idx !== lastTick.value) {
        lastTick.value = idx
        runOnJS(wheelTick)()
      }
      // Refresh the rest detector on every movement — only true stillness commits.
      runOnJS(noteScroll)(e.contentOffset.y)
    },
  })

  // A required field with an honest default commits its first option on mount so
  // the collapsed row reads a real value. Fields that must NOT default (the owner
  // has to choose) opt out with defaultToFirst={false} and show the placeholder.
  useEffect(() => {
    if (defaultToFirst && value == null && options[0]) onChange(options[0].value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggle = () => {
    haptics.selection()
    // A manual toggle overrides any pending settle-commit or self-fold.
    cancelSettle()
    cancelCollapse()
    const chevronTarget = open ? 0 : 1
    chevron.value = reduceMotion ? chevronTarget : withTiming(chevronTarget, timingHover("fast"))
    setOpen((o) => !o)
    lockScroll?.(!open)
  }
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevron.value * 180}deg` }],
  }))
  const bandGilt = t.colors.gilt
  const bandInk = t.colors.foreground
  const bandStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(bandPulse.value, [0, 1], [`${bandGilt}5e`, bandGilt]),
    backgroundColor: interpolateColor(bandPulse.value, [0, 1], [`${bandInk}0a`, `${bandGilt}24`]),
  }))

  const pad = WHEEL_ITEM_H * WHEEL_CENTER

  return (
    <View style={{ gap: 8 }}>
      {/* Collapsed field — shows the current value; tap reveals the wheel. */}
      <PressableScale onPress={toggle} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            minHeight: t.touch.min,
            paddingHorizontal: 14,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: open ? t.colors.gilt : t.colors.border,
            backgroundColor: t.colors.card,
          }}
        >
          <Text
            className="font-medium"
            style={{
              fontSize: 16,
              lineHeight: 22,
              color: showPlaceholder ? t.colors.mutedForeground : t.colors.foreground,
            }}
            numberOfLines={1}
          >
            {showPlaceholder ? placeholder : (selected?.label ?? placeholder)}
          </Text>
          <Animated.View style={chevronStyle}>
            <ChevronDown size={t.icon.sm} color={t.colors.mutedForeground} />
          </Animated.View>
        </View>
      </PressableScale>

      {open ? (
        <Animated.View
          entering={FadeIn.duration(reduceMotion ? 0 : duration.fast)}
          style={{ height: WHEEL_ITEM_H * WHEEL_VISIBLE }}
        >
          {/* The centred selection band — a gilt-edged slot the chosen value rests
              in. It warms briefly when a settled choice commits (bandStyle). */}
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: "absolute",
                left: 0,
                right: 0,
                top: pad,
                height: WHEEL_ITEM_H,
                borderRadius: 10,
                borderTopWidth: 1,
                borderBottomWidth: 1,
              },
              bandStyle,
            ]}
          />
          <Animated.ScrollView
            onScroll={onScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            snapToInterval={WHEEL_ITEM_H}
            decelerationRate="fast"
            bounces={false}
            nestedScrollEnabled
            contentOffset={{ x: 0, y: selectedIndex * WHEEL_ITEM_H }}
            onTouchStart={onWheelTouch}
            onScrollBeginDrag={onWheelTouch}
            contentContainerStyle={{ paddingVertical: pad }}
          >
            {options.map((opt, i) => (
              <WheelRow key={opt.value} label={opt.label} index={i} scrollY={scrollY} ink={t.colors.foreground} />
            ))}
          </Animated.ScrollView>
        </Animated.View>
      ) : null}
    </View>
  )
}

function WheelRow({
  label,
  index,
  scrollY,
  ink,
}: {
  label: string
  index: number
  scrollY: SharedValue<number>
  ink: string
}): ReactNode {
  const style = useAnimatedStyle(() => {
    "worklet"
    const centred = scrollY.value / WHEEL_ITEM_H
    const dist = Math.abs(centred - index)
    return {
      opacity: interpolate(dist, [0, 1, 2], [1, 0.4, 0.16], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(dist, [0, 1, 2], [1, 0.84, 0.72], Extrapolation.CLAMP) }],
    }
  })
  return (
    <Animated.View style={[{ height: WHEEL_ITEM_H, alignItems: "center", justifyContent: "center" }, style]}>
      <Text className="font-medium" style={{ fontSize: 19, lineHeight: 24, color: ink }} numberOfLines={1}>
        {label}
      </Text>
    </Animated.View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// DateWheel — a tap-to-open day · month · year wheel for a date of birth. Same
// gilt-band, recede-with-depth feel as WheelPicker, but three columns spinning a
// `YYYY-MM-DD` wire string. Optional: the collapsed row reads „Datum wählen" until
// the owner opens it; the first open seats a sensible default to spin from.
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS_DE = [
  "Januar", "Februar", "März", "April", "Mai", "Juni",
  "Juli", "August", "September", "Oktober", "November", "Dezember",
] as const

const DATE_MIN_YEAR = 1920

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function parseISODate(v: string | null): { y: number; m: number; d: number } | null {
  if (!v) return null
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v.trim())
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  return { y, m, d }
}

/** One spinning column inside the DateWheel — a self-contained wheel over string
 *  labels that reports the snapped index on momentum end. */
function WheelColumn({
  options,
  selectedIndex,
  onCommit,
  flex,
}: {
  options: readonly string[]
  selectedIndex: number
  onCommit: (index: number) => void
  flex: number
}): ReactNode {
  const t = useW14Theme()
  const scrollY = useSharedValue(selectedIndex * WHEEL_ITEM_H)
  const lastTick = useSharedValue(selectedIndex)
  // Same rest-is-the-confirmation mechanic as the single wheel: a slow drag
  // released without a fling never fires onMomentumScrollEnd, so the column
  // commits whenever it truly RESTS instead. The composite date panel never
  // folds itself (three columns are a deliberate multi-step choice).
  const { noteScroll, cancelSettle } = useWheelSettle(onCommit)
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y
      const idx = Math.round(e.contentOffset.y / WHEEL_ITEM_H)
      if (idx !== lastTick.value) {
        lastTick.value = idx
        runOnJS(wheelTick)()
      }
      runOnJS(noteScroll)(e.contentOffset.y)
    },
  })
  const pad = WHEEL_ITEM_H * WHEEL_CENTER
  return (
    <Animated.ScrollView
      style={{ flex, height: WHEEL_ITEM_H * WHEEL_VISIBLE }}
      onScroll={onScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      snapToInterval={WHEEL_ITEM_H}
      decelerationRate="fast"
      bounces={false}
      nestedScrollEnabled
      contentOffset={{ x: 0, y: selectedIndex * WHEEL_ITEM_H }}
      onTouchStart={cancelSettle}
      onScrollBeginDrag={cancelSettle}
      contentContainerStyle={{ paddingVertical: pad }}
    >
      {options.map((opt, i) => (
        <WheelRow key={`${opt}-${i}`} label={opt} index={i} scrollY={scrollY} ink={t.colors.foreground} />
      ))}
    </Animated.ScrollView>
  )
}

export function DateWheel({
  value,
  onChange,
}: {
  value: string | null
  onChange: (value: string) => void
}): ReactNode {
  const t = useW14Theme()
  const [open, setOpen] = useState(false)
  const lockScroll = useContext(WheelScrollLock)
  const chevron = useSharedValue(0)
  const reduceMotion = useReduceMotion()

  const maxYear = new Date().getFullYear()
  const years = useMemo(
    () => Array.from({ length: maxYear - DATE_MIN_YEAR + 1 }, (_, i) => DATE_MIN_YEAR + i),
    [maxYear],
  )
  const days = useMemo(() => Array.from({ length: 31 }, (_, i) => i + 1), [])

  const parsed = parseISODate(value)
  const hasValue = parsed != null
  const [d, setD] = useState(parsed?.d ?? 1)
  const [m, setM] = useState(parsed?.m ?? 1)
  const [y, setY] = useState(parsed?.y ?? 1990)

  const commit = useCallback(
    (nd: number, nm: number, ny: number) => {
      onChange(`${ny}-${pad2(nm)}-${pad2(nd)}`)
    },
    [onChange],
  )

  const toggle = () => {
    haptics.selection()
    const next = !open
    chevron.value = reduceMotion ? (next ? 1 : 0) : withTiming(next ? 1 : 0, timingHover("fast"))
    setOpen(next)
    lockScroll?.(next)
    // First open of an empty field seats the shown default so the row stops
    // reading „Datum wählen" and the wheels have a value to spin from.
    if (next && !hasValue) commit(d, m, y)
  }
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevron.value * 180}deg` }],
  }))

  const display = hasValue ? `${pad2(d)}.${pad2(m)}.${y}` : "Datum wählen"
  const pad = WHEEL_ITEM_H * WHEEL_CENTER

  return (
    <View style={{ gap: 8 }}>
      <PressableScale onPress={toggle} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            minHeight: t.touch.min,
            paddingHorizontal: 14,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: open ? t.colors.gilt : t.colors.border,
            backgroundColor: t.colors.card,
          }}
        >
          <Text
            className="font-medium"
            style={{
              fontSize: 16,
              lineHeight: 22,
              color: hasValue ? t.colors.foreground : t.colors.mutedForeground,
            }}
            numberOfLines={1}
          >
            {display}
          </Text>
          <Animated.View style={chevronStyle}>
            <ChevronDown size={t.icon.sm} color={t.colors.mutedForeground} />
          </Animated.View>
        </View>
      </PressableScale>

      {open ? (
        <Animated.View
          entering={FadeIn.duration(reduceMotion ? 0 : duration.fast)}
          style={{ height: WHEEL_ITEM_H * WHEEL_VISIBLE }}
        >
          {/* One gilt band spans all three columns — the centred date rests in it. */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: pad,
              height: WHEEL_ITEM_H,
              borderRadius: 10,
              borderTopWidth: 1,
              borderBottomWidth: 1,
              borderColor: `${t.colors.gilt}5e`,
              backgroundColor: `${t.colors.foreground}0a`,
            }}
          />
          <View style={{ flexDirection: "row" }}>
            <WheelColumn
              options={days.map((n) => pad2(n))}
              selectedIndex={d - 1}
              onCommit={(i) => {
                const nd = i + 1
                setD(nd)
                commit(nd, m, y)
              }}
              flex={1}
            />
            <WheelColumn
              options={MONTHS_DE}
              selectedIndex={m - 1}
              onCommit={(i) => {
                const nm = i + 1
                setM(nm)
                commit(d, nm, y)
              }}
              flex={1.6}
            />
            <WheelColumn
              options={years.map((n) => String(n))}
              selectedIndex={Math.max(0, y - DATE_MIN_YEAR)}
              onCommit={(i) => {
                const ny = DATE_MIN_YEAR + i
                setY(ny)
                commit(d, m, ny)
              }}
              flex={1.2}
            />
          </View>
        </Animated.View>
      ) : null}
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MoneyField — a decimal-pad amount input with a right-aligned unit affordance.
// Composes the spine `FormField` chrome (label · required · hint/error) and
// forwards the keyboard/ref props for focus chaining. The wire value is the
// decimal STRING the products API expects; the operator types „199.90".
//
// The affordance defaults to „€" so a price reads like money, but it is honest
// about what the value IS: pass `suffix="g"` for a gram weight, or `suffix={null}`
// for a pure ratio (Feinheit) so NO unit is overlaid. When there is no suffix the
// input drops its reserved right padding so the field reads as a plain number.
// ─────────────────────────────────────────────────────────────────────────────

export function MoneyField({
  label,
  value,
  onChangeText,
  placeholder = "0.00",
  hint,
  error,
  required,
  inputRef,
  suffix = "€",
  ...inputProps
}: {
  label: string
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
  hint?: string
  error?: string
  required?: boolean
  inputRef?: RefObject<InputRef | null>
  /** Right-aligned unit affordance. „€" by default; „g" for a weight; `null`
   *  for a unit-less ratio (e.g. Feinheit) so nothing is overlaid. */
  suffix?: string | null
} & Omit<TextInputProps, "value" | "onChangeText" | "placeholder">): ReactNode {
  const t = useW14Theme()
  const invalid = !!error
  // Reserve the right gutter only when there is a unit to show — a unit-less
  // field reads as a plain number with the spine's standard padding.
  const hasSuffix = suffix != null && suffix !== ""
  return (
    <FormField label={label} required={required} hint={hint} error={error}>
      <View className="relative justify-center">
        <Input
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          keyboardType="decimal-pad"
          inputMode="decimal"
          aria-invalid={invalid}
          className={hasSuffix ? "pr-9 font-mono" : "font-mono"}
          style={invalid ? { borderColor: t.colors.destructive } : undefined}
          accessibilityLabel={label}
          {...inputProps}
        />
        {hasSuffix ? (
          <View className="absolute right-3" pointerEvents="none">
            <Text
              className="font-mono-medium text-base"
              style={{ color: t.colors.mutedForeground }}
            >
              {suffix}
            </Text>
          </View>
        ) : null}
      </View>
    </FormField>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MetalWeightField — Gewicht (g) + Feinheit on one row, decimal-pad, with a live
// Feingewicht read-out (Gewicht × Feinheit) so the operator sees the melt basis
// as they type. The read-out is honest: it appears only when BOTH values parse
// to real numbers; otherwise the field shows its plain hint.
// ─────────────────────────────────────────────────────────────────────────────

export function MetalWeightField({
  weight,
  onWeightChange,
  fineness,
  onFinenessChange,
  weightError,
  finenessError,
  weightRef,
  finenessRef,
  onWeightSubmit,
  onFinenessSubmit,
}: {
  weight: string
  onWeightChange: (text: string) => void
  fineness: string
  onFinenessChange: (text: string) => void
  weightError?: string
  finenessError?: string
  weightRef?: RefObject<InputRef | null>
  finenessRef?: RefObject<InputRef | null>
  onWeightSubmit?: () => void
  onFinenessSubmit?: () => void
}): ReactNode {
  const t = useW14Theme()

  // The melt basis preview — only real when both numbers parse (honesty rule).
  const feingewicht = useMemo(() => {
    const w = Number(weight.trim())
    const f = Number(fineness.trim())
    if (!weight.trim() || !fineness.trim()) return null
    if (!Number.isFinite(w) || !Number.isFinite(f) || w <= 0 || f <= 0) return null
    return (w * f).toLocaleString("de-DE", { maximumFractionDigits: 3 })
  }, [weight, fineness])

  return (
    <View className="gap-1.5">
      <View className="flex-row gap-3">
        <View className="flex-1">
          <MoneyField
            label="Gewicht (g)"
            value={weight}
            onChangeText={onWeightChange}
            placeholder="4.20"
            error={weightError}
            inputRef={weightRef}
            // A gram weight is not money — show „g", never „€".
            suffix="g"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={onWeightSubmit}
          />
        </View>
        <View className="flex-1">
          <MoneyField
            label="Feinheit"
            value={fineness}
            onChangeText={onFinenessChange}
            placeholder="0.585"
            error={finenessError}
            inputRef={finenessRef}
            // A 0–1 ratio carries no unit — overlay nothing (no „€", no „g").
            suffix={null}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={onFinenessSubmit}
          />
        </View>
      </View>
      {feingewicht ? (
        <View className="flex-row items-center justify-between">
          <Text className="text-muted-foreground text-2xs">Feingewicht (Schmelzbasis)</Text>
          <Text className="font-mono-medium text-xs" style={{ color: t.colors.foreground }}>
            {feingewicht} g
          </Text>
        </View>
      ) : (
        <Text className="text-muted-foreground text-2xs">
          Optional bei Edelmetallware. Feingewicht = Gewicht × Feinheit.
        </Text>
      )}
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CategoryPicker — a searchable single-choice picker for the taxonomy. A flat
// chip wall does not scale to a deep tree, so this filters as the operator types
// and pins the selected node at the top with a verdigris check. „Ohne" clears.
// ─────────────────────────────────────────────────────────────────────────────

export interface CategoryChoice {
  value: string
  label: string
}

export function CategoryPicker({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<CategoryChoice>
  value: string | null
  onChange: (value: string | null) => void
}): ReactNode {
  const t = useW14Theme()
  const [open, setOpen] = useState(false)
  const lockScroll = useContext(WheelScrollLock)
  const chevron = useSharedValue(0)
  const reduceMotion = useReduceMotion()

  // Parse the flat "Root" / "Root › Child" labels back into a 2-level tree so the
  // owner spins a Hauptkategorie wheel, then an Unterkategorie wheel — never a wall
  // of printed chips.
  const roots = useMemo(() => {
    const map = new Map<
      string,
      { name: string; value: string | null; children: { name: string; value: string }[] }
    >()
    for (const o of options) {
      const parts = o.label.split("›").map((s) => s.trim())
      if (parts.length === 1) {
        const existing = map.get(parts[0])
        if (existing) existing.value = o.value
        else map.set(parts[0], { name: parts[0], value: o.value, children: [] })
      }
    }
    for (const o of options) {
      const parts = o.label.split("›").map((s) => s.trim())
      if (parts.length >= 2) {
        let r = map.get(parts[0])
        if (!r) {
          r = { name: parts[0], value: null, children: [] }
          map.set(parts[0], r)
        }
        r.children.push({ name: parts[1], value: o.value })
      }
    }
    return Array.from(map.values())
  }, [options])

  const selectedLabel = useMemo(
    () => options.find((o) => o.value === value)?.label ?? null,
    [options, value],
  )

  // Resolve the current value to a (root, child) index pair for the two wheels.
  const { rootIndex, childIndex } = useMemo(() => {
    if (value == null) return { rootIndex: 0, childIndex: 0 }
    for (let r = 0; r < roots.length; r++) {
      const root = roots[r]
      if (root.value === value) return { rootIndex: r + 1, childIndex: 0 }
      const ci = root.children.findIndex((c) => c.value === value)
      if (ci >= 0) return { rootIndex: r + 1, childIndex: ci + 1 }
    }
    return { rootIndex: 0, childIndex: 0 }
  }, [roots, value])

  const activeRoot = rootIndex > 0 ? roots[rootIndex - 1] ?? null : null
  const hasChildren = !!activeRoot && activeRoot.children.length > 0

  const rootLabels = useMemo(() => ["Ohne", ...roots.map((r) => r.name)], [roots])
  const childLabels = useMemo(
    () => (activeRoot ? [`Nur ${activeRoot.name}`, ...activeRoot.children.map((c) => c.name)] : []),
    [activeRoot],
  )

  const commitRoot = (ri: number) => {
    if (ri === rootIndex) return
    haptics.selection()
    if (ri <= 0) {
      onChange(null)
      return
    }
    const root = roots[ri - 1]
    if (root) onChange(root.value)
  }
  const commitChild = (ci: number) => {
    if (ci === childIndex) return
    haptics.selection()
    if (!activeRoot) return
    if (ci <= 0) {
      onChange(activeRoot.value)
      return
    }
    const child = activeRoot.children[ci - 1]
    if (child) onChange(child.value)
  }

  const toggle = () => {
    haptics.selection()
    const next = !open
    chevron.value = reduceMotion ? (next ? 1 : 0) : withTiming(next ? 1 : 0, timingHover("fast"))
    setOpen(next)
    lockScroll?.(next)
  }
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevron.value * 180}deg` }],
  }))

  const pad = WHEEL_ITEM_H * WHEEL_CENTER

  return (
    <View style={{ gap: 8 }}>
      <PressableScale onPress={toggle} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            minHeight: t.touch.min,
            paddingHorizontal: 14,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: open ? t.colors.gilt : t.colors.border,
            backgroundColor: t.colors.card,
          }}
        >
          <Text
            className="font-medium"
            style={{
              fontSize: 16,
              lineHeight: 22,
              color: selectedLabel ? t.colors.foreground : t.colors.mutedForeground,
            }}
            numberOfLines={1}
          >
            {selectedLabel ?? "Ohne Kategorie"}
          </Text>
          <Animated.View style={chevronStyle}>
            <ChevronDown size={t.icon.sm} color={t.colors.mutedForeground} />
          </Animated.View>
        </View>
      </PressableScale>

      {open ? (
        <Animated.View
          entering={FadeIn.duration(reduceMotion ? 0 : duration.fast)}
          style={{ height: WHEEL_ITEM_H * WHEEL_VISIBLE }}
        >
          {/* The gilt band the chosen Haupt- and Unterkategorie rest in. */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: pad,
              height: WHEEL_ITEM_H,
              borderRadius: 10,
              borderTopWidth: 1,
              borderBottomWidth: 1,
              borderColor: `${t.colors.gilt}5e`,
              backgroundColor: `${t.colors.foreground}0a`,
            }}
          />
          <View style={{ flexDirection: "row" }}>
            <WheelColumn options={rootLabels} selectedIndex={rootIndex} onCommit={commitRoot} flex={1} />
            {hasChildren ? (
              <WheelColumn
                key={activeRoot?.name ?? "none"}
                options={childLabels}
                selectedIndex={childIndex}
                onCommit={commitChild}
                flex={1.4}
              />
            ) : null}
          </View>
        </Animated.View>
      ) : null}
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Stepper — a compact − / value / + control for bounded integers (quantity,
// year, Michel-Nummer). Haptic on each step; respects min/max bounds; the
// buttons dim at the boundary so the operator never taps into a dead state.
// ─────────────────────────────────────────────────────────────────────────────

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 9999,
  step = 1,
  suffix,
}: {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}): ReactNode {
  const { colors } = useW14Theme()
  const dec = () => { haptics.selection(); onChange(Math.max(min, value - step)) }
  const inc = () => { haptics.selection(); onChange(Math.min(max, value + step)) }
  const atMin = value <= min
  const atMax = value >= max
  return (
    <View className="flex-row items-center overflow-hidden rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Verringern"
        onPress={dec}
        disabled={atMin}
        style={{ opacity: atMin ? 0.35 : 1, paddingHorizontal: 16, paddingVertical: 10 }}
      >
        <Text style={{ fontSize: 18, color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>−</Text>
      </PressableScale>
      <View style={{ paddingHorizontal: 14, paddingVertical: 10, minWidth: 56, alignItems: "center", borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.border }}>
        <Text style={{ fontSize: 16, color: colors.foreground, fontFamily: "JetBrainsMono_500Medium" }}>
          {value}{suffix ? ` ${suffix}` : ""}
        </Text>
      </View>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Erhöhen"
        onPress={inc}
        disabled={atMax}
        style={{ opacity: atMax ? 0.35 : 1, paddingHorizontal: 16, paddingVertical: 10 }}
      >
        <Text style={{ fontSize: 18, color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>+</Text>
      </PressableScale>
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SegmentedControl — a compact segmented toggle for 2-4 mutually exclusive
// options (Ja/Nein, Aktiv/Inaktiv, Postfrisch/Gestempelt). More space-
// efficient than ChipSelect for short binary/ternary choices. The selected
// segment fills ink; the others are bare with a hairline divider between.
// ─────────────────────────────────────────────────────────────────────────────

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
}): ReactNode {
  const { colors } = useW14Theme()
  return (
    <View className="flex-row overflow-hidden rounded-lg" style={{ borderWidth: 1, borderColor: colors.border }}>
      {options.map((opt, i) => {
        const selected = opt.value === value
        return (
          <PressableScale
            key={opt.value}
            accessibilityRole="button"
            accessibilityLabel={opt.label}
            accessibilityState={{ selected }}
            onPress={() => { haptics.selection(); onChange(opt.value) }}
            style={{
              flex: 1,
              paddingVertical: 10,
              alignItems: "center",
              backgroundColor: selected ? colors.foreground : colors.card,
              borderRightWidth: i < options.length - 1 ? 1 : 0,
              borderRightColor: colors.border,
            }}
          >
            <Text style={{
              fontSize: 14,
              fontFamily: "Inter_500Medium",
              color: selected ? colors.primaryForeground : colors.foreground,
            }}>
              {opt.label}
            </Text>
          </PressableScale>
        )
      })}
    </View>
  )
}
