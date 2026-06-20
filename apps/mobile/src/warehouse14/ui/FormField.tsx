/**
 * FormField — a labelled input block: label (+ optional "Pflicht"-Markierung) ·
 * the control · optional hint · optional per-field error. Wraps the RNR Input
 * for the common text case; pass `children` to drop in any other control
 * (picker, chips, switch) while keeping the label/hint/error chrome consistent.
 */
import { type ReactNode } from "react"
import { View, type TextInputProps } from "react-native"

import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"

export interface FormFieldProps {
  label: string
  /** Marks the label with a brass asterisk. */
  required?: boolean
  /** Helper text under the control. */
  hint?: string
  /** Per-field error — shown in destructive colour, replaces the hint. */
  error?: string | null
  /**
   * Custom control. When omitted, an Input is rendered from `inputProps`.
   */
  children?: ReactNode
  /** Props forwarded to the default Input (ignored when `children` is set). */
  inputProps?: TextInputProps
}

export function FormField({
  label,
  required = false,
  hint,
  error,
  children,
  inputProps,
}: FormFieldProps): ReactNode {
  const t = useW14Theme()
  const invalid = !!error
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-medium">
        {label}
        {required ? <Text style={{ color: t.colors.primary }}> *</Text> : null}
      </Text>
      {children ?? (
        <Input
          aria-invalid={invalid}
          style={invalid ? { borderColor: t.colors.destructive } : undefined}
          {...inputProps}
        />
      )}
      {invalid ? (
        <Text className="text-xs" style={{ color: t.colors.destructive }}>
          {error}
        </Text>
      ) : hint != null ? (
        <Text className="text-muted-foreground text-xs">{hint}</Text>
      ) : null}
    </View>
  )
}
