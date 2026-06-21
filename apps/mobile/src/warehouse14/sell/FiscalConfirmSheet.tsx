/**
 * FiscalConfirmSheet — the ONE gate in front of every money-movement +
 * fiscal commit (Verkauf finalize, Ankauf payout, and reusable for the Z-Bon).
 *
 * Why it exists, and the rules it enforces (DESIGN.md honesty + fiscal weight):
 *   • It NEVER auto-fires. Opening it is the surface's explicit decision; the
 *     legal commit then needs a SECOND, explicit press inside the sheet. Two
 *     deliberate acts before a Finanzamt-relevant row is written.
 *   • It makes the fiscal weight VISIBLE: clear copy that this finalizes a legal
 *     sale (a TSE-signed, GoBD-relevant Beleg that cannot simply be deleted —
 *     only reversed by a Storno), plus the exact amount in big mono.
 *   • The commit press fires `impactMedium` — the money-path commit haptic (§7).
 *   • Step-up is TRANSPARENT: the `onConfirm` calls the api-client; a 403
 *     STEP_UP_REQUIRED is intercepted by stepUpMiddleware → the global
 *     StepUpDialogHost (PIN) → the request is replayed. This sheet does nothing
 *     special for it; a real failure rejects and lands in the InlineError.
 *   • Idempotency is the CALLER's: it generates one key per sheet-open
 *     (newIdempotencyKey) and sends it unchanged so a retry never double-books.
 *
 * Pure + reusable: it owns the confirm lifecycle (busy / error / success) and
 * the legal framing; the surface supplies the amount, the copy specifics, the
 * preview (as children), and the async commit. Verkauf and Ankauf both mount it.
 */
import { type ReactNode, useEffect, useState } from "react"
import { ScrollView, View } from "react-native"
import { ShieldCheck } from "lucide-react-native"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Text } from "@/components/ui/text"
import { describeError } from "@/warehouse14/api"
import { useW14Theme } from "@/warehouse14/theme"
import { InlineError } from "@/warehouse14/ui"
import { impactMedium, success as successHaptic } from "@/warehouse14/ui/native"

export interface FiscalConfirmSheetProps {
  open: boolean
  /** Called when the sheet should close (scrim tap / Abbrechen / after success). */
  onOpenChange: (open: boolean) => void
  /**
   * The legal commit. Throw → the German message lands in the InlineError and
   * the sheet stays open for a retry (the idempotency key is unchanged, so a
   * lost-response retry is safe). Resolve → success haptic + the sheet closes.
   * A transparent step-up happens INSIDE this promise via the global host.
   */
  onConfirm: () => Promise<void>
  /** Run after a successful commit (e.g. clear the cart, navigate to the Beleg). */
  onConfirmed?: () => void

  /** Sheet title, e.g. "Verkauf abschließen". */
  title: string
  /** The big amount in pre-formatted de-DE EUR (the surface formats the cents). */
  amountLabel: string
  /** Label above the amount, e.g. "Zu zahlen" / "Auszahlung". Default "Gesamt". */
  amountCaption?: string
  /** The legal weight line. A sensible Verkauf default is provided. */
  fiscalNote?: string
  /** Confirm-button label, e.g. "Verkauf abschließen". */
  confirmLabel: string
  /** Optional preview / breakdown rendered above the legal note (ReceiptPreview). */
  children?: ReactNode
}

const DEFAULT_FISCAL_NOTE =
  "Mit dem Abschluss wird ein rechtsverbindlicher, TSE-signierter Beleg erzeugt " +
  "und im Kassenbuch festgeschrieben (GoBD). Er lässt sich nicht löschen, sondern " +
  "nur durch einen Storno rückgängig machen."

export function FiscalConfirmSheet({
  open,
  onOpenChange,
  onConfirm,
  onConfirmed,
  title,
  amountLabel,
  amountCaption = "Gesamt",
  fiscalNote = DEFAULT_FISCAL_NOTE,
  confirmLabel,
  children,
}: FiscalConfirmSheetProps): ReactNode {
  const t = useW14Theme()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Clear any stale error each time the sheet opens fresh.
  useEffect(() => {
    if (open) setError(null)
  }, [open])

  async function confirm(): Promise<void> {
    impactMedium() // money-path commit haptic, on the press (DESIGN.md §7)
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      successHaptic() // pairs with the verdigris close (§7)
      onOpenChange(false)
      onConfirmed?.()
    } catch (e) {
      // A cancelled step-up or a server refusal: show it, keep the sheet open so
      // the SAME idempotency key can be retried without double-booking.
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        // Never let a scrim tap interrupt an in-flight commit.
        if (busy) return
        onOpenChange(next)
      }}
    >
      <DialogContent className="gap-4">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Bitte den Betrag prüfen und den Abschluss bestätigen.
          </DialogDescription>
        </DialogHeader>

        <ScrollView
          className="max-h-[420px]"
          contentContainerStyle={{ gap: 16 }}
          showsVerticalScrollIndicator={false}
        >
          {/* The amount — the single hero number, big TABULAR MONO. This is the
              cross-app money rule: the single biggest money figure is mono in
              BOTH apps (matches the cashier "Zu zahlen" anchor in
              apps/tauri-pos BezahlenDialog). Serif is reserved for titles. */}
          <View
            className="items-center gap-1 rounded-xl border border-border bg-card py-4"
            accessibilityRole="summary"
          >
            <Text className="text-muted-foreground text-xs uppercase tracking-wide">
              {amountCaption}
            </Text>
            <Text className="font-mono-medium text-2xl">{amountLabel}</Text>
          </View>

          {children}

          {/* The fiscal weight — made visible, never hidden. */}
          <View
            className="flex-row items-start gap-2.5 rounded-xl px-3.5 py-3"
            style={{ backgroundColor: t.colors.primary + "14" }}
          >
            <View className="pt-0.5">
              <ShieldCheck size={t.icon.md} color={t.colors.primary} />
            </View>
            <Text className="text-muted-foreground flex-1 text-xs leading-5">{fiscalNote}</Text>
          </View>

          {error != null ? (
            <InlineError message={error} onRetry={() => void confirm()} onDismiss={() => setError(null)} />
          ) : null}
        </ScrollView>

        {/* Actions — confirm is a 48px money target. */}
        <View className="gap-2">
          <Button
            size="xl"
            onPress={() => void confirm()}
            disabled={busy}
            accessibilityLabel={confirmLabel}
          >
            <Text>{busy ? "Wird abgeschlossen…" : confirmLabel}</Text>
          </Button>
          <Button
            variant="outline"
            size="xl"
            onPress={() => onOpenChange(false)}
            disabled={busy}
            accessibilityLabel="Abbrechen"
          >
            <Text>Abbrechen</Text>
          </Button>
        </View>
      </DialogContent>
    </Dialog>
  )
}
