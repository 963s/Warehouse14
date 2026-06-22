/**
 * CartLineRow — one line in the sell cart.
 *
 * Name + SKU, a calm quantity stepper, the Steuerschlüssel as a badge, the line
 * total in mono, and a quiet remove. Reused by Verkauf and Ankauf (the labels
 * differ; the row does not). All money is pre-derived cents from `cart-math`,
 * formatted through `formatCents` — never a raw or fabricated number.
 *
 * Touch targets on the stepper + remove are ≥44px (this is not itself a
 * money-commit control — that's the keypad + the confirm sheet — so 44 is the
 * right minimum here). Press feedback is the spine's `PressableScale`.
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import { Minus, Plus, Trash2 } from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
import { Text } from "@/components/ui/text"
import { formatCents } from "@/warehouse14/api"
import { useW14Theme } from "@/warehouse14/theme"
import { PressableScale } from "@/warehouse14/ui"
import { selection } from "@/warehouse14/ui/native"

import type { CartLineView } from "./cart"
import { TAX_TREATMENT_SHORT } from "./labels"

export interface CartLineRowProps {
  line: CartLineView
  /** Show the quantity stepper (consumables). Serialized items hide it. */
  editableQty?: boolean
  onIncQty?: (delta: number) => void
  onRemove?: () => void
  /** Optional per-line discount editor rendered below the row (Verkauf). Omit
   *  on read-only surfaces (Ankauf) that do not discount. */
  discountEditor?: ReactNode
}

function StepButton({
  label,
  icon: Icon,
  onPress,
  disabled,
}: {
  label: string
  icon: typeof Plus
  onPress: () => void
  disabled?: boolean
}): ReactNode {
  const t = useW14Theme()
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => {
        selection()
        onPress()
      }}
      style={{ width: t.touch.min, height: t.touch.min, opacity: disabled ? 0.4 : 1 }}
      className="items-center justify-center rounded-md border border-border bg-card"
    >
      <Icon size={t.icon.sm} color={t.colors.foreground} />
    </PressableScale>
  )
}

export function CartLineRow({
  line,
  editableQty = false,
  onIncQty,
  onRemove,
  discountEditor,
}: CartLineRowProps): ReactNode {
  const t = useW14Theme()
  const hasDiscount = line.math.lineDiscountCents > 0n

  return (
    <View>
    <View className="flex-row items-center gap-3 py-2">
      <View className="flex-1 gap-1">
        <Text className="text-base font-medium" numberOfLines={1}>
          {line.name}
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          {line.sku ? (
            <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
              {line.sku}
            </Text>
          ) : null}
          <Badge variant="outline">
            <Text>{TAX_TREATMENT_SHORT[line.taxTreatmentCode]}</Text>
          </Badge>
          {hasDiscount ? (
            <Text className="text-xs" style={{ color: t.colors.verdigris }} numberOfLines={1}>
              −{formatCents(Number(line.math.lineDiscountCents))} Rabatt
            </Text>
          ) : null}
        </View>
      </View>

      {editableQty ? (
        <View className="flex-row items-center gap-2">
          <StepButton
            label="Menge verringern"
            icon={Minus}
            disabled={line.qty <= 1}
            onPress={() => onIncQty?.(-1)}
          />
          <Text className="font-mono-medium text-base" style={{ minWidth: 20, textAlign: "center" }}>
            {line.qty}
          </Text>
          <StepButton label="Menge erhöhen" icon={Plus} onPress={() => onIncQty?.(1)} />
        </View>
      ) : line.qty > 1 ? (
        <Text className="text-muted-foreground font-mono text-xs">×{line.qty}</Text>
      ) : null}

      <Text className="font-mono-medium text-base" numberOfLines={1} style={{ minWidth: 72, textAlign: "right" }}>
        {formatCents(Number(line.math.lineTotalCents))}
      </Text>

      {onRemove ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${line.name} entfernen`}
          onPress={() => {
            selection()
            onRemove()
          }}
          style={{ width: t.touch.min, height: t.touch.min }}
          className="items-center justify-center rounded-md"
        >
          <Trash2 size={t.icon.sm} color={t.colors.mutedForeground} />
        </PressableScale>
      ) : null}
    </View>
      {discountEditor ? <View className="pb-1">{discountEditor}</View> : null}
    </View>
  )
}
