/**
 * Team — the Owner-OS people / Zweitkasse surface.
 *
 * Where the owner sees who is signed in on this phone, who opened the open till
 * (who is on duty), how the roles are split, and the honest reality that the
 * staff roster itself is administered at the Desktop-Kasse. Built entirely on
 * the shared spine — the session store, the data layer (useMultiQuery with
 * per-source honesty + refetch-on-focus + polite polling + pull-to-refresh),
 * the motion system (Stagger), the components (SectionCard / StatTile / ListRow
 * / EmptyState), and the §7 haptic vocabulary — so it looks and behaves like
 * every other surface.
 *
 * HONESTY (DESIGN.md §4, absolute). There is NO staff-roster or staff-mutation
 * endpoint exposed to a paired device — no GET /api/users, no `usersApi`. So:
 *   • the current operator is the real `SessionActor` from the PIN session
 *     ({ id, role, isOwner }; the server ships no name to the device);
 *   • "who is on duty" is the real OPEN shift (shifts.getCurrent →
 *     openedByUserId + openedAt), with the till revenue from the dashboard
 *     summary (currentShiftRevenueEur) when the till is open;
 *   • the full roster, roles and PINs are explicitly „Verwaltung am Desktop".
 * No personal names are fabricated — the display falls back to the role label
 * and a non-PII short user reference. A failing read shows a locked/error state,
 * never a zero or an invented person.
 *
 * This surface is READ-ONLY: it moves no money and writes no staff data, so
 * there is no step-up here — just calm selection haptics on pull-to-refresh.
 */
import { useEffect, useMemo, useState } from "react"
import { RefreshControl, ScrollView, View } from "react-native"
import { type Href, useRouter } from "expo-router"
import type { DashboardSummary, ShiftView } from "@warehouse14/api-client"
import {
  ChevronRight,
  Clock,
  Lock,
  Monitor,
  ShieldCheck,
  UserCheck,
  UserCircle2,
  Users,
  Wallet,
} from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
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
  haptics,
  InlineError,
  ListRow,
  PaperGrain,
  SectionCard,
  Skeleton,
  StaggerItem,
  StatTile,
  useMultiQuery,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

// ── Angemeldet auf diesem Gerät — the current operator (session actor) ────────
function OperatorCard({ actor }: { actor: ReturnType<typeof currentOperator> }) {
  const t = useW14Theme()
  if (actor == null) {
    return (
      <SectionCard title={COPY.operatorTitle} subtitle={COPY.operatorSubtitle} icon={UserCircle2}>
        <View className="flex-row items-center gap-2 py-1">
          <Lock size={t.icon.sm} color={t.colors.mutedForeground} />
          <Text className="text-muted-foreground text-sm">{COPY.operatorEmptyDescription}</Text>
        </View>
      </SectionCard>
    )
  }
  return (
    <SectionCard
      title={COPY.operatorTitle}
      subtitle={COPY.operatorSubtitle}
      icon={UserCircle2}
      action={
        <Badge variant={roleBadgeVariant(actor.role)} dot>
          <Text>{actor.roleLabel}</Text>
        </Badge>
      }
    >
      <View className="flex-row items-center gap-3 py-1">
        <View
          className="h-11 w-11 items-center justify-center rounded-full"
          style={{ backgroundColor: t.colors.primary + "1f" }}
        >
          <Text className="font-mono-medium text-base" style={{ color: t.colors.primary }}>
            {actor.shortRef.slice(0, 2)}
          </Text>
        </View>
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="text-base font-semibold" numberOfLines={1}>
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
        <Text className="font-mono-medium text-2xs" style={{ color: t.colors.mutedForeground }}>
          #{actor.shortRef}
        </Text>
      </View>
    </SectionCard>
  )
}

// ── Im Dienst — who opened the open till (real shift + till revenue) ──────────
function OnDutyCard({
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
  // Till revenue is honest only when the dashboard's current shift IS this open
  // shift; otherwise we make no revenue claim (muted „—").
  const revenueMatchesShift = summary != null && summary.currentShiftId === shift.id
  const tillRevenue = revenueMatchesShift ? formatEur(summary.currentShiftRevenueEur) : "—"

  return (
    <SectionCard
      title={COPY.onDutyTitle}
      subtitle={COPY.onDutySubtitle}
      icon={UserCheck}
      action={
        <Badge variant="success" dot>
          <Text>Offen</Text>
        </Badge>
      }
    >
      <View className="gap-3">
        <View className="flex-row items-center gap-3">
          <View
            className="h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: t.colors.verdigris + "22" }}
          >
            <Text className="font-mono-medium text-base" style={{ color: t.colors.verdigris }}>
              {duty.shortRef.slice(0, 2)}
            </Text>
          </View>
          <View className="flex-1">
            <View className="flex-row items-center gap-2">
              <Text className="text-base font-semibold" numberOfLines={1}>
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

        <View className="flex-row flex-wrap justify-between" style={{ rowGap: 12 }}>
          <StatTile label="Anfangsbestand" value={formatEur(shift.openingFloatEur)} />
          <StatTile
            label="Umsatz Schicht"
            value={tillRevenue}
            tone="accent"
            muted={!revenueMatchesShift}
          />
        </View>

        {/* The honest CLOSE handoff. Closing a shift is a Blindsturz a fiscal
            action with a PIN step-up so it is owned by the Kasse cockpit, not
            re-implemented here. We deep-link there plainly rather than fake a
            close button that this surface shouldn't carry. */}
        <Card
          className="overflow-hidden p-0"
          style={{ borderWidth: 1, borderColor: t.colors.border }}
        >
          <ListRow
            icon={Wallet}
            title={COPY.closeHandoffCta}
            subtitle={COPY.closeHandoffHint}
            right={<ChevronRight size={t.icon.sm} color={t.colors.mutedForeground} />}
            onPress={onClose}
          />
        </Card>
      </View>
    </SectionCard>
  )
}

/**
 * Shown when this device has NO open shift. Beyond the honest "nobody on duty"
 * line it carries the one real cashier-session action the API grants this device:
 * open THIS register (Zweitkasse) with a counted opening float. The float is
 * validated live (tolerant of the German comma; negatives refused; empty simply
 * disables the button) and the actual open is a two-step deliberate act — the
 * confirm sheet — never a single tap that moves the till.
 */
function OpenZweitkasseCard({
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
    <SectionCard title={COPY.onDutyTitle} subtitle={COPY.onDutySubtitle} icon={UserCheck}>
      <View className="gap-4">
        <EmptyState
          icon={Clock}
          title={COPY.onDutyClosedTitle}
          description={COPY.onDutyClosedDescription}
        />

        {/* Zweitkasse öffnen the counted opening float + a deliberate open. */}
        <View
          className="gap-3 rounded-xl px-3.5 py-3.5"
          style={{ borderWidth: 1, borderColor: t.colors.border }}
        >
          <View className="flex-row items-center gap-2">
            <Wallet size={t.icon.sm} color={t.colors.primary} />
            <Text className="text-sm font-semibold" numberOfLines={1}>
              {OPEN_SHIFT_COPY.cardTitle}
            </Text>
          </View>
          <Text className="text-muted-foreground text-xs" style={{ lineHeight: 18 }}>
            {OPEN_SHIFT_COPY.cardSubtitle}
          </Text>

          <View className="gap-1.5">
            <Text className="text-muted-foreground text-xs font-medium">
              {OPEN_SHIFT_COPY.floatLabel}
            </Text>
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
    </SectionCard>
  )
}

/**
 * The deliberate open-confirm. Opening a register sets a counted float (a
 * money-context act) so it gets a clear confirm with the amount in hero mono and
 * an HONEST note — deliberately NOT the fiscal-Beleg framing the FiscalConfirmSheet
 * uses, because opening a drawer signs no Beleg and needs no step-up. The §7
 * Medium impact lands on the commit press; a refusal keeps the sheet open with the
 * real German message inline.
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
          <DialogDescription>
            Bitte den Anfangsbestand prüfen und die Schicht öffnen.
          </DialogDescription>
        </DialogHeader>

        <View
          className="items-center gap-1 rounded-xl border border-border bg-card py-4"
          accessibilityRole="summary"
        >
          <Text className="text-muted-foreground text-xs uppercase tracking-wide">
            {OPEN_SHIFT_COPY.amountCaption}
          </Text>
          <Text className="font-mono-medium text-2xl">{amountLabel}</Text>
        </View>

        <View
          className="flex-row items-start gap-2.5 rounded-xl px-3.5 py-3"
          style={{ backgroundColor: t.colors.primary + "14" }}
        >
          <View className="pt-0.5">
            <Wallet size={t.icon.md} color={t.colors.primary} />
          </View>
          <Text className="text-muted-foreground flex-1 text-xs leading-5">
            {OPEN_SHIFT_COPY.note}
          </Text>
        </View>

        {error != null ? (
          <InlineError message={error} onRetry={onConfirm} onDismiss={onDismissError} />
        ) : null}

        <View className="gap-2">
          <Button
            size="xl"
            onPress={onConfirm}
            disabled={busy}
            accessibilityLabel={OPEN_SHIFT_COPY.confirmLabel}
          >
            <Text>{busy ? "Wird geöffnet…" : OPEN_SHIFT_COPY.confirmLabel}</Text>
          </Button>
          <Button
            variant="outline"
            size="xl"
            onPress={onCancel}
            disabled={busy}
            accessibilityLabel="Abbrechen"
          >
            <Text>Abbrechen</Text>
          </Button>
        </View>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Shown when the shift READ itself failed (honesty, DESIGN.md §4). We must NOT
 * fall through to NoOnDutyCard — claiming "Niemand im Dienst" would be a
 * confident false negative when in truth we could not read the shift and a till
 * may well be open. So we surface a locked/error state that tells the truth: the
 * status is unknown, with a retry. The real `describeError` message rides the
 * non-blocking InlineError banner above this card.
 */
function OnDutyErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <SectionCard title={COPY.onDutyTitle} subtitle={COPY.onDutySubtitle} icon={UserCheck}>
      <ErrorState
        icon={Lock}
        title={COPY.onDutyUnknownTitle}
        message={COPY.onDutyUnknownDescription}
        onRetry={onRetry}
      />
    </SectionCard>
  )
}

// ── Zweitkasse — the honest secondary-register explainer ──────────────────────
function ZweitkasseCard() {
  return (
    <SectionCard title={ZWEITKASSE_COPY.title} subtitle={ZWEITKASSE_COPY.subtitle} icon={ShieldCheck}>
      <Text className="text-muted-foreground text-sm" style={{ lineHeight: 20 }}>
        {ZWEITKASSE_COPY.body}
      </Text>
    </SectionCard>
  )
}

// ── Rollen — the three-permission reference (current role highlighted) ────────
function RolesCard({ activeRole }: { activeRole: ActorRole | null }) {
  return (
    <SectionCard title={COPY.rolesTitle} subtitle={COPY.rolesSubtitle} icon={Users}>
      <View className="gap-1">
        {ROLE_ORDER.map((role) => (
          <ListRow
            key={role}
            icon={UserCircle2}
            title={ROLE_LABELS[role]}
            subtitle={ROLE_DESCRIPTIONS[role]}
            right={
              <Badge variant={role === activeRole ? "success" : roleBadgeVariant(role)} dot={role === activeRole}>
                <Text>{role === activeRole ? COPY.youBadge : ROLE_LABELS[role]}</Text>
              </Badge>
            }
          />
        ))}
      </View>
    </SectionCard>
  )
}

// ── Verwaltung am Desktop — the honest "no mobile write" footnote ─────────────
function DesktopManagementCard() {
  const t = useW14Theme()
  return (
    <Card
      className="gap-2.5 px-4 py-4"
      style={{ borderWidth: 1, borderStyle: "dashed", borderColor: t.colors.border }}
    >
      <View className="flex-row items-center gap-2.5">
        <View
          className="h-8 w-8 items-center justify-center rounded-md"
          style={{ backgroundColor: t.colors.mutedForeground + "14" }}
        >
          <Monitor size={t.icon.md} color={t.colors.mutedForeground} />
        </View>
        <Text className="flex-1 text-base font-semibold" numberOfLines={1}>
          {DESKTOP_MANAGEMENT_COPY.title}
        </Text>
      </View>
      <Text className="text-muted-foreground text-sm" style={{ lineHeight: 20 }}>
        {DESKTOP_MANAGEMENT_COPY.description}
      </Text>
      <Text className="text-muted-foreground text-2xs" style={{ opacity: 0.8 }}>
        {DESKTOP_MANAGEMENT_COPY.gap}
      </Text>
    </Card>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function TeamScreen() {
  const t = useW14Theme()
  const insets = useScreenInsets()
  const router = useRouter()
  const { actor } = useSession()

  // Two independent live sources (per-source honesty): a failing dashboard read
  // never blanks the on-duty card, and the shift read lights its own card alone.
  // Polite polling keeps "who is on duty" fresh after a shift opens elsewhere.
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

  // ── Zweitkasse öffnen — the one cashier-session mutation this device allows ──
  // The typed opening float is validated live; the confirm sheet is the second,
  // deliberate act before any open is sent. Busy/error track the in-flight POST.
  const [floatInput, setFloatInput] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [openBusy, setOpenBusy] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)

  const floatValidation = useMemo(() => validateOpeningFloat(floatInput), [floatInput])
  // Openable only with a clean, valid wire value (empty/invalid/negative → no).
  const canOpen = floatValidation.wireValue != null && floatValidation.error == null

  // If a shift opens (here or elsewhere) the closed-state card is replaced by the
  // on-duty card; tear down any stale open form so it never lingers behind it.
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
    // Light press confirm as the sheet opens (§7) — the open itself is two-step.
    haptics.impactLight()
    setOpenError(null)
    setConfirmOpen(true)
  }

  async function onConfirmOpen(): Promise<void> {
    const wire = floatValidation.wireValue
    if (wire == null) return
    // Money-context commit haptic on the press (§7).
    haptics.impactMedium()
    setOpenBusy(true)
    setOpenError(null)
    try {
      await openShift({ openingFloatEur: wire })
      haptics.success()
      setConfirmOpen(false)
      setFloatInput("")
      // Bring the freshly-opened shift into view (the on-duty card replaces the
      // form, and the dashboard recomputes the shift context).
      await q.refetch()
    } catch (e) {
      // A 409 (a shift is already OPEN on this device) or any refusal surfaces the
      // real German message inline; the sheet stays open so it can be retried or
      // cancelled. Never a fabricated success.
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

  // The current operator is local (session), so the surface always has SOMETHING
  // to show. The skeleton is only for the very first shift/dashboard load; a hard
  // error means BOTH live reads failed with nothing on screen yet.
  const firstLoad = q.isLoading && !q.anyData
  const hardError = q.allFailed && !q.anyData && operator == null

  return (
    <View className="flex-1 bg-background">
      {/* Die gealterte Papier-Maserung als Leinwand Tiefe aus dem geschichteten
          Creme plus dieser feinen warmen Struktur, nie eine flache Fläche
          (DESIGN.md §1, §5). */}
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingTop: t.space.x4,
          paddingHorizontal: t.space.x4,
          paddingBottom: insets.contentBottom,
          gap: t.space.x5,
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl {...rc} progressViewOffset={8} />}
      >
        <View className="gap-1">
          <View className="flex-row items-center gap-2">
            <Users size={t.icon.lg} color={t.colors.primary} />
            {/* Bildschirmtitel in der Bricolage-Display-Stimme (DESIGN-SYSTEM.md §3). */}
            <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={1}>
              {COPY.screenTitle}
            </Text>
          </View>
          <Text className="text-muted-foreground text-sm" numberOfLines={2}>
            {COPY.screenSubtitle}
          </Text>
        </View>

        {/* The shift read failed while the surface still has something to show →
            one calm, non-blocking banner with retry. Under useMultiQuery an
            errored source always has data === null, so this gates on the error
            alone (a `&& shift != null` guard would be permanently dead). Never
            blanks the board. */}
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
          <View className="gap-5">
            {/* Always-real: the signed-in operator, straight from the session. */}
            <StaggerItem index={0} exit={false}>
              <OperatorCard actor={operator} />
            </StaggerItem>

            {/* Who is on duty the open shift, or its skeleton/closed state. */}
            <StaggerItem index={1} exit={false}>
              {firstLoad ? (
                <Card className="gap-3 px-4 py-4">
                  <Skeleton width="40%" height={16} />
                  <View className="flex-row items-center gap-3">
                    <Skeleton width={44} height={44} radius="full" />
                    <View className="flex-1 gap-2">
                      <Skeleton width="60%" height={14} />
                      <Skeleton width="44%" height={12} />
                    </View>
                  </View>
                </Card>
              ) : duty != null && shift != null ? (
                <OnDutyCard
                  shift={shift}
                  summary={summary}
                  isCurrentOperator={duty.isCurrentOperator}
                  duty={duty}
                  onClose={goToKasse}
                />
              ) : q.results.shift.error != null ? (
                // The shift read FAILED — never claim "Niemand im Dienst"
                // (that would be a fabricated negative). Show the honest
                // unknown/locked state with a retry instead.
                <OnDutyErrorCard onRetry={() => void q.refetch()} />
              ) : (
                // No open shift on this device → offer the real "Zweitkasse
                // öffnen" action with a counted opening float.
                <OpenZweitkasseCard
                  floatInput={floatInput}
                  floatError={floatValidation.error}
                  canOpen={canOpen}
                  onChangeFloat={onFloatChange}
                  onOpen={onOpenPressed}
                />
              )}
            </StaggerItem>

            {/* The Zweitkasse explainer honest secondary-register model. */}
            <StaggerItem index={2} exit={false}>
              <ZweitkasseCard />
            </StaggerItem>

            {/* The role reference the current operator's role highlighted. */}
            <StaggerItem index={3} exit={false}>
              <RolesCard activeRole={operator?.role ?? null} />
            </StaggerItem>

            {/* The honest roster note administered at the Desktop-Kasse. */}
            <StaggerItem index={4} exit={false}>
              <DesktopManagementCard />
            </StaggerItem>
          </View>
        )}
      </ScrollView>

      {/* The deliberate open-confirm mounted at the root so it overlays the
          whole surface. Never auto-fires; the open POST runs only on its commit
          press. */}
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
