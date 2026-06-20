/**
 * PinPad — the premium numeric PIN entry for the login surface.
 *
 * A row of brass dots that fill as digits land, over a calm 3×4 keypad. Every
 * key is a spine `PressableScale` (the same press feel as the rest of the app)
 * with a selection haptic per tap; the dots shake (spine motion, reduce-motion
 * aware) when the parent reports a wrong PIN. Keys are ≥48px — money-grade
 * targets — and labelled in German for VoiceOver.
 *
 * It owns no auth and no PIN value beyond what it is handed: the parent holds
 * the digits and submits when the row fills. Honest by construction — it only
 * ever renders the real entered length, never a placeholder figure.
 */
import { useEffect, type ReactNode } from "react"
import { View } from "react-native"
import { Delete } from "lucide-react-native"
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from "react-native-reanimated"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { duration, easing, haptics, PressableScale, useReduceMotion } from "@/warehouse14/ui"

export interface PinPadProps {
  /** Current entered length (0..length). The parent owns the digits. */
  filled: number
  /** Total PIN length (number of dots / submit threshold). */
  length: number
  /** Append a digit. Ignored by the parent once full. */
  onDigit: (digit: string) => void
  /** Remove the last digit. */
  onBackspace: () => void
  /** Bumped by the parent on a wrong PIN to replay the shake + clear the dots. */
  errorNonce?: number
  /** Disable the pad while a submit is in flight. */
  disabled?: boolean
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const

export function PinPad({
  filled,
  length,
  onDigit,
  onBackspace,
  errorNonce = 0,
  disabled = false,
}: PinPadProps): ReactNode {
  const t = useW14Theme()
  const reduceMotion = useReduceMotion()

  // Shake offset (px) driven on the wrong-PIN nonce; reduce motion skips it.
  const shake = useSharedValue(0)
  useEffect(() => {
    if (errorNonce === 0 || reduceMotion) return
    shake.value = withSequence(
      withTiming(-9, { duration: duration.instant, easing: easing.standard }),
      withTiming(9, { duration: duration.instant, easing: easing.standard }),
      withTiming(-6, { duration: duration.instant, easing: easing.standard }),
      withTiming(0, { duration: duration.fast, easing: easing.standard }),
    )
    // Only on a new error event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorNonce])

  const dotsStyle = useAnimatedStyle(() => {
    "worklet"
    return { transform: [{ translateX: shake.value }] }
  })

  function press(digit: string): void {
    if (disabled) return
    haptics.selection()
    onDigit(digit)
  }

  function back(): void {
    if (disabled || filled === 0) return
    haptics.selection()
    onBackspace()
  }

  return (
    <View className="items-center gap-8">
      {/* PIN dots — brass when filled, hairline ring when empty. */}
      <Animated.View
        style={dotsStyle}
        className="flex-row items-center justify-center gap-4"
        accessibilityRole="text"
        accessibilityLabel={`PIN, ${filled} von ${length} Ziffern eingegeben`}
      >
        {Array.from({ length }).map((_, i) => {
          const on = i < filled
          return (
            <View
              key={i}
              className="rounded-full"
              style={{
                width: 14,
                height: 14,
                backgroundColor: on ? t.colors.primary : "transparent",
                borderWidth: on ? 0 : 1.5,
                borderColor: t.colors.border,
              }}
            />
          )
        })}
      </Animated.View>

      {/* 3×4 keypad. */}
      <View className="w-full items-center gap-3">
        {[0, 1, 2].map((row) => (
          <View key={row} className="flex-row justify-center gap-3">
            {KEYS.slice(row * 3, row * 3 + 3).map((k) => (
              <Key key={k} label={k} onPress={() => press(k)} disabled={disabled} />
            ))}
          </View>
        ))}
        {/* Last row: empty · 0 · backspace. */}
        <View className="flex-row justify-center gap-3">
          <View style={{ width: KEY_SIZE, height: KEY_SIZE }} />
          <Key label="0" onPress={() => press("0")} disabled={disabled} />
          <Key
            glyph={<Delete size={t.icon.lg} color={t.colors.mutedForeground} strokeWidth={1.75} />}
            accessibilityLabel="Letzte Ziffer löschen"
            onPress={back}
            disabled={disabled || filled === 0}
            ghost
          />
        </View>
      </View>
    </View>
  )
}

const KEY_SIZE = 72

interface KeyProps {
  label?: string
  glyph?: ReactNode
  accessibilityLabel?: string
  onPress: () => void
  disabled?: boolean
  /** A bare key with no fill (the backspace) vs the filled digit keys. */
  ghost?: boolean
}

function Key({ label, glyph, accessibilityLabel, onPress, disabled, ghost }: KeyProps): ReactNode {
  const t = useW14Theme()
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `Ziffer ${label}`}
      className="items-center justify-center rounded-full"
      style={{
        width: KEY_SIZE,
        height: KEY_SIZE,
        backgroundColor: ghost ? "transparent" : t.colors.card,
        borderWidth: ghost ? 0 : 1,
        borderColor: t.colors.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {glyph ?? <Text className="text-foreground text-2xl font-semibold">{label}</Text>}
    </PressableScale>
  )
}
