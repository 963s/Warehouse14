/**
 * DiscountEditor — a per-line Rabatt control for the mobile sell cart.
 *
 * Collapsed it is a quiet "Rabatt" / "Rabatt ändern" link on the cart row;
 * expanded it offers a percent-off preset row + a free EUR amount, and a
 * MANDATORY reason (the DB CHECK + finalize route enforce a reason whenever
 * the discount > 0). The amount is clamped to the list price by the cart math;
 * an empty/zero amount clears the discount.
 *
 * Mirrors the desktop cashier's DiscountEditor (apps/tauri-pos CartPanel.tsx)
 * so the two cashiers behave the same. Uses the official store design system:
 * ink for action, gilt for the thread flourish, hairline borders, calm motion.
 */
import { useState, type ReactNode } from "react"
import { Pressable, TextInput, View } from "react-native"
import { Minus, Tag } from "lucide-react-native"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { PressableScale } from "@/warehouse14/ui"
import { selection } from "@/warehouse14/ui/native"
import { toCents, fromCents } from "./cart-math"
import type { CartLineView } from "./cart"

// Percent presets — fast common discounts (mirror the desktop cashier).
const PCT_PRESETS = [5, 10, 15, 20] as const
// Reason presets — the DB CHECK requires a non-empty reason when discount > 0.
const REASON_PRESETS = [
  "Mitarbeiterrabatt",
  "Mängelnachlass",
  "Stammkunde",
  "Verhandlung",
] as const

export interface DiscountEditorProps {
  line: CartLineView
  /** Apply the discount (amount Eur string + reason). Empty/zero clears it. */
  onApply: (discountEur: string, reason: string) => void
}

/** Normalise a Eur amount string: German decimal comma → point, trim, empty → "0". */
function normalizeDecimal(input: string): string {
  return (input || "").replace(",", ".").trim() || "0"
}

/** Percent → Eur off the line list price. Returns a Eur string (or '' on bad input). */
function percentToEur(listPriceEur: string, pct: number): string {
  const cents = toCents(listPriceEur)
  const off = (cents * BigInt(Math.round(pct * 100))) / 10000n
  return fromCents(off)
}

/** Minimal EUR money-input check (digits + , or . + 0–2 decimals). */
function isMoneyInput(s: string): boolean {
  return /^\d*[.,]?\d{0,2}$/.test(s.trim())
}

/** Reason is valid when it has at least 3 non-space characters (mirrors desktop). */
function isReasonValid(s: string): boolean {
  return s.trim().length >= 3
}

export function DiscountEditor({ line, onApply }: DiscountEditorProps): ReactNode {
  const t = useW14Theme()
  const [open, setOpen] = useState(false)
  const [pct, setPct] = useState<string>("")
  const [amount, setAmount] = useState<string>(line.discountEur ?? "")
  const [reason, setReason] = useState<string>(line.discountReason ?? "")

  const setPercent = (raw: string): void => {
    setPct(raw)
    const n = Number(normalizeDecimal(raw))
    setAmount(
      Number.isFinite(n) && n > 0 ? percentToEur(line.listPriceEur, n) : "",
    )
  }

  const amountValid = isMoneyInput(amount)
  const positive = amountValid && Number(normalizeDecimal(amount)) > 0
  const reasonValid = isReasonValid(reason)
  const canApply = positive && reasonValid

  const apply = (): void => {
    if (!canApply) return
    onApply(amount, reason.trim())
    selection()
    setOpen(false)
  }

  const clear = (): void => {
    setAmount("")
    setPct("")
    setReason("")
    onApply("", "")
    selection()
    setOpen(false)
  }

  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={line.discountEur ? "Rabatt ändern" : "Rabatt"}
        onPress={() => {
          selection()
          setOpen(true)
        }}
        style={{ paddingTop: 4 }}
      >
        <View className="flex-row items-center gap-1">
          {/* A discount is a positive price move for the buyer → verdigris (the
              law: green = positive). Gilt is a thread/edge/seal only, never text. */}
          <Tag size={t.icon.xs} color={t.colors.verdigris} />
          <Text
            className="text-xs"
            style={{ color: t.colors.verdigris }}
          >
            {line.discountEur ? "Rabatt ändern" : "Rabatt"}
          </Text>
        </View>
      </Pressable>
    )
  }

  return (
    // Box-free: this editor lives INSIDE the cart Card, so it has no border/bg
    // of its own — a hairline-t separates it from the line row above (box-in-box
    // was the prior `border border-border bg-card` wrapper).
    <View className="mt-2 gap-3 border-t border-border pt-3">
      <View className="flex-row items-center justify-between">
        <Text className="font-display-semibold text-base">Rabatt</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abbrechen"
          onPress={() => {
            selection()
            setOpen(false)
          }}
        >
          <Text className="text-xs" style={{ color: t.colors.mutedForeground }}>
            Abbrechen
          </Text>
        </Pressable>
      </View>

      {/* Percent presets the fast path. */}
      <View className="flex-row flex-wrap gap-2">
        {PCT_PRESETS.map((p) => {
          const active = pct === String(p)
          return (
            <PressableScale
              key={p}
              accessibilityRole="button"
              accessibilityLabel={`${p} Prozent`}
              onPress={() => setPercent(active ? "" : String(p))}
              className="items-center justify-center rounded-md border"
              style={{
                minWidth: 44,
                minHeight: 36,
                paddingHorizontal: 12,
                borderRadius: t.radii.button,
                borderColor: active ? t.colors.foreground : t.colors.border,
                backgroundColor: active ? t.colors.foreground : "transparent",
              }}
            >
              <Text
                className="font-mono-medium text-sm"
                style={{ color: active ? t.colors.card : t.colors.foreground }}
              >
                {p}%
              </Text>
            </PressableScale>
          )
        })}
      </View>

      {/* Free EUR amount. */}
      <View className="flex-row items-center gap-2">
        <Text className="text-sm" style={{ color: t.colors.mutedForeground }}>
          Betrag
        </Text>
        <View
          className="flex-row items-center gap-1 rounded-md border border-border"
          style={{ borderRadius: t.radii.button, paddingHorizontal: 10, paddingVertical: 6 }}
        >
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0,00"
            keyboardType="decimal-pad"
            accessibilityLabel="Rabatt in Euro"
            style={{
              fontFamily: t.fonts.mono,
              fontSize: 15,
              minWidth: 80,
              color: t.colors.foreground,
            }}
          />
          <Text className="font-mono text-sm" style={{ color: t.colors.mutedForeground }}>
            €
          </Text>
        </View>
      </View>

      {/* Mandatory reason. */}
      <View className="gap-1">
        <Text className="text-xs" style={{ color: t.colors.mutedForeground }}>
          Grund (Pflicht)
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {REASON_PRESETS.map((r) => {
            const active = reason.trim() === r
            return (
              <Pressable
                key={r}
                accessibilityRole="button"
                accessibilityLabel={r}
                onPress={() => {
                  selection()
                  setReason(active ? "" : r)
                }}
                className="rounded-md border"
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: t.radii.button,
                  borderColor: active ? t.colors.foreground : t.colors.border,
                  backgroundColor: active ? t.colors.raised : "transparent",
                }}
              >
                <Text className="text-xs" style={{ color: t.colors.foreground }}>
                  {r}
                </Text>
              </Pressable>
            )
          })}
        </View>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="z. B. Mängelnachlass"
          accessibilityLabel="Rabattgrund"
          style={{
            fontFamily: t.fonts.body,
            fontSize: 14,
            paddingVertical: 6,
            paddingHorizontal: 10,
            borderRadius: t.radii.button,
            borderWidth: 1,
            borderColor: t.colors.border,
            color: t.colors.foreground,
          }}
        />
        {reason.length > 0 && !reasonValid ? (
          <Text className="text-xs" style={{ color: t.colors.destructive }}>
            Mindestens 3 Zeichen.
          </Text>
        ) : null}
      </View>

      {/* Apply / clear. */}
      <View className="flex-row gap-2">
        <PressableScale
          disabled={!canApply}
          accessibilityRole="button"
          accessibilityLabel="Rabatt anwenden"
          onPress={apply}
          className="flex-1 items-center justify-center rounded-md"
          style={{
            minHeight: t.touch.min,
            borderRadius: t.radii.button,
            backgroundColor: canApply ? t.colors.foreground : t.colors.raised,
            opacity: canApply ? 1 : 0.5,
          }}
        >
          <Text
            className="text-sm font-semibold"
            style={{ color: canApply ? t.colors.card : t.colors.mutedForeground }}
          >
            Anwenden
          </Text>
        </PressableScale>
        {line.discountEur ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel="Rabatt entfernen"
            onPress={clear}
            className="items-center justify-center rounded-md border border-border"
            style={{
              minHeight: t.touch.min,
              paddingHorizontal: 14,
              borderRadius: t.radii.button,
            }}
          >
            <Minus size={t.icon.sm} color={t.colors.destructive} />
          </PressableScale>
        ) : null}
      </View>
    </View>
  )
}
