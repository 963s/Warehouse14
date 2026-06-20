/**
 * Login — the first impression of the Owner OS.
 *
 * P0 auth: `pinLogin` resolves the owner from the seeded dev device (the
 * X-Dev-Device-Fingerprint header) plus the PIN; no email. The returned session
 * token is stored and carried as Bearer on every later request; the root auth
 * gate redirects into the tab shell once it lands.
 *
 * This is the brand surface, so it is built to feel premium on the first tap:
 * the VaultCrest brand mark, a custom brass PIN pad (spine press feel + haptics),
 * an auto-submit when the row fills, and a shake + Error haptic on a wrong PIN —
 * all from the shared spine, nothing hand-rolled. On the very first cold open it
 * leads with a calm three-slide intro (gated by `onboarding.ts`); the owner can
 * always re-open it from here.
 *
 * Honesty: the only figures on screen are the entered PIN length and the DEV
 * connection hint — no fabricated state. A failure shows the themed
 * `describeError` message, never a guess.
 */
import { useCallback, useState, type ReactNode } from "react"
import { View } from "react-native"
import Animated from "react-native-reanimated"

import { Text } from "@/components/ui/text"
import { API_BASE_URL, describeError, pinLogin } from "@/warehouse14/api"
import { replayOnboarding, useOnboardingSeen } from "@/warehouse14/onboarding"
import { setSession } from "@/warehouse14/session"
import {
  haptics,
  itemEnter,
  PressableScale,
  screenEnter,
  useReduceMotion,
  useScreenInsets,
} from "@/warehouse14/ui"

import { OnboardingIntro } from "./_login/OnboardingIntro"
import { PinPad } from "./_login/PinPad"
import { VaultCrest } from "./_login/VaultCrest"

const PIN_LENGTH = 4

export default function LoginScreen(): ReactNode {
  const insets = useScreenInsets()
  const reduceMotion = useReduceMotion()
  const seenIntro = useOnboardingSeen()

  const [pin, setPin] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Bumped on each failed attempt → replays the PinPad shake.
  const [errorNonce, setErrorNonce] = useState(0)

  const submit = useCallback(async (value: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await pinLogin(value)
      haptics.success()
      setSession({ token: res.token, actor: res.actor, expiresAt: res.sessionExpiresAt })
      // The root auth gate redirects to the tab shell once the session lands.
    } catch (e) {
      haptics.error()
      setError(describeError(e))
      setPin("")
      setErrorNonce((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }, [])

  const onDigit = useCallback(
    (digit: string) => {
      if (busy) return
      setError(null)
      setPin((prev) => {
        if (prev.length >= PIN_LENGTH) return prev
        const nextPin = prev + digit
        if (nextPin.length === PIN_LENGTH) void submit(nextPin)
        return nextPin
      })
    },
    [busy, submit],
  )

  const onBackspace = useCallback(() => {
    setError(null)
    setPin((prev) => prev.slice(0, -1))
  }, [])

  // First cold open → the calm intro takes the whole screen, then hands back.
  if (!seenIntro) {
    return <OnboardingIntro onDone={() => setPin("")} />
  }

  return (
    <View
      className="bg-background flex-1 items-center justify-between"
      style={{
        paddingTop: insets.screen.top + 24,
        paddingBottom: insets.stickyBottom,
        paddingHorizontal: 24,
      }}
    >
      {/* Hero — brand crest + title. Settles in with the spine's screen-enter. */}
      <Animated.View entering={screenEnter(reduceMotion)} className="items-center gap-4 pt-6">
        <VaultCrest size="lg" />
        <View className="items-center gap-1.5">
          <Text className="text-foreground text-3xl font-bold">Warehouse14</Text>
          <Text className="text-muted-foreground text-base">
            {busy ? "Wird angemeldet …" : "Mit PIN anmelden"}
          </Text>
        </View>
      </Animated.View>

      {/* PIN entry — dots + brass keypad. Carries the error shake on a wrong PIN. */}
      <View className="w-full items-center gap-4">
        <PinPad
          filled={pin.length}
          length={PIN_LENGTH}
          onDigit={onDigit}
          onBackspace={onBackspace}
          errorNonce={errorNonce}
          disabled={busy}
        />

        {/* One reserved line for the error so the keypad never jumps. */}
        <View style={{ minHeight: 20 }} className="items-center justify-center px-2">
          {error ? (
            <Animated.View entering={itemEnter(0, reduceMotion)}>
              <Text className="text-destructive text-center text-sm font-medium" numberOfLines={2}>
                {error}
              </Text>
            </Animated.View>
          ) : null}
        </View>
      </View>

      {/* Footer — re-open the intro + the honest DEV connection hint. */}
      <View className="w-full items-center gap-3">
        <PressableScale
          onPress={() => {
            haptics.selection()
            replayOnboarding()
          }}
          accessibilityRole="button"
          accessibilityLabel="App kennenlernen — Einführung erneut ansehen"
          hitSlop={12}
          style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}
        >
          <Text className="text-primary text-sm font-medium">App kennenlernen</Text>
        </PressableScale>

        <Text className="text-muted-foreground text-2xs text-center">
          Dev-Backend · {API_BASE_URL}
          {"\n"}Owner basel@warehouse14.local · PIN 0000
        </Text>
      </View>
    </View>
  )
}
