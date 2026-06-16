/**
 * Warehouse14 native primitives — the React Native counterpart of the web
 * ui-kit's Button / Card / Input, built from the typed tokens in theme.ts.
 * Token-faithful, dependency-free, and safe on any RN version.
 */
import { type ReactNode } from "react"
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  Text,
  type TextProps,
  TextInput,
  type TextInputProps,
  View,
  type ViewProps,
} from "react-native"

import { useW14Theme, type Theme } from "./theme"

// ── Text ────────────────────────────────────────────────────────────────────
type Variant = "display" | "title" | "body" | "label" | "caption" | "mono"

export function W14Text({
  variant = "body",
  color,
  style,
  ...rest
}: TextProps & { variant?: Variant; color?: string }): ReactNode {
  const t = useW14Theme()
  return <Text style={[textStyle(t, variant, color), style]} {...rest} />
}

function textStyle(t: Theme, variant: Variant, color?: string) {
  const c = color ?? t.colors.foreground
  switch (variant) {
    case "display":
      return { fontFamily: t.fonts.bold, fontSize: 28, lineHeight: 34, color: c }
    case "title":
      return { fontFamily: t.fonts.semibold, fontSize: 18, lineHeight: 24, color: c }
    case "label":
      return { fontFamily: t.fonts.medium, fontSize: 14, lineHeight: 18, color: c }
    case "caption":
      return { fontFamily: t.fonts.body, fontSize: 12, lineHeight: 16, color: t.colors.mutedForeground }
    case "mono":
      return { fontFamily: t.fonts.mono, fontSize: 13, lineHeight: 18, color: c }
    default:
      return { fontFamily: t.fonts.body, fontSize: 15, lineHeight: 21, color: c }
  }
}

// ── Card ─────────────────────────────────────────────────────────────────────
export function Card({ style, ...rest }: ViewProps): ReactNode {
  const t = useW14Theme()
  return (
    <View
      style={[
        {
          backgroundColor: t.colors.card,
          borderColor: t.colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: t.radii.card,
          padding: t.space.x4,
        },
        style,
      ]}
      {...rest}
    />
  )
}

// ── Button ─────────────────────────────────────────────────────────────────────
export function Button({
  title,
  variant = "primary",
  loading = false,
  money = false,
  disabled,
  style,
  ...rest
}: PressableProps & {
  title: string
  variant?: "primary" | "outline"
  loading?: boolean
  /** money-path action → comfortable 48px target */
  money?: boolean
}): ReactNode {
  const t = useW14Theme()
  const isPrimary = variant === "primary"
  const minHeight = money ? t.touch.comfortable : t.touch.min
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={({ pressed }) => [
        {
          minHeight,
          paddingHorizontal: t.space.x4,
          borderRadius: t.radii.button,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          backgroundColor: isPrimary ? t.colors.primary : "transparent",
          borderWidth: isPrimary ? 0 : StyleSheet.hairlineWidth,
          borderColor: t.colors.border,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style as object,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? t.colors.primaryForeground : t.colors.primary} />
      ) : (
        <W14Text
          variant="label"
          color={isPrimary ? t.colors.primaryForeground : t.colors.foreground}
        >
          {title}
        </W14Text>
      )}
    </Pressable>
  )
}

// ── Input ──────────────────────────────────────────────────────────────────────
export function Input({ style, ...rest }: TextInputProps): ReactNode {
  const t = useW14Theme()
  return (
    <TextInput
      placeholderTextColor={t.colors.mutedForeground}
      style={[
        {
          minHeight: t.touch.min,
          paddingHorizontal: t.space.x3,
          borderRadius: t.radii.button,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.colors.border,
          color: t.colors.foreground,
          backgroundColor: t.colors.card,
          fontFamily: t.fonts.body,
          fontSize: 15,
        },
        style,
      ]}
      {...rest}
    />
  )
}

// ── Badge ──────────────────────────────────────────────────────────────────────
export function Badge({ label, tone = "muted" }: { label: string; tone?: "muted" | "positive" | "danger" }): ReactNode {
  const t = useW14Theme()
  const color =
    tone === "positive" ? t.colors.verdigris : tone === "danger" ? t.colors.destructive : t.colors.mutedForeground
  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: t.space.x2,
        paddingVertical: t.space.x1,
        borderRadius: t.radii.button,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: color,
      }}
    >
      <W14Text variant="caption" color={color}>
        {label}
      </W14Text>
    </View>
  )
}
