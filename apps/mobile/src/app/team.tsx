/**
 * Team — die Owner-OS-Personen-/Zweitkasse-Fläche.
 *
 * Wo der Inhaber sieht, wer auf diesem Gerät angemeldet ist, wer die offene
 * Kasse geöffnet hat (wer im Dienst ist), wie die Rollen geregelt sind und die
 * ehrliche Wahrheit, dass die Mitarbeiter-Stammdaten selbst an der Desktop-Kasse
 * verwaltet werden. Gebaut ganz auf dem geteilten Spine — dem Session-Store, der
 * Datenschicht (useMultiQuery mit Quell-Ehrlichkeit + Refetch-on-focus + höf-
 * lichem Polling + Pull-to-refresh), dem Motion-System (Stagger), den Primitiven
 * und der §7-Haptik — so verhält und liest sie sich wie jede andere Fläche.
 *
 * Form (DESIGN-SYSTEM.md): keine Kästen in Kästen. Die Fläche lebt direkt auf
 * dem warmen Papier — ein ruhiger Kopf mit bespoke Siegel, der Operator und der
 * Dienst als nackte Zeilen, die Schicht-Bilanz als boxlose Mono-Reihe mit einer
 * senkrechten Haarlinie, und die Übergaben als Gilt-gefädelte Zeilen. Tiefe kommt
 * aus dem geschichteten Papier und der einen warmen Linie, nie aus gestapelten
 * Karten.
 *
 * EHRLICHKEIT (DESIGN-SYSTEM.md §9, absolut). Es gibt KEINEN Mitarbeiter- oder
 * Stammdaten-Endpunkt für ein gekoppeltes Gerät — kein GET /api/users. Also:
 *   • der aktuelle Operator ist der echte SessionActor aus der PIN-Sitzung
 *     ({ id, role, isOwner }; der Server liefert dem Gerät keinen Namen);
 *   • „wer im Dienst ist" ist die echte OFFENE Schicht (shifts.getCurrent →
 *     openedByUserId + openedAt) mit dem Schicht-Umsatz aus der Dashboard-
 *     Summary, wenn die Kasse offen ist;
 *   • die volle Liste, Rollen und PINs sind ausdrücklich „Verwaltung am Desktop".
 * Es wird KEIN Name erfunden — die Anzeige fällt auf das Rollen-Label und eine
 * nicht-personenbezogene Kurz-Referenz zurück. Ein fehlgeschlagener Lesevorgang
 * zeigt einen gesperrten/Fehler-Zustand, nie eine Null oder eine erfundene Person.
 *
 * Diese Fläche ist READ-ONLY für Stammdaten und bewegt kein Geld — also keine
 * Freigabe hier, nur ruhige Auswahl-Haptik beim Pull-to-refresh. Die EINE echte
 * Aktion ist „Zweitkasse öffnen" (gezählter Anfangsbestand, bewusster Confirm).
 */
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { RefreshControl, ScrollView, View } from "react-native"
import { type Href, useRouter } from "expo-router"
import Svg, { Circle, Path } from "react-native-svg"
import type { DashboardSummary, ShiftView } from "@warehouse14/api-client"
import { ChevronRight, Clock, Lock, Monitor, Wallet } from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { dashboardSummary, describeError, formatEur, getCurrentShift, openShift } from "@/warehouse14/api"
import { useSession } from "@/warehouse14/session"
import {
  COPY,
  currentOperator,
  DESKTOP_MANAGEMENT_COPY,
  durationSince,
  formatTimestamp,
  OPEN_SHIFT_COPY,
  onDuty,
  roleBadgeVariant,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_ORDER,
  validateOpeningFloat,
  ZWEITKASSE_COPY,
} from "@/warehouse14/team-ui"
import { useW14Theme } from "@/warehouse14/theme"
import type { ActorRole } from "@warehouse14/api-client"
import {
  EmptyState,
  ErrorState,
  Hairline,
  haptics,
  InlineError,
  PaperGrain,
  PressableScale,
  SectionCard,
  Skeleton,
  StaggerItem,
  useMultiQuery,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

// ────────────────────────────────────────────────────────────────────────────
// RosterSeal — ein bespoke Team-Siegel (react-native-svg). Ein gestempelter Ring
// (Tinte) mit zwei kleinen Köpfen darin: die ruhige Marke der Personen-Fläche.
// Die Schulter-Linie tönt in Gilt — Gold nur als Faden/Siegel (DESIGN-SYSTEM.md
// §1). Dekorativ, vor der Barrierefreiheit verborgen.
// ────────────────────────────────────────────────────────────────────────────
function RosterSeal({ size = 26, ink, gilt }: { size?: number; ink: string; gilt: string }): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      {/* Gestempelter Ring — die Siegel-Tinte. */}
      <Circle cx={12} cy={12} r={8.6} stroke={ink} strokeWidth={1.4} fill="none" />
      <Circle cx={12} cy={12} r={6.4} stroke={ink} strokeWidth={0.7} strokeOpacity={0.4} fill="none" />
      {/* Zwei Köpfe — das Team im Siegel; die Schulter-Linie ist der Gilt-Faden. */}
      <Circle cx={9.6} cy={10.4} r={1.5} stroke={ink} strokeWidth={1.2} fill="none" />
      <Circle cx={14.4} cy={10.4} r={1.5} stroke={gilt} strokeWidth={1.2} fill="none" />
      <Path d="M7.5 15.4 C7.5 13.7 8.7 12.9 9.6 12.9 C10.5 12.9 11.4 13.5 11.6 14.6" stroke={ink} strokeWidth={1.1} strokeLinecap="round" fill="none" />
      <Path d="M12.4 14.6 C12.6 13.5 13.5 12.9 14.4 12.9 C15.3 12.9 16.5 13.7 16.5 15.4" stroke={gilt} strokeWidth={1.1} strokeLinecap="round" fill="none" />
    </Svg>
  )
}

// Ein kleiner Initialen-Monogramm-Kreis — bare, ein einziger Tinten- oder
// Patina-Hairline-Ring um die Kurz-Referenz, kein gefülltes Chip-Kästchen.
function Monogram({ text, accent }: { text: string; accent?: boolean }): ReactNode {
  const t = useW14Theme()
  const tone = accent ? t.colors.verdigris : t.colors.foreground
  return (
    <View
      className="h-11 w-11 items-center justify-center rounded-full"
      style={{ borderWidth: 1, borderColor: accent ? t.colors.verdigris + "55" : t.colors.border }}
    >
      <Text className="font-mono-medium text-base" style={{ color: tone }}>
        {text}
      </Text>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Angemeldet auf diesem Gerät — der aktuelle Operator (Session-Actor) als nackte
// Zeile auf dem Papier. Kein Kasten — nur der Monogramm-Ring, der Titel und das
// Rollen-Siegel rechts.
// ────────────────────────────────────────────────────────────────────────────
function OperatorRow({ actor }: { actor: ReturnType<typeof currentOperator> }) {
  const t = useW14Theme()
  if (actor == null) {
    return (
      <View className="flex-row items-center gap-3 py-1">
        <View
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ borderWidth: 1, borderColor: t.colors.border }}
        >
          <Lock size={t.icon.md} color={t.colors.mutedForeground} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-base font-semibold" numberOfLines={1}>
            {COPY.operatorEmptyTitle}
          </Text>
          <Text className="text-muted-foreground text-xs" numberOfLines={2}>
            {COPY.operatorEmptyDescription}
          </Text>
        </View>
      </View>
    )
  }
  return (
    <View className="flex-row items-center gap-3 py-1">
      <Monogram text={actor.shortRef.slice(0, 2)} />
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className="text-base font-semibold leading-tight" numberOfLines={1}>
            {actor.title}
          </Text>
          {actor.isOwner ? (
            <Badge variant="success">
              <Text>{COPY.ownerBadge}</Text>
            </Badge>
          ) : null}
        </View>
        <Text className="text-muted-foreground text-xs" numberOfLines={1}>
          {ROLE_DESCRIPTIONS[actor.role]}
        </Text>
      </View>
      {/* Das Rollen-Siegel rechts — ruhiges Pill mit Punkt, kein Kasten. */}
      <Badge variant={roleBadgeVariant(actor.role)} dot>
        <Text>{actor.roleLabel}</Text>
      </Badge>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Im Dienst — wer die offene Kasse geöffnet hat. Die Identitäts-Zeile bare; die
// Schicht-Zahlen als boxlose Mono-Bilanz mit einer senkrechten Haarlinie (wie der
// Register-Kopf in belege.tsx), nicht als zwei gestapelte Karten. Die Übergabe
// zum Kassensturz ist eine Gilt-gefädelte Zeile, kein Kasten im Kasten.
// ────────────────────────────────────────────────────────────────────────────
function OnDutyBlock({
  shift,
  summary,
  isCurrentOperator,
  duty,
  onClose,
}: {
  shift: ShiftView
  summary: DashboardSummary | null
  isCurrentOperator: boolean
  duty: NonNullable<ReturnType<typeof onDuty>>
  onClose: () => void
}) {
  const t = useW14Theme()
  const openedAt = formatTimestamp(shift.openedAt)
  const since = durationSince(shift.openedAt)
  // Der Schicht-Umsatz ist nur ehrlich, wenn die Dashboard-Summary GENAU diese
  // offene Schicht meint; sonst keine Umsatz-Behauptung (gedämpftes „—").
  const revenueMatchesShift = summary != null && summary.currentShiftId === shift.id
  const tillRevenue = revenueMatchesShift ? formatEur(summary.currentShiftRevenueEur) : "—"

  const cells: { label: string; value: string; color: string; muted: boolean }[] = [
    {
      label: "Anfangsbestand",
      value: formatEur(shift.openingFloatEur),
      color: t.colors.foreground,
      muted: false,
    },
    {
      label: "Umsatz Schicht",
      value: tillRevenue,
      color: revenueMatchesShift ? t.colors.verdigris : t.colors.mutedForeground,
      muted: !revenueMatchesShift,
    },
  ]

  return (
    <View className="gap-4">
      {/* Identitäts-Zeile — der Patina-Monogramm-Ring (lebende Kasse) bare. */}
      <View className="flex-row items-center gap-3">
        <Monogram text={duty.shortRef.slice(0, 2)} accent />
        <View className="flex-1 gap-0.5">
          <View className="flex-row items-center gap-2">
            <Text className="text-base font-semibold leading-tight" numberOfLines={1}>
              {duty.title}
            </Text>
            {isCurrentOperator ? (
              <Badge variant="secondary">
                <Text>{COPY.youBadge}</Text>
              </Badge>
            ) : null}
          </View>
          {openedAt ? (
            <Text className="text-muted-foreground text-xs" numberOfLines={1}>
              {`${COPY.openedAtPrefix} ${openedAt}`}
              {since ? ` · ${since}` : ""}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Schicht-Bilanz — boxlose Mono-Reihe mit senkrechter Haarlinie. */}
      <View className="flex-row items-stretch">
        {cells.map((cell, i) => (
          <View key={cell.label} className="flex-1 flex-row">
            {i > 0 ? <Hairline vertical length={36} /> : null}
            <View className="flex-1 gap-1" style={{ paddingLeft: i > 0 ? 16 : 0 }}>
              <Text
                className="text-muted-foreground text-2xs font-medium"
                style={{ letterSpacing: 0.6 }}
                numberOfLines={1}
              >
                {cell.label}
              </Text>
              <Text
                className="font-mono-medium text-2xl leading-none"
                style={{ color: cell.muted ? t.colors.mutedForeground : cell.color }}
                numberOfLines={1}
              >
                {cell.value}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* Übergabe — der Kassensturz ist ein fiskalischer Akt mit PIN-Step-up und
          gehört dem Kassen-Cockpit. Wir verlinken ehrlich dorthin als Gilt-
          gefädelte Zeile statt einen Schließen-Knopf hier vorzutäuschen. */}
      <Hairline />
      <PressableScale
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={`${COPY.closeHandoffCta}, ${COPY.closeHandoffHint}`}
      >
        <View className="min-h-[44px] flex-row items-center gap-3 py-1">
          <View style={{ height: 5, width: 5, borderRadius: 3, backgroundColor: t.colors.gilt }} />
          <View className="flex-1 gap-0.5">
            <Text className="text-base font-medium" numberOfLines={1}>
              {COPY.closeHandoffCta}
            </Text>
            <Text className="text-muted-foreground text-xs" numberOfLines={1}>
              {COPY.closeHandoffHint}
            </Text>
          </View>
          <ChevronRight size={t.icon.md} color={t.colors.mutedForeground} />
        </View>
      </PressableScale>
    </View>
  )
}

/**
 * Gezeigt, wenn dieses Gerät KEINE offene Schicht hat. Über die ehrliche
 * „niemand im Dienst"-Zeile hinaus trägt sie die eine echte Kassen-Aktion, die
 * der Server diesem Gerät gewährt: DIESE Kasse (Zweitkasse) mit gezähltem
 * Anfangsbestand öffnen. Der Bestand wird live geprüft (toleriert das deutsche
 * Komma; Negatives wird abgelehnt; leer deaktiviert nur den Knopf) und das
 * Öffnen selbst ist ein zweistufiger, bewusster Akt — die Confirm-Schicht — nie
 * ein einzelner Tipp, der die Kasse bewegt. Boxlos: das Feld lebt direkt auf dem
 * Papier, gerahmt nur durch eine einzige warme Haarlinie.
 */
function OpenZweitkasseBlock({
  floatInput,
  floatError,
  canOpen,
  onChangeFloat,
  onOpen,
}: {
  floatInput: string
  floatError: string | null
  canOpen: boolean
  onChangeFloat: (v: string) => void
  onOpen: () => void
}) {
  const t = useW14Theme()
  return (
    <View className="gap-4">
      <EmptyState icon={Clock} title={COPY.onDutyClosedTitle} description={COPY.onDutyClosedDescription} />

      <Hairline />

      {/* Zweitkasse öffnen — der gezählte Anfangsbestand + ein bewusstes Öffnen,
          direkt auf dem Papier (keine gerahmte Box im Abschnitt). */}
      <View className="gap-3">
        <View className="flex-row items-center gap-2">
          <View style={{ height: 5, width: 5, borderRadius: 3, backgroundColor: t.colors.gilt }} />
          <Text className="text-sm font-semibold" numberOfLines={1}>
            {OPEN_SHIFT_COPY.cardTitle}
          </Text>
        </View>
        <Text className="text-muted-foreground text-xs" style={{ lineHeight: 18 }}>
          {OPEN_SHIFT_COPY.cardSubtitle}
        </Text>

        <View className="gap-1.5">
          <Text className="text-muted-foreground text-xs font-medium">{OPEN_SHIFT_COPY.floatLabel}</Text>
          <View className="flex-row items-center gap-2">
            <Input
              value={floatInput}
              onChangeText={onChangeFloat}
              placeholder="0,00"
              keyboardType="decimal-pad"
              autoCorrect={false}
              className="flex-1"
              aria-invalid={floatError != null}
              accessibilityLabel={OPEN_SHIFT_COPY.floatLabel}
            />
            <Text className="text-muted-foreground font-mono-medium text-base">€</Text>
          </View>
          {floatError != null ? (
            <Text className="text-xs" style={{ color: t.colors.destructive }}>
              {floatError}
            </Text>
          ) : (
            <Text className="text-muted-foreground text-2xs">{OPEN_SHIFT_COPY.floatHint}</Text>
          )}
        </View>

        <Button
          size="lg"
          className="h-12"
          disabled={!canOpen}
          onPress={onOpen}
          accessibilityLabel={OPEN_SHIFT_COPY.openCta}
        >
          <Wallet size={t.icon.sm} color={t.colors.primaryForeground} />
          <Text>{OPEN_SHIFT_COPY.openCta}</Text>
        </Button>
      </View>
    </View>
  )
}

/**
 * Das bewusste Öffnen-Confirm. Eine Kasse zu öffnen setzt einen gezählten Bestand
 * (ein Geld-Kontext-Akt) — also ein klares Confirm mit dem Betrag in Mono-Hero
 * und einer EHRLICHEN Notiz — bewusst NICHT die fiskalische Beleg-Rahmung des
 * FiscalConfirmSheet, denn das Öffnen einer Lade signiert keinen Beleg und braucht
 * kein Step-up. Die §7-Medium-Haptik landet auf dem Commit; eine Ablehnung hält die
 * Schicht offen mit der echten deutschen Meldung inline.
 */
function OpenShiftSheet({
  open,
  amountLabel,
  busy,
  error,
  onConfirm,
  onCancel,
  onDismissError,
}: {
  open: boolean
  amountLabel: string
  busy: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
  onDismissError: () => void
}) {
  const t = useW14Theme()
  return (
    <Dialog
      open={open}
      onOpenChange={(next: boolean) => {
        if (busy) return
        if (!next) onCancel()
      }}
    >
      <DialogContent className="gap-4">
        <DialogHeader>
          <DialogTitle>{OPEN_SHIFT_COPY.confirmTitle}</DialogTitle>
          <DialogDescription>Bitte den Anfangsbestand prüfen und die Schicht öffnen.</DialogDescription>
        </DialogHeader>

        {/* Der Betrag als Mono-Hero — boxlos, nur durch zwei Haarlinien gekappt. */}
        <View className="items-center gap-1 py-1" accessibilityRole="summary">
          <Hairline />
          <Text className="text-muted-foreground text-xs" style={{ paddingTop: 12 }}>
            {OPEN_SHIFT_COPY.amountCaption}
          </Text>
          <Text className="font-mono-medium text-3xl" style={{ paddingBottom: 12 }}>
            {amountLabel}
          </Text>
          <Hairline />
        </View>

        <View className="flex-row items-start gap-2.5">
          <View className="pt-0.5">
            <Wallet size={t.icon.md} color={t.colors.foreground} />
          </View>
          <Text className="text-muted-foreground flex-1 text-xs leading-5">{OPEN_SHIFT_COPY.note}</Text>
        </View>

        {error != null ? <InlineError message={error} onRetry={onConfirm} onDismiss={onDismissError} /> : null}

        <View className="gap-2">
          <Button size="xl" onPress={onConfirm} disabled={busy} accessibilityLabel={OPEN_SHIFT_COPY.confirmLabel}>
            <Text>{busy ? "Wird geöffnet…" : OPEN_SHIFT_COPY.confirmLabel}</Text>
          </Button>
          <Button variant="outline" size="xl" onPress={onCancel} disabled={busy} accessibilityLabel="Abbrechen">
            <Text>Abbrechen</Text>
          </Button>
        </View>
      </DialogContent>
    </Dialog>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Rollen — die drei Berechtigungen als nackte Zeilen, getrennt nur durch eine
// einzige eingerückte Haarlinie. Die aktive Rolle trägt das Patina-Siegel.
// ────────────────────────────────────────────────────────────────────────────
function RoleRow({ role, active }: { role: ActorRole; active: boolean }) {
  const t = useW14Theme()
  return (
    <View className="flex-row items-start gap-3 py-2.5">
      {/* Ein leiser Faden-Punkt führt die Zeile — Gilt für die aktive Rolle. */}
      <View
        style={{
          marginTop: 7,
          height: 6,
          width: 6,
          borderRadius: 3,
          backgroundColor: active ? t.colors.gilt : t.colors.border,
        }}
      />
      <View className="flex-1 gap-0.5">
        <Text className="text-base font-semibold leading-tight" numberOfLines={1}>
          {ROLE_LABELS[role]}
        </Text>
        <Text className="text-muted-foreground text-xs" numberOfLines={2} style={{ lineHeight: 18 }}>
          {ROLE_DESCRIPTIONS[role]}
        </Text>
      </View>
      <Badge variant={active ? "success" : roleBadgeVariant(role)} dot={active}>
        <Text>{active ? COPY.youBadge : ROLE_LABELS[role]}</Text>
      </Badge>
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Ein un-gekarteter Gruppen-Kopf — ein bare Titel + leise Unterzeile auf dem
// Papier, mit einer warmen Haarlinie darunter. Ersetzt die gestapelte SectionCard.
// ────────────────────────────────────────────────────────────────────────────
function GroupHead({ title, subtitle }: { title: string; subtitle: string }): ReactNode {
  return (
    <View className="gap-2">
      <View className="gap-0.5">
        <Text className="text-base font-semibold leading-tight" numberOfLines={1}>
          {title}
        </Text>
        <Text className="text-muted-foreground text-xs" numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <Hairline />
    </View>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Bildschirm
// ────────────────────────────────────────────────────────────────────────────
export default function TeamScreen() {
  const t = useW14Theme()
  const insets = useScreenInsets()
  const router = useRouter()
  const { actor } = useSession()

  // Zwei unabhängige Live-Quellen (Quell-Ehrlichkeit): ein fehlgeschlagener
  // Dashboard-Lesevorgang leert nie die Dienst-Zeile, und der Schicht-Lesevorgang
  // beleuchtet seinen eigenen Block allein. Höfliches Polling hält „wer im Dienst
  // ist" frisch, nachdem anderswo eine Schicht geöffnet wurde.
  const q = useMultiQuery(
    {
      shift: getCurrentShift,
      summary: dashboardSummary,
    },
    { key: "team", pollIntervalMs: 60_000 },
  )

  const shift = q.results.shift.data as ShiftView | null
  const summary = q.results.summary.data as DashboardSummary | null

  const operator = useMemo(() => currentOperator(actor), [actor])
  const duty = useMemo(() => onDuty(shift, actor), [shift, actor])

  const rc = useRefreshControl(q)

  // ── Zweitkasse öffnen — die eine Kassen-Mutation, die dieses Gerät erlaubt ──
  // Der getippte Anfangsbestand wird live geprüft; die Confirm-Schicht ist der
  // zweite, bewusste Akt vor jedem Öffnen. Busy/error verfolgen den laufenden POST.
  const [floatInput, setFloatInput] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [openBusy, setOpenBusy] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)

  const floatValidation = useMemo(() => validateOpeningFloat(floatInput), [floatInput])
  // Öffenbar nur mit einem sauberen, gültigen Wire-Wert (leer/ungültig/negativ → nein).
  const canOpen = floatValidation.wireValue != null && floatValidation.error == null

  // Öffnet sich eine Schicht (hier oder anderswo), ersetzt die Dienst-Bilanz den
  // geschlossenen Zustand; jedes veraltete Öffnen-Formular wird abgebaut, damit es
  // nie dahinter hängen bleibt.
  useEffect(() => {
    if (shift != null && shift.status === "OPEN") {
      setConfirmOpen(false)
      setOpenError(null)
      setFloatInput("")
    }
  }, [shift])

  function onFloatChange(v: string): void {
    setFloatInput(v)
    if (openError != null) setOpenError(null)
  }

  function onOpenPressed(): void {
    if (!canOpen) return
    // Leichte Press-Bestätigung beim Öffnen der Schicht (§7) — das Öffnen ist zweistufig.
    haptics.impactLight()
    setOpenError(null)
    setConfirmOpen(true)
  }

  async function onConfirmOpen(): Promise<void> {
    const wire = floatValidation.wireValue
    if (wire == null) return
    // Geld-Kontext-Commit-Haptik auf dem Press (§7).
    haptics.impactMedium()
    setOpenBusy(true)
    setOpenError(null)
    try {
      await openShift({ openingFloatEur: wire })
      haptics.success()
      setConfirmOpen(false)
      setFloatInput("")
      // Die frisch geöffnete Schicht in den Blick bringen (die Dienst-Bilanz
      // ersetzt das Formular, das Dashboard rechnet den Schicht-Kontext neu).
      await q.refetch()
    } catch (e) {
      // Ein 409 (auf diesem Gerät ist bereits eine Schicht OFFEN) oder jede
      // Ablehnung zeigt die echte deutsche Meldung inline; die Schicht bleibt
      // offen zum erneut Versuchen oder Abbrechen. Nie ein erfundener Erfolg.
      haptics.error()
      setOpenError(describeError(e))
    } finally {
      setOpenBusy(false)
    }
  }

  function goToKasse(): void {
    haptics.selection()
    router.push("/kasse" as Href)
  }

  // Der aktuelle Operator ist lokal (Session), also hat die Fläche immer ETWAS zu
  // zeigen. Das Skeleton gilt nur dem allerersten Schicht-/Dashboard-Laden; ein
  // harter Fehler heißt, BEIDE Live-Lesevorgänge sind gescheitert und nichts ist
  // auf dem Bildschirm.
  const firstLoad = q.isLoading && !q.anyData
  const hardError = q.allFailed && !q.anyData && operator == null

  return (
    <View className="flex-1 bg-background">
      {/* Die gealterte Papier-Maserung als Leinwand-Tiefe aus dem geschichteten
          Creme plus dieser feinen warmen Struktur, nie eine flache Fläche
          (DESIGN-SYSTEM.md §1, §5). */}
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: t.space.x1_5,
          paddingHorizontal: t.space.x2,
          paddingBottom: insets.contentBottom,
          gap: t.space.x3,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...rc} progressViewOffset={8} />}
      >
        {/* ── Kopf — Kicker + Bricolage-Titel mit dem bespoke Team-Siegel ────── */}
        <View className="gap-1.5">
          <View className="flex-row items-center gap-2">
            <View style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }} />
            <Text className="text-muted-foreground text-2xs font-semibold" style={{ letterSpacing: 1.2 }}>
              TEAM & ZWEITKASSE
            </Text>
          </View>
          <View className="flex-row items-center gap-2.5">
            <RosterSeal size={26} ink={t.colors.primary} gilt={t.colors.gilt} />
            {/* Bildschirmtitel in der Bricolage-Display-Stimme (DESIGN-SYSTEM.md §3). */}
            <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={1}>
              {COPY.screenTitle}
            </Text>
          </View>
          <Text className="text-muted-foreground text-sm" numberOfLines={2}>
            {COPY.screenSubtitle}
          </Text>
        </View>

        {/* Der Schicht-Lesevorgang scheiterte, während die Fläche noch etwas zeigt
            → ein ruhiges, nicht-blockierendes Banner mit Retry. Unter useMultiQuery
            hat eine fehlerhafte Quelle immer data === null, also gatet das allein
            auf den Fehler. Leert nie das Brett. */}
        {!firstLoad && !hardError && q.results.shift.error != null ? (
          <InlineError message={q.results.shift.error} onRetry={() => void q.refetch()} />
        ) : null}

        {hardError ? (
          <View className="pt-6">
            <ErrorState
              message={q.results.shift.error ?? q.results.summary.error}
              onRetry={() => void q.refetch()}
              retrying={q.isFetching}
            />
          </View>
        ) : (
          <View className="gap-3">
            {/* ── Angemeldet auf diesem Gerät — immer echt, aus der Session ──── */}
            <StaggerItem index={0} exit={false}>
              <View className="gap-3">
                <GroupHead title={COPY.operatorTitle} subtitle={COPY.operatorSubtitle} />
                <OperatorRow actor={operator} />
              </View>
            </StaggerItem>

            {/* ── Im Dienst — die offene Schicht, ihr Skeleton oder geschlossen ─ */}
            <StaggerItem index={1} exit={false}>
              <View className="gap-3">
                <View className="flex-row items-center justify-between gap-2">
                  <View className="flex-1">
                    <GroupHead title={COPY.onDutyTitle} subtitle={COPY.onDutySubtitle} />
                  </View>
                  {duty != null ? (
                    <View style={{ paddingBottom: 9 }}>
                      <Badge variant="success" dot>
                        <Text>Offen</Text>
                      </Badge>
                    </View>
                  ) : null}
                </View>

                {firstLoad ? (
                  <View className="gap-3" accessibilityElementsHidden>
                    <View className="flex-row items-center gap-3">
                      <Skeleton width={44} height={44} radius="full" />
                      <View className="flex-1 gap-2">
                        <Skeleton width="60%" height={14} />
                        <Skeleton width="44%" height={12} />
                      </View>
                    </View>
                    <View className="flex-row gap-4">
                      <View className="flex-1 gap-2">
                        <Skeleton width="70%" height={9} />
                        <Skeleton width="50%" height={22} />
                      </View>
                      <View className="flex-1 gap-2">
                        <Skeleton width="70%" height={9} />
                        <Skeleton width="50%" height={22} />
                      </View>
                    </View>
                  </View>
                ) : duty != null && shift != null ? (
                  <OnDutyBlock
                    shift={shift}
                    summary={summary}
                    isCurrentOperator={duty.isCurrentOperator}
                    duty={duty}
                    onClose={goToKasse}
                  />
                ) : q.results.shift.error != null ? (
                  // Der Schicht-Lesevorgang SCHEITERTE — nie „Niemand im Dienst"
                  // behaupten (das wäre ein erfundener negativer Befund). Stattdessen
                  // der ehrliche unbekannt/gesperrt-Zustand mit Retry.
                  <ErrorState
                    icon={Lock}
                    title={COPY.onDutyUnknownTitle}
                    message={COPY.onDutyUnknownDescription}
                    onRetry={() => void q.refetch()}
                  />
                ) : (
                  // Keine offene Schicht auf diesem Gerät → die echte „Zweitkasse
                  // öffnen"-Aktion mit gezähltem Anfangsbestand anbieten.
                  <OpenZweitkasseBlock
                    floatInput={floatInput}
                    floatError={floatValidation.error}
                    canOpen={canOpen}
                    onChangeFloat={onFloatChange}
                    onOpen={onOpenPressed}
                  />
                )}
              </View>
            </StaggerItem>

            {/* ── Zweitkasse — der ehrliche Sekundär-Kassen-Erklärer ─────────── */}
            <StaggerItem index={2} exit={false}>
              <View className="gap-3">
                <GroupHead title={ZWEITKASSE_COPY.title} subtitle={ZWEITKASSE_COPY.subtitle} />
                <Text className="text-muted-foreground text-sm" style={{ lineHeight: 20 }}>
                  {ZWEITKASSE_COPY.body}
                </Text>
              </View>
            </StaggerItem>

            {/* ── Rollen — die Referenz; die Rolle des Operators hervorgehoben ── */}
            <StaggerItem index={3} exit={false}>
              <View className="gap-3">
                <GroupHead title={COPY.rolesTitle} subtitle={COPY.rolesSubtitle} />
                <View>
                  {ROLE_ORDER.map((role, i) => (
                    <View key={role}>
                      {i > 0 ? <Hairline inset={18} /> : null}
                      <RoleRow role={role} active={role === (operator?.role ?? null)} />
                    </View>
                  ))}
                </View>
              </View>
            </StaggerItem>

            {/* ── Verwaltung am Desktop — die EINE bewusste Museums-Tafel ─────── */}
            {/* Der ehrliche Stammdaten-Hinweis bleibt eine ruhige getafelte Karte,
                damit der Grenz-Hinweis (kein Schreibzugriff) sichtbar getragen wird
                (DESIGN-SYSTEM.md §9 Ehrlichkeit). Alles andere lebt boxlos. */}
            <StaggerItem index={4} exit={false}>
              <SectionCard
                title={DESKTOP_MANAGEMENT_COPY.title}
                subtitle={DESKTOP_MANAGEMENT_COPY.description}
                icon={Monitor}
              >
                <Hairline />
                <View className="flex-row items-start gap-2">
                  <Lock size={t.icon.sm} color={t.colors.mutedForeground} style={{ marginTop: 1 }} />
                  <Text className="text-muted-foreground flex-1 text-xs" style={{ lineHeight: 18 }}>
                    {DESKTOP_MANAGEMENT_COPY.gap}
                  </Text>
                </View>
              </SectionCard>
            </StaggerItem>
          </View>
        )}
      </ScrollView>

      {/* Das bewusste Öffnen-Confirm am Wurzel-Knoten montiert, damit es die ganze
          Fläche überlagert. Feuert nie von selbst; der Öffnen-POST läuft nur auf
          seinem Commit-Press. */}
      <OpenShiftSheet
        open={confirmOpen}
        amountLabel={formatEur(floatValidation.wireValue ?? "0.00")}
        busy={openBusy}
        error={openError}
        onConfirm={() => void onConfirmOpen()}
        onCancel={() => {
          if (openBusy) return
          setConfirmOpen(false)
          setOpenError(null)
        }}
        onDismissError={() => setOpenError(null)}
      />
    </View>
  )
}
