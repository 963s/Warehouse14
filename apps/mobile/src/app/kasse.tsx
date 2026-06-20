/**
 * Kasse — the fiscal cockpit. READ-FIRST for fiscal safety: it shows the open
 * Schicht (shifts.getCurrent — Umsatzkontext + Kassendifferenz) and the list of
 * finalized Tagesabschlüsse (closingsApi.list: businessDay, Netto-Verkauf,
 * Netto-Ankauf, Kassendifferenz, Status).
 *
 * Two read-only exports per closing — DATEV (EXTF) and Kassenbericht — are
 * offered as share-sheet downloads: the CSV body comes back as text, is written
 * to a temp cache file, and handed to the OS share sheet (RN Share). The temp
 * file is best-effort cleaned up afterwards.
 *
 * The ONLY mutation is the Z-Bon (closingsApi.finalize). It is the WRITE of a
 * legal Tagesabschluss, so it lives behind a clear confirm dialog AND server
 * step-up (the global StepUpDialogHost handles the 403 transparently). It is
 * marked plainly as a fiscal action and NEVER auto-fires. Reached from the
 * „Mehr"-Hub (/kasse).
 *
 * Honesty rule (mirrors Aufgaben + Termine): every row is a real closing from a
 * real endpoint; an empty list shows the EmptyState, never a fabricated day.
 * All labels German. No native deps added — Share + expo-file-system only.
 */
import { useCallback, useState } from "react"
import { Alert, Modal, RefreshControl, ScrollView, Share, View } from "react-native"
import { useFocusEffect } from "expo-router"
import { File, Paths } from "expo-file-system"
import type { ClosingListItem, ShiftView } from "@warehouse14/api-client"
import {
  AlertTriangle,
  CalendarDays,
  Download,
  FileSpreadsheet,
  Lock,
  Receipt,
  ShieldCheck,
  Wallet,
  XCircle,
} from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

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
  formatBusinessDay,
  formatTimestamp,
  SHIFT_STATUS_LABELS,
  sortClosingsNewestFirst,
  varianceTone,
} from "@/warehouse14/kasse-ui"
import { useW14Theme } from "@/warehouse14/theme"
import { EmptyState, SectionCard, StatTile } from "@/warehouse14/ui"

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
        <Badge variant={shift.status === "OPEN" ? "default" : "outline"}>
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
        <Lock size={16} color={t.colors.mutedForeground} />
        <Text className="text-muted-foreground text-sm">
          Keine offene Schicht. Die Kasse wird am POS geöffnet.
        </Text>
      </View>
    </SectionCard>
  )
}

// ── Tagesabschluss-Karte ──────────────────────────────────────────────────────
function ClosingCard({
  closing,
  busy,
  onExport,
  onFinalize,
}: {
  closing: ClosingListItem
  busy: boolean
  onExport: (kind: ExportKind) => void
  onFinalize: () => void
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

  return (
    <Card className="gap-3 px-4 py-4">
      {/* Kopf: Geschäftstag + Status */}
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 flex-row items-center gap-2.5">
          <CalendarDays size={18} color={t.colors.primary} />
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
        <Badge variant={closingStateBadgeVariant(closing.state)}>
          <Text>{CLOSING_STATE_LABELS[closing.state]}</Text>
        </Badge>
      </View>

      {/* Kennzahlen */}
      <View className="gap-1.5">
        <View className="flex-row items-center justify-between">
          <Text className="text-muted-foreground text-sm">Netto-Verkauf</Text>
          <Text className="text-sm font-semibold">{formatEur(closing.netVerkaufEur)}</Text>
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="text-muted-foreground text-sm">Netto-Ankauf</Text>
          <Text className="text-sm font-semibold">{formatEur(closing.netAnkaufEur)}</Text>
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="text-muted-foreground text-sm">Kassendifferenz</Text>
          <Text className="text-sm font-semibold" style={{ color: varColor }}>
            {closing.cashVarianceEur != null ? formatEur(closing.cashVarianceEur) : "—"}
          </Text>
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="text-muted-foreground text-sm">Belege (V · A · Storno)</Text>
          <Text className="text-sm font-medium">
            {closing.verkaufCount} · {closing.ankaufCount} · {closing.stornoCount}
          </Text>
        </View>
        {closing.tseFailedCount > 0 ? (
          <View className="flex-row items-center gap-1.5 pt-0.5">
            <AlertTriangle size={13} color={t.colors.destructive} />
            <Text className="text-sm" style={{ color: t.colors.destructive }}>
              {closing.tseFailedCount} TSE-Fehler an diesem Tag
            </Text>
          </View>
        ) : null}
      </View>

      {/* Exporte (read-only Downloads) */}
      <View className="flex-row flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onPress={() => onExport("datev")}
          disabled={busy}
          accessibilityLabel={`${EXPORT_LABELS.datev} teilen`}
        >
          <Download size={14} color={t.colors.foreground} />
          <Text>DATEV</Text>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onPress={() => onExport("kassenbericht")}
          disabled={busy}
          accessibilityLabel={`${EXPORT_LABELS.kassenbericht} teilen`}
        >
          <FileSpreadsheet size={14} color={t.colors.foreground} />
          <Text>Kassenbericht</Text>
        </Button>
      </View>

      {/* Z-Bon — fiskalische Aktion, nur wenn der Tag noch offen ist */}
      {!finalized ? (
        <View className="border-border gap-2 border-t pt-3">
          <View className="flex-row items-center gap-1.5">
            <ShieldCheck size={14} color={t.colors.primary} />
            <Text className="text-xs font-semibold" style={{ color: t.colors.primary }}>
              Fiskalische Aktion
            </Text>
          </View>
          <Text className="text-muted-foreground text-xs">
            Der Z-Bon schließt den Geschäftstag rechtsverbindlich ab und kann nicht rückgängig
            gemacht werden.
          </Text>
          <Button variant="default" onPress={onFinalize} disabled={busy}>
            <Receipt size={16} color={t.colors.primaryForeground} />
            <Text>Z-Bon erstellen</Text>
          </Button>
        </View>
      ) : null}
    </Card>
  )
}

// ── Z-Bon Bestätigungsdialog ──────────────────────────────────────────────────
function FinalizeConfirm({
  closing,
  busy,
  onClose,
  onConfirm,
}: {
  closing: ClosingListItem
  busy: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const t = useW14Theme()
  const insets = useSafeAreaInsets()

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
        <View
          className="bg-background gap-4 rounded-t-2xl px-5 pt-5"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <View className="flex-row items-center gap-2">
            <ShieldCheck size={20} color={t.colors.primary} />
            <Text className="text-lg font-bold">Z-Bon erstellen</Text>
          </View>

          <Text className="text-muted-foreground text-sm">
            Du schließt den Geschäftstag{" "}
            <Text className="text-foreground font-semibold">
              {formatBusinessDay(closing.businessDay)}
            </Text>{" "}
            rechtsverbindlich ab. Der Tagesabschluss wird signiert, im Prüfprotokoll vermerkt und
            kann danach nicht mehr geändert werden.
          </Text>

          <View
            className="gap-1 rounded-xl px-4 py-3"
            style={{ borderWidth: 1, borderColor: t.colors.border }}
          >
            <View className="flex-row items-center justify-between">
              <Text className="text-muted-foreground text-sm">Netto-Verkauf</Text>
              <Text className="text-sm font-semibold">{formatEur(closing.netVerkaufEur)}</Text>
            </View>
            <View className="flex-row items-center justify-between">
              <Text className="text-muted-foreground text-sm">Netto-Ankauf</Text>
              <Text className="text-sm font-semibold">{formatEur(closing.netAnkaufEur)}</Text>
            </View>
          </View>

          <Text className="text-muted-foreground" style={{ fontSize: 11 }}>
            Zur Bestätigung kann eine PIN-Eingabe verlangt werden.
          </Text>

          <View className="flex-row gap-3 pt-1">
            <Button variant="outline" className="flex-1" onPress={onClose} disabled={busy}>
              <Text>Abbrechen</Text>
            </Button>
            <Button variant="default" className="flex-1" onPress={onConfirm} disabled={busy}>
              <Receipt size={16} color={t.colors.primaryForeground} />
              <Text>{busy ? "Wird erstellt…" : "Abschließen"}</Text>
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function KasseScreen() {
  const t = useW14Theme()
  const insets = useSafeAreaInsets()

  const [shift, setShift] = useState<ShiftView | null>(null)
  const [closings, setClosings] = useState<ClosingListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<ClosingListItem | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      // The shift read is allowed to fail independently (the till may be
      // closed → null); the closings list is the primary payload.
      const [shiftRes, closingsRes] = await Promise.all([
        getCurrentShift().catch(() => null),
        listClosings(),
      ])
      setShift(shiftRes)
      setClosings(sortClosingsNewestFirst(closingsRes.items))
    } catch (e) {
      setError(describeError(e))
      setClosings([])
    } finally {
      setLoading(false)
    }
  }, [])

  useFocusEffect(
    useCallback(() => {
      setLoading(true)
      void load()
    }, [load]),
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }, [load])

  // ── Export → temp cache CSV → OS share sheet ───────────────────────────────
  async function onExport(closing: ClosingListItem, kind: ExportKind) {
    setBusyId(closing.id)
    setError(null)
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
      setError(describeError(e))
    } finally {
      // Best-effort temp cleanup (the share sheet has already read the file).
      try {
        file?.delete()
      } catch {
        // already gone — fine.
      }
      setBusyId(null)
    }
  }

  // ── Z-Bon finalize (step-up + confirm, NEVER auto) ─────────────────────────
  async function runFinalize(closing: ClosingListItem) {
    setBusyId(closing.id)
    setError(null)
    try {
      // 403 STEP_UP_REQUIRED → the PIN dialog opens + the POST retries.
      await finalizeClosing(closing.businessDay)
      setConfirming(null)
      Alert.alert(
        "Z-Bon erstellt",
        `Der Geschäftstag ${formatBusinessDay(closing.businessDay)} wurde abgeschlossen.`,
      )
      await load()
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 18 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.colors.primary} />
        }
      >
        {error != null ? (
          <Card className="gap-2 border-destructive px-4 py-4">
            <View className="flex-row items-center gap-2">
              <XCircle size={16} color={t.colors.destructive} />
              <Text className="text-destructive text-base font-semibold">Fehler</Text>
            </View>
            <Text className="text-muted-foreground text-sm">{error}</Text>
          </Card>
        ) : null}

        {loading ? (
          <Text className="text-muted-foreground">Lade Kasse…</Text>
        ) : (
          <>
            {shift != null ? <ShiftPanel shift={shift} /> : <NoShiftPanel />}

            <View className="gap-3">
              <Text
                className="text-xs font-semibold uppercase"
                style={{ color: t.colors.mutedForeground, letterSpacing: 0.5 }}
              >
                Tagesabschlüsse
              </Text>

              {closings.length === 0 ? (
                <EmptyState
                  icon={Receipt}
                  title="Keine Abschlüsse"
                  description="Sobald am POS ein Geschäftstag läuft, erscheint er hier zum Abschließen und Exportieren."
                />
              ) : (
                closings.map((closing) => (
                  <ClosingCard
                    key={closing.id}
                    closing={closing}
                    busy={busyId === closing.id}
                    onExport={(kind) => void onExport(closing, kind)}
                    onFinalize={() => setConfirming(closing)}
                  />
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>

      {confirming != null ? (
        <FinalizeConfirm
          closing={confirming}
          busy={busyId === confirming.id}
          onClose={() => setConfirming(null)}
          onConfirm={() => void runFinalize(confirming)}
        />
      ) : null}
    </View>
  )
}
