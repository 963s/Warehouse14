/**
 * Termine — the Owner agenda. A per-day list of appointments (appointments.list
 * over the day's [00:00, 24:00) window) with one-tap status transitions along
 * the happy path SCHEDULED → CONFIRMED → CHECKED_IN (appointments.setStatus),
 * a reschedule sheet (appointments.reschedule), and a header button into the
 * „Neuer Termin"-Buchung (termine/neu). Reached from the „Mehr"-Hub (/termine).
 *
 * Honesty rule (mirrors the Schatzkammer): every row is a real appointment from
 * a real endpoint; an empty day shows the EmptyState, never a fabricated slot.
 * Status mutations are step-up gated server-side — the global StepUpDialogHost
 * fires transparently and the middleware retries the PATCH/POST after the PIN.
 *
 * date/time are de-DE; all labels German. No native deps added (RN Modal for the
 * reschedule sheet, the shared W14 UI kit for everything else).
 */
import { useCallback, useLayoutEffect, useState } from "react"
import { Modal, Pressable, RefreshControl, ScrollView, View } from "react-native"
import { useFocusEffect, useNavigation, useRouter } from "expo-router"
import type {
  AppointmentListItem,
  AppointmentPatchStatus,
} from "@warehouse14/api-client"
import { APPOINTMENT_STATUS_LABELS } from "@warehouse14/api-client"
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
  XCircle,
} from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

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
import { useW14Theme } from "@/warehouse14/theme"
import {
  addDays,
  endOfDay,
  formatDateShort,
  formatTimeRange,
  isTerminal,
  isToday,
  nextStatus,
  nextStatusLabel,
  sortByStart,
  startOfDay,
  STATUS_BADGE_VARIANT,
  typeLabel,
} from "@/warehouse14/termine-ui"
import { EmptyState } from "@/warehouse14/ui"

// ── Reschedule sheet ──────────────────────────────────────────────────────────
/** A minimal RN-Modal sheet collecting a new start time (de-DE typed) for the
 *  selected appointment. Keeps the agenda dependency-free (no date-picker dep);
 *  the field accepts "TT.MM.JJJJ HH:MM" and is parsed locally to an ISO start. */
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
  const insets = useSafeAreaInsets()
  const [value, setValue] = useState(defaultRescheduleInput(appt.starts_at))
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    const startsAt = parseGermanDateTime(value)
    if (!startsAt) {
      setError("Bitte im Format TT.MM.JJJJ HH:MM eingeben.")
      return
    }
    if (startsAt.getTime() <= Date.now()) {
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
      onDone()
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
        <View
          className="bg-background gap-4 rounded-t-2xl px-5 pt-5"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <View className="gap-1">
            <Text className="text-lg font-bold">Termin verschieben</Text>
            <Text className="text-muted-foreground text-sm">
              {typeLabel(appt.appointment_type)} · {formatTimeRange(appt.starts_at, appt.ends_at)}
            </Text>
          </View>

          {error != null ? (
            <View
              className="rounded-xl px-4 py-3"
              style={{ borderWidth: 1, borderColor: t.colors.destructive }}
            >
              <Text className="text-sm" style={{ color: t.colors.destructive }}>
                {error}
              </Text>
            </View>
          ) : null}

          <View className="gap-1.5">
            <Text className="text-sm font-medium">Neuer Beginn</Text>
            <Input
              value={value}
              onChangeText={setValue}
              placeholder="TT.MM.JJJJ HH:MM"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
            />
          </View>

          <View className="gap-1.5">
            <Text className="text-sm font-medium">Grund (optional)</Text>
            <Input
              value={reason}
              onChangeText={setReason}
              placeholder="z. B. Kundenwunsch"
              autoCapitalize="sentences"
            />
          </View>

          <View className="flex-row gap-3 pt-1">
            <Button variant="outline" className="flex-1" onPress={onClose} disabled={busy}>
              <Text>Abbrechen</Text>
            </Button>
            <Button className="flex-1" onPress={() => void submit()} disabled={busy}>
              <Text>{busy ? "Verschiebe…" : "Verschieben"}</Text>
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ── Appointment row ───────────────────────────────────────────────────────────
function ApptRow({
  appt,
  busy,
  onAdvance,
  onCancel,
  onReschedule,
}: {
  appt: AppointmentListItem
  busy: boolean
  onAdvance: (next: AppointmentPatchStatus) => void
  onCancel: () => void
  onReschedule: () => void
}) {
  const t = useW14Theme()
  const next = nextStatus(appt.status)
  const terminal = isTerminal(appt.status)

  return (
    <Card className="gap-3 px-4 py-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text className="text-base font-semibold" numberOfLines={1}>
            {typeLabel(appt.appointment_type)}
          </Text>
          <View className="flex-row items-center gap-1.5">
            <Clock size={13} color={t.colors.mutedForeground} />
            <Text className="text-muted-foreground text-sm">
              {formatTimeRange(appt.starts_at, appt.ends_at)}
            </Text>
          </View>
        </View>
        <Badge variant={STATUS_BADGE_VARIANT[appt.status]}>
          <Text>{APPOINTMENT_STATUS_LABELS[appt.status]}</Text>
        </Badge>
      </View>

      {!terminal ? (
        <View className="flex-row flex-wrap gap-2">
          {next != null ? (
            <Button
              size="sm"
              className="grow"
              onPress={() => onAdvance(next)}
              disabled={busy}
            >
              <Text>{nextStatusLabel(next)}</Text>
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onPress={onReschedule} disabled={busy}>
            <Text>Verschieben</Text>
          </Button>
          <Button size="sm" variant="outline" onPress={onCancel} disabled={busy}>
            <Text>Stornieren</Text>
          </Button>
        </View>
      ) : null}
    </Card>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function TermineScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const t = useW14Theme()
  const insets = useSafeAreaInsets()

  const [day, setDay] = useState<Date>(() => startOfDay(new Date()))
  const [rows, setRows] = useState<AppointmentListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rescheduling, setRescheduling] = useState<AppointmentListItem | null>(null)

  // Header „Neuer Termin"-Aktion → the booking flow.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => router.push("/termine/neu")}
          accessibilityRole="button"
          accessibilityLabel="Neuer Termin"
          hitSlop={12}
          style={{ paddingHorizontal: 12 }}
        >
          <CalendarPlus color={t.colors.primary} size={22} />
        </Pressable>
      ),
    })
  }, [navigation, router, t.colors.primary])

  const load = useCallback(async (d: Date) => {
    setError(null)
    try {
      const res = await listAppointments({
        from: startOfDay(d).toISOString(),
        to: endOfDay(d).toISOString(),
      })
      setRows(sortByStart(res.appointments))
    } catch (e) {
      setError(describeError(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Reload whenever the day changes or the screen regains focus (so a fresh
  // booking from termine/neu shows on return).
  useFocusEffect(
    useCallback(() => {
      setLoading(true)
      void load(day)
    }, [day, load]),
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load(day)
    setRefreshing(false)
  }, [day, load])

  async function advance(appt: AppointmentListItem, status: AppointmentPatchStatus) {
    setBusyId(appt.id)
    setError(null)
    try {
      // 403 STEP_UP_REQUIRED → PIN Dialog opens + the call retries automatically.
      await setAppointmentStatus(appt.id, { status })
      await load(day)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusyId(null)
    }
  }

  async function cancel(appt: AppointmentListItem) {
    setBusyId(appt.id)
    setError(null)
    try {
      await setAppointmentStatus(appt.id, {
        status: "CANCELLED",
        cancellationReason: "Vom Betrieb storniert",
      })
      await load(day)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <View className="flex-1 bg-background">
      {/* Date stepper */}
      <View className="border-border flex-row items-center justify-between border-b px-3 py-2.5">
        <Pressable
          onPress={() => setDay((d) => startOfDay(addDays(d, -1)))}
          accessibilityRole="button"
          accessibilityLabel="Vorheriger Tag"
          hitSlop={10}
          className="h-10 w-10 items-center justify-center"
        >
          <ChevronLeft color={t.colors.foreground} size={22} />
        </Pressable>

        <Pressable
          onPress={() => setDay(startOfDay(new Date()))}
          accessibilityRole="button"
          className="items-center"
        >
          <Text className="text-base font-semibold">{formatDateShort(day)}</Text>
          <Text className="text-muted-foreground text-xs">
            {isToday(day) ? "Heute" : "Tippen für heute"}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setDay((d) => startOfDay(addDays(d, 1)))}
          accessibilityRole="button"
          accessibilityLabel="Nächster Tag"
          hitSlop={10}
          className="h-10 w-10 items-center justify-center"
        >
          <ChevronRight color={t.colors.foreground} size={22} />
        </Pressable>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={t.colors.primary}
          />
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
          <Text className="text-muted-foreground">Lade Termine…</Text>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={CalendarPlus}
            title="Keine Termine an diesem Tag"
            description="Lege über das Plus oben rechts einen neuen Termin an."
            actionLabel="Neuer Termin"
            onAction={() => router.push("/termine/neu")}
          />
        ) : (
          rows.map((appt) => (
            <ApptRow
              key={appt.id}
              appt={appt}
              busy={busyId === appt.id}
              onAdvance={(status) => void advance(appt, status)}
              onCancel={() => void cancel(appt)}
              onReschedule={() => setRescheduling(appt)}
            />
          ))
        )}
      </ScrollView>

      {rescheduling != null ? (
        <RescheduleSheet
          appt={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={() => {
            setRescheduling(null)
            void load(day)
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
  const m = input
    .trim()
    .match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})[ T]+(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const [, dd, mm, yyyy, hh, min] = m
  const d = new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(min),
    0,
    0,
  )
  if (Number.isNaN(d.getTime())) return null
  // Guard against JS Date roll-over (e.g. 32.01 → 01.02).
  if (d.getDate() !== Number(dd) || d.getMonth() !== Number(mm) - 1) return null
  return d
}
