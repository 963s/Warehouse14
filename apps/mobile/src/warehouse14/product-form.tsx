/**
 * Shared building blocks for the product "Neu"/"Bearbeiten" intake forms.
 *
 * No native picker ships in this app, so a single-choice field is a row of
 * tappable Badge chips (the same visual language as the Lager status filters).
 * `Field` wraps any control with a German label so every screen reads the same.
 */
import { type ReactNode } from "react"
import { Pressable, View } from "react-native"

import { Badge } from "@/components/ui/badge"
import { Text } from "@/components/ui/text"

/** A labelled form row — label above, control below, consistent spacing. */
export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium text-foreground">{label}</Text>
      {children}
      {hint ? <Text className="text-muted-foreground text-xs">{hint}</Text> : null}
    </View>
  )
}

/**
 * Single-choice chip selector. `value === null` selects nothing (e.g. an
 * optional Metall field). Generic over the value type so it works for every
 * intake enum without casting at the call site.
 */
export function ChipSelect<T extends string>({
  options,
  value,
  onChange,
  allowClear = false,
  clearLabel = "Keins",
}: {
  options: ReadonlyArray<{ value: T; label: string }>
  value: T | null
  onChange: (value: T | null) => void
  /** Render a leading chip that resets the field to null. */
  allowClear?: boolean
  clearLabel?: string
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {allowClear ? (
        <Pressable onPress={() => onChange(null)} accessibilityRole="button">
          <Badge variant={value === null ? "default" : "outline"}>
            <Text>{clearLabel}</Text>
          </Badge>
        </Pressable>
      ) : null}
      {options.map((opt) => (
        <Pressable key={opt.value} onPress={() => onChange(opt.value)} accessibilityRole="button">
          <Badge variant={value === opt.value ? "default" : "outline"}>
            <Text>{opt.label}</Text>
          </Badge>
        </Pressable>
      ))}
    </View>
  )
}
