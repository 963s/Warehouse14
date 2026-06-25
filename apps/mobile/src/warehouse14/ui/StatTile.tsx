/**
 * StatTile — a single KPI tile (label · big value · optional progress gauge ·
 * hint). The half-width grid building block for owner dashboards. Pure
 * presentational: the caller formats CENTS with the de-DE Money helper first.
 */
import { type ReactNode } from "react"

import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { RingGauge } from "@/warehouse14/ui/RingGauge"
import { useW14Theme } from "@/warehouse14/theme"

export type StatTileTone = "primary" | "accent" | "muted"

export interface StatTileProps {
  /** Small upper-case-ish caption, e.g. "Tagesumsatz". */
  label: string
  /** Pre-formatted value, e.g. "1.999,99 €" or "12". */
  value: string
  /** Small hint under the gauge, e.g. "Ziel 500 €". */
  hint?: string
  /** Progress 0..1 — when set, a gauge renders under the value. */
  ratio?: number
  /** Colour intent for the value + gauge fill. Default "primary". */
  tone?: StatTileTone
  /** Dim the value (e.g. when the live source is unavailable). */
  muted?: boolean
}

export function StatTile({
  label,
  value,
  hint,
  ratio,
  tone = "primary",
  muted = false,
}: StatTileProps): ReactNode {
  const t = useW14Theme()
  const toneColor =
    tone === "accent"
      ? t.colors.verdigris
      : tone === "muted"
        ? t.colors.mutedForeground
        : t.colors.primary

  return (
    <Card className="justify-between gap-2 px-4 py-4" style={{ width: "48%" }}>
      <Text
        className="text-muted-foreground text-xs font-medium"
        style={{ letterSpacing: 0.4 }}
        numberOfLines={1}
      >
        {label}
      </Text>
      {ratio != null ? (
        <RingGauge value={ratio} color={toneColor} label={value} caption={hint} muted={muted} />
      ) : (
        <>
          <Text
            className="font-mono-medium text-2xl"
            style={{ color: muted ? t.colors.mutedForeground : toneColor }}
            numberOfLines={1}
          >
            {value}
          </Text>
          {hint != null ? (
            <Text className="text-muted-foreground text-2xs">{hint}</Text>
          ) : null}
        </>
      )}
    </Card>
  )
}
