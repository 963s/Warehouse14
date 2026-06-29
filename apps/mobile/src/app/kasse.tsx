/**
 * Kasse — the fiscal cockpit. READ-FIRST for fiscal safety: it shows the open
 * Schicht (shifts.getCurrent — Umsatzkontext + Kassendifferenz), an honest
 * fiscal overview (open vs. sealed days + the TSE-failure trail), and the list of
 * Tagesabschlüsse (closingsApi.list: businessDay, Netto-Verkauf, Netto-Ankauf,
 * Kassendifferenz, Status).
 *
 * Two read-only exports per closing — DATEV (EXTF) and Kassenbericht — are
 * offered as share-sheet downloads: the CSV body comes back as text, is written
 * to a temp cache file, and handed to the OS share sheet (RN Share). The temp
 * file is best-effort cleaned up afterwards.
 *
 * The ONLY mutation is the Z-Bon (closingsApi.finalize). It is the WRITE of a
 * legal Tagesabschluss, so it lives behind a clear confirm SHEET that spells out
 * the fiscal weight AND a server step-up (the global StepUpDialogHost handles the
 * 403 transparently). It is marked plainly as a fiskalische Aktion, fires the
 * money-path haptic on the commit press, NEVER auto-fires, and seals the day with
 * a single measured gold flourish. Reached from the Mehr-Hub (/kasse).
 *
 * Two finalize entry points: an open-day affordance for the CURRENT trading day
 * (when no daily_closings row exists for it yet — finalize() defaults to today
 * server-side; this is the keystone path that writes a day's FIRST closing), and,
 * defensively, an open closing row if one is ever returned in COUNTING state.
 *
 * VISUAL LAW (docs/DESIGN-SYSTEM.md): warm parchment ground, ink text, a single
 * warm hairline as the only divider, gilt only as the sealed-day edge + the wax
 * seal. NO boxes inside boxes — the shift figures, the fiscal overview, and the
 * closings are bare ledger rows on the canvas, separated by Hairlines, grouped
 * under un-carded SectionHeaders. The one real raised surface is the keystone
 * open-day affordance (the action still owed). Bricolage display headings, mono
 * numerals, calm reanimated motion.
 *
 * Built on the shared spine (DESIGN.md): live data through `useMultiQuery` (shift
 * is allowed to fail independently → null, closings is the primary payload;
 * refetch-on-focus + pull-to-refresh via `useRefreshControl`), the unified state
 * vocabulary (shaped Skeleton · ErrorState+Retry · EmptyState), a staggered list
 * entrance, `PressableScale` rows, honest `CountUp` figures, and the §7 haptic
 * vocabulary (selection on an export tap, Light on opening the Z-Bon sheet, Medium
 * on the Z-Bon commit press, Success on the sealed day, Error on a refusal).
 *
 * Honesty rule (mirrors Aufgaben): every row + the overview are real values from
 * a real endpoint; an empty list shows the EmptyState, never a fabricated day. All
 * labels German; de-DE money/dates. Money on the wire here is EUR DECIMAL STRINGS
 * — formatted with `formatEur`, never `formatCents`. No native deps added — Share +
 * expo-file-system + react-native-svg (already present) only.
 */
import { useCallback, useState } from "react"
import { Modal, Pressable, RefreshControl, ScrollView, Share, View } from "react-native"
import { File, Paths } from "expo-file-system"
import Svg, { Circle, Path } from "react-native-svg"
import type { ClosingListItem, ShiftView } from "@warehouse14/api-client"
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Lock,
  Receipt,
  ShieldCheck,
  Wallet,
} from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import {
  closingDatevCsv,
  closingKassenberichtCsv,
  describeError,
  finalizeClosing,
  formatEur,
  getCurrentShift,
  listClosings,
} from "@/warehouse14/api"
import {
  CLOSING_STATE_LABELS,
  closingStateBadgeVariant,
  EXPORT_LABELS,
  type ExportKind,
  exportFileName,
  fiscalOverview,
  formatBusinessDay,
  formatTimestamp,
  isTodayOpen,
  SHIFT_STATUS_LABELS,
  sortClosingsNewestFirst,
  varianceTone,
} from "@/warehouse14/kasse-ui"
import { todayBusinessDay } from "@/warehouse14/schatzkammer"
import { useW14Theme } from "@/warehouse14/theme"
import {
  CountUp,
  EmptyState,
  ErrorState,
  GoldFlood,
  Hairline,
  haptics,
  InlineError,
  PaperGrain,
  PressableScale,
  SectionHeader,
  Skeleton,
  StaggerItem,
  useMultiQuery,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

// ── Wachssiegel ───────────────────────────────────────────────────────────────
/**
 * A bespoke wax-seal mark — the visual seal of a rechtsverbindlich finalized
 * Z-Bon. A reeded ring with an embossed check, drawn in `currentColor` so it
 * tints from the verdigris (sealed) or gilt (decorative) it is given. Gilt is a
 * seal here, exactly as the design law permits.
 */
function WaxSeal({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.4} fill="none" />
      <Circle cx={12} cy={12} r={6.4} stroke={color} strokeWidth={0.7} strokeOpacity={0.5} fill="none" />
      <Path
        d="M8.6 12.2 L11 14.6 L15.4 9.6"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  )
}

// ── Kennzahl-Zeile ──────────────────────────────────────────────────────────────
/** A bare ledger row: a muted German label on the left, a mono figure on the
 *  right. The atom that replaces every boxed StatTile — figures read down a single
 *  aligned mono column, separated only by hairlines. */
function MetricRow({
  label,
  value,
  color,
  muted = false,
}: {
  label: string
  value: string
  color?: string
  muted?: boolean
}) {
  const t = useW14Theme()
  return (
    <View className="min-h-[34px] flex-row items-center justify-between gap-3 py-1.5">
      <Text className="text-muted-foreground text-sm" numberOfLines={1}>
        {label}
      </Text>
      <Text
        className="font-mono-medium text-sm"
        style={{ color: muted ? t.colors.mutedForeground : (color ?? t.colors.foreground) }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  )
}

// ── Aktuelle Schicht ──────────────────────────────────────────────────────────
/** The open-till context as a bare ledger block on the canvas: opening float,
 *  blind count, system-expected, variance — each a MetricRow, hairline-separated.
 *  No card, no inner tiles. */
function ShiftBlock({ shift }: { shift: ShiftView }) {
  const t = useW14Theme()
  const tone = varianceTone(shift.varianceEur)
  const varColor =
    tone === "accent"
      ? t.colors.verdigris
      : tone === "muted"
        ? t.colors.mutedForeground
        : t.colors.foreground
  const openedAt = formatTimestamp(shift.openedAt)

  return (
    <View className="gap-3">
      <SectionHeader
        title="Aktuelle Schicht"
        subtitle={openedAt ? `Geöffnet am ${openedAt}` : undefined}
        icon={Wallet}
        action={
          <Badge variant={shift.status === "OPEN" ? "success" : "outline"} dot>
            <Text>{SHIFT_STATUS_LABELS[shift.status]}</Text>
          </Badge>
        }
      />
      <View>
        <MetricRow label="Anfangsbestand" value={formatEur(shift.openingFloatEur)} />
        <Hairline />
        <MetricRow
          label="Erwartet (System)"
          value={shift.systemExpectedEur != null ? formatEur(shift.systemExpectedEur) : "Nicht ermittelt"}
          muted={shift.systemExpectedEur == null}
        />
        <Hairline />
        <MetricRow
          label="Gezählt (Blind)"
          value={shift.blindCountEur != null ? formatEur(shift.blindCountEur) : "Noch nicht gezählt"}
          muted={shift.blindCountEur == null}
        />
        <Hairline />
        <MetricRow
          label="Kassendifferenz"
          value={shift.varianceEur != null ? formatEur(shift.varianceEur) : "Noch offen"}
          color={varColor}
          muted={shift.varianceEur == null}
        />
      </View>
    </View>
  )
}

/** Shown when the till is closed — no open shift to report. A bare, honest line. */
function NoShiftBlock() {
  const t = useW14Theme()
  return (
    <View className="gap-3">
      <SectionHeader title="Aktuelle Schicht" icon={Wallet} />
      <View className="flex-row items-center gap-2">
        <Lock size={t.icon.sm} color={t.colors.mutedForeground} />
        <Text className="text-muted-foreground flex-1 text-sm">
          Keine offene Schicht. Die Kasse wird am POS geöffnet.
        </Text>
      </View>
    </View>
  )
}

// ── Fiskalischer Überblick ────────────────────────────────────────────────────
/** The honest trust header as a bare block. "Heutiger Tag" is read from the
 *  ABSENCE of today's closing row (the backend never produces a COUNTING row, so
 *  it can't be read from state), and "Abgeschlossen" counts the real sealed days.
 *  The TSE line is deliberately conservative: tse_failed_count is a known backend
 *  stub (hardcoded 0), so we NEVER paint an unconditional green "lückenlos"
 *  guarantee — we only raise a clear destructive line when the record actually
 *  reports failures, and otherwise state plainly that none are recorded. */
function FiscalOverviewBlock({
  closings,
  today,
}: {
  closings: ClosingListItem[]
  today: string
}) {
  const t = useW14Theme()
  const o = fiscalOverview(closings, today)
  const hasFailures = o.tseFailures > 0

  return (
    <View className="gap-3">
      <SectionHeader
        title="Fiskalischer Überblick"
        subtitle="Stand der Tagesabschlüsse"
        icon={ShieldCheck}
      />

      {/* Two honest figures, side by side, bare on the canvas — a divider hairline
          between them, not two boxes. */}
      <View className="flex-row items-stretch">
        <View className="flex-1 gap-1">
          <Text className="text-muted-foreground text-2xs font-medium" style={{ letterSpacing: 0.4 }}>
            Heutiger Tag
          </Text>
          <Text
            className="text-2xl font-display-semibold leading-tight"
            style={{ color: o.todayOpen ? t.colors.foreground : t.colors.verdigris }}
            numberOfLines={1}
          >
            {o.todayOpen ? "Offen" : "Fertig"}
          </Text>
          <Text className="text-muted-foreground text-2xs">
            {o.todayOpen ? "Z-Bon ausstehend" : "Z-Bon gesiegelt"}
          </Text>
        </View>

        <Hairline vertical length={56} />

        <View className="flex-1 gap-1 pl-4">
          <Text className="text-muted-foreground text-2xs font-medium" style={{ letterSpacing: 0.4 }}>
            Abgeschlossen
          </Text>
          <CountUp
            value={o.finalizedDays}
            motion="timing"
            className="font-mono-medium text-2xl leading-tight"
            style={{ color: t.colors.verdigris }}
            accessibilityLabel={`${o.finalizedDays} abgeschlossene Tage`}
          />
          <Text className="text-muted-foreground text-2xs">
            {o.finalizedDays === 1 ? "Tag gesiegelt" : "Tage gesiegelt"}
          </Text>
        </View>
      </View>

      {/* The fiscal trust line. We only assert the audit trail's health when there
          is a real signal to assert: recorded TSE failures raise a destructive
          line. With none recorded we state that plainly — NOT a green "lückenlos"
          seal, because the underlying count is a backend stub, not a verified
          completeness check. A single hairline-edge note, not a tinted box. */}
      <View className="flex-row items-center gap-2 pt-0.5">
        {hasFailures ? (
          <AlertTriangle size={t.icon.sm} color={t.colors.destructive} />
        ) : (
          <CheckCircle2 size={t.icon.sm} color={t.colors.mutedForeground} />
        )}
        <Text
          className="flex-1 text-sm"
          style={{ color: hasFailures ? t.colors.destructive : t.colors.mutedForeground }}
        >
          {hasFailures
            ? `${o.tseFailures} TSE-Fehler im Prüfprotokoll`
            : "Keine TSE-Fehler im Prüfprotokoll vermerkt"}
        </Text>
      </View>
    </View>
  )
}

// ── Offener Geschäftstag (Heute) ──────────────────────────────────────────────
/**
 * The keystone affordance: finalize the CURRENT trading day's Z-Bon when no
 * daily_closings row exists for it yet. The backend's finalize defaults to
 * today's Berlin business day when called without a businessDay, so this is the
 * ONLY path that can write the first closing of a day — the list can never carry
 * an open-day row because the backend only ever returns FINALIZED rows.
 *
 * This is the ONE genuine raised surface on the screen: an action still owed. It
 * is a parchment-step leaf (the raised cream) with a single gilt edge on the
 * leading rail — not a stacked card grid. It is honest about its precondition:
 * the day must be settled first (the Kassensturz / Schicht abgeschlossen at the
 * POS). `shiftOpenHere` is a true signal only for THIS device's till; it lets us
 * pre-warn when we can, without overclaiming.
 */
function OpenDayAffordance({
  businessDay,
  shiftOpenHere,
  busy,
  onFinalize,
}: {
  businessDay: string
  shiftOpenHere: boolean
  busy: boolean
  onFinalize: () => void
}) {
  const t = useW14Theme()

  return (
    <View
      className="overflow-hidden rounded-xl"
      style={{ backgroundColor: t.colors.card, borderWidth: 1, borderColor: t.colors.border }}
    >
      <View className="flex-row">
        {/* The single gilt edge — a thread marking the action still owed (gilt as
            edge only, never a fill). */}
        <View style={{ width: 3, backgroundColor: t.colors.gilt }} />

        <View className="flex-1 gap-3 px-4 py-4">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1">
              <Text className="text-lg font-display-semibold leading-tight" numberOfLines={1}>
                {formatBusinessDay(businessDay)}
              </Text>
              <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                Heute noch nicht abgeschlossen
              </Text>
            </View>
            <Badge variant="outline" dot>
              <Text>Offen</Text>
            </Badge>
          </View>

          <View className="flex-row items-center gap-1.5">
            <ShieldCheck size={t.icon.xs} color={t.colors.gilt} />
            <Text className="text-xs font-semibold" style={{ color: t.colors.foreground }}>
              Fiskalische Aktion
            </Text>
          </View>
          <Text className="text-muted-foreground text-xs leading-5">
            Der Z-Bon schließt den heutigen Geschäftstag rechtsverbindlich ab. Die Kasse muss dafür
            zuerst per Kassensturz abgeschlossen sein.
          </Text>

          {shiftOpenHere ? (
            <View className="flex-row items-start gap-1.5">
              <AlertTriangle size={t.icon.xs} color={t.colors.gilt} />
              <Text className="flex-1 text-xs leading-5" style={{ color: t.colors.foreground }}>
                Diese Kasse ist noch geöffnet. Schließe zuerst die Schicht am POS.
              </Text>
            </View>
          ) : null}

          <Button
            variant="default"
            size="lg"
            className="h-12"
            onPress={onFinalize}
            disabled={busy}
            accessibilityLabel={`Z-Bon erstellen für ${formatBusinessDay(businessDay)}`}
          >
            <Receipt size={t.icon.sm} color={t.colors.primaryForeground} />
            <Text>Z-Bon erstellen</Text>
          </Button>
        </View>
      </View>
    </View>
  )
}

// ── Tagesabschluss-Zeile ──────────────────────────────────────────────────────
/** One day in the ledger as a BARE row — no card. A leading status mark (the wax
 *  seal for a sealed day, the calendar count for an open one), the Geschäftstag +
 *  its figures, the exports, and the seal note — separated from its neighbours by
 *  the list's single hairline, never a stacked box. */
function ClosingRow({
  closing,
  busy,
  error,
  onExport,
  onFinalize,
  onDismissError,
}: {
  closing: ClosingListItem
  busy: boolean
  error: string | null
  onExport: (kind: ExportKind) => void
  onFinalize: () => void
  onDismissError: () => void
}) {
  const t = useW14Theme()
  const finalized = closing.state === "FINALIZED"
  const finalizedAt = formatTimestamp(closing.finalizedAt)
  const varTone = varianceTone(closing.cashVarianceEur)
  const varColor =
    varTone === "accent"
      ? t.colors.verdigris
      : varTone === "muted"
        ? t.colors.mutedForeground
        : t.colors.foreground

  // A sealed day wears the verdigris wax seal; an open day shows the gilt edge
  // of an action still owed.
  const markColor = finalized ? t.colors.verdigris : t.colors.gilt

  return (
    <View className="gap-3 py-4">
      {/* Kopf: seal mark · Geschäftstag · Status */}
      <View className="flex-row items-start gap-3">
        <View className="pt-0.5">
          <WaxSeal size={t.icon.lg} color={markColor} />
        </View>
        <View className="flex-1">
          <Text className="text-base font-semibold" numberOfLines={1}>
            {formatBusinessDay(closing.businessDay)}
          </Text>
          <Text className="text-muted-foreground text-xs" numberOfLines={1}>
            {finalizedAt ? `Z-Bon am ${finalizedAt}` : "Noch nicht abgeschlossen"}
          </Text>
        </View>
        <Badge variant={closingStateBadgeVariant(closing.state)} dot>
          <Text>{CLOSING_STATE_LABELS[closing.state]}</Text>
        </Badge>
      </View>

      {/* Kennzahlen — bare label/value rows, mono column aligned. */}
      <View className="gap-1.5">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-muted-foreground text-sm">Netto-Verkauf</Text>
          <Text className="font-mono-medium text-sm">{formatEur(closing.netVerkaufEur)}</Text>
        </View>
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-muted-foreground text-sm">Netto-Ankauf</Text>
          <Text className="font-mono-medium text-sm">{formatEur(closing.netAnkaufEur)}</Text>
        </View>
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-muted-foreground text-sm">Kassendifferenz</Text>
          <Text className="font-mono-medium text-sm" style={{ color: varColor }}>
            {closing.cashVarianceEur != null ? formatEur(closing.cashVarianceEur) : "Nicht gezählt"}
          </Text>
        </View>
        <View className="flex-row items-center justify-between gap-3">
          <Text className="text-muted-foreground text-sm">Belege (V · A · Storno)</Text>
          <Text className="font-mono-medium text-sm">
            {closing.verkaufCount} · {closing.ankaufCount} · {closing.stornoCount}
          </Text>
        </View>
        {closing.tseFailedCount > 0 ? (
          <View className="flex-row items-center gap-1.5 pt-0.5">
            <AlertTriangle size={t.icon.xs} color={t.colors.destructive} />
            <Text className="text-sm" style={{ color: t.colors.destructive }}>
              {closing.tseFailedCount} TSE-Fehler an diesem Tag
            </Text>
          </View>
        ) : null}
      </View>

      {error != null ? <InlineError message={error} onDismiss={onDismissError} /> : null}

      {/* Exporte (read-only Downloads) + Status-Schluss in one quiet footer row. */}
      <View className="flex-row flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onPress={() => onExport("datev")}
          disabled={busy}
          accessibilityLabel={`${EXPORT_LABELS.datev} teilen`}
          hitSlop={{ top: 8, bottom: 8 }}
        >
          <Download size={t.icon.xs} color={t.colors.foreground} />
          <Text>DATEV</Text>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onPress={() => onExport("kassenbericht")}
          disabled={busy}
          accessibilityLabel={`${EXPORT_LABELS.kassenbericht} teilen`}
          hitSlop={{ top: 8, bottom: 8 }}
        >
          <FileSpreadsheet size={t.icon.xs} color={t.colors.foreground} />
          <Text>Kassenbericht</Text>
        </Button>

        {finalized ? (
          <View className="ml-auto flex-row items-center gap-1.5">
            <Lock size={t.icon.xs} color={t.colors.verdigris} />
            <Text className="text-2xs font-medium" style={{ color: t.colors.verdigris }}>
              Rechtsverbindlich
            </Text>
          </View>
        ) : null}
      </View>

      {/* Z-Bon — fiskalische Aktion, nur wenn der Tag noch offen ist. */}
      {!finalized ? (
        <View className="gap-2">
          <Text className="text-muted-foreground text-xs leading-5">
            Der Z-Bon schließt den Geschäftstag rechtsverbindlich ab und kann nicht rückgängig
            gemacht werden.
          </Text>
          <Button
            variant="default"
            size="lg"
            className="h-12"
            onPress={onFinalize}
            disabled={busy}
            accessibilityLabel={`Z-Bon erstellen für ${formatBusinessDay(closing.businessDay)}`}
          >
            <Receipt size={t.icon.sm} color={t.colors.primaryForeground} />
            <Text>Z-Bon erstellen</Text>
          </Button>
        </View>
      ) : null}
    </View>
  )
}

// ── Z-Bon Bestätigungs-Sheet ──────────────────────────────────────────────────
/** A spine-native bottom sheet that spells out the fiscal weight of a Z-Bon
 *  before it is written: grabber + brass shield header + tap-scrim-to-dismiss, a
 *  bare hairline-ruled Netto-Zusammenfassung, an explicit irreversibility note,
 *  the InlineError on a refusal, and comfortable 48px money-path actions off the
 *  home indicator. The commit press fires the §7 money-path Medium haptic; the
 *  write never fires on its own.
 *
 *  Two modes. With an existing `closing` it shows the real figures being sealed.
 *  For the CURRENT open day no closing row exists yet (the backend computes the
 *  aggregate at finalize), so `closing` is null and `businessDay` carries the day
 *  — we show an HONEST note that the totals are computed at finalize rather than a
 *  fabricated 0,00 summary. */
function FinalizeSheet({
  closing,
  businessDay,
  busy,
  error,
  onClose,
  onConfirm,
  onDismissError,
}: {
  closing: ClosingListItem | null
  businessDay: string
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
  onDismissError: () => void
}) {
  const t = useW14Theme()
  const insets = useScreenInsets()
  const hasTseFailures = closing != null && closing.tseFailedCount > 0

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      // Android hardware back: while the legal Z-Bon write is in flight the sheet
      // stays put (matching the scrim + Abbrechen, both disabled when busy) so a
      // back-press can't tear it down mid-commit.
      onRequestClose={busy ? undefined : onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <Pressable
        className="flex-1 justify-end"
        style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
        accessibilityRole="button"
        accessibilityLabel="Schließen"
        onPress={busy ? undefined : onClose}
      >
        {/* Inner Pressable swallows taps so a tap inside the sheet never dismisses. */}
        <Pressable
          onPress={() => {}}
          className="bg-background border-border gap-4 rounded-t-2xl border-t px-5 pt-5"
          style={{ paddingBottom: insets.stickyBottom }}
        >
          <View className="items-center pb-1">
            <View className="h-1 w-10 rounded-full" style={{ backgroundColor: t.colors.border }} />
          </View>

          <View className="flex-row items-center gap-2.5">
            <WaxSeal size={t.icon.xl} color={t.colors.gilt} />
            <View className="flex-1">
              <Text className="text-lg font-display-semibold leading-tight">Z-Bon erstellen</Text>
              <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                {formatBusinessDay(businessDay)}
              </Text>
            </View>
          </View>

          <Text className="text-muted-foreground text-sm leading-5">
            Du schließt diesen Geschäftstag rechtsverbindlich ab. Der Tagesabschluss wird signiert,
            im Prüfprotokoll vermerkt und kann danach nicht mehr geändert werden.
          </Text>

          {/* Netto-Zusammenfassung — the real figures being sealed, as bare
              hairline-separated rows. For the open current day no row exists yet,
              so we state honestly that the totals are computed at finalize rather
              than show a fabricated summary. */}
          {closing != null ? (
            <View>
              <View className="flex-row items-center justify-between gap-3 py-1.5">
                <Text className="text-muted-foreground text-sm">Netto-Verkauf</Text>
                <Text className="font-mono-medium text-sm">{formatEur(closing.netVerkaufEur)}</Text>
              </View>
              <Hairline />
              <View className="flex-row items-center justify-between gap-3 py-1.5">
                <Text className="text-muted-foreground text-sm">Netto-Ankauf</Text>
                <Text className="font-mono-medium text-sm">{formatEur(closing.netAnkaufEur)}</Text>
              </View>
              <Hairline />
              <View className="flex-row items-center justify-between gap-3 py-1.5">
                <Text className="text-muted-foreground text-sm">Belege (V · A · Storno)</Text>
                <Text className="font-mono-medium text-sm">
                  {closing.verkaufCount} · {closing.ankaufCount} · {closing.stornoCount}
                </Text>
              </View>
            </View>
          ) : (
            <View className="flex-row items-start gap-2">
              <Receipt size={t.icon.sm} color={t.colors.mutedForeground} />
              <Text className="text-muted-foreground flex-1 text-sm leading-5">
                Die Tagessummen (Verkauf, Ankauf, Kassendifferenz) werden beim Abschluss aus den
                Belegen des Tages berechnet und im Z-Bon festgeschrieben.
              </Text>
            </View>
          )}

          {/* A day with TSE failures is sealed WITH that flaw on record — say so. */}
          {hasTseFailures && closing != null ? (
            <View className="flex-row items-start gap-2">
              <AlertTriangle size={t.icon.sm} color={t.colors.destructive} />
              <Text className="flex-1 text-sm leading-5" style={{ color: t.colors.destructive }}>
                {closing.tseFailedCount} TSE-Fehler werden mit abgeschlossen und bleiben im
                Prüfprotokoll dokumentiert.
              </Text>
            </View>
          ) : null}

          <View className="flex-row items-center gap-1.5">
            <Lock size={t.icon.xs} color={t.colors.mutedForeground} />
            <Text className="text-muted-foreground text-2xs">
              Zur Bestätigung kann eine PIN-Eingabe verlangt werden.
            </Text>
          </View>

          {error != null ? <InlineError message={error} onDismiss={onDismissError} /> : null}

          <View className="flex-row gap-3 pt-1">
            <Button
              variant="outline"
              size="lg"
              className="h-12 flex-1"
              onPress={onClose}
              disabled={busy}
            >
              <Text>Abbrechen</Text>
            </Button>
            <Button
              variant="default"
              size="lg"
              className="h-12 flex-1"
              onPress={() => {
                // Money-path commit — the §7 Medium impact lands on the press.
                haptics.impactMedium()
                onConfirm()
              }}
              disabled={busy}
              accessibilityLabel="Tagesabschluss rechtsverbindlich abschließen"
            >
              <Receipt size={t.icon.sm} color={t.colors.primaryForeground} />
              <Text>{busy ? "Wird erstellt…" : "Abschließen"}</Text>
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

// ── First-load skeleton — the surface's own shape, never a mid-screen spinner. ──
function KasseSkeleton() {
  const t = useW14Theme()
  return (
    <View className="gap-7">
      {/* Aktuelle Schicht — header + four ledger rows. */}
      <View className="gap-3">
        <View className="flex-row items-center gap-2.5">
          <Skeleton width={18} height={18} radius="button" />
          <Skeleton width={150} height={18} />
        </View>
        <View>
          {Array.from({ length: 4 }).map((_, i) => (
            <View key={i}>
              <View className="flex-row items-center justify-between py-1.5">
                <Skeleton width={120} height={13} />
                <Skeleton width={72} height={13} />
              </View>
              {i < 3 ? <View style={{ height: 1, backgroundColor: t.colors.border }} /> : null}
            </View>
          ))}
        </View>
      </View>

      {/* Tagesabschlüsse — overline + three bare rows. */}
      <View className="gap-3">
        <Skeleton width={120} height={11} />
        {Array.from({ length: 3 }).map((_, i) => (
          <View key={i}>
            <View className="gap-3 py-4">
              <View className="flex-row items-center gap-3">
                <Skeleton width={20} height={20} radius="button" />
                <Skeleton width="50%" height={15} />
                <View className="flex-1" />
                <Skeleton width={84} height={22} radius="button" />
              </View>
              <View className="gap-2">
                <Skeleton width="100%" height={12} />
                <Skeleton width="90%" height={12} />
              </View>
              <View className="flex-row gap-2">
                <Skeleton width={92} height={36} radius="button" />
                <Skeleton width={120} height={36} radius="button" />
              </View>
            </View>
            {i < 2 ? <View style={{ height: 1, backgroundColor: t.colors.border }} /> : null}
          </View>
        ))}
      </View>
    </View>
  )
}

// A stable busy-id for the current open trading day, which has no closing row yet
// (so it cannot key off a row id). Distinct from any UUID the list could return.
const TODAY_BUSY_ID = "__today__"

/**
 * What the confirm sheet is sealing: either an existing closing row, or the
 * current open trading day (no row yet — the backend computes it at finalize).
 */
type FinalizeTarget =
  | { kind: "closing"; closing: ClosingListItem }
  | { kind: "today"; businessDay: string }

// ── Screen ────────────────────────────────────────────────────────────────────
export default function KasseScreen() {
  const t = useW14Theme()
  const insets = useScreenInsets()

  // Per-card write/export state + the active confirm target + the seal flourish.
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)
  const [confirming, setConfirming] = useState<FinalizeTarget | null>(null)
  const [finalizeError, setFinalizeError] = useState<string | null>(null)
  const [celebrate, setCelebrate] = useState(false)

  // One live fan-out: the shift read is allowed to fail independently (the till
  // may be closed → null), while the closings list is the primary payload.
  // Refetch-on-focus brings a freshly-finalized day into view on return;
  // pull-to-refresh + in-flight de-dupe come free.
  const q = useMultiQuery(
    {
      shift: () => getCurrentShift(),
      closings: () => listClosings(),
    },
    { key: "kasse" },
  )
  const rc = useRefreshControl(q)

  const shift = q.results.shift.data
  // A FAILED shift read resolves to data:null — the SAME shape as a genuine
  // closed till. Keep the error so we never assert „keine offene Schicht" when
  // we simply could not read it (it would tell an owner with an open till it is
  // closed, and drop the Z-Bon pre-warning). Same bug class fixed for Team.
  const shiftError = q.results.shift.error
  const closingsData = q.results.closings.data
  const closings = closingsData ? sortClosingsNewestFirst(closingsData.items) : null
  // The surface only hard-fails when its PRIMARY payload (closings) couldn't load.
  const closingsError = q.results.closings.error

  // The current trading day is "open" (needs a Z-Bon) when it has no closing row
  // yet — the only honest open-day signal, since the backend never writes a
  // COUNTING row. We surface the finalize affordance only once the list has
  // loaded (closings != null), so we never imply an open day before we know.
  const today = todayBusinessDay(new Date())
  const todayIsOpen = closings != null && isTodayOpen(closings, today)
  // A true signal only for THIS device's till; lets us pre-warn that the
  // Kassensturz is still pending without overclaiming about other devices.
  const shiftOpenHere = shift != null && shift.status === "OPEN"

  // ── Export → temp cache CSV → OS share sheet ───────────────────────────────
  const onExport = useCallback(async (closing: ClosingListItem, kind: ExportKind) => {
    haptics.selection()
    setBusyId(closing.id)
    setRowError(null)
    let file: File | null = null
    try {
      // 403 STEP_UP_REQUIRED on the export is handled transparently + retried.
      const csv =
        kind === "datev"
          ? await closingDatevCsv(closing.id)
          : await closingKassenberichtCsv(closing.id)

      file = new File(Paths.cache, exportFileName(kind, closing.businessDay))
      // Overwrite any stale copy from a previous share of the same day.
      if (file.exists) file.delete()
      file.create()
      file.write(csv)

      await Share.share(
        {
          url: file.uri,
          message: `${EXPORT_LABELS[kind]} · ${formatBusinessDay(closing.businessDay)}`,
        },
        { subject: exportFileName(kind, closing.businessDay) },
      )
    } catch (e) {
      haptics.error()
      setRowError({ id: closing.id, message: describeError(e) })
    } finally {
      // Best-effort temp cleanup (the share sheet has already read the file).
      try {
        file?.delete()
      } catch {
        // already gone — fine.
      }
      setBusyId(null)
    }
  }, [])

  // ── Z-Bon finalize (step-up + confirm sheet, NEVER auto) ───────────────────
  // Handles both an existing closing row and the current open day. For "today"
  // we call finalizeClosing() with NO businessDay — the backend defaults to the
  // current Berlin business day, which is the only path that writes a day's first
  // closing (the list can never offer an open-day row to seal).
  const runFinalize = useCallback(
    async (target: FinalizeTarget) => {
      const busyKey = target.kind === "closing" ? target.closing.id : TODAY_BUSY_ID
      setBusyId(busyKey)
      setFinalizeError(null)
      try {
        // 403 STEP_UP_REQUIRED → the global host opens the PIN + retries the POST.
        // A still-open shift / unsettled day → backend 409 with a clear German
        // message, surfaced inline by describeError (never a fabricated success).
        await finalizeClosing(target.kind === "closing" ? target.closing.businessDay : undefined)
        // The legal day-seal landed — a real fiscal milestone. One Success haptic
        // (§7), close the sheet, arm the single gold flourish, then refetch so the
        // freshly-sealed day appears and the overview recounts from server truth.
        haptics.success()
        setConfirming(null)
        setCelebrate(true)
        await q.refetch()
      } catch (e) {
        haptics.error()
        setFinalizeError(describeError(e))
      } finally {
        setBusyId(null)
      }
    },
    [q],
  )

  const showSkeleton = q.status === "loading" && closings == null
  const showError = closings == null && closingsError != null

  return (
    <View className="flex-1 bg-background">
      {/* The aged-paper grain canvas — depth from the layered cream plus this
          faint warm tooth, never a flat fill (DESIGN.md §1, §5). */}
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.contentBottom,
          gap: 28,
        }}
        refreshControl={<RefreshControl {...rc} />}
      >
        {showSkeleton ? (
          <KasseSkeleton />
        ) : showError ? (
          <View className="pt-6">
            <ErrorState
              message={closingsError ?? describeError(q.results.closings.errorCause)}
              cause={q.results.closings.errorCause}
              onRetry={() => void q.refetch()}
              retrying={q.isFetching}
            />
          </View>
        ) : (
          <>
            {/* Three honest states: open → ShiftBlock; read FAILED → a degraded
                „status unklar" (NEVER „keine offene Schicht" on an error); only a
                clean null (read succeeded, no shift) → NoShiftBlock. */}
            {shift != null ? (
              <ShiftBlock shift={shift} />
            ) : shiftError != null ? (
              <View className="gap-1.5">
                <Text className="font-display-semibold text-lg leading-tight">
                  Schichtstatus unklar
                </Text>
                <Text className="text-muted-foreground text-sm leading-5">
                  Der Schichtstatus konnte nicht geladen werden. Zum Aktualisieren nach unten
                  ziehen.
                </Text>
              </View>
            ) : (
              <NoShiftBlock />
            )}

            {closings != null && closings.length > 0 ? (
              <FiscalOverviewBlock closings={closings} today={today} />
            ) : null}

            {/* The current open trading day — the ONLY path to write its first
                Z-Bon (no list row can exist for it yet). */}
            {todayIsOpen ? (
              <View className="gap-3">
                <SectionHeader title="HEUTIGER GESCHÄFTSTAG" emphasis="overline" />
                <StaggerItem index={0} exit={false}>
                  <OpenDayAffordance
                    businessDay={today}
                    shiftOpenHere={shiftOpenHere}
                    busy={busyId === TODAY_BUSY_ID}
                    onFinalize={() => {
                      // Light press confirm as the fiscal sheet opens (§7).
                      haptics.impactLight()
                      setFinalizeError(null)
                      setConfirming({ kind: "today", businessDay: today })
                    }}
                  />
                </StaggerItem>
              </View>
            ) : null}

            <View className="gap-3">
              <SectionHeader title="TAGESABSCHLÜSSE" emphasis="overline" />

              {closings != null && closings.length === 0 ? (
                <EmptyState
                  icon={Receipt}
                  title="Keine Abschlüsse"
                  description="Sobald am POS ein Geschäftstag läuft, erscheint er hier zum Abschließen und Exportieren."
                />
              ) : (
                <View>
                  {closings?.map((closing, index) => (
                    <StaggerItem key={closing.id} index={Math.min(index, 8)} exit={false}>
                      {index > 0 ? <Hairline /> : null}
                      <PressableScale accessibilityLabel={formatBusinessDay(closing.businessDay)}>
                        <ClosingRow
                          closing={closing}
                          busy={busyId === closing.id}
                          error={rowError?.id === closing.id ? rowError.message : null}
                          onExport={(kind) => void onExport(closing, kind)}
                          onFinalize={() => {
                            // Light press confirm as the fiscal sheet opens (§7).
                            haptics.impactLight()
                            setFinalizeError(null)
                            setConfirming({ kind: "closing", closing })
                          }}
                          onDismissError={() => setRowError(null)}
                        />
                      </PressableScale>
                    </StaggerItem>
                  ))}
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>

      {confirming != null ? (
        <FinalizeSheet
          closing={confirming.kind === "closing" ? confirming.closing : null}
          businessDay={
            confirming.kind === "closing" ? confirming.closing.businessDay : confirming.businessDay
          }
          busy={busyId === (confirming.kind === "closing" ? confirming.closing.id : TODAY_BUSY_ID)}
          error={finalizeError}
          onClose={() => {
            setConfirming(null)
            setFinalizeError(null)
          }}
          onConfirm={() => void runFinalize(confirming)}
          onDismissError={() => setFinalizeError(null)}
        />
      ) : null}

      {/* The day-seal flourish — gilt, decorative only, plays once on success. */}
      <GoldFlood
        visible={celebrate}
        onReachPeak={() => haptics.impactHeavy()}
        onDone={() => setCelebrate(false)}
      />
    </View>
  )
}
