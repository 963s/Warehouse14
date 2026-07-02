/**
 * FormScreen — the labelled-form scaffold for every owner mutation surface
 * (Ausgabe erfassen, Fixkosten, Margen, …). It owns the boring, repeated parts:
 *
 *   • a scrolling, keyboard-aware body with a title + optional subtitle,
 *   • a destructive error banner + a verdigris success banner,
 *   • a sticky primary "Speichern" action with a busy spinner,
 *   • the submit lifecycle: run the async `onSubmit`, map thrown ApiErrors to
 *     German via describeError, surface the message, otherwise show success.
 *
 * STEP-UP is transparent: a 403 STEP_UP_REQUIRED is intercepted by
 * stepUpMiddleware → the global StepUpDialogHost (mounted in the root layout) →
 * the request is retried after the PIN. FormScreen does nothing special for it;
 * a real failure still rejects and lands in the error banner.
 *
 * The caller renders FormFields as `children` and does the actual api-client
 * call inside `onSubmit`.
 */
import { type ReactNode, useRef, useState } from "react"
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import { describeError } from "@/warehouse14/api"
import { useW14Theme } from "@/warehouse14/theme"
import { error as hapticError, selection, success as hapticSuccess } from "@/warehouse14/ui/native/haptics"

export interface FormScreenProps {
  title: string
  subtitle?: string
  children: ReactNode
  /**
   * The mutation. Throw → the message lands in the error banner; resolve →
   * success banner. Resolving `false` is the escape hatch for client-side field
   * validation that already surfaced its message inline (at the offending
   * FormField): it shows neither banner, so the owner never sees the same
   * problem reported twice. Resolving `void`/`true` keeps the success banner.
   */
  onSubmit: () => Promise<void | boolean>
  /** Save-button label (default "Speichern"). */
  submitLabel?: string
  /**
   * In-flight button label (default "Speichern…"). Set it to the verb of the
   * flow so the moment of action matches the rest of the copy — e.g. a create
   * screen passes "Wird angelegt…" instead of the save-an-edit "Speichern…".
   */
  submitBusyLabel?: string
  /** German success line under the banner (default "Gespeichert."). */
  successMessage?: string
  /** Disable the save action (e.g. client-side validation not yet satisfied). */
  submitDisabled?: boolean
  /** Money-path action → comfortable 48px target. */
  money?: boolean
}

export function FormScreen({
  title,
  subtitle,
  children,
  onSubmit,
  submitLabel = "Speichern",
  submitBusyLabel = "Speichern…",
  successMessage = "Gespeichert.",
  submitDisabled = false,
  money = false,
}: FormScreenProps): ReactNode {
  const t = useW14Theme()
  const insets = useSafeAreaInsets()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  // Synchronous double-tap guard. `busy` only disables the button AFTER React
  // re-renders (~100 ms on LTE), so an impatient second tap in that gap would
  // fire a second request — doubling the load AND the rate-limit budget spend
  // (a real cause of the "Zu viele Versuche" the owner saw). The ref blocks the
  // re-entry on the SAME tick, before any await.
  const submittingRef = useRef(false)
  // The error banner renders at the TOP of the scroll; on a long form the owner
  // sits at the bottom (at the save bar) when the server refuses, so the banner
  // would land off-screen and the tap would look ignored. Scroll it into view.
  const scrollRef = useRef<ScrollView>(null)

  const handleSubmit = async (): Promise<void> => {
    if (submittingRef.current) return
    submittingRef.current = true
    setError(null)
    setOk(false)
    setBusy(true)
    try {
      // `false` = client-side field validation stopped us and already showed
      // its message inline; show no success banner (and no error banner — the
      // caller returned rather than threw). Any other resolution is a success.
      const result = await onSubmit()
      if (result !== false) {
        setOk(true)
        hapticSuccess()
      }
    } catch (e) {
      setError(describeError(e))
      // Bring the freshly-shown banner into view (error just went null → set).
      scrollRef.current?.scrollTo({ y: 0, animated: true })
      hapticError()
    } finally {
      submittingRef.current = false
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      // iOS "padding" keeps the save bar + field above the keyboard cleanly;
      // Android "height" resizes the scroll viewport so inputs stay reachable
      // (matches the shared KeyboardAvoidingScreen — earlier this was
      // `undefined` on Android, which let the keyboard cover the active field).
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 14 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-1">
          <Text className="text-2xl font-display-semibold leading-tight">{title}</Text>
          {subtitle != null ? (
            <Text className="text-muted-foreground text-sm">{subtitle}</Text>
          ) : null}
        </View>

        {error != null ? (
          <View
            className="gap-1 rounded-xl px-4 py-3"
            style={{ borderWidth: 1, borderColor: t.colors.destructive }}
          >
            <Text className="text-sm font-semibold" style={{ color: t.colors.destructive }}>
              Fehler
            </Text>
            <Text className="text-muted-foreground text-sm">{error}</Text>
          </View>
        ) : null}

        {ok ? (
          <View
            className="rounded-xl px-4 py-3"
            style={{ borderWidth: 1, borderColor: t.colors.verdigris }}
          >
            <Text className="text-sm font-semibold" style={{ color: t.colors.verdigris }}>
              {successMessage}
            </Text>
          </View>
        ) : null}

        <View className="gap-3.5">{children}</View>
      </ScrollView>

      <View
        className="bg-card border-border border-t px-4 pt-3"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        <Button
          onPress={() => void handleSubmit()}
          // Instant tactile confirmation on the press itself — fires on the same
          // touch tick, BEFORE the async busy re-render, so the tap never feels
          // ignored even when the network round-trip is slow.
          onPressIn={() => selection()}
          disabled={submitDisabled || busy}
          size={money ? "xl" : "default"}
        >
          <Text>{busy ? submitBusyLabel : submitLabel}</Text>
        </Button>
      </View>
    </KeyboardAvoidingView>
  )
}
