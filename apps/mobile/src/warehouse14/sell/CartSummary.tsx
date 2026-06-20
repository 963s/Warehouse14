/**
 * CartSummary — the totals block under a cart: Zwischensumme · enthaltene MwSt
 * per Steuerschlüssel · the bold Gesamt. Reused by Verkauf (the customer pays)
 * and Ankauf (the shop pays out) — the `totalLabel` prop swaps the headline word.
 *
 * Every figure is pre-derived cents from `cart-math`, formatted via
 * `formatCents` (de-DE EUR). The VAT lines come from the grouped breakdown so
 * the summary always matches the receipt and the wire body. Honest: nothing is
 * shown that isn't a real summed number.
 */
import { type ReactNode } from "react"
import { View } from "react-native"

import { Text } from "@/components/ui/text"
import { formatCents } from "@/warehouse14/api"

import type { CartTotals } from "./cart"
import { TAX_TREATMENT_SHORT, formatVatRate } from "./labels"

export interface CartSummaryProps {
  totals: CartTotals
  /** Headline label for the bold total (default "Gesamt"). */
  totalLabel?: string
}

function Row({
  label,
  value,
  emphasis = false,
}: {
  label: string
  value: string
  emphasis?: boolean
}): ReactNode {
  return (
    <View className="flex-row items-center justify-between">
      <Text
        className={emphasis ? "text-base font-semibold" : "text-muted-foreground text-sm"}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text
        className={emphasis ? "font-mono-medium text-xl" : "font-mono text-sm text-muted-foreground"}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  )
}

export function CartSummary({ totals, totalLabel = "Gesamt" }: CartSummaryProps): ReactNode {
  const { header, vatGroups } = totals
  // Only VAT-bearing groups get a "darin enthalten" line; §25a/§25c carry none.
  const vatLines = vatGroups.filter((g) => g.vatCents > 0n)

  return (
    <View className="gap-2">
      <Row label="Zwischensumme (netto)" value={formatCents(Number(header.subtotalCents))} />

      {vatLines.map((g) => {
        const pct = formatVatRate(g.appliedVatRate)
        const label = pct
          ? `darin ${pct} MwSt`
          : `darin MwSt (${TAX_TREATMENT_SHORT[g.taxTreatmentCode]})`
        return <Row key={`${g.taxTreatmentCode}-${g.appliedVatRate}`} label={label} value={formatCents(Number(g.vatCents))} />
      })}

      <View className="my-1 h-px bg-border" />

      <Row label={totalLabel} value={formatCents(Number(header.totalCents))} emphasis />
    </View>
  )
}
