/**
 * PinPad — the premium numeric PIN entry for the login + lock surface.
 *
 * A row of ink PIN dots over a calm 3×4 keypad of engraved keys. It is built
 * entirely on the shared spine so it feels like the rest of the app, but with
 * the extra craft the brand surface deserves:
 *
 *   • Dots — an empty hairline ring fills to a solid ink disc with a settled
 *     spring pop as each digit lands; on a wrong PIN the row shakes
 *     (reduce-motion aware) and the dots flash to the wax-red error colour.
 *   • Keys — each is a spine `PressableScale` over an `Animated.View` that
 *     deepens its fill to the raised surface on press, so a tap feels
 *     physically recessed, not just scaled. One clean circle per key — no
 *     nested shapes, no halo, no glow (the design law forbids them).
 *   • Targets — every key is ≥64px (money-grade) and grows on larger screens.
 *   • Haptics — one selection per tap, nothing on render; the parent fires the
 *     success/error notification on the attempt result.
 *   • German — every label is human German for VoiceOver.
 *
 * It owns no auth and no PIN value beyond what it is handed: the parent holds
 * the digits and submits when the row fills. Honest by construction — it only
 * ever renders the real entered length, never a placeholder figure.
 */
import { useEffect, type ReactNode } from "react"
import { useWindowDimensions, View } from "react-native"
import { Delete } from "lucide-react-native"
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import {
  duration,
  easing,
  emphasisSpring,
  haptics,
  PressableScale,
  press,
  useReduceMotion,
} from "@/warehouse14/ui"

export interface PinPadProps {
  /** Current entered length (0..length). The parent owns the digits. */
  filled: number
  /** Total PIN length (number of dots / submit threshold). */
  length: number
  /** Append a digit. Ignored by the parent once full. */
  onDigit: (digit: string) => void
  /** Remove the last digit. */
  onBackspace: () => void
  /** Bumped by the parent on a wrong PIN to replay the shake + error flash. */
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
  const { width } = useWindowDimensions()

  // Responsive key size: comfortable on a phone, generous on a tablet, but the
  // 3-up row (+ gaps + page padding) always fits the viewport.
  const gap = t.space.x4
  const maxKey = 84
  const minKey = 64
  const fitKey = Math.floor((Math.min(width, 460) - t.space.x6 * 2 - gap * 2) / 3)
  const keySize = Math.max(minKey, Math.min(maxKey, fitKey))

  // Shake offset (px) + error flash (0..1), driven on the wrong-PIN nonce.
  const shake = useSharedValue(0)
  const errorFlash = useSharedValue(0)
  useEffect(() => {
    if (errorNonce === 0) return
    errorFlash.value = withSequence(
      withTiming(1, { duration: duration.fast, easing: easing.standard }),
      withDelay(duration.base, withTiming(0, { duration: duration.base, easing: easing.standard })),
    )
    if (reduceMotion) return
    shake.value = withSequence(
      withTiming(-10, { duration: duration.instant, easing: easing.standard }),
      withTiming(10, { duration: duration.instant, easing: easing.standard }),
      withTiming(-7, { duration: duration.instant, easing: easing.standard }),
      withTiming(0, { duration: duration.fast, easing: easing.standard }),
    )
    // Only on a new error event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorNonce])

  const dotsRowStyle = useAnimatedStyle(() => {
    "worklet"
    return { transform: [{ translateX: shake.value }] }
  })

  function pressDigit(digit: string): void {
    if (disabled || filled >= length) return
    haptics.selection()
    onDigit(digit)
  }

  function back(): void {
    if (disabled || filled === 0) return
    haptics.selection()
    onBackspace()
  }

  return (
    <View className="items-center" style={{ gap: t.space.x8 }}>
      {/* PIN dots — fill with a settled spring pop; flash wax-red on a wrong PIN. */}
      <Animated.View
        style={dotsRowStyle}
        className="flex-row items-center justify-center"
        accessibilityRole="text"
        accessibilityLabel={`PIN, ${filled} von ${length} Ziffern eingegeben`}
      >
        {Array.from({ length }).map((_, i) => (
          <View key={i} style={{ paddingHorizontal: t.space.x3 }}>
            <PinDot on={i < filled} index={i} errorFlash={errorFlash} reduceMotion={reduceMotion} />
          </View>
        ))}
      </Animated.View>

      {/* 3×4 keypad. */}
      <View style={{ alignItems: "center", gap }}>
        {[0, 1, 2].map((row) => (
          <View key={row} className="flex-row justify-center" style={{ gap }}>
            {KEYS.slice(row * 3, row * 3 + 3).map((k) => (
              <Key key={k} label={k} size={keySize} onPress={() => pressDigit(k)} disabled={disabled} />
            ))}
          </View>
        ))}
        {/* Last row: spacer · 0 · backspace. */}
        <View className="flex-row justify-center" style={{ gap }}>
          <View style={{ width: keySize, height: keySize }} />
          <Key label="0" size={keySize} onPress={() => pressDigit("0")} disabled={disabled} />
          <Key
            size={keySize}
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

/** A single PIN dot — hairline ring when empty, solid ink disc when filled.
 *  No halo, no nested shapes — a single precise disc that fills with a settled
 *  spring pop. On a wrong PIN the dots flash wax-red (the destructive token). */
interface PinDotProps {
  on: boolean
  index: number
  errorFlash: SharedValue<number>
  reduceMotion: boolean
}

function PinDot({ on, index, errorFlash, reduceMotion }: PinDotProps): ReactNode {
  const t = useW14Theme()
  const SIZE = 14

  // Fill progress 0..1 with a settled pop as the digit lands.
  const fill = useSharedValue(on ? 1 : 0)
  useEffect(() => {
    if (reduceMotion) {
      fill.value = on ? 1 : 0
      return
    }
    fill.value = on ? withSpring(1, emphasisSpring) : withTiming(0, { duration: duration.fast })
  }, [on, reduceMotion, fill])

  const dotStyle = useAnimatedStyle(() => {
    "worklet"
    const flash = errorFlash.value
    const base = fill.value
    return {
      backgroundColor: base > 0.02 ? (flash > 0.5 ? t.colors.destructive : t.colors.foreground) : "transparent",
      borderColor: flash > 0.5 ? t.colors.destructive : t.colors.border,
      borderWidth: base > 0.5 ? 0 : 1.5,
      transform: [{ scale: 0.6 + base * 0.4 }],
    }
  })

  return (
    <View style={{ width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={[dotStyle, { width: SIZE, height: SIZE, borderRadius: SIZE / 2 }]} />
    </View>
  )
}

interface KeyProps {
  label?: string
  glyph?: ReactNode
  accessibilityLabel?: string
  onPress: () => void
  disabled?: boolean
  size: number
  /** A bare key with no fill (the backspace) vs the engraved digit keys. */
  ghost?: boolean
}

function Key({ label, glyph, accessibilityLabel, onPress, disabled, ghost, size }: KeyProps): ReactNode {
  const t = useW14Theme()
  const reduceMotion = useReduceMotion()

  // Press depth — the face deepens its fill to the raised surface on press-in,
  // so a tap feels recessed into the panel rather than only scaled. Ink-only
  // palette (no brass): the key rests on the card, presses into the raised
  // surface, with a hairline border — one clean circle, no nested shapes.
  const depth = useSharedValue(0)
  const faceStyle = useAnimatedStyle(() => {
    "worklet"
    const p = depth.value
    return {
      backgroundColor: ghost
        ? "transparent"
        : p > 0.5
          ? t.colors.raised
          : t.colors.card,
      borderColor: ghost ? "transparent" : p > 0.5 ? t.colors.foreground : t.colors.border,
    }
  })

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `Ziffer ${label}`}
      onPressIn={() => {
        if (reduceMotion) return
        depth.value = withTiming(1, { duration: duration.instant, easing: easing.standard })
      }}
      onPressOut={() => {
        if (reduceMotion) return
        depth.value = withTiming(0, { duration: duration.fast, easing: easing.standard })
      }}
      // Keep the spine scale subtle so the depth fill carries the press feel.
      pressedScale={ghost ? press.scale : 0.96}
      style={{ opacity: disabled ? (ghost ? 0.35 : 0.5) : 1 }}
    >
      <Animated.View
        style={[
          faceStyle,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: ghost ? 0 : 1,
            alignItems: "center",
            justifyContent: "center",
          },
        ]}
      >
        {glyph ?? (
          <Text className="text-foreground font-semibold" style={{ fontSize: size >= 76 ? 30 : 26 }}>
            {label}
          </Text>
        )}
      </Animated.View>
    </PressableScale>
  )
}
