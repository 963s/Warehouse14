/**
 * ReceiptPreview — a receipt-shaped preview of exactly what a finalize will
 * print and book. NOT the legal Beleg (the TSE/Belegtext on the server owns
 * that) — a faithful PREVIEW so the owner sees the lines, the per-Steuerschlüssel
 * VAT breakdown, the total and the tender before they confirm. Reused by Verkauf
 * and Ankauf (the headline + tender label swap).
 *
 * Honesty rule: every figure is a real summed cent value from `cart-math`,
 * formatted through `formatCents`. Nothing here is placeholder. The optional
 * `belegtext` is the live legal footer when the surface has fetched it; absent,
 * the preview simply omits it rather than inventing one.
 */
import { type ReactNode } from "react"
import { View } from "react-native"

import { Text } from "@/components/ui/text"
import { formatCents } from "@/warehouse14/api"

import type { CartTotals } from "./cart"
import { PAYMENT_METHOD_LABELS, TAX_TREATMENT_LONG, formatVatRate } from "./labels"
import type { PaymentMethod } from "@warehouse14/api-client"

export interface ReceiptPreviewProps {
  totals: CartTotals
  /** Shop name for the receipt head (the surface passes the real configured name). */
  shopName?: string
  /** Tender shown in the footer, when chosen. */
  payment?: { method: PaymentMethod; receivedCents?: bigint; changeCents?: bigint }
  /** Headline ("Verkauf" / "Ankauf"). Default "Verkauf". */
  kind?: "Verkauf" | "Ankauf"
  /** Live legal Belegtext footer (from belegtextApi). Omitted when not loaded. */
  belegtext?: string | null
}

function MonoRow({
  label,
  value,
  muted = false,
  bold = false,
}: {
  label: string
  value: string
  muted?: boolean
  bold?: boolean
}): ReactNode {
  return (
    <View className="flex-row items-start justify-between gap-3">
      <Text
        className={
          bold
            ? "flex-1 text-sm font-semibold"
            : muted
              ? "text-muted-foreground flex-1 text-xs"
              : "flex-1 text-sm"
        }
      >
        {label}
      </Text>
      <Text className={bold ? "font-mono-medium text-sm" : muted ? "text-muted-foreground font-mono text-xs" : "font-mono text-sm"}>
        {value}
      </Text>
    </View>
  )
}

export function ReceiptPreview({
  totals,
  shopName,
  payment,
  kind = "Verkauf",
  belegtext,
}: ReceiptPreviewProps): ReactNode {
  const { lines, header, vatGroups } = totals

  return (
    <View className="rounded-xl border border-border bg-card p-4 gap-3">
      {/* Head */}
      <View className="items-center gap-0.5">
        {shopName ? <Text className="text-base font-semibold">{shopName}</Text> : null}
        <Text className="text-muted-foreground text-xs">
          {kind} · Vorschau
        </Text>
      </View>

      <View className="h-px bg-border" />

      {/* Lines */}
      <View className="gap-1.5">
        {lines.map((l) => (
          <View key={l.id} className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <Text className="text-sm" numberOfLines={1}>
                {l.qty > 1 ? `${l.qty}× ` : ""}
                {l.name}
              </Text>
              {l.sku ? (
                <Text className="text-muted-foreground font-mono text-2xs" numberOfLines={1}>
                  {l.sku}
                </Text>
              ) : null}
            </View>
            <Text className="font-mono text-sm">{formatCents(Number(l.math.lineTotalCents))}</Text>
          </View>
        ))}
      </View>

      <View className="h-px bg-border" />

      {/* Totals + VAT breakdown */}
      <View className="gap-1">
        <MonoRow label="Zwischensumme (netto)" value={formatCents(Number(header.subtotalCents))} muted />
        {vatGroups.map((g) => {
          const pct = formatVatRate(g.appliedVatRate)
          const label = pct
            ? `${TAX_TREATMENT_LONG[g.taxTreatmentCode]} (${pct})`
            : TAX_TREATMENT_LONG[g.taxTreatmentCode]
          return (
            <MonoRow
              key={`${g.taxTreatmentCode}-${g.appliedVatRate}`}
              label={label}
              value={formatCents(Number(g.vatCents))}
              muted
            />
          )
        })}
        <View className="my-0.5 h-px bg-border" />
        <MonoRow
          label={kind === "Ankauf" ? "Auszahlung gesamt" : "Gesamt"}
          value={formatCents(Number(header.totalCents))}
          bold
        />
      </View>

      {/* Tender */}
      {payment ? (
        <>
          <View className="h-px bg-border" />
          <View className="gap-1">
            <MonoRow label="Zahlungsart" value={PAYMENT_METHOD_LABELS[payment.method]} muted />
            {payment.receivedCents != null ? (
              <MonoRow label="Erhalten" value={formatCents(Number(payment.receivedCents))} muted />
            ) : null}
            {payment.changeCents != null && payment.changeCents > 0n ? (
              <MonoRow label="Rückgeld" value={formatCents(Number(payment.changeCents))} muted />
            ) : null}
          </View>
        </>
      ) : null}

      {/* Live legal footer, only when fetched */}
      {belegtext ? (
        <>
          <View className="h-px bg-border" />
          <Text className="text-muted-foreground text-2xs leading-4">{belegtext}</Text>
        </>
      ) : null}
    </View>
  )
}
