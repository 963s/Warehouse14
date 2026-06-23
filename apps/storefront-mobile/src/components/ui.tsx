/**
 * On-system UI primitives for the storefront app.
 *
 * All components obey the design law: warm parchment ground, ink text, gilt as
 * a thread, edge, seal ONLY, functional colours for meaning only, calm motion.
 * No underscore, dash separator, or German quotes in any rendered string.
 */

import { ActivityIndicator, Pressable, Text, View, type ViewProps } from "react-native"
import { Diamond } from "lucide-react-native"
import type { ReactNode } from "react"

import { palette } from "../theme/tokens"

// ────────────────────────────────────────────────────────────────────────
// Kicker: the gold diamond + small-caps eyebrow that opens every section.
// ────────────────────────────────────────────────────────────────────────

export function Kicker({ label, className = "" }: { label: string; className?: string }) {
  return (
    <View className={`flex-row items-center gap-1.5 ${className}`}>
      <Diamond size={9} color={palette.gilt} fill={palette.gilt} />
      <Text
        className="text-2xs uppercase"
        style={{
          color: palette.inkFaded,
          letterSpacing: 1.6,
          fontWeight: 600,
          fontFamily: "Inter_600SemiBold",
        }}
      >
        {label}
      </Text>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Display heading (Bricolage Grotesque).
// ────────────────────────────────────────────────────────────────────────

export function Heading({
  children,
  level = 2,
  className = "",
}: {
  children: ReactNode
  level?: 1 | 2 | 3
  className?: string
}) {
  const sizeCls = level === 1 ? "text-4xl" : level === 3 ? "text-xl" : "text-2xl"
  return (
    <Text
      className={`text-ink ${sizeCls} ${className}`}
      style={{
        fontFamily:
          level === 1
            ? "BricolageGrotesque_700Bold"
            : "BricolageGrotesque_600SemiBold",
        lineHeight: level === 1 ? 38 : 28,
      }}
    >
      {children}
    </Text>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Button: ink fill (the house accent), calm press. Gilt never a fill.
// ────────────────────────────────────────────────────────────────────────

interface ButtonProps {
  children: ReactNode
  onPress?: () => void
  variant?: "primary" | "ghost" | "outline"
  disabled?: boolean
  loading?: boolean
  className?: string
}

export function Button({
  children,
  onPress,
  variant = "primary",
  disabled,
  loading,
  className = "",
}: ButtonProps) {
  const base =
    "flex-row items-center justify-center rounded-md py-3.5 px-5 active:opacity-80"
  const variantCls =
    variant === "primary"
      ? "bg-ink"
      : variant === "outline"
        ? "border border-rule bg-transparent"
        : "bg-transparent"
  const textCls =
    variant === "primary" ? "text-primary-foreground" : "text-ink"
  const opacity = disabled || loading ? 0.5 : 1
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={{ opacity }}
      className={`${base} ${variantCls} ${className}`}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.primaryForeground} />
      ) : (
        <Text
          className={`${textCls} text-base`}
          style={{ fontFamily: "Inter_600SemiBold" }}
        >
          {children}
        </Text>
      )}
    </Pressable>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Card: the warm raised leaf with a hairline.
// ────────────────────────────────────────────────────────────────────────

export function Card({ children, className = "", ...rest }: ViewProps & { className?: string }) {
  return (
    <View
      className={`bg-card rounded-xl border border-rule ${className}`}
      {...rest}
    >
      {children}
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────
// Spinner + empty + error states. Always clean German, never raw tokens.
// ────────────────────────────────────────────────────────────────────────

export function Spinner({ label }: { label?: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-10">
      <ActivityIndicator size="large" color={palette.ink} />
      {label ? (
        <Text
          className="text-sm"
          style={{ color: palette.inkFaded, fontFamily: "Inter_400Regular" }}
        >
          {label}
        </Text>
      ) : null}
    </View>
  )
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-10">
      <Diamond size={20} color={palette.gilt} fill={palette.gilt} />
      <Text
        className="text-center text-lg"
        style={{ color: palette.inkAged, fontFamily: "Inter_500Medium" }}
      >
        {title}
      </Text>
      {hint ? (
        <Text
          className="text-center text-sm"
          style={{ color: palette.inkFaded, fontFamily: "Inter_400Regular" }}
        >
          {hint}
        </Text>
      ) : null}
      {action}
    </View>
  )
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <View className="flex-1 items-center justify-center gap-4 p-10">
      <Text
        className="text-center text-base"
        style={{ color: palette.waxRed, fontFamily: "Inter_500Medium" }}
      >
        {message}
      </Text>
      {onRetry ? (
        <Button variant="outline" onPress={onRetry}>
          {__retryLabel}
        </Button>
      ) : null}
    </View>
  )
}

// Local constant keeps the text spine in german.ts as the single source.
import { t } from "../lib/german"
const __retryLabel = t.retry
