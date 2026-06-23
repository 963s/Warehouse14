/**
 * SectionHeader — the un-carded group header for the Owner OS.
 *
 * Where `SectionCard` is a titled PANEL (a Card with rows inside), SectionHeader
 * is just the LABEL above content that sits directly on the canvas: a list of
 * `SectionCard`s, a grid of `StatTile`s, a free-standing block. One consistent
 * way to title a region without boxing it.
 *
 * Two emphases (DESIGN.md §3 type ramp):
 *   • default — a Section title: `text-base` semibold, optional brass icon.
 *   • "overline" — a quieter grouping label: tracked, upper, muted, `text-xs`.
 *     Use this to separate runs of cards (e.g. "HEUTE", "DIESE WOCHE").
 *
 * An optional right-hand `action` slot (a small Button/Badge/"Alle"-link) and an
 * optional one-line `subtitle` round it out. Spacing matches the spine: the
 * header reserves §1 group separation above via the caller's gap; it adds none
 * of its own margins so it composes cleanly in a gap-stack.
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import type { LucideIcon } from "lucide-react-native"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"

export interface SectionHeaderProps {
  title: string
  /** Optional German one-liner under the title (default emphasis only). */
  subtitle?: string
  /** Optional leading icon, brass (default emphasis only). */
  icon?: LucideIcon
  /** Optional right-aligned slot (e.g. an "Alle"-link Button or a count Badge). */
  action?: ReactNode
  /**
   * "overline" renders the quiet, tracked, upper-case grouping label instead of
   * the default Section title. Icon/subtitle are ignored in this mode.
   */
  emphasis?: "default" | "overline"
}

export function SectionHeader({
  title,
  subtitle,
  icon: Icon,
  action,
  emphasis = "default",
}: SectionHeaderProps): ReactNode {
  const t = useW14Theme()

  if (emphasis === "overline") {
    return (
      <View className="flex-row items-center justify-between gap-3">
        <Text
          className="text-muted-foreground text-xs font-semibold uppercase"
          style={{ letterSpacing: 0.8 }}
          numberOfLines={1}
        >
          {title}
        </Text>
        {action != null ? <View>{action}</View> : null}
      </View>
    )
  }

  return (
    <View className="flex-row items-center justify-between gap-3">
      <View className="flex-1 flex-row items-center gap-2.5">
        {Icon ? <Icon size={t.icon.md} color={t.colors.primary} /> : null}
        <View className="flex-1">
          {/* An un-carded headline on the canvas speaks the antique DISPLAY
              voice Bricolage Grotesque at the section-headline step (DESIGN-SYSTEM.md §3:
              headlines that sit on the canvas, not the small in-card title). */}
          <Text className="text-lg font-display-semibold leading-tight" numberOfLines={1}>
            {title}
          </Text>
          {subtitle != null ? (
            <Text className="text-muted-foreground text-xs" numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {action != null ? <View>{action}</View> : null}
    </View>
  )
}
