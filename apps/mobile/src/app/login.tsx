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
 *   • the warm paper ground (PaperGrain gives the subtle aged tooth) — depth
 *     comes from hierarchy + a hairline, never a glow or bloom;
 *   • the GENUINE shop logo (the same WAREHOUSE 14 mark as the splash) seated in
 *     a calm medallion that breathes in once and then holds still;
 *   • a custom PIN pad with engraved, recessing keys, a spring-pop dot
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
import { ScrollView, useWindowDimensions, View } from "react-native"
import { ApiError } from "@warehouse14/api-client"
import Animated from "react-native-reanimated"

import { Text } from "@/components/ui/text"
import { describeError, pinLogin } from "@/warehouse14/api"
import { setSession } from "@/warehouse14/session"
import { useW14Theme } from "@/warehouse14/theme"
import {
  haptics,
  itemEnter,
  PaperGrain,
  screenEnter,
  useReduceMotion,
  useScreenInsets,
} from "@/warehouse14/ui"

import { PinPad } from "./_login/PinPad"
import { WarehouseMark } from "./_login/WarehouseMark"

const PIN_LENGTH = 4

/**
 * The login surface describes a failure in the OWNER's login vocabulary, then
 * defers everything else to the shared `describeError`. Only two codes are
 * reframed here, because the app-wide default reads wrong on the brand surface:
 *
 *   • NOT_FOUND (404) — the shared default is "Datensatz nicht gefunden", which
 *     is opaque on a login (the owner entered a PIN, not opened a record). A 404
 *     from the PIN-login route means the seeded device or the owner could not be
 *     resolved — a pairing/setup state, never a wrong PIN. Name THAT, so the
 *     screen never blames the entered PIN with a "record" word.
 *   • RATE_LIMITED (429) — calm and login-framed. When the server sends a real
 *     Retry-After (surfaced as `details.retryAfterMs`), show an honest seconds
 *     countdown; otherwise the calm "gleich wieder" line. Never a fabricated
 *     wait — only a number the server actually gave us.
 *
 * Every other failure (the wrong-PIN 401, the lockout 423, a timeout, a hard
 * offline) already reads perfectly through the shared describer, so we delegate
 * — no parallel error vocabulary, one honest source per case.
 */
function describeLoginError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "NOT_FOUND") {
      return "Dieses Gerät ist noch nicht eingerichtet. Bitte den Support kontaktieren."
    }
    if (err.code === "RATE_LIMITED") {
      const retryAfterMs = (err.details as { retryAfterMs?: number } | undefined)?.retryAfterMs
      const secs =
        typeof retryAfterMs === "number" && retryAfterMs > 0 ? Math.ceil(retryAfterMs / 1000) : null
      return secs
        ? `Zu viele Versuche in ${secs} Sek. erneut versuchen.`
        : "Zu viele Versuche bitte einen Moment warten, dann erneut versuchen."
    }
  }
  return describeError(err)
}

export default function LoginScreen(): ReactNode {
  const t = useW14Theme()
  const insets = useScreenInsets()
  const reduceMotion = useReduceMotion()
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
      setError(describeLoginError(e))
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

  // The intro is DISABLED — the owner wants to go straight to the PIN pad.
  // (if (!seenIntro) return <OnboardingIntro ... /> was here; removed per owner
  // request: no splash/intro, just the lock screen.)

  // Compact phones tighten the internal gaps so the centred group breathes
  // without overflowing on a short screen.
  const compact = height < 720

  // The honest status line: ready → signing in → the themed error.
  const statusLabel = error ?? (busy ? "Wird angemeldet …" : "Bitte gib deine PIN ein")

  // The hero + PIN pad are ONE optically-centred group, not three blocks spread
  // edge-to-edge. The old `justify-between` stretched the stack to fill any
  // height, so on a tall phone the mark floated high and the pad sank toward the
  // home bar. Here the brand + pad live in a single `justify-center` column that
  // stays composed at any device height, and the footer is a separate,
  // non-growing element pinned just above the home indicator.
  const heroGap = compact ? t.space.x2 : t.space.x3
  const groupGap = compact ? t.space.x3_5 : t.space.x5

  return (
    <View className="bg-background flex-1">
      {/* Aged-paper grain the house canvas is warm paper, not a flat cream
          fill (DESIGN.md §1, §5). Sits first, behind all content; pure
          decoration, never under text it must contrast against. */}
      <PaperGrain />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          // Hero up top, keypad anchored toward the bottom (the flexible spacer in
          // the column does the pushing). The bottom padding keeps the "0" row a
          // comfortable, balanced inset above the home indicator — never pinned to
          // the screen edge — and the horizontal padding gives equal left/right
          // margins so the centred pad sits square on screen.
          paddingTop: insets.screen.top + t.space.x2,
          paddingBottom: insets.stickyBottom + 32,
          paddingHorizontal: t.space.x6,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        {/* Owner directive: the whole lock template — logo, welcome, dots and
            keypad — rides ONE upward lift so it sits higher on the screen as a
            single unit, with the freed breathing room dropping to the bottom. The
            lift is translateY only, so the column stays perfectly centred. */}
        <View
          style={{
            flex: 1,
            width: "100%",
            alignItems: "center",
            // Owner zoom: scale the whole lock template up 7% on top of the lift,
            // so logo, welcome, dots and keypad all grow as one.
            transform: [{ translateY: -height * 0.08 }, { scale: 1.07 }],
          }}
        >
        {/* Hero the real brand mark (optically centred) + a calm welcome, seated
            in the upper area. Settles with the spine's screen-enter; the mark
            breathes in once. */}
        <Animated.View
          entering={screenEnter(reduceMotion)}
          className="w-full items-center"
          style={{ maxWidth: 420, gap: heroGap, marginTop: compact ? 0 : t.space.x1 }}
        >
          <WarehouseMark size="lg" />
          {/* Owner: lift the word up from its place (the logo above stays put). */}
          <Text
            className="text-foreground font-display-bold text-center text-4xl leading-tight"
            style={{ transform: [{ translateY: -height * 0.05 }] }}
          >
            Willkommen zurück
          </Text>
        </Animated.View>

        {/* Flexible breathing space pushes the PIN block to the lower third, so the
            keypad rests under the thumb while the welcome stays well clear above
            the dots. */}
        <View style={{ flexGrow: 1 }} />

        {/* PIN entry dots + the clean ink keypad, anchored near the bottom with a
            balanced inset (equal to the side padding, clear of the home bar).
            Carries the shake + flash on error. */}
        <View
          className="w-full items-center"
          style={{ maxWidth: 420, gap: t.space.x4, transform: [{ translateY: -height * 0.05 }] }}
        >
          {/* One reserved status line ABOVE the pad — the calm prompt, the
              signing-in state, or the themed error — in a fixed-height slot so the
              keypad never jumps and stays the bottom-most element with a clean,
              balanced margin to the home bar. */}
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

          <PinPad
            filled={pin.length}
            length={PIN_LENGTH}
            onDigit={onDigit}
            onBackspace={onBackspace}
            errorNonce={errorNonce}
            disabled={busy}
          />
        </View>
        </View>
      </ScrollView>
    </View>
  )
}

