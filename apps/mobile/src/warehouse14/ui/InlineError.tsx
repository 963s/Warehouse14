/**
 * InlineError — the unified non-blocking error card.
 *
 * The full-screen <ErrorState> is for "the surface has nothing to show". This
 * is the smaller sibling for everything else: a mutation that failed, a
 * background revalidation that errored while data is still on screen, an action
 * the server refused. It's the one destructive card every surface should use
 * instead of hand-rolling its own (they all used to), so an error always looks
 * and reads the same.
 *
 *   {mutation.error != null ? (
 *     <InlineError message={mutation.error} onRetry={() => void mutation.mutate(vars)} />
 *   ) : null}
 *
 * Pairs with the Error haptic per DESIGN.md §7 — the touch and the destructive
 * tint say the same thing. The message is always a real `describeError` string.
 */
import { type ReactNode } from "react"
import { Pressable, View } from "react-native"
import Animated, { FadeIn, FadeOut } from "react-native-reanimated"
import { RefreshCw, TriangleAlert, X } from "lucide-react-native"

import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { duration } from "./motion/tokens"
import { useReduceMotion } from "./motion/useReduceMotion"

export interface InlineErrorProps {
  /** The themed German message (e.g. a mutation's `error`). */
  message: string
  /** Heading. Default „Fehler". */
  title?: string
  /** Optional retry — renders a „Erneut"-button when set. */
  onRetry?: () => void
  /** Optional dismiss — renders an X when set. */
  onDismiss?: () => void
}

export function InlineError({
  message,
  title = "Fehler",
  onRetry,
  onDismiss,
}: InlineErrorProps): ReactNode {
  const t = useW14Theme()
  const reduceMotion = useReduceMotion()

  return (
    <Animated.View
      entering={FadeIn.duration(reduceMotion ? duration.fast : duration.base)}
      exiting={FadeOut.duration(duration.fast)}
    >
      <Card
        className="gap-2 px-4 py-3.5"
        style={{ borderColor: t.colors.destructive + "55", backgroundColor: t.colors.destructive + "0D" }}
        accessibilityRole="alert"
      >
        <View className="flex-row items-start gap-2.5">
          <View className="pt-0.5">
            <TriangleAlert size={16} color={t.colors.destructive} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="text-sm font-semibold" style={{ color: t.colors.destructive }}>
              {title}
            </Text>
            <Text className="text-muted-foreground text-sm leading-5">{message}</Text>
          </View>
          {onDismiss != null ? (
            <Pressable
              onPress={onDismiss}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Schließen"
            >
              <X size={16} color={t.colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>

        {onRetry != null ? (
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            className="flex-row items-center gap-1.5 self-start rounded-md px-2 py-1"
            style={{ marginLeft: 26 }}
          >
            <RefreshCw size={13} color={t.colors.destructive} />
            <Text className="text-sm font-medium" style={{ color: t.colors.destructive }}>
              Erneut
            </Text>
          </Pressable>
        ) : null}
      </Card>
    </Animated.View>
  )
}
