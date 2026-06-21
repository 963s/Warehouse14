/**
 * Neuer Termin — the Owner booking flow. Two steps in one screen:
 *
 *   1. Terminart wählen   — VIEWING / BUYBACK_EVAL / CONSULTATION / PICKUP.
 *   2. Slot wählen        — appointments.availableSlots over the next 14 days
 *                           for the logged-in staff member (the actor), grouped
 *                           by day, server-computed (Europe/Berlin, DST-correct).
 *   → Buchen              — appointments.book (bookedVia: "pos"); on success the
 *                           create lands as a milestone (Success haptic + one
 *                           gold flood) and a native confirm card routes back to
 *                           the agenda, which refetches on focus.
 *
 * Built on the shared spine (DESIGN.md): the slot list reads through `useQuery`
 * (re-keyed on the chosen type, in-flight de-dupe, refetch-on-focus), the
 * booking writes through `useMutation`, `QueryBoundary` renders the slot states
 * (skeleton / error+retry / empty) uniformly, `PressableScale` + the §7 haptics
 * make every chip feel native, a sticky book bar sits off the home indicator via
 * `KeyboardAvoidingScreen`, and the success step celebrates with `GoldFlood`.
 *
 * Honesty rule: the slot list is the server's real availability — never a
 * fabricated grid. Duration is left to the server default per type. Reached from
 * the Termine agenda's „Neuer Termin"-Aktion (/termine/neu).
 *
 * de-DE date/time; all labels German; no native deps added.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { ScrollView, View } from "react-native"
import { router, useNavigation } from "expo-router"
import type { AppointmentType, AvailableSlot } from "@warehouse14/api-client"
import { CalendarCheck2, CalendarClock, CalendarSearch, Check } from "lucide-react-native"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { availableSlots, bookAppointment } from "@/warehouse14/api"
import { useSession } from "@/warehouse14/session"
import {
  addDays,
  BOOKABLE_TYPES,
  formatDayHeader,
  formatTime,
  parseServerDate,
  startOfDay,
  typeLabel,
} from "@/warehouse14/termine-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  GoldFlood,
  haptics,
  InlineError,
  PressableScale,
  QueryBoundary,
  SectionCard,
  Skeleton,
  StaggerItem,
  useMutation,
  useQuery,
  useScreenInsets,
} from "@/warehouse14/ui"

/** How far ahead the slot search reaches (days). */
const SLOT_HORIZON_DAYS = 14

interface SlotsResult {
  slots: AvailableSlot[]
}

/** Group slots by their local calendar day (header → slots), in time order. */
function groupByDay(
  slots: readonly AvailableSlot[],
): { key: string; label: string; slots: AvailableSlot[] }[] {
  const byKey = new Map<string, { label: string; slots: AvailableSlot[] }>()
  for (const s of [...slots].sort((a, b) => a.slot_starts_at.localeCompare(b.slot_starts_at))) {
    const d = parseServerDate(s.slot_starts_at)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const bucket = byKey.get(key) ?? { label: formatDayHeader(d), slots: [] }
    bucket.slots.push(s)
    byKey.set(key, bucket)
  }
  return [...byKey.entries()].map(([key, v]) => ({ key, label: v.label, slots: v.slots }))
}

/** The slot picker's loading placeholder — day headers + chip rows, in shape. */
function SlotsSkeleton() {
  return (
    <View className="gap-5 pt-1">
      {Array.from({ length: 2 }).map((_, g) => (
        <View key={g} className="gap-2">
          <Skeleton width="42%" height={12} />
          <View className="flex-row flex-wrap gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} width={68} height={38} radius="button" />
            ))}
          </View>
        </View>
      ))}
    </View>
  )
}

export default function NeuerTerminScreen() {
  const navigation = useNavigation()
  const t = useW14Theme()
  const insets = useScreenInsets()
  const { actor } = useSession()

  const [type, setType] = useState<AppointmentType | null>(null)
  const [selected, setSelected] = useState<AvailableSlot | null>(null)
  const [celebrate, setCelebrate] = useState(false)
  const [booked, setBooked] = useState(false)

  useEffect(() => {
    navigation.setOptions({ title: "Neuer Termin" })
  }, [navigation])

  // Slot availability is a live read keyed on the chosen type, so the spine owns
  // its loading / error / empty states and de-dupes in-flight requests. Gated
  // off until a type is picked (`enabled`), so nothing fires on first paint.
  const slots = useQuery<SlotsResult>(
    () => {
      const from = new Date()
      const to = startOfDay(addDays(from, SLOT_HORIZON_DAYS))
      return availableSlots({
        type: type!,
        from: from.toISOString(),
        to: to.toISOString(),
        ...(actor?.id ? { staffUserId: actor.id } : {}),
      })
    },
    { key: type ? `slots:${type}:${actor?.id ?? "self"}` : undefined, enabled: type != null },
  )

  // The booking write. On success we celebrate once and flip to the confirm step.
  const booking = useMutation(
    (vars: { type: AppointmentType; slot: AvailableSlot; staffUserId: string }) =>
      bookAppointment({
        type: vars.type,
        startsAt: vars.slot.slot_starts_at,
        staffUserId: vars.staffUserId,
        bookedVia: "pos",
      }),
    {
      onSuccess: () => {
        // One haptic per action (§7): Success IS the confirm; the flood is visual.
        haptics.success()
        setBooked(true)
        setCelebrate(true)
      },
      onError: () => haptics.error(),
    },
  )

  const chooseType = useCallback((opt: AppointmentType) => {
    haptics.selection()
    setType(opt)
    setSelected(null)
  }, [])

  const chooseSlot = useCallback((s: AvailableSlot) => {
    haptics.selection()
    setSelected(s)
  }, [])

  const book = useCallback(() => {
    if (!type || !selected) return
    // The booking endpoint needs a concrete staff member. The slot row carries
    // the resolved staff id; fall back to the actor when present.
    const staffUserId = selected.staff_user_id || actor?.id
    if (!staffUserId) {
      haptics.error()
      return
    }
    void booking.mutate({ type, slot: selected, staffUserId }).catch(() => {})
  }, [type, selected, actor?.id, booking])

  const groups = useMemo(() => (slots.data ? groupByDay(slots.data.slots) : []), [slots.data])

  // ── Erfolg: zurück zur Agenda ───────────────────────────────────────────────
  if (booked) {
    return (
      <View className="flex-1 bg-background">
        <View className="flex-1 items-center justify-center gap-5 px-6">
          <View
            className="h-20 w-20 items-center justify-center rounded-full"
            style={{ backgroundColor: t.colors.verdigris + "1f" }}
          >
            <CalendarCheck2 size={t.icon.xl} color={t.colors.verdigris} />
          </View>
          <View className="items-center gap-1.5">
            <Text className="text-xl font-bold">Termin gebucht</Text>
            {type != null && selected != null ? (
              <Text className="text-muted-foreground text-center text-sm" numberOfLines={2}>
                {typeLabel(type)} · {formatDayHeader(parseServerDate(selected.slot_starts_at))},{" "}
                {formatTime(selected.slot_starts_at)} Uhr
              </Text>
            ) : null}
          </View>
        </View>

        <View
          className="border-border border-t px-4 pt-3"
          style={{ paddingBottom: insets.stickyBottom }}
        >
          <Button
            size="lg"
            className="h-12"
            onPress={() => {
              haptics.selection()
              router.back()
            }}
            accessibilityLabel="Zur Agenda"
          >
            <Text>Zur Agenda</Text>
          </Button>
        </View>

        {/* The booking milestone flood — visual only (Success already fired). */}
        <GoldFlood visible={celebrate} onDone={() => setCelebrate(false)} />
      </View>
    )
  }

  // ── Buchung ─────────────────────────────────────────────────────────────────
  const staffMissing = selected != null && !(selected.staff_user_id || actor?.id)

  return (
    <View className="flex-1 bg-background">
      <Step1AndSlots
        type={type}
        onChooseType={chooseType}
        slots={slots}
        groups={groups}
        selected={selected}
        onChooseSlot={chooseSlot}
        bookError={booking.error}
        staffMissing={staffMissing}
      />

      {/* Sticky book action — 48px money-comfortable target, off the home bar. */}
      <View
        className="bg-card border-border border-t px-4 pt-3"
        style={{ paddingBottom: insets.stickyBottom }}
      >
        <Button
          size="lg"
          className="h-12"
          onPress={book}
          disabled={!type || !selected || booking.isPending || staffMissing}
          accessibilityLabel="Termin buchen"
        >
          <Text>
            {booking.isPending
              ? "Buche…"
              : selected != null
                ? `Termin buchen · ${formatTime(selected.slot_starts_at)} Uhr`
                : "Termin buchen"}
          </Text>
        </Button>
      </View>
    </View>
  )
}

// ── Step 1 (type) + Step 2 (slots) body ───────────────────────────────────────
/** Split out so the scrolling body stays readable; pure presentation over the
 *  live `slots` query handed down from the screen. */
function Step1AndSlots({
  type,
  onChooseType,
  slots,
  groups,
  selected,
  onChooseSlot,
  bookError,
  staffMissing,
}: {
  type: AppointmentType | null
  onChooseType: (t: AppointmentType) => void
  slots: ReturnType<typeof useQuery<SlotsResult>>
  groups: { key: string; label: string; slots: AvailableSlot[] }[]
  selected: AvailableSlot | null
  onChooseSlot: (s: AvailableSlot) => void
  bookError: string | null
  staffMissing: boolean
}) {
  const t = useW14Theme()

  return (
    <ScrollView
      className="flex-1"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, paddingBottom: 24, gap: 16 }}
    >
      <View className="gap-4">
        {bookError != null ? <InlineError message={bookError} /> : null}
        {staffMissing ? (
          <InlineError message="Kein Mitarbeiter für die Buchung ermittelbar — bitte neu anmelden." />
        ) : null}

        {/* Step 1 — type */}
        <SectionCard title="Terminart" subtitle="Worum geht es?" icon={CalendarClock}>
          <View className="flex-row flex-wrap gap-2">
            {BOOKABLE_TYPES.map((opt) => {
              const active = type === opt
              return (
                <PressableScale
                  key={opt}
                  onPress={() => onChooseType(opt)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={typeLabel(opt)}
                >
                  <View
                    className="rounded-md border px-3 py-2"
                    style={{
                      borderColor: active ? t.colors.primary : t.colors.border,
                      backgroundColor: active ? t.colors.primary : "transparent",
                    }}
                  >
                    <Text
                      className="text-sm font-medium"
                      style={{
                        color: active ? t.colors.primaryForeground : t.colors.foreground,
                      }}
                    >
                      {typeLabel(opt)}
                    </Text>
                  </View>
                </PressableScale>
              )
            })}
          </View>
        </SectionCard>

        {/* Step 2 — slot */}
        {type == null ? (
          <View className="flex-row items-center gap-2 px-1">
            <CalendarSearch size={t.icon.sm} color={t.colors.mutedForeground} />
            <Text className="text-muted-foreground text-sm">
              Wähle zuerst eine Terminart, um freie Slots zu sehen.
            </Text>
          </View>
        ) : (
          <QueryBoundary
            query={slots}
            loading={<SlotsSkeleton />}
            isEmpty={(d) => d.slots.length === 0}
            empty={{
              icon: CalendarSearch,
              title: "Keine freien Termine",
              description: "In den nächsten 14 Tagen ist für diese Terminart kein Slot frei.",
            }}
            renderError={({ message, retry, retrying }) => (
              <Card className="gap-3 px-4 py-4">
                <InlineError message={message ?? "Konnte freie Termine nicht laden."} />
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onPress={retry}
                  disabled={retrying}
                  accessibilityLabel="Erneut laden"
                >
                  <Text>{retrying ? "Lädt…" : "Erneut"}</Text>
                </Button>
              </Card>
            )}
          >
            {() => (
              <View className="gap-5">
                {groups.map((g, gi) => (
                  <StaggerItem key={g.key} index={gi} exit={false}>
                    <View className="gap-2">
                      <Text
                        className="text-muted-foreground text-2xs font-semibold uppercase"
                        style={{ letterSpacing: 0.5 }}
                      >
                        {g.label}
                      </Text>
                      <View className="flex-row flex-wrap gap-2">
                        {g.slots.map((s) => {
                          const active =
                            selected?.slot_starts_at === s.slot_starts_at &&
                            selected?.staff_user_id === s.staff_user_id
                          return (
                            <PressableScale
                              key={`${s.staff_user_id}-${s.slot_starts_at}`}
                              onPress={() => onChooseSlot(s)}
                              accessibilityRole="button"
                              accessibilityState={{ selected: active }}
                              accessibilityLabel={`${formatTime(s.slot_starts_at)} Uhr`}
                            >
                              <View
                                className="flex-row items-center gap-1.5 rounded-md border px-3 py-2"
                                style={{
                                  borderColor: active ? t.colors.primary : t.colors.border,
                                  backgroundColor: active ? t.colors.primary : t.colors.card,
                                }}
                              >
                                {active ? (
                                  <Check size={t.icon.xs} color={t.colors.primaryForeground} />
                                ) : null}
                                <Text
                                  className="font-mono-medium text-sm"
                                  style={{
                                    color: active
                                      ? t.colors.primaryForeground
                                      : t.colors.foreground,
                                  }}
                                >
                                  {formatTime(s.slot_starts_at)}
                                </Text>
                              </View>
                            </PressableScale>
                          )
                        })}
                      </View>
                    </View>
                  </StaggerItem>
                ))}
              </View>
            )}
          </QueryBoundary>
        )}
      </View>
    </ScrollView>
  )
}
