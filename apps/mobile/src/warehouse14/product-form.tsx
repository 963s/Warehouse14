/**
 * Shared building blocks for the product „Neu"/„Bearbeiten"-Formulare.
 *
 * The intake and the edit surface collect overlapping fields (Name, Zustand,
 * Listenpreis, Kategorie …) and must read pixel-identical, so this module owns
 * the controls and the field-level validation in one place. Both screens then
 * differ only in the api-client call they fire.
 *
 * Controls compose the spine — never fork it:
 *   • `ChipSelect` — the single-choice chip row (Artikelart, Metall, Zustand,
 *     Steuerbehandlung). Each tap fires the selection haptic (DESIGN.md §7) and
 *     presses with the shared scale. Kept generic + backward-compatible because
 *     `customer-form` reuses it for the Sprache field.
 *   • `MoneyField` — a EUR amount input wired through the spine's `FormField`
 *     chrome, decimal-pad keyboard, and a right-aligned „€" affordance so an
 *     amount reads like money. Validates to the de-DE/decimal wire shape.
 *   • `MetalWeightField` — Gewicht (g) + Feinheit side by side, decimal-pad, with
 *     a live Feingewicht hint (Gewicht × Feinheit) so the operator sees the melt
 *     basis as they type. Honest: the hint only shows once both are real numbers.
 *   • `CategoryPicker` — a searchable single-choice picker (a row of chips would
 *     wall off the screen with a deep taxonomy). Filters as you type; the
 *     selected node is pinned at the top with a verdigris check.
 *
 * Validation is field-level and German: each `validate…` returns an error MAP
 * keyed by field, so a screen paints exactly the offending input red via the
 * spine's `FormField` and the operator sees which line to fix — never one opaque
 * banner for a typo two fields up. `first…Error` gives the banner copy + the
 * Error haptic. Money is on the wire as a decimal EUR STRING here (the products
 * API takes „199.90", not cents) — `MoneyField` keeps that contract and we never
 * fabricate a value (DESIGN.md honesty rule): an empty optional field stays empty.
 */
import { type ComponentRef, type ReactNode, type RefObject, useMemo, useState } from "react"
import { View, type TextInputProps } from "react-native"
import { Check, Search, X } from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { FormField } from "@/warehouse14/ui"
import { PressableScale } from "@/warehouse14/ui/motion"
import * as haptics from "@/warehouse14/ui/native/haptics"

/** The imperative handle of the spine's `Input` wrapper — a TextInput instance,
 *  derived from the component so we never import the restricted RN symbol. */
export type InputRef = ComponentRef<typeof Input>

// ── Wire-shape guards (shared by the screens' validators) ────────────────────

/** Decimal money/weight: up to 16 integer + 2 fractional digits (the wire shape
 *  the products API accepts — „199.90", not cents). */
export const DECIMAL_RE = /^\d{1,16}(\.\d{1,2})?$/
/** Feinheit 0..1 with up to 4 fractional digits (mirrors the server FinenessString). */
export const FINENESS_RE = /^(0(\.\d{1,4})?|1(\.0{1,4})?)$/

/** A decimal-string amount > 0 (a list/Einkaufspreis of „0" is not a real price). */
export function isPositiveDecimal(value: string): boolean {
  const v = value.trim()
  return DECIMAL_RE.test(v) && Number(v) > 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Field — a labelled form row. Kept as a thin alias over the spine `FormField`
// so existing call sites (`<Field label hint>…children`) keep working while the
// label/hint/error chrome now comes from the one shared component.
// ─────────────────────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  required,
  error,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  error?: string | null
  children: ReactNode
}): ReactNode {
  return (
    <FormField label={label} hint={hint} required={required} error={error}>
      {children}
    </FormField>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ChipSelect — single-choice chip row. Generic over the value so it serves every
// intake enum without a cast at the call site. Each chip presses with the shared
// scale and ticks the selection haptic; the active chip is brass (`default`).
// ─────────────────────────────────────────────────────────────────────────────

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
}): ReactNode {
  const pick = (next: T | null) => {
    haptics.selection()
    onChange(next)
  }
  return (
    <View className="flex-row flex-wrap gap-2">
      {allowClear ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={clearLabel}
          accessibilityState={{ selected: value === null }}
          onPress={() => pick(null)}
        >
          <Badge variant={value === null ? "default" : "outline"}>
            <Text>{clearLabel}</Text>
          </Badge>
        </PressableScale>
      ) : null}
      {options.map((opt) => (
        <PressableScale
          key={opt.value}
          accessibilityRole="button"
          accessibilityLabel={opt.label}
          accessibilityState={{ selected: value === opt.value }}
          onPress={() => pick(opt.value)}
        >
          <Badge variant={value === opt.value ? "default" : "outline"}>
            <Text>{opt.label}</Text>
          </Badge>
        </PressableScale>
      ))}
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MoneyField — a EUR amount input with a right-aligned „€" affordance. Composes
// the spine `FormField` chrome (label · required · hint/error) and forwards the
// keyboard/ref props for focus chaining. The wire value is the decimal STRING
// the products API expects; the operator types „199.90".
// ─────────────────────────────────────────────────────────────────────────────

export function MoneyField({
  label,
  value,
  onChangeText,
  placeholder = "0.00",
  hint,
  error,
  required,
  inputRef,
  ...inputProps
}: {
  label: string
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
  hint?: string
  error?: string
  required?: boolean
  inputRef?: RefObject<InputRef | null>
} & Omit<TextInputProps, "value" | "onChangeText" | "placeholder">): ReactNode {
  const t = useW14Theme()
  const invalid = !!error
  return (
    <FormField label={label} required={required} hint={hint} error={error}>
      <View className="relative justify-center">
        <Input
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          keyboardType="decimal-pad"
          inputMode="decimal"
          aria-invalid={invalid}
          className="pr-9 font-mono"
          style={invalid ? { borderColor: t.colors.destructive } : undefined}
          accessibilityLabel={label}
          {...inputProps}
        />
        <View className="absolute right-3" pointerEvents="none">
          <Text className="font-mono-medium text-base" style={{ color: t.colors.mutedForeground }}>
            €
          </Text>
        </View>
      </View>
    </FormField>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MetalWeightField — Gewicht (g) + Feinheit on one row, decimal-pad, with a live
// Feingewicht read-out (Gewicht × Feinheit) so the operator sees the melt basis
// as they type. The read-out is honest: it appears only when BOTH values parse
// to real numbers; otherwise the field shows its plain hint.
// ─────────────────────────────────────────────────────────────────────────────

export function MetalWeightField({
  weight,
  onWeightChange,
  fineness,
  onFinenessChange,
  weightError,
  finenessError,
  weightRef,
  finenessRef,
  onWeightSubmit,
  onFinenessSubmit,
}: {
  weight: string
  onWeightChange: (text: string) => void
  fineness: string
  onFinenessChange: (text: string) => void
  weightError?: string
  finenessError?: string
  weightRef?: RefObject<InputRef | null>
  finenessRef?: RefObject<InputRef | null>
  onWeightSubmit?: () => void
  onFinenessSubmit?: () => void
}): ReactNode {
  const t = useW14Theme()

  // The melt basis preview — only real when both numbers parse (honesty rule).
  const feingewicht = useMemo(() => {
    const w = Number(weight.trim())
    const f = Number(fineness.trim())
    if (!weight.trim() || !fineness.trim()) return null
    if (!Number.isFinite(w) || !Number.isFinite(f) || w <= 0 || f <= 0) return null
    return (w * f).toLocaleString("de-DE", { maximumFractionDigits: 3 })
  }, [weight, fineness])

  return (
    <View className="gap-1.5">
      <View className="flex-row gap-3">
        <View className="flex-1">
          <MoneyField
            label="Gewicht (g)"
            value={weight}
            onChangeText={onWeightChange}
            placeholder="4.20"
            error={weightError}
            inputRef={weightRef}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={onWeightSubmit}
          />
        </View>
        <View className="flex-1">
          <MoneyField
            label="Feinheit"
            value={fineness}
            onChangeText={onFinenessChange}
            placeholder="0.585"
            error={finenessError}
            inputRef={finenessRef}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={onFinenessSubmit}
          />
        </View>
      </View>
      {feingewicht ? (
        <View className="flex-row items-center justify-between">
          <Text className="text-muted-foreground text-2xs">Feingewicht (Schmelzbasis)</Text>
          <Text className="font-mono-medium text-xs" style={{ color: t.colors.primary }}>
            {feingewicht} g
          </Text>
        </View>
      ) : (
        <Text className="text-muted-foreground text-2xs">
          Optional — bei Edelmetallware. Feingewicht = Gewicht × Feinheit.
        </Text>
      )}
    </View>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CategoryPicker — a searchable single-choice picker for the taxonomy. A flat
// chip wall does not scale to a deep tree, so this filters as the operator types
// and pins the selected node at the top with a verdigris check. „Ohne" clears.
// ─────────────────────────────────────────────────────────────────────────────

export interface CategoryChoice {
  value: string
  label: string
}

export function CategoryPicker({
  options,
  value,
  onChange,
}: {
  options: ReadonlyArray<CategoryChoice>
  value: string | null
  onChange: (value: string | null) => void
}): ReactNode {
  const t = useW14Theme()
  const [query, setQuery] = useState("")

  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
    // Keep the selected node out of the scroll list (it is pinned above).
    return pool.filter((o) => o.value !== value).slice(0, 40)
  }, [options, query, value])

  const pick = (next: string | null) => {
    haptics.selection()
    onChange(next)
    setQuery("")
  }

  return (
    <View className="gap-2">
      {/* Selected node — pinned, with a verdigris check + clear affordance. */}
      {selected ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Kategorie ${selected.label} entfernen`}
          onPress={() => pick(null)}
        >
          <View
            className="min-h-[44px] flex-row items-center gap-2.5 rounded-md px-3 py-2"
            style={{
              backgroundColor: t.colors.verdigris + "14",
              borderColor: t.colors.verdigris + "40",
              borderWidth: 1,
            }}
          >
            <Check size={t.icon.sm} color={t.colors.verdigris} />
            <Text className="flex-1 text-sm font-medium" numberOfLines={1}>
              {selected.label}
            </Text>
            <X size={t.icon.sm} color={t.colors.mutedForeground} />
          </View>
        </PressableScale>
      ) : null}

      {/* Search box — filters the list as you type. */}
      <View className="relative justify-center">
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="Kategorie suchen …"
          autoCapitalize="none"
          autoCorrect={false}
          className="pl-9"
          accessibilityLabel="Kategorie suchen"
        />
        <View className="absolute left-3" pointerEvents="none">
          <Search size={t.icon.sm} color={t.colors.mutedForeground} />
        </View>
      </View>

      {/* Filtered choices — chips, capped so the picker never walls the screen. */}
      {filtered.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {filtered.map((opt) => (
            <PressableScale
              key={opt.value}
              accessibilityRole="button"
              accessibilityLabel={opt.label}
              onPress={() => pick(opt.value)}
            >
              <Badge variant="outline">
                <Text>{opt.label}</Text>
              </Badge>
            </PressableScale>
          ))}
        </View>
      ) : query.trim() ? (
        <Text className="text-muted-foreground text-xs">Keine Kategorie gefunden.</Text>
      ) : null}
    </View>
  )
}
