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
import { useMemo } from "react"
import { RefreshControl, ScrollView, View } from "react-native"
import type { DashboardSummary, ShiftView } from "@warehouse14/api-client"
import { Clock, Lock, Monitor, ShieldCheck, UserCheck, UserCircle2, Users } from "lucide-react-native"

import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { dashboardSummary, formatEur, getCurrentShift } from "@/warehouse14/api"
import { useSession } from "@/warehouse14/session"
import {
  COPY,
  currentOperator,
  DESKTOP_MANAGEMENT_COPY,
  durationSince,
  formatTimestamp,
  onDuty,
  roleBadgeVariant,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROLE_ORDER,
  ZWEITKASSE_COPY,
} from "@/warehouse14/team-ui"
import { useW14Theme } from "@/warehouse14/theme"
import type { ActorRole } from "@warehouse14/api-client"
import {
  EmptyState,
  ErrorState,
  InlineError,
  ListRow,
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
}: {
  shift: ShiftView
  summary: DashboardSummary | null
  isCurrentOperator: boolean
  duty: NonNullable<ReturnType<typeof onDuty>>
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
      </View>
    </SectionCard>
  )
}

/** Shown when there is no OPEN shift — nobody on duty / the till is closed. */
function NoOnDutyCard() {
  return (
    <SectionCard title={COPY.onDutyTitle} subtitle={COPY.onDutySubtitle} icon={UserCheck}>
      <EmptyState
        icon={Clock}
        title={COPY.onDutyClosedTitle}
        description={COPY.onDutyClosedDescription}
      />
    </SectionCard>
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

  // The current operator is local (session), so the surface always has SOMETHING
  // to show. The skeleton is only for the very first shift/dashboard load; a hard
  // error means BOTH live reads failed with nothing on screen yet.
  const firstLoad = q.isLoading && !q.anyData
  const hardError = q.allFailed && !q.anyData && operator == null

  return (
    <View className="flex-1 bg-background">
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
          <Text className="text-xl font-bold" numberOfLines={1}>
            {COPY.screenTitle}
          </Text>
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

            {/* Who is on duty — the open shift, or its skeleton/closed state. */}
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
                />
              ) : q.results.shift.error != null ? (
                // The shift read FAILED — never claim "Niemand im Dienst"
                // (that would be a fabricated negative). Show the honest
                // unknown/locked state with a retry instead.
                <OnDutyErrorCard onRetry={() => void q.refetch()} />
              ) : (
                <NoOnDutyCard />
              )}
            </StaggerItem>

            {/* The Zweitkasse explainer — honest secondary-register model. */}
            <StaggerItem index={2} exit={false}>
              <ZweitkasseCard />
            </StaggerItem>

            {/* The role reference — the current operator's role highlighted. */}
            <StaggerItem index={3} exit={false}>
              <RolesCard activeRole={operator?.role ?? null} />
            </StaggerItem>

            {/* The honest roster note — administered at the Desktop-Kasse. */}
            <StaggerItem index={4} exit={false}>
              <DesktopManagementCard />
            </StaggerItem>
          </View>
        )}
      </ScrollView>
    </View>
  )
}
