/**
 * Termine — the Owner agenda. A per-day list of real appointments (over the
 * day's [00:00, 24:00) window) with one-tap status transitions along the happy
 * path SCHEDULED → CONFIRMED → CHECKED_IN, a reschedule sheet, and a header
 * button into the „Neuer Termin"-Buchung. Reached from the „Mehr"-Hub (/termine).
 *
 * Built on the shared spine (DESIGN.md): live data through `useQuery` (re-keyed
 * on the day, refetch-on-focus, pull-to-refresh via `useRefreshControl`),
 * one-tap status writes through `useMutation` (the row spins on `busyId`, then
 * the agenda refetches so the badge + ordering reflect server truth, never a
 * guessed local state), the spine's `InlineError` pinned to the failing row, a
 * staggered list entrance, and the §7 haptic vocabulary (selection on a step,
 * Light on opening the reschedule sheet, Success on a committed transition,
 * Error on a refusal). The date stepper sits in a sticky header so it never
 * scrolls away, and the four list states (skeleton / error+retry / empty /
 * content) render inside the list body so the header stays mounted across every
 * state change.
 *
 * Honesty rule (mirrors the Schatzkammer): every row + the day summary are real
 * values from a real endpoint; an empty day shows the EmptyState, never a
 * fabricated slot. Status mutations are step-up gated server-side — the global
 * StepUpDialogHost fires transparently and the middleware retries after the PIN.
 *
 * date/time are de-DE; all labels German. No native deps added (RN Modal for the
 * reschedule sheet, the shared W14 UI kit + motion for everything else).
 */
import { useCallback, useLayoutEffect, useMemo, useState } from "react"
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  View,
} from "react-native"
import { useNavigation, useRouter } from "expo-router"
import type { AppointmentListItem, AppointmentPatchStatus } from "@warehouse14/api-client"
import { APPOINTMENT_STATUS_LABELS } from "@warehouse14/api-client"
import {
  ArrowRight,
  CalendarPlus,
  CalendarX2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  LogIn,
  RotateCcw,
} from "lucide-react-native"
import Animated, { FadeIn, FadeOut } from "react-native-reanimated"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import {
  describeError,
  listAppointments,
  rescheduleAppointment,
  setAppointmentStatus,
} from "@/warehouse14/api"
import {
  addDays,
  advanceAccessibilityLabel,
  endOfDay,
  formatDayMonth,
  formatTimeRange,
  formatWeekday,
  isActionable,
  isToday,
  nextStatus,
  nextStatusLabel,
  relativeDayLabel,
  sortByStart,
  startOfDay,
  STATUS_BADGE_VARIANT,
  summaryLine,
  typeLabel,
} from "@/warehouse14/termine-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  ErrorState,
  haptics,
  InlineError,
  Skeleton,
  StaggerItem,
  useMutation,
  useQuery,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

/** Lucide glyph for the forward-step button, matched to its target status. */
function advanceIcon(next: AppointmentPatchStatus) {
  return next === "CHECKED_IN" ? LogIn : CheckCircle2
}

// ── Reschedule sheet ──────────────────────────────────────────────────────────
/** A minimal RN-Modal sheet collecting a new start time (de-DE typed) for the
 *  selected appointment. Keeps the agenda dependency-free (no date-picker dep);
 *  the field accepts "TT.MM.JJJJ HH:MM" and is parsed locally to an ISO start.
 *  Opens with the Light press haptic; a successful move fires Success. */
function RescheduleSheet({
  appt,
  onClose,
  onDone,
}: {
  appt: AppointmentListItem
  onClose: () => void
  onDone: () => void
}) {
  const t = useW14Theme()
  const insets = useScreenInsets()
  const [value, setValue] = useState(defaultRescheduleInput(appt.starts_at))
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    const startsAt = parseGermanDateTime(value)
    if (!startsAt) {
      haptics.error()
      setError("Bitte im Format TT.MM.JJJJ HH:MM eingeben.")
      return
    }
    if (startsAt.getTime() <= Date.now()) {
      haptics.error()
      setError("Der neue Termin muss in der Zukunft liegen.")
      return
    }
    setBusy(true)
    try {
      // 403 STEP_UP_REQUIRED → PIN Dialog opens + the call retries automatically.
      await rescheduleAppointment(appt.id, {
        startsAt: startsAt.toISOString(),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      })
      haptics.success()
      onDone()
    } catch (e) {
      haptics.error()
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      {/* Keyboard avoidance, same per-platform behavior as the spine's
          KeyboardAvoidingScreen — so focusing „Neuer Beginn"/„Grund" lifts the
          whole sheet (inputs + Abbrechen/Verschieben) clear of the keyboard. */}
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Pressable
          className="flex-1 justify-end"
          style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
          accessibilityRole="button"
          accessibilityLabel="Schließen"
          onPress={onClose}
        >
          {/* Inner Pressable swallows taps so a tap inside the sheet never dismisses. */}
          <Pressable
            onPress={() => {}}
            className="bg-background border-border gap-4 rounded-t-2xl border-t px-5 pt-5"
            style={{ paddingBottom: insets.stickyBottom }}
          >
            <View className="items-center pb-1">
              <View
                className="h-1 w-10 rounded-full"
                style={{ backgroundColor: t.colors.border }}
              />
            </View>

            <View className="flex-row items-center gap-2.5">
              <View
                className="h-9 w-9 items-center justify-center rounded-md"
                style={{ backgroundColor: t.colors.primary + "1f" }}
              >
                <RotateCcw size={t.icon.md} color={t.colors.primary} />
              </View>
              <View className="flex-1">
                <Text className="text-base font-bold">Termin verschieben</Text>
                <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                  {typeLabel(appt.appointment_type)} ·{" "}
                  {formatTimeRange(appt.starts_at, appt.ends_at)}
                </Text>
              </View>
            </View>

            {error != null ? <InlineError message={error} /> : null}

            <View className="gap-1.5">
              <Text className="text-sm font-medium">Neuer Beginn</Text>
              <Input
                value={value}
                onChangeText={setValue}
                placeholder="TT.MM.JJJJ HH:MM"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="numbers-and-punctuation"
                accessibilityLabel="Neuer Beginn, Format Tag Punkt Monat Punkt Jahr Stunde Doppelpunkt Minute"
              />
            </View>

            <View className="gap-1.5">
              <Text className="text-sm font-medium">Grund (optional)</Text>
              <Input
                value={reason}
                onChangeText={setReason}
                placeholder="z. B. Kundenwunsch"
                autoCapitalize="sentences"
                accessibilityLabel="Grund"
              />
            </View>

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
                size="lg"
                className="h-12 flex-1"
                onPress={() => void submit()}
                disabled={busy}
              >
                <Text>{busy ? "Verschiebe…" : "Verschieben"}</Text>
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ── Appointment row ───────────────────────────────────────────────────────────
/** One agenda row: a leading time block, the type + time range, the status
 *  badge, and the one-tap action strip (advance / reschedule / cancel) for a
 *  live row. A terminal row reads quietly with no actions. */
function ApptRow({
  appt,
  busy,
  error,
  onAdvance,
  onCancel,
  onReschedule,
  onDismissError,
}: {
  appt: AppointmentListItem
  busy: boolean
  error: string | null
  onAdvance: (next: AppointmentPatchStatus) => void
  onCancel: () => void
  onReschedule: () => void
  onDismissError: () => void
}) {
  const t = useW14Theme()
  const next = nextStatus(appt.status)
  const actionable = isActionable(appt.status)
  const [start, end] = formatTimeRange(appt.starts_at, appt.ends_at).split("–")
  const AdvanceIcon = next != null ? advanceIcon(next) : ArrowRight

  return (
    <Card className="gap-3 px-4 py-4">
      <View className="flex-row items-start gap-3">
        {/* Leading time block — the calm anchor a scanning eye lands on. */}
        <View
          className="items-center rounded-md px-2.5 py-2"
          style={{
            backgroundColor: actionable ? t.colors.primary + "14" : t.colors.border + "66",
            minWidth: 56,
          }}
        >
          <Text
            className="font-mono-medium text-base"
            style={{ color: actionable ? t.colors.primary : t.colors.mutedForeground }}
          >
            {start}
          </Text>
          <Text className="text-muted-foreground font-mono text-2xs">{end}</Text>
        </View>

        <View className="flex-1 gap-1">
          <Text className="text-base font-semibold" numberOfLines={1}>
            {typeLabel(appt.appointment_type)}
          </Text>
          <View className="flex-row items-center gap-1.5">
            <Clock size={t.icon.xs} color={t.colors.mutedForeground} />
            <Text className="text-muted-foreground text-sm" numberOfLines={1}>
              {formatTimeRange(appt.starts_at, appt.ends_at)} · {appt.duration_minutes} Min.
            </Text>
          </View>
        </View>

        <Badge variant={STATUS_BADGE_VARIANT[appt.status]} dot>
          <Text>{APPOINTMENT_STATUS_LABELS[appt.status]}</Text>
        </Badge>
      </View>

      {error != null ? <InlineError message={error} onDismiss={onDismissError} /> : null}

      {actionable ? (
        <View className="flex-row flex-wrap gap-2">
          {next != null ? (
            <Button
              size="sm"
              className="grow flex-row gap-1.5"
              onPress={() => onAdvance(next)}
              disabled={busy}
              accessibilityLabel={advanceAccessibilityLabel(next)}
            >
              <AdvanceIcon size={t.icon.sm} color={t.colors.primaryForeground} />
              <Text>{nextStatusLabel(next)}</Text>
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onPress={onReschedule}
            disabled={busy}
            accessibilityLabel="Termin verschieben"
          >
            <Text>Verschieben</Text>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onPress={onCancel}
            disabled={busy}
            accessibilityLabel="Termin stornieren"
          >
            <Text>Stornieren</Text>
          </Button>
        </View>
      ) : null}
    </Card>
  )
}

// ── First-load skeleton — the list's own shape, never a mid-screen spinner. ────
function AgendaSkeleton() {
  return (
    <View className="gap-3 pt-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <Card key={i} className="gap-3 px-4 py-4">
          <View className="flex-row items-start gap-3">
            <Skeleton width={56} height={44} radius="button" />
            <View className="flex-1 gap-2">
              <Skeleton width="55%" height={15} />
              <Skeleton width="40%" height={12} />
            </View>
            <Skeleton width={72} height={22} radius="button" />
          </View>
          <View className="flex-row gap-2">
            <Skeleton width={120} height={36} radius="button" />
            <Skeleton width={104} height={36} radius="button" />
          </View>
        </Card>
      ))}
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function TermineScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const t = useW14Theme()
  const insets = useScreenInsets()

  const [day, setDay] = useState<Date>(() => startOfDay(new Date()))
  const [rescheduling, setRescheduling] = useState<AppointmentListItem | null>(null)
  // Per-row write state — the id currently mutating, and the last per-row error.
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)

  const dayKey = useMemo(() => {
    const d = startOfDay(day)
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  }, [day])

  // One live read, re-keyed on the day. Refetch-on-focus brings a fresh booking
  // (from termine/neu) into view on return; pull-to-refresh + de-dupe come free.
  const agenda = useQuery(
    () =>
      listAppointments({
        from: startOfDay(day).toISOString(),
        to: endOfDay(day).toISOString(),
      }),
    { key: `appointments:${dayKey}` },
  )
  const rc = useRefreshControl(agenda)

  const rows = useMemo(
    () => (agenda.data ? sortByStart(agenda.data.appointments) : null),
    [agenda.data],
  )

  // Header „Neuer Termin"-Aktion → the booking flow.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => {
            haptics.selection()
            router.push("/termine/neu")
          }}
          accessibilityRole="button"
          accessibilityLabel="Neuer Termin"
          hitSlop={12}
          style={{ paddingHorizontal: 12 }}
        >
          <CalendarPlus color={t.colors.primary} size={t.icon.lg} />
        </Pressable>
      ),
    })
  }, [navigation, router, t.colors.primary, t.icon.lg])

  // One mutation drives every status write (advance + cancel). It carries the
  // full body so cancel can attach a reason; the row id raises `busyId`.
  const statusMutation = useMutation(
    (vars: { id: string; body: { status: AppointmentPatchStatus; cancellationReason?: string } }) =>
      setAppointmentStatus(vars.id, vars.body),
    {
      onSuccess: () => {
        haptics.success()
        void agenda.refetch()
      },
      onError: (e, vars) => {
        haptics.error()
        setRowError({ id: vars.id, message: describeError(e) })
      },
      onSettled: () => setBusyId(null),
    },
  )

  const stepDay = useCallback((delta: number) => {
    haptics.selection()
    setRowError(null)
    setDay((d) => startOfDay(addDays(d, delta)))
  }, [])

  const goToday = useCallback(() => {
    haptics.selection()
    setRowError(null)
    setDay(startOfDay(new Date()))
  }, [])

  const advance = useCallback(
    (appt: AppointmentListItem, status: AppointmentPatchStatus) => {
      setRowError(null)
      setBusyId(appt.id)
      // 403 STEP_UP_REQUIRED → the global host opens the PIN + retries the PATCH.
      void statusMutation.mutate({ id: appt.id, body: { status } }).catch(() => {})
    },
    [statusMutation],
  )

  const cancel = useCallback(
    (appt: AppointmentListItem) => {
      setRowError(null)
      setBusyId(appt.id)
      void statusMutation
        .mutate({
          id: appt.id,
          body: { status: "CANCELLED", cancellationReason: "Vom Betrieb storniert" },
        })
        .catch(() => {})
    },
    [statusMutation],
  )

  const relative = relativeDayLabel(day)
  const today = isToday(day)

  // Sticky date stepper — prev / the day itself / next, plus an honest day
  // summary derived only from the fetched rows. Never scrolls away.
  const header = useMemo(
    () => (
      <View className="bg-background border-border gap-3 border-b px-4 pb-3 pt-3">
        <View className="flex-row items-center justify-between">
          <Pressable
            onPress={() => stepDay(-1)}
            accessibilityRole="button"
            accessibilityLabel="Vorheriger Tag"
            hitSlop={8}
            className="h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: t.colors.card }}
          >
            <ChevronLeft color={t.colors.foreground} size={t.icon.lg} />
          </Pressable>

          <Pressable
            onPress={goToday}
            accessibilityRole="button"
            accessibilityLabel={today ? "Heute" : "Zu heute springen"}
            className="flex-1 items-center px-2"
          >
            <View className="flex-row items-center gap-2">
              <Text className="text-lg font-bold" numberOfLines={1}>
                {relative ?? formatWeekday(day)}
              </Text>
              {relative != null && relative !== "Heute" ? (
                <Text className="text-muted-foreground text-sm" numberOfLines={1}>
                  {formatWeekday(day)}
                </Text>
              ) : null}
            </View>
            <Text className="text-muted-foreground text-xs" numberOfLines={1}>
              {formatDayMonth(day)}
              {!today ? " · Tippen für heute" : ""}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => stepDay(1)}
            accessibilityRole="button"
            accessibilityLabel="Nächster Tag"
            hitSlop={8}
            className="h-11 w-11 items-center justify-center rounded-full"
            style={{ backgroundColor: t.colors.card }}
          >
            <ChevronRight color={t.colors.foreground} size={t.icon.lg} />
          </Pressable>
        </View>

        {/* Honest day summary — only when a real list is in hand with rows. */}
        {rows != null && rows.length > 0 ? (
          <Animated.View
            entering={FadeIn.duration(160)}
            exiting={FadeOut.duration(160)}
            className="items-center"
          >
            <Text className="text-muted-foreground text-xs">{summaryLine(rows)}</Text>
          </Animated.View>
        ) : null}
      </View>
    ),
    [day, relative, today, rows, stepDay, goToday, t.colors, t.icon.lg],
  )

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={rows ?? []}
        keyExtractor={(a) => a.id}
        stickyHeaderIndices={[0]}
        ListHeaderComponent={header}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.contentBottom,
          gap: 12,
          paddingTop: 12,
        }}
        refreshControl={<RefreshControl {...rc} progressViewOffset={8} />}
        renderItem={({ item, index }) => (
          <StaggerItem index={index} exit={false}>
            <ApptRow
              appt={item}
              busy={busyId === item.id}
              error={rowError?.id === item.id ? rowError.message : null}
              onAdvance={(status) => advance(item, status)}
              onCancel={() => cancel(item)}
              onReschedule={() => {
                haptics.impactLight()
                setRowError(null)
                setRescheduling(item)
              }}
              onDismissError={() => setRowError(null)}
            />
          </StaggerItem>
        )}
        ListEmptyComponent={
          // First load with nothing yet → the shaped skeleton.
          agenda.status === "loading" && rows == null ? (
            <AgendaSkeleton />
          ) : agenda.status === "error" && rows == null ? (
            <View className="pt-6">
              <ErrorState
                message={agenda.error ?? describeError(agenda.errorCause)}
                cause={agenda.errorCause}
                onRetry={() => void agenda.refetch()}
                retrying={agenda.isFetching}
              />
            </View>
          ) : rows != null && rows.length === 0 ? (
            <View className="items-center justify-center gap-3 px-6 py-12">
              <View
                className="h-16 w-16 items-center justify-center rounded-full"
                style={{
                  backgroundColor: t.colors.primary + "14",
                  borderColor: t.colors.border,
                  borderWidth: 1,
                }}
              >
                <CalendarX2 size={t.icon.xl} color={t.colors.primary} />
              </View>
              <Text className="text-center text-base font-semibold">
                {today
                  ? "Heute keine Termine"
                  : relative === "Morgen"
                    ? "Morgen keine Termine"
                    : "Keine Termine an diesem Tag"}
              </Text>
              <Text className="text-muted-foreground max-w-xs text-center text-sm leading-5">
                Lege über das Plus oben rechts einen neuen Termin an.
              </Text>
              <Button
                variant="outline"
                className="mt-2"
                onPress={() => {
                  haptics.selection()
                  router.push("/termine/neu")
                }}
                accessibilityLabel="Neuer Termin"
              >
                <Text>Neuer Termin</Text>
              </Button>
            </View>
          ) : null
        }
      />

      {rescheduling != null ? (
        <RescheduleSheet
          appt={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={() => {
            setRescheduling(null)
            void agenda.refetch()
          }}
        />
      ) : null}
    </View>
  )
}

// ── Local de-DE date-time parsing (no date-picker dep) ────────────────────────
/** Prefill the reschedule field with the appointment's current start, de-DE. */
function defaultRescheduleInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Parse "TT.MM.JJJJ HH:MM" (local time) → Date, or null if malformed. */
function parseGermanDateTime(input: string): Date | null {
  const m = input.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T]+(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const [, dd, mm, yyyy, hh, min] = m
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), 0, 0)
  if (Number.isNaN(d.getTime())) return null
  // Guard against JS Date roll-over (e.g. 32.01 → 01.02).
  if (d.getDate() !== Number(dd) || d.getMonth() !== Number(mm) - 1) return null
  return d
}
