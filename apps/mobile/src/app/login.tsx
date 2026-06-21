/**
 * Login — the first impression of the Owner OS, and its lock screen.
 *
 * P0 auth: `pinLogin` resolves the owner from the seeded dev device (the
 * X-Dev-Device-Fingerprint header) plus the PIN; no email. The returned session
 * token is stored and carried as Bearer on every later request; the root auth
 * gate redirects into the tab shell once it lands.
 *
 * This is THE brand surface, so it is built to feel premium on the first tap and
 * to continue the splash without a seam:
 *   • a layered brass canvas — a soft radial bloom up top and a calm vignette —
 *     so the screen has real depth, not a flat fill;
 *   • the GENUINE shop logo (the same WAREHOUSE 14 mark as the splash) seated in
 *     a brass medallion that breathes in once and then holds still;
 *   • a custom brass PIN pad with engraved, recessing keys, a spring-pop dot
 *     row, per-tap haptics, an auto-submit when the row fills, and a shake +
 *     error flash + Error haptic on a wrong PIN — all from the shared spine;
 *   • calm German copy throughout, with one honest status line that only ever
 *     names the real state (ready / signing in / the themed error).
 * On the very first cold open it leads with the calm intro (gated by
 * `onboarding.ts`); the owner can always re-open it from here.
 *
 * Reliability — no abort on re-render: the auto-submit is fired imperatively,
 * exactly once per completed PIN, and the in-flight request is NEVER torn down
 * or re-issued by a re-render. A ref tracks the pin already submitted so the
 * driving effect can re-run freely (StrictMode / concurrent re-renders, OS
 * theme flips, keyboard insets) without double-dispatching or cancelling the
 * request that is mid-flight. We do not pass an AbortSignal: a login attempt the
 * owner has committed to must run to completion and report a real result. This
 * UI guard is now belt-and-suspenders: `pinLogin` routes through the shared
 * api-client `loginSafe`, which ALSO coalesces a double-submit of the same PIN
 * onto one POST, runs detached from any caller signal, and silently re-issues
 * once on a transient network/timeout blip — the same guarantee the cashier
 * gets from the one shared client.
 *
 * Honesty: the only figures on screen are the entered PIN length and the DEV
 * connection hint — no fabricated state. A failure shows the themed
 * `describeError` message, never a guess.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useWindowDimensions, View } from "react-native"
import Animated from "react-native-reanimated"

import { Text } from "@/components/ui/text"
import { API_BASE_URL, describeError, pinLogin } from "@/warehouse14/api"
import { replayOnboarding, useOnboardingSeen } from "@/warehouse14/onboarding"
import { setSession } from "@/warehouse14/session"
import { useW14Theme } from "@/warehouse14/theme"
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
import { WarehouseMark } from "./_login/WarehouseMark"

const PIN_LENGTH = 4

export default function LoginScreen(): ReactNode {
  const t = useW14Theme()
  const insets = useScreenInsets()
  const reduceMotion = useReduceMotion()
  const seenIntro = useOnboardingSeen()
  const { height } = useWindowDimensions()

  const [pin, setPin] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Bumped on each failed attempt → replays the PinPad shake + error flash.
  const [errorNonce, setErrorNonce] = useState(0)

  // Guards a committed attempt against re-render churn (see file header). The
  // `mounted` ref keeps a late-resolving result from touching torn-down state
  // without ever aborting the request the owner committed to.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const submit = useCallback(async (value: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await pinLogin(value)
      haptics.success()
      // The root auth gate redirects to the tab shell once the session lands; we
      // set it regardless of the mounted ref because the session is global state
      // the gate is waiting on — only LOCAL state is guarded below.
      setSession({ token: res.token, actor: res.actor, expiresAt: res.sessionExpiresAt })
    } catch (e) {
      if (!mounted.current) return
      haptics.error()
      setError(describeError(e))
      setPin("")
      setErrorNonce((n) => n + 1)
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [])

  // Auto-submit *after* commit, not from inside the setState updater. React may
  // call an updater more than once (StrictMode/concurrent) and updaters must be
  // pure, so firing the pin-login POST there double-dispatches — halving the
  // backend's 10/min budget and risking spurious RATE_LIMITED. Driving it from
  // an effect keyed on a full, untried pin guarantees exactly one request per
  // attempt; the ref guards against the effect re-running for the same value
  // (which is exactly how a re-render is prevented from re-issuing or aborting
  // the in-flight request).
  const submittedPin = useRef<string | null>(null)
  useEffect(() => {
    if (pin.length !== PIN_LENGTH) {
      // Cleared/backspaced below full — arm for the next complete entry.
      submittedPin.current = null
      return
    }
    if (busy || submittedPin.current === pin) return
    submittedPin.current = pin
    void submit(pin)
  }, [pin, busy, submit])

  const onDigit = useCallback((digit: string) => {
    setError(null)
    setPin((prev) => (prev.length >= PIN_LENGTH ? prev : prev + digit))
  }, [])

  const onBackspace = useCallback(() => {
    setError(null)
    setPin((prev) => prev.slice(0, -1))
  }, [])

  // First cold open → the calm intro takes the whole screen, then hands back.
  if (!seenIntro) {
    return <OnboardingIntro onDone={() => setPin("")} />
  }

  // Compact phones get a tighter hero so the pad never crowds the home bar.
  const compact = height < 720

  // The honest status line: ready → signing in → the themed error.
  const statusLabel = error ?? (busy ? "Wird angemeldet …" : "Bitte gib deine PIN ein")

  return (
    <View className="bg-background flex-1">
      {/* Layered canvas — a soft brass bloom up top + a calm bottom vignette so
          the surface has depth, not a flat fill. Decorative, behind everything,
          never under text it must contrast against. */}
      <BrassCanvas />

      <View
        className="flex-1 items-center justify-between"
        style={{
          paddingTop: insets.screen.top + (compact ? t.space.x4 : t.space.x7),
          paddingBottom: insets.stickyBottom + t.space.x2,
          paddingHorizontal: t.space.x6,
        }}
      >
        {/* Hero — the real brand mark + a calm welcome. Settles with the spine's
            screen-enter; the mark itself breathes in once. */}
        <Animated.View
          entering={screenEnter(reduceMotion)}
          className="items-center"
          style={{ gap: compact ? t.space.x4 : t.space.x5, paddingTop: compact ? 0 : t.space.x4 }}
        >
          <WarehouseMark size="lg" />
          <View className="items-center" style={{ gap: t.space.x2 }}>
            <Text
              className="text-primary text-2xs font-semibold uppercase"
              style={{ letterSpacing: 2 }}
            >
              Warehouse 14
            </Text>
            <Text className="text-foreground text-center text-3xl font-bold">Willkommen zurück</Text>
          </View>
        </Animated.View>

        {/* PIN entry — dots + brass keypad. Carries the shake + flash on error. */}
        <View className="w-full items-center" style={{ gap: t.space.x5 }}>
          <PinPad
            filled={pin.length}
            length={PIN_LENGTH}
            onDigit={onDigit}
            onBackspace={onBackspace}
            errorNonce={errorNonce}
            disabled={busy}
          />

          {/* One reserved status line so the keypad never jumps; it carries the
              calm prompt, the signing-in state, or the themed error in place. */}
          <View
            style={{ minHeight: 22, paddingHorizontal: t.space.x2 }}
            className="items-center justify-center"
          >
            <Animated.View key={statusLabel} entering={itemEnter(0, reduceMotion)}>
              <Text
                className={`text-center text-sm font-medium ${error ? "text-destructive" : "text-muted-foreground"}`}
                numberOfLines={2}
              >
                {statusLabel}
              </Text>
            </Animated.View>
          </View>
        </View>

        {/* Footer — re-open the intro + the honest DEV connection hint. */}
        <View className="w-full items-center" style={{ gap: t.space.x3 }}>
          <PressableScale
            onPress={() => {
              haptics.selection()
              replayOnboarding()
            }}
            accessibilityRole="button"
            accessibilityLabel="App kennenlernen — Einführung erneut ansehen"
            hitSlop={12}
            style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: t.space.x2 }}
          >
            <Text className="text-primary text-sm font-medium">App kennenlernen</Text>
          </PressableScale>

          <Text className="text-muted-foreground text-2xs text-center">
            Dev-Backend · {API_BASE_URL}
            {"\n"}Owner basel@warehouse14.local · PIN 0000
          </Text>
        </View>
      </View>
    </View>
  )
}

/**
 * BrassCanvas — the calm, layered backdrop behind the login. A brass radial
 * bloom near the hero and a soft vignette toward the bottom give the surface
 * depth without a gradient/native-svg dependency: each glow is a stack of large,
 * very-faint concentric brass discs. Purely decorative, behind all content, and
 * never the contrast surface for any text.
 */
function BrassCanvas(): ReactNode {
  const t = useW14Theme()
  const { width } = useWindowDimensions()
  const bloom = width * 1.5

  return (
    <View pointerEvents="none" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {/* Top brass bloom — sits behind the brand mark. */}
      <View
        style={{
          position: "absolute",
          top: -bloom * 0.42,
          left: (width - bloom) / 2,
          width: bloom,
          height: bloom,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {[1, 0.66, 0.4].map((f, i) => (
          <View
            key={i}
            style={{
              position: "absolute",
              width: bloom * f,
              height: bloom * f,
              borderRadius: (bloom * f) / 2,
              backgroundColor: t.colors.primary,
              opacity: t.isDark ? 0.04 : 0.03,
            }}
          />
        ))}
      </View>

      {/* Bottom verdigris vignette — the faintest cool counterweight so the
          canvas is not all warm. Decorative; verdigris is the brand positive. */}
      <View
        style={{
          position: "absolute",
          bottom: -bloom * 0.6,
          left: (width - bloom) / 2,
          width: bloom,
          height: bloom,
          borderRadius: bloom / 2,
          backgroundColor: t.colors.verdigris,
          opacity: t.isDark ? 0.03 : 0.02,
        }}
      />
    </View>
  )
}
