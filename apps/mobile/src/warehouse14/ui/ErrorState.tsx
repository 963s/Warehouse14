/**
 * ErrorState — the centred "this couldn't load" block for a surface that has
 * NOTHING to show (the query is in `status: "error"` with no cached data).
 *
 * It mirrors EmptyState's anatomy on purpose — an icon in a soft disc, a title,
 * the real German error message, and a primary action — so the three terminal
 * states (loading / empty / error) feel like one family. The single action is
 * "Erneut versuchen", wired to the query's `refetch`, with a press-scale and an
 * Error haptic-friendly destructive tint.
 *
 * It tells the truth about WHY it failed: a transport-level failure (we never
 * reached the cloud) reads as an offline problem ("Keine Verbindung"), while a
 * server refusal shows the themed message from `describeError`. The message is
 * always a real string from a real failure — never a fabricated reassurance.
 *
 * Use it via `QueryBoundary` (which picks it automatically), or directly when a
 * surface wants bespoke placement.
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import Animated from "react-native-reanimated"
import { CloudOff, RefreshCw, SearchX, TriangleAlert, type LucideIcon } from "lucide-react-native"

import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { isConnectionError, isNotFoundError } from "./data/connection"
import { screenEnter } from "./motion/transitions"
import { useReduceMotion } from "./motion/useReduceMotion"

export interface ErrorStateProps {
  /**
   * The themed German error message (a query's `error`). When omitted, a
   * sensible default for the detected kind is used.
   */
  message?: string | null
  /**
   * The raw thrown value (a query's `errorCause`) — used to detect whether this
   * was a connection failure vs a server refusal, which changes the copy + icon.
   */
  cause?: unknown
  /** Heading. Defaults to the kind-appropriate German title. */
  title?: string
  /** Override the icon (default: kind-appropriate). */
  icon?: LucideIcon
  /** Retry label. Default „Erneut versuchen". */
  retryLabel?: string
  /** Wire to the query's `refetch`. Renders the retry button when set. */
  onRetry?: () => void
  /** True while a retry is in flight — disables the button + spins copy. */
  retrying?: boolean
}

export function ErrorState({
  message,
  cause,
  title,
  icon,
  retryLabel = "Erneut versuchen",
  onRetry,
  retrying = false,
}: ErrorStateProps): ReactNode {
  const t = useW14Theme()
  const reduceMotion = useReduceMotion()
  const offline = isConnectionError(cause)
  // A missing record is a CALM absence, not a failure — render it in the neutral
  // muted tone with a „nicht gefunden" frame, never the destructive red of a
  // real error. (A surface that wants a richer empty layout should use
  // QueryBoundary's `notFound`; this keeps a direct <ErrorState cause={…}> honest.)
  const notFound = !offline && isNotFoundError(cause)

  const Icon = icon ?? (offline ? CloudOff : notFound ? SearchX : TriangleAlert)
  const resolvedTitle =
    title ??
    (offline ? "Keine Verbindung" : notFound ? "Nicht gefunden" : "Konnte nicht geladen werden")
  const resolvedMessage =
    message ??
    (offline
      ? "Die Cloud ist gerade nicht erreichbar. Sobald die Verbindung steht, hier erneut versuchen."
      : notFound
        ? "Dieser Datensatz ist nicht (mehr) vorhanden."
        : "Beim Laden ist ein Fehler aufgetreten.")
  // Tint: calm muted disc for a not-found absence, destructive red for a real error.
  const tint = notFound ? t.colors.mutedForeground : t.colors.destructive

  return (
    <Animated.View
      entering={screenEnter(reduceMotion)}
      className="items-center justify-center gap-3 px-6 py-10"
      accessibilityRole="alert"
    >
      <View
        className="h-16 w-16 items-center justify-center rounded-full"
        style={{
          backgroundColor: tint + "14",
          borderColor: tint + "33",
          borderWidth: 1,
        }}
      >
        <Icon size={t.icon.xl} color={tint} />
      </View>
      <Text className="text-center text-xl font-display-semibold leading-tight">{resolvedTitle}</Text>
      <Text className="text-muted-foreground max-w-xs text-center text-sm leading-5">
        {resolvedMessage}
      </Text>
      {onRetry != null ? (
        <Button
          variant="outline"
          onPress={onRetry}
          disabled={retrying}
          className="mt-2"
          accessibilityLabel={retryLabel}
        >
          <RefreshCw size={t.icon.sm} color={t.colors.foreground} />
          <Text>{retrying ? "Wird geladen…" : retryLabel}</Text>
        </Button>
      ) : null}
    </Animated.View>
  )
}
