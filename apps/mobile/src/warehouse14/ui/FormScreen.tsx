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
import { type ReactNode, useState } from "react"
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import { describeError } from "@/warehouse14/api"
import { useW14Theme } from "@/warehouse14/theme"

export interface FormScreenProps {
  title: string
  subtitle?: string
  children: ReactNode
  /** The mutation. Resolve → success; throw → the message lands in the banner. */
  onSubmit: () => Promise<void>
  /** Save-button label (default "Speichern"). */
  submitLabel?: string
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
  successMessage = "Gespeichert.",
  submitDisabled = false,
  money = false,
}: FormScreenProps): ReactNode {
  const t = useW14Theme()
  const insets = useSafeAreaInsets()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  const handleSubmit = async (): Promise<void> => {
    setError(null)
    setOk(false)
    setBusy(true)
    try {
      await onSubmit()
      setOk(true)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 14 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-1">
          <Text className="text-xl font-bold">{title}</Text>
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
          disabled={submitDisabled || busy}
          className={money ? "h-12" : undefined}
        >
          <Text>{busy ? "Speichern…" : submitLabel}</Text>
        </Button>
      </View>
    </KeyboardAvoidingView>
  )
}
