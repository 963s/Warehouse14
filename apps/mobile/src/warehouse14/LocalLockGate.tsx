/**
 * LocalLockGate — the device second factor, the mobile mirror of the desktop
 * `apps/tauri-pos/src/components/LocalLockGate.tsx`.
 *
 * Wraps the authenticated app. A valid Google session is NOT enough to open the
 * shell: the device is locked on every cold start and whenever the app returns
 * from the background, and the owner must enter the per-device code (or set one
 * on first use). The code never leaves the phone (see `local-lock.ts`); it only
 * gates re-entry so a grabbed unlocked phone cannot walk straight in.
 *
 * When there is no session the gate is transparent (the root redirect shows the
 * login screen). "Abmelden" here runs the full sign-out cascade.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { AppState, Pressable, ScrollView, View } from "react-native"

import { Text } from "@/components/ui/text"
import { signOut } from "@/warehouse14/api"
import { clearLocalPin, hasLocalPin, setLocalPin, verifyLocalPin } from "@/warehouse14/local-lock"
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

  useEffect(() => {
    let alive = true
    void hasLocalPin().then((has) => {
      if (alive) setMode(has ? "verify" : "create")
    })
    return () => {
      alive = false
    }
  }, [])

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
        ? "Vergib einen Code für dieses Gerät."
        : "Zur Bestätigung erneut eingeben."
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

  // Re-lock whenever the app returns from the background — the mobile equivalent
  // of the desktop's idle re-lock, and stricter: leaving the app re-arms the code.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") setUnlocked(false)
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
