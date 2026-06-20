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
 * a single measured gold flourish. Reached from the „Mehr"-Hub (/kasse).
 *
 * Built on the shared spine (DESIGN.md): live data through `useMultiQuery` (shift
 * is allowed to fail independently → null, closings is the primary payload;
 * refetch-on-focus + pull-to-refresh via `useRefreshControl`), the unified state
 * vocabulary (shaped Skeleton · ErrorState+Retry · EmptyState), a staggered list
 * entrance, `PressableScale` cards, honest `CountUp` figures, and the §7 haptic
 * vocabulary (selection on an export tap, Light on opening the Z-Bon sheet, Medium
 * on the Z-Bon commit press, Success on the sealed day, Error on a refusal).
 *
 * Honesty rule (mirrors Aufgaben + Termine): every row + the overview are real
 * values from a real endpoint; an empty list shows the EmptyState, never a
 * fabricated day. All labels German; de-DE money/dates. Money on the wire here is
 * EUR DECIMAL STRINGS — formatted with `formatEur`, never `formatCents`. No native
 * deps added — Share + expo-file-system only.
 */
import { useCallback, useState } from "react"
import { Modal, Pressable, RefreshControl, ScrollView, Share, View } from "react-native"
import { File, Paths } from "expo-file-system"
import type { ClosingListItem, ShiftView } from "@warehouse14/api-client"
import {
  AlertTriangle,
  CalendarDays,
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
import { Card } from "@/components/ui/card"
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
  SHIFT_STATUS_LABELS,
  sortClosingsNewestFirst,
  varianceTone,
} from "@/warehouse14/kasse-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  CountUp,
  EmptyState,
  ErrorState,
  GoldFlood,
  haptics,
  InlineError,
  PressableScale,
  SectionCard,
  Skeleton,
  StaggerItem,
  StatTile,
  useMultiQuery,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

// ── Aktuelle Schicht ──────────────────────────────────────────────────────────
/** The open-till context: opening float, blind count, system-expected, variance. */
function ShiftPanel({ shift }: { shift: ShiftView }) {
  const tone = varianceTone(shift.varianceEur)
  const openedAt = formatTimestamp(shift.openedAt)

  return (
    <SectionCard
      title="Aktuelle Schicht"
      subtitle={openedAt ? `Geöffnet am ${openedAt}` : undefined}
      icon={Wallet}
      action={
        <Badge variant={shift.status === "OPEN" ? "success" : "outline"} dot>
          <Text>{SHIFT_STATUS_LABELS[shift.status]}</Text>
        </Badge>
      }
    >
      <View className="flex-row flex-wrap justify-between" style={{ rowGap: 12 }}>
        <StatTile label="Anfangsbestand" value={formatEur(shift.openingFloatEur)} />
        <StatTile
          label="Erwartet (System)"
          value={shift.systemExpectedEur != null ? formatEur(shift.systemExpectedEur) : "—"}
          muted={shift.systemExpectedEur == null}
        />
        <StatTile
          label="Gezählt (Blind)"
          value={shift.blindCountEur != null ? formatEur(shift.blindCountEur) : "—"}
          muted={shift.blindCountEur == null}
        />
        <StatTile
          label="Kassendifferenz"
          value={shift.varianceEur != null ? formatEur(shift.varianceEur) : "—"}
          tone={tone}
          muted={shift.varianceEur == null}
        />
      </View>
    </SectionCard>
  )
}

/** Shown when the till is closed — no open shift to report. */
function NoShiftPanel() {
  const t = useW14Theme()
  return (
    <SectionCard title="Aktuelle Schicht" icon={Wallet}>
      <View className="flex-row items-center gap-2 py-1">
        <Lock size={t.icon.sm} color={t.colors.mutedForeground} />
        <Text className="text-muted-foreground text-sm">
          Keine offene Schicht. Die Kasse wird am POS geöffnet.
        </Text>
      </View>
    </SectionCard>
  )
}

// ── Fiskalischer Überblick ────────────────────────────────────────────────────
/** The honest trust header: real counts of open vs. sealed days, and the TSE
 *  failure trail — every figure derived from the fetched closings, animated only
 *  because it is real (CountUp animates magnitude, never a fabricated number). A
 *  non-zero TSE count surfaces as a calm-but-clear destructive line. */
function FiscalOverviewPanel({ closings }: { closings: ClosingListItem[] }) {
  const t = useW14Theme()
  const o = fiscalOverview(closings)
  const clean = o.tseFailures === 0

  return (
    <SectionCard
      title="Fiskalischer Überblick"
      subtitle="Stand der Tagesabschlüsse"
      icon={ShieldCheck}
    >
      <View className="flex-row flex-wrap justify-between" style={{ rowGap: 12 }}>
        <StatTile
          label="Offene Tage"
          value={String(o.openDays)}
          tone={o.openDays > 0 ? "primary" : "muted"}
          hint={o.openDays > 0 ? "Z-Bon ausstehend" : "Alles abgeschlossen"}
        />
        <Card className="gap-2 px-3 py-3" style={{ width: "48%" }}>
          <Text
            className="text-muted-foreground text-xs font-medium uppercase"
            style={{ letterSpacing: 0.4 }}
            numberOfLines={1}
          >
            Abgeschlossen
          </Text>
          <CountUp
            value={o.finalizedDays}
            motion="timing"
            className="font-mono-medium text-2xl"
            style={{ color: t.colors.verdigris }}
            accessibilityLabel={`${o.finalizedDays} abgeschlossene Tage`}
          />
          <Text className="text-muted-foreground text-2xs">Z-Bon gesiegelt</Text>
        </Card>
      </View>

      {/* The fiscal trust line — the audit trail's health in one honest row. */}
      <View
        className="flex-row items-center gap-2 rounded-xl px-3 py-2.5"
        style={{
          backgroundColor: (clean ? t.colors.verdigris : t.colors.destructive) + "12",
          borderWidth: 1,
          borderColor: (clean ? t.colors.verdigris : t.colors.destructive) + "33",
        }}
      >
        {clean ? (
          <CheckCircle2 size={t.icon.sm} color={t.colors.verdigris} />
        ) : (
          <AlertTriangle size={t.icon.sm} color={t.colors.destructive} />
        )}
        <Text
          className="flex-1 text-sm font-medium"
          style={{ color: clean ? t.colors.verdigris : t.colors.destructive }}
        >
          {clean
            ? "TSE-Protokoll lückenlos"
            : `${o.tseFailures} TSE-${o.tseFailures === 1 ? "Fehler" : "Fehler"} im Prüfprotokoll`}
        </Text>
      </View>
    </SectionCard>
  )
}

// ── Tagesabschluss-Karte ──────────────────────────────────────────────────────
function ClosingCard({
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
        : t.colors.primary

  // A finalized day reads sealed (verdigris rail); an open day carries the brass
  // attention of an action still owed.
  const railColor = finalized ? t.colors.verdigris : t.colors.primary

  return (
    <Card className="overflow-hidden p-0">
      <View className="flex-row">
        {/* Status accent rail — sealed (verdigris) vs. open (brass). */}
        <View style={{ width: 4, backgroundColor: railColor }} />

        <View className="flex-1 gap-3 px-4 py-4">
          {/* Kopf: Geschäftstag + Status */}
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1 flex-row items-center gap-2.5">
              <CalendarDays size={t.icon.md} color={railColor} />
              <View className="flex-1">
                <Text className="text-base font-semibold" numberOfLines={1}>
                  {formatBusinessDay(closing.businessDay)}
                </Text>
                {finalizedAt ? (
                  <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                    Z-Bon am {finalizedAt}
                  </Text>
                ) : (
                  <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                    Noch nicht abgeschlossen
                  </Text>
                )}
              </View>
            </View>
            <Badge variant={closingStateBadgeVariant(closing.state)} dot>
              <Text>{CLOSING_STATE_LABELS[closing.state]}</Text>
            </Badge>
          </View>

          {/* Kennzahlen */}
          <View className="gap-1.5">
            <View className="flex-row items-center justify-between">
              <Text className="text-muted-foreground text-sm">Netto-Verkauf</Text>
              <Text className="font-mono-medium text-sm">{formatEur(closing.netVerkaufEur)}</Text>
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="text-muted-foreground text-sm">Netto-Ankauf</Text>
              <Text className="font-mono-medium text-sm">{formatEur(closing.netAnkaufEur)}</Text>
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="text-muted-foreground text-sm">Kassendifferenz</Text>
              <Text className="font-mono-medium text-sm" style={{ color: varColor }}>
                {closing.cashVarianceEur != null ? formatEur(closing.cashVarianceEur) : "—"}
              </Text>
            </View>
            <View className="flex-row items-center justify-between">
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

          {/* Exporte (read-only Downloads) */}
          <View className="flex-row flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onPress={() => onExport("datev")}
              disabled={busy}
              accessibilityLabel={`${EXPORT_LABELS.datev} teilen`}
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
            >
              <FileSpreadsheet size={t.icon.xs} color={t.colors.foreground} />
              <Text>Kassenbericht</Text>
            </Button>
          </View>

          {/* Z-Bon — fiskalische Aktion, nur wenn der Tag noch offen ist */}
          {!finalized ? (
            <View className="border-border gap-2 border-t pt-3">
              <View className="flex-row items-center gap-1.5">
                <ShieldCheck size={t.icon.xs} color={t.colors.primary} />
                <Text className="text-xs font-semibold" style={{ color: t.colors.primary }}>
                  Fiskalische Aktion
                </Text>
              </View>
              <Text className="text-muted-foreground text-xs">
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
          ) : (
            <View className="border-border flex-row items-center gap-1.5 border-t pt-3">
              <Lock size={t.icon.xs} color={t.colors.verdigris} />
              <Text className="text-xs font-medium" style={{ color: t.colors.verdigris }}>
                Rechtsverbindlich abgeschlossen
              </Text>
            </View>
          )}
        </View>
      </View>
    </Card>
  )
}

// ── Z-Bon Bestätigungs-Sheet ──────────────────────────────────────────────────
/** A spine-native bottom sheet that spells out the fiscal weight of a Z-Bon
 *  before it is written: grabber + brass shield header + tap-scrim-to-dismiss, a
 *  framed Netto-Zusammenfassung, an explicit irreversibility note, the InlineError
 *  on a refusal, and comfortable 48px money-path actions off the home indicator.
 *  The commit press fires the §7 money-path Medium haptic; the write never fires
 *  on its own. */
function FinalizeSheet({
  closing,
  busy,
  error,
  onClose,
  onConfirm,
  onDismissError,
}: {
  closing: ClosingListItem
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
  onDismissError: () => void
}) {
  const t = useW14Theme()
  const insets = useScreenInsets()
  const hasTseFailures = closing.tseFailedCount > 0

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
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
            <View
              className="h-9 w-9 items-center justify-center rounded-md"
              style={{ backgroundColor: t.colors.primary + "1f" }}
            >
              <ShieldCheck size={t.icon.md} color={t.colors.primary} />
            </View>
            <View className="flex-1">
              <Text className="text-base font-bold">Z-Bon erstellen</Text>
              <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                {formatBusinessDay(closing.businessDay)}
              </Text>
            </View>
          </View>

          <Text className="text-muted-foreground text-sm leading-5">
            Du schließt diesen Geschäftstag rechtsverbindlich ab. Der Tagesabschluss wird signiert,
            im Prüfprotokoll vermerkt und kann danach nicht mehr geändert werden.
          </Text>

          {/* Netto-Zusammenfassung — the real figures being sealed. */}
          <View
            className="gap-1.5 rounded-xl px-4 py-3"
            style={{ borderWidth: 1, borderColor: t.colors.border }}
          >
            <View className="flex-row items-center justify-between">
              <Text className="text-muted-foreground text-sm">Netto-Verkauf</Text>
              <Text className="font-mono-medium text-sm">{formatEur(closing.netVerkaufEur)}</Text>
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="text-muted-foreground text-sm">Netto-Ankauf</Text>
              <Text className="font-mono-medium text-sm">{formatEur(closing.netAnkaufEur)}</Text>
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="text-muted-foreground text-sm">Belege (V · A · Storno)</Text>
              <Text className="font-mono-medium text-sm">
                {closing.verkaufCount} · {closing.ankaufCount} · {closing.stornoCount}
              </Text>
            </View>
          </View>

          {/* A day with TSE failures is sealed WITH that flaw on record — say so. */}
          {hasTseFailures ? (
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
  return (
    <View className="gap-[18px]">
      <Card className="gap-3 px-4 py-4">
        <View className="flex-row items-center gap-2.5">
          <Skeleton width={32} height={32} radius="button" />
          <View className="gap-1.5">
            <Skeleton width={140} height={15} />
            <Skeleton width={100} height={11} />
          </View>
        </View>
        <View className="flex-row flex-wrap justify-between" style={{ rowGap: 12 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} width="48%" height={64} radius="card" />
          ))}
        </View>
      </Card>
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="gap-3 px-4 py-4">
          <View className="flex-row items-center justify-between gap-3">
            <Skeleton width="56%" height={15} />
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
        </Card>
      ))}
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function KasseScreen() {
  const insets = useScreenInsets()

  // Per-card write/export state + the active confirm target + the seal flourish.
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)
  const [confirming, setConfirming] = useState<ClosingListItem | null>(null)
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
  const closingsData = q.results.closings.data
  const closings = closingsData ? sortClosingsNewestFirst(closingsData.items) : null
  // The surface only hard-fails when its PRIMARY payload (closings) couldn't load.
  const closingsError = q.results.closings.error

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
  const runFinalize = useCallback(
    async (closing: ClosingListItem) => {
      setBusyId(closing.id)
      setFinalizeError(null)
      try {
        // 403 STEP_UP_REQUIRED → the global host opens the PIN + retries the POST.
        await finalizeClosing(closing.businessDay)
        // The legal day-seal landed — a real fiscal milestone. One Success haptic
        // (§7), close the sheet, arm the single gold flourish, then refetch so the
        // card flips to FINALIZED and the overview recounts from server truth.
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
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.contentBottom,
          gap: 18,
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
            {/* Shift read failed on its own → show the closed-till panel, not an
                error; the closings payload still drives the rest of the screen. */}
            {shift != null ? <ShiftPanel shift={shift} /> : <NoShiftPanel />}

            {closings != null && closings.length > 0 ? (
              <FiscalOverviewPanel closings={closings} />
            ) : null}

            <View className="gap-3">
              <Text
                className="text-muted-foreground text-2xs font-semibold uppercase"
                style={{ letterSpacing: 0.5 }}
              >
                Tagesabschlüsse
              </Text>

              {closings != null && closings.length === 0 ? (
                <EmptyState
                  icon={Receipt}
                  title="Keine Abschlüsse"
                  description="Sobald am POS ein Geschäftstag läuft, erscheint er hier zum Abschließen und Exportieren."
                />
              ) : (
                closings?.map((closing, index) => (
                  <StaggerItem key={closing.id} index={Math.min(index, 8)} exit={false}>
                    <PressableScale accessibilityLabel={formatBusinessDay(closing.businessDay)}>
                      <ClosingCard
                        closing={closing}
                        busy={busyId === closing.id}
                        error={rowError?.id === closing.id ? rowError.message : null}
                        onExport={(kind) => void onExport(closing, kind)}
                        onFinalize={() => {
                          // Light press confirm as the fiscal sheet opens (§7).
                          haptics.impactLight()
                          setFinalizeError(null)
                          setConfirming(closing)
                        }}
                        onDismissError={() => setRowError(null)}
                      />
                    </PressableScale>
                  </StaggerItem>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>

      {confirming != null ? (
        <FinalizeSheet
          closing={confirming}
          busy={busyId === confirming.id}
          error={finalizeError}
          onClose={() => {
            setConfirming(null)
            setFinalizeError(null)
          }}
          onConfirm={() => void runFinalize(confirming)}
          onDismissError={() => setFinalizeError(null)}
        />
      ) : null}

      {/* The day-seal flourish — gold, decorative only, plays once on success. */}
      <GoldFlood
        visible={celebrate}
        onReachPeak={() => haptics.impactHeavy()}
        onDone={() => setCelebrate(false)}
      />
    </View>
  )
}
