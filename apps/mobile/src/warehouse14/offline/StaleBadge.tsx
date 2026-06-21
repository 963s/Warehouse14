/**
 * StaleBadge — the honest „this is the last-good value, captured then" marker.
 *
 * The data layer keeps showing cached numbers when the cloud is unreachable
 * (that's the whole point of the read cache). The honesty rule says a value the
 * operator reads must never quietly masquerade as live — so wherever a surface
 * paints from cache, it pins this small marker beside the value:
 *
 *   „Stand vor 12 s"   — recent, calm (muted): we lost the cloud a moment ago.
 *   „veraltet · vor 8 Min."  — older than the stale threshold, warmed to brass
 *                              so the eye catches that this is not current.
 *
 * It is purely presentational — it formats a `cachedAt` instant against now and
 * picks a tone. No fetching, no store reads; a surface passes the `cachedAt` and
 * `stale` it already has from `useCachedQuery`. Brass (`primary`) is the kit's
 * text-emphasis colour (DESIGN.md §4) and is AA on bg + card; `gold` is never
 * used here because it is decorative-only and must not sit under text.
 */
import { type ReactNode } from "react"
import { View } from "react-native"
import { History } from "lucide-react-native"

import { Text } from "@/components/ui/text"
import { useW14Theme } from "@/warehouse14/theme"

export interface StaleBadgeProps {
  /** `Date.now()` the shown data was captured (from `useCachedQuery.cachedAt`). */
  cachedAt: number | null
  /** True once the data is past the stale threshold — warms the tone + adds „veraltet". */
  stale?: boolean
  /** Pin the relative time to a fixed `now` (tests / deterministic render). */
  now?: number
}

/**
 * A compact German „vor … " for the captured instant — mirrors the audit-ui
 * vocabulary („gerade eben", „vor 3 min", „vor 2 Std.") so age reads the same
 * everywhere. Below a minute we use seconds, since a freshly-dropped connection
 * is the common case and „vor 8 s" is more reassuring than „gerade eben".
 */
function sinceLabel(cachedAt: number, now: number): string {
  const ms = Math.max(0, now - cachedAt)
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `vor ${sec} s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `vor ${min} min`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `vor ${hours} Std.`
  const days = Math.floor(hours / 24)
  return `vor ${days} ${days === 1 ? "Tag" : "Tagen"}`
}

export function StaleBadge({
  cachedAt,
  stale = false,
  now = Date.now(),
}: StaleBadgeProps): ReactNode {
  const t = useW14Theme()
  if (cachedAt == null) return null

  const color = stale ? t.colors.primary : t.colors.mutedForeground
  const since = sinceLabel(cachedAt, now)
  const text = stale ? `veraltet · ${since}` : `Stand ${since}`

  return (
    <View
      className="flex-row items-center gap-1"
      accessibilityRole="text"
      accessibilityLabel={stale ? `Veraltete Daten, Stand ${since}` : `Stand ${since}`}
    >
      <History size={t.icon.xs} color={color} />
      <Text className="text-2xs font-medium" style={{ color }} numberOfLines={1}>
        {text}
      </Text>
    </View>
  )
}
