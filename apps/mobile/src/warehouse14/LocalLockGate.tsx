/**
 * LocalLockGate — the device second factor, the mobile mirror of the desktop
 * `apps/tauri-pos/src/components/LocalLockGate.tsx`.
 *
 * Wraps the authenticated app. A valid Google session is NOT enough to open the
 * shell: the device is locked on every cold start and whenever the app returns
 * from the background. Unlocking asks for the phone's BIOMETRICS first
 * (fingerprint / face, owner directive) with the per-device code as the honest
 * fallback — set on first use, never sent to the server (see `local-lock.ts`).
 * On a phone without enrolled biometrics the code alone gates re-entry.
 *
 * When there is no session the gate is transparent (the root redirect shows the
 * login screen). "Abmelden" here runs the full sign-out cascade.
 */
import * as LocalAuthentication from "expo-local-authentication"
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { AppState, Pressable, ScrollView, View } from "react-native"

import { Text } from "@/components/ui/text"
import { signOut } from "@/warehouse14/api"
import { clearLocalPin, readLocalPinState, setLocalPin, verifyLocalPin } from "@/warehouse14/local-lock"
import { clearSession, useSession } from "@/warehouse14/session"
import { useW14Theme } from "@/warehouse14/theme"
import { haptics, PaperGrain, useScreenInsets } from "@/warehouse14/ui"

import { PinPad } from "@/app/_login/PinPad"
import { WarehouseMark } from "@/app/_login/WarehouseMark"

const PIN_LENGTH = 4

type Mode = "loading" | "verify" | "create"

function LocalLock({ onUnlock }: { onUnlock: () => void }): ReactNode {
  const t = useW14Theme()
  const insets = useScreenInsets()

  const [mode, setMode] = useState<Mode>("loading")
  const [pin, setPin] = useState("")
  const [firstCode, setFirstCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [errorNonce, setErrorNonce] = useState(0)
  /** The secure store did not ANSWER (read failed) — fail closed in verify. */
  const [storeUnreadable, setStoreUnreadable] = useState(false)

  useEffect(() => {
    let alive = true
    void readLocalPinState().then((state) => {
      if (!alive) return
      // FAIL CLOSED: only a keystore that genuinely answered "no value" may
      // offer to create a code. A read ERROR stays in verify — biometrics (which
      // never touch the stored hash) still unlock; a fresh create would let any
      // holder of the phone set their own code over the owner's.
      if (state === "unset") {
        setMode("create")
      } else {
        setMode("verify")
        if (state === "error") setStoreUnreadable(true)
      }
    })
    return () => {
      alive = false
    }
  }, [])

  // Biometrics (owner directive): once a code exists, the lock ASKS for the
  // phone's fingerprint / face first — the code pad stays as the fallback.
  // `disableDeviceFallback` keeps the OS from substituting the phone PIN; our
  // own device code is the only fallback. On failure or cancel the pad is
  // simply there, plus a retry button. Never fabricated: the button renders
  // only when hardware + an enrolled biometric genuinely exist.
  const [bioReady, setBioReady] = useState(false)
  const bioPrompted = useRef(false)
  const promptBiometric = useCallback(async () => {
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: "Warehouse 14 entsperren",
        cancelLabel: "Code verwenden",
        disableDeviceFallback: true,
      })
      if (res.success) {
        haptics.success()
        onUnlock()
      }
    } catch {
      // hardware hiccup → the code pad is already on screen; nothing to fake.
    }
  }, [onUnlock])

  useEffect(() => {
    if (mode !== "verify") return
    let alive = true
    // The relock fires on the "background" event, so this component usually
    // MOUNTS while the app is invisible. A biometric sheet cannot show from the
    // background — prompting there would silently consume the one auto-ask and
    // the owner would return to a dead pad. So: auto-prompt immediately only
    // when already active, otherwise arm a listener and ask the moment the app
    // is back in the foreground.
    let detected = false
    const tryAutoPrompt = (): void => {
      if (!alive || !detected || bioPrompted.current) return
      if (AppState.currentState !== "active") return
      bioPrompted.current = true
      void promptBiometric()
    }
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") tryAutoPrompt()
    })
    void (async () => {
      try {
        const [hw, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ])
        if (!alive || !hw || !enrolled) return
        detected = true
        setBioReady(true)
        tryAutoPrompt()
      } catch {
        // detection failed → code-only, honestly.
      }
    })()
    return () => {
      alive = false
      sub.remove()
    }
  }, [mode, promptBiometric])

  const fail = useCallback((message: string) => {
    haptics.error()
    setError(message)
    setPin("")
    setErrorNonce((n) => n + 1)
  }, [])

  const complete = useCallback(
    async (value: string) => {
      setBusy(true)
      setError(null)
      try {
        if (mode === "verify") {
          const ok = await verifyLocalPin(value)
          if (ok) {
            haptics.success()
            onUnlock()
          } else {
            fail("Falscher Code. Bitte erneut versuchen.")
          }
          return
        }
        // create: first entry captures, second confirms.
        if (firstCode === null) {
          setFirstCode(value)
          setPin("")
          return
        }
        if (firstCode === value) {
          await setLocalPin(value)
          haptics.success()
          onUnlock()
        } else {
          setFirstCode(null)
          fail("Die Codes stimmen nicht überein. Bitte neu vergeben.")
        }
      } catch {
        // A keystore write (create) or digest (verify) failure must never be a
        // silent dead end: clear the row, say what happened, stay locked.
        fail("Der sichere Speicher hat nicht geantwortet. Bitte erneut versuchen.")
      } finally {
        setBusy(false)
      }
    },
    [mode, firstCode, onUnlock, fail],
  )

  // Auto-submit once the row fills (mirrors the login screen).
  const submitted = useRef<string | null>(null)
  useEffect(() => {
    if (pin.length !== PIN_LENGTH) {
      submitted.current = null
      return
    }
    if (busy || submitted.current === pin) return
    submitted.current = pin
    void complete(pin)
  }, [pin, busy, complete])

  const onDigit = useCallback((digit: string) => {
    setError(null)
    setPin((prev) => (prev.length >= PIN_LENGTH ? prev : prev + digit))
  }, [])

  const onBackspace = useCallback(() => {
    setError(null)
    setPin((prev) => prev.slice(0, -1))
  }, [])

  const onSignOut = useCallback(async () => {
    try {
      await signOut()
    } catch {
      // best-effort server revoke; still wipe locally.
    } finally {
      await clearLocalPin()
      clearSession()
    }
  }, [])

  const prompt =
    mode === "create"
      ? firstCode === null
        ? "Gerätecode vergeben"
        : "Code wiederholen"
      : "Gerätecode eingeben"

  const status =
    error ??
    (mode === "create"
      ? firstCode === null
        ? bioReady
          ? "Einmalig einen Code für dieses Gerät vergeben. Danach entsperrst du bequem mit Fingerabdruck oder Gesicht; der Code bleibt dein Ersatzschlüssel."
          : "Einmalig einen Code für dieses Gerät vergeben. Er wird bei jedem Öffnen der App abgefragt."
        : "Zur Bestätigung erneut eingeben."
      : storeUnreadable
        ? "Der sichere Speicher ist gerade nicht lesbar. Biometrisch entsperren oder abmelden."
        : bioReady
          ? "Mit Fingerabdruck oder Gesicht entsperren, oder den Gerätecode eingeben."
          : "Zum Entsperren den Gerätecode eingeben.")

  return (
    <View className="bg-background flex-1">
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: "center",
          paddingTop: insets.screen.top + t.space.x6,
          paddingBottom: insets.stickyBottom + 32,
          paddingHorizontal: t.space.x6,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        <View className="w-full items-center" style={{ maxWidth: 420, gap: t.space.x3 }}>
          <WarehouseMark size="lg" />
          <Text className="text-foreground font-display-bold text-center text-3xl leading-tight">
            {prompt}
          </Text>
        </View>

        <View style={{ flexGrow: 1 }} />

        <View className="w-full items-center" style={{ maxWidth: 420, gap: t.space.x4 }}>
          <View
            style={{ minHeight: 22, paddingHorizontal: t.space.x2 }}
            className="items-center justify-center"
          >
            <Text
              className={`text-center text-sm font-medium ${error ? "text-destructive" : "text-muted-foreground"}`}
              numberOfLines={2}
            >
              {status}
            </Text>
          </View>

          <PinPad
            filled={pin.length}
            length={PIN_LENGTH}
            onDigit={onDigit}
            onBackspace={onBackspace}
            errorNonce={errorNonce}
            disabled={busy || mode === "loading"}
          />

          {mode === "verify" && bioReady && (
            <Pressable
              onPress={() => void promptBiometric()}
              accessibilityRole="button"
              hitSlop={8}
              className="px-4 py-2"
              style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
            >
              <Text className="text-foreground text-center text-sm font-semibold">
                Biometrisch entsperren
              </Text>
            </Pressable>
          )}

          <Pressable
            onPress={() => void onSignOut()}
            accessibilityRole="button"
            hitSlop={8}
            className="mt-1 px-4 py-2"
            style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}
          >
            <Text className="text-muted-foreground text-center text-sm underline">Abmelden</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  )
}

export function LocalLockGate({ children }: { children: ReactNode }): ReactNode {
  const { isAuthenticated } = useSession()
  // Locked on every cold start; the gate is only consulted while authenticated.
  const [unlocked, setUnlocked] = useState(false)

  // Re-lock whenever the app genuinely leaves the foreground — the mobile
  // equivalent of the desktop's idle re-lock, and stricter: leaving the app
  // re-arms the lock. Deliberately "background" only: iOS fires "inactive" for
  // transient overlays (control centre, the Face-ID sheet itself), which would
  // thrash the lock without any real departure. Android has no "inactive".
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") setUnlocked(false)
    })
    return () => sub.remove()
  }, [])

  // A fresh sign-out (no session) must reset the unlocked flag so the next login
  // is gated again.
  useEffect(() => {
    if (!isAuthenticated) setUnlocked(false)
  }, [isAuthenticated])

  if (isAuthenticated && !unlocked) {
    return <LocalLock onUnlock={() => setUnlocked(true)} />
  }
  return <>{children}</>
}
