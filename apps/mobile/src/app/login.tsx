/**
 * Login — the first impression of the Owner OS, and its front door.
 *
 * The door is GOOGLE ONLY (owner directive 2026-07-20): the PIN pad that used
 * to live here is gone. Identity comes from the Warehouse14 Google account via
 * the server-brokered flow (same system as the desktop): the OS auth browser
 * opens `/api/admin/auth/google/start`, the server verifies the id_token
 * against the provisioned staff table, mints the session and returns through
 * the `warehouse14://auth-done` deep link. The role is assigned by the SERVER
 * from the staff row — nothing on this screen can escalate it.
 *
 * This is THE brand surface, so it is built to feel premium on the first tap
 * and to continue the splash without a seam:
 *   • the warm paper ground (PaperGrain gives the subtle aged tooth) — depth
 *     comes from hierarchy + a hairline, never a glow or bloom;
 *   • the GENUINE shop logo (the same WAREHOUSE 14 mark as the splash) seated
 *     in a calm medallion that breathes in once and then holds still;
 *   • ONE clear action: the recognizable Google door, seated on a hairline
 *     with one soft shadow, a calm press settle, an honest busy state, and
 *     success/error haptics;
 *   • calm German copy with one honest status line that only ever names the
 *     real state (ready / signing in / the themed error).
 *
 * After the session lands the LocalLockGate takes over: it detects what the
 * device offers (Face ID, Fingerabdruck, Gerätecode), registers the local
 * lock once, and from then on guards every entry — see LocalLockGate.tsx.
 *
 * Honesty: no fabricated state. A failure shows a named, human German message
 * (account not provisioned / cancelled / network), never a guess.
 */
import { useCallback, useState, type ReactNode } from "react"
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native"
import Animated from "react-native-reanimated"

import { Text } from "@/components/ui/text"
import { API_BASE_URL, completeGoogleLogin } from "@/warehouse14/api"
import { signInWithGoogle } from "@/warehouse14/google-login"
import { useW14Theme } from "@/warehouse14/theme"
import {
  haptics,
  itemEnter,
  PaperGrain,
  screenEnter,
  useReduceMotion,
  useScreenInsets,
} from "@/warehouse14/ui"

import { GoogleG } from "./_login/GoogleG"
import { WarehouseMark } from "./_login/WarehouseMark"

export default function LoginScreen(): ReactNode {
  const t = useW14Theme()
  const insets = useScreenInsets()
  const reduceMotion = useReduceMotion()
  const { height } = useWindowDimensions()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleGoogle = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await signInWithGoogle(API_BASE_URL)
      if (res.ok) {
        await completeGoogleLogin(res.token, res.expiresAt)
        haptics.success()
        // The root auth gate + LocalLockGate take over once the session lands.
      } else if (res.error) {
        haptics.error()
        setError(
          res.error === "FORBIDDEN"
            ? "Dieses Google-Konto ist nicht freigeschaltet. Bitte den Inhaber kontaktieren."
            : "Die Google-Anmeldung ist fehlgeschlagen. Bitte erneut versuchen.",
        )
      }
      // res.error === null → the owner closed the browser; leave the screen calm.
    } catch {
      haptics.error()
      setError("Die Anmeldung konnte nicht abgeschlossen werden. Bitte erneut versuchen.")
    } finally {
      setBusy(false)
    }
  }, [])

  // Compact phones tighten the internal gaps so the centred group breathes
  // without overflowing on a short screen.
  const compact = height < 720
  const heroGap = compact ? t.space.x2 : t.space.x3

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
          paddingTop: insets.screen.top + t.space.x2,
          paddingBottom: insets.stickyBottom + 32,
          paddingHorizontal: t.space.x6,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        {/* Owner directive: the whole template — logo, welcome and door — rides
            ONE upward lift so it sits higher on the screen as a single unit,
            with the freed breathing room dropping to the bottom. The lift is
            translateY only, so the column stays perfectly centred. */}
        <View
          style={{
            flex: 1,
            width: "100%",
            alignItems: "center",
            // Owner zoom: scale the whole template up 7% on top of the lift.
            transform: [{ translateY: -height * 0.08 }, { scale: 1.07 }],
          }}
        >
          {/* Hero the real brand mark (optically centred) + a calm welcome,
              seated in the upper area. Settles with the spine's screen-enter;
              the mark breathes in once. */}
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

          {/* Flexible breathing space pushes the door to the lower third, under
              the thumb, while the welcome stays well clear above. */}
          <View style={{ flexGrow: 1 }} />

          {/* The single door, anchored near the bottom. */}
          <View
            className="w-full items-center"
            style={{ maxWidth: 420, gap: t.space.x4, transform: [{ translateY: -height * 0.05 }] }}
          >
            {/* Calm hint / themed error, in a fixed-height slot so the button
                never jumps. Re-keys on the message so it settles in. */}
            <Animated.View
              key={error ?? "hint"}
              entering={itemEnter(0, reduceMotion)}
              style={{ minHeight: 40, paddingHorizontal: t.space.x2 }}
              className="items-center justify-center"
            >
              <Text
                className={`text-center text-sm font-medium ${error ? "text-destructive" : "text-muted-foreground"}`}
                numberOfLines={3}
              >
                {error ?? "Mit dem Warehouse14-Google-Konto anmelden"}
              </Text>
            </Animated.View>

            {/* The door — the recognizable white Google button, seated on a
                hairline (depth from the edge plus ONE soft shadow, never a
                glow), calm press settle, honest busy state. */}
            <Animated.View entering={itemEnter(1, reduceMotion)} className="w-full items-center">
              <Pressable
                onPress={() => void handleGoogle()}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Mit Google anmelden"
                accessibilityState={{ disabled: busy, busy }}
                className="bg-card border-border w-full flex-row items-center justify-center rounded-2xl border"
                style={({ pressed }) => [
                  {
                    maxWidth: 420,
                    height: 58,
                    gap: 12,
                    opacity: busy ? 0.55 : 1,
                    shadowColor: "#000",
                    shadowOpacity: 0.08,
                    shadowRadius: 12,
                    shadowOffset: { width: 0, height: 4 },
                    elevation: 3,
                  },
                  pressed && !busy ? { transform: [{ scale: 0.985 }], opacity: 0.9 } : null,
                ]}
              >
                <GoogleG size={22} />
                <Text
                  className="text-foreground text-base font-semibold"
                  style={{ letterSpacing: 0.2 }}
                >
                  {busy ? "Wird angemeldet …" : "Mit Google anmelden"}
                </Text>
              </Pressable>
            </Animated.View>

            {/* The exclusivity line: names the ONLY way in, so nobody hunts for
                a hidden second method — and what happens right after. */}
            <Animated.View entering={itemEnter(2, reduceMotion)}>
              <Text
                className="text-muted-foreground text-center text-xs leading-relaxed"
                style={{ maxWidth: 320, opacity: 0.85 }}
              >
                Der Zugang ist ausschließlich mit dem freigeschalteten Google-Konto möglich. Danach
                sichert dein Gerät die App zusätzlich mit Face ID, Fingerabdruck oder Gerätecode.
              </Text>
            </Animated.View>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
