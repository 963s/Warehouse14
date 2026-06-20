/**
 * TopNList — a ranked "top movers" list: best products, top customers, biggest
 * expense categories. Each row is a rank chip · title (+ optional sublabel) over
 * a proportional bar · the real value right-aligned in mono.
 *
 * The bar under each row is the row's share of the TOP value (rank 1 fills the
 * track; everything else is relative to it), so the eye reads the ranking
 * instantly. Built on react-native Views + the shared `GrowBar` and stagger — no
 * charting dep. Rows cascade in; tapping a row (when `onSelect` is set) presses
 * with the spine's one feedback and fires a selection haptic.
 *
 * Honesty (DESIGN.md §4): values come straight from the caller's `formatValue`
 * (de-DE), never re-derived. An empty list or a missing aggregate renders the
 * explicit empty / locked state — a list with no rows is never dressed up as a
 * real "nobody bought anything" unless that is genuinely the data. A negative
 * value still prints its real (negative) figure; its bar simply clamps to zero.
 */
import { type ReactNode, useMemo } from "react"
import { View } from "react-native"
import { Trophy, type LucideIcon } from "lucide-react-native"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"
import { selection } from "@/warehouse14/ui/native"
import { PressableScale } from "@/warehouse14/ui/motion/PressableScale"
import { StaggerItem } from "@/warehouse14/ui/motion/Stagger"
import { EmptyState } from "@/warehouse14/ui/EmptyState"
import { SkeletonRow } from "@/warehouse14/ui/Skeleton"
import { GrowBar } from "./GrowBar"
import { type RankItem } from "./types"

export interface TopNListProps {
  /** The ranked rows, already sorted by the caller (highest first). */
  data: ReadonlyArray<RankItem>
  /** Render a value in the caller's unit as a de-DE string (e.g. formatCents). */
  formatValue: (value: number) => string
  /** Cap how many rows render (default 5). The caller may pass more; we slice. */
  limit?: number
  /**
   * Colour intent for the bars. "primary" = brass (default), "accent" =
   * verdigris (a positive metric like revenue).
   */
  tone?: "primary" | "accent"
  /** Tapping a row calls back with its index + item (fires a selection haptic). */
  onSelect?: (index: number, item: RankItem) => void
  /** First-load → a few SkeletonRows in the list's shape. */
  loading?: boolean
  /** The aggregate behind this list isn't available → honest locked state. */
  locked?: boolean
  /** Empty / locked copy + icon overrides (German). */
  emptyTitle?: string
  emptyDescription?: string
  emptyIcon?: LucideIcon
}

export function TopNList({
  data,
  formatValue,
  limit = 5,
  tone = "primary",
  onSelect,
  loading = false,
  locked = false,
  emptyTitle,
  emptyDescription,
  emptyIcon,
}: TopNListProps): ReactNode {
  const t = useW14Theme()

  const rows = useMemo(() => data.slice(0, Math.max(1, limit)), [data, limit])
  // Scale every bar against the top row's magnitude so rank 1 fills the track.
  const peak = useMemo(() => {
    let p = 0
    for (const r of rows) {
      const a = Math.abs(r.value)
      if (Number.isFinite(a) && a > p) p = a
    }
    return p
  }, [rows])

  if (loading) {
    return (
      <View className="gap-2.5">
        {Array.from({ length: Math.min(limit, 4) }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </View>
    )
  }

  if (locked || rows.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon ?? Trophy}
        title={emptyTitle ?? (locked ? "Noch keine Rangliste" : "Keine Einträge")}
        description={
          emptyDescription ??
          (locked
            ? "Für diesen Zeitraum liegt noch keine Auswertung vor."
            : "In diesem Zeitraum gibt es nichts zu ranken.")
        }
      />
    )
  }

  const barColor = tone === "accent" ? t.colors.verdigris : t.colors.primary

  return (
    <View className="gap-2.5">
      {rows.map((item, i) => {
        const ratio = peak > 0 && Number.isFinite(item.value) ? Math.abs(item.value) / peak : 0
        const isTop = i === 0
        const a11y = `Platz ${i + 1}, ${item.label}: ${formatValue(item.value)}`

        const body = (
          <View className="gap-1.5" style={{ minHeight: t.touch.min }}>
            <View className="flex-row items-center gap-2.5">
              {/* rank chip — brass on the leader, muted-tinted otherwise */}
              <View
                className="h-6 w-6 items-center justify-center rounded-md"
                style={{
                  backgroundColor: isTop ? t.colors.primary + "1f" : t.colors.border,
                }}
              >
                <Text
                  className="font-mono-medium text-2xs"
                  style={{ color: isTop ? t.colors.primary : t.colors.mutedForeground }}
                >
                  {i + 1}
                </Text>
              </View>
              <View className="flex-1">
                <Text className="text-sm font-medium" numberOfLines={1}>
                  {item.label}
                </Text>
                {item.sublabel != null ? (
                  <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
                    {item.sublabel}
                  </Text>
                ) : null}
              </View>
              <Text className="font-mono-medium text-sm" numberOfLines={1}>
                {formatValue(item.value)}
              </Text>
            </View>
            {/* proportional bar — share of the top row */}
            <View
              className="overflow-hidden rounded-full"
              style={{ height: 4, backgroundColor: t.colors.border, marginLeft: 34 }}
            >
              <GrowBar
                ratio={ratio}
                color={barColor}
                direction="right"
                thickness={4}
                length="100%"
                delay={Math.min(i * 30, 240)}
                dim={!isTop}
              />
            </View>
          </View>
        )

        return (
          <StaggerItem key={item.key ?? i} index={i}>
            {onSelect ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={a11y}
                onPress={() => {
                  selection()
                  onSelect(i, item)
                }}
              >
                {body}
              </PressableScale>
            ) : (
              <View accessibilityLabel={a11y}>{body}</View>
            )}
          </StaggerItem>
        )
      })}
    </View>
  )
}
