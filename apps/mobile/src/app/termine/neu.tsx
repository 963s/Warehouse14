/**
 * Neuer Termin — the Owner booking flow. Three steps in one screen:
 *
 *   1. Terminart wählen   — VIEWING / BUYBACK_EVAL / CONSULTATION / PICKUP.
 *   2. Slot wählen        — appointments.availableSlots over the next 14 days
 *                           for the logged-in staff member (the actor), grouped
 *                           by day, server-computed (Europe/Berlin, DST-correct).
 *   3. Buchen             — appointments.book (bookedVia: "pos"); on success we
 *                           return to the agenda, which refetches on focus.
 *
 * Honesty rule: the slot list is the server's real availability — never a
 * fabricated grid. Duration is left to the server default per type. Reached from
 * the Termine agenda's „Neuer Termin"-Aktion (/termine/neu).
 *
 * de-DE date/time; all labels German; no native deps added (the shared W14 UI
 * kit + the typed theme).
 */
import { useCallback, useEffect, useState } from "react"
import { Pressable, ScrollView, View } from "react-native"
import { useRouter } from "expo-router"
import type { AppointmentType, AvailableSlot } from "@warehouse14/api-client"
import { CalendarClock, Check } from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { availableSlots, bookAppointment, describeError } from "@/warehouse14/api"
import { useSession } from "@/warehouse14/session"
import { useW14Theme } from "@/warehouse14/theme"
import {
  addDays,
  BOOKABLE_TYPES,
  formatDayHeader,
  formatTime,
  startOfDay,
  typeLabel,
} from "@/warehouse14/termine-ui"
import { EmptyState, SectionCard } from "@/warehouse14/ui"

/** How far ahead the slot search reaches (days). */
const SLOT_HORIZON_DAYS = 14

/** Group slots by their local calendar day (header → slots), in time order. */
function groupByDay(slots: readonly AvailableSlot[]): { key: string; label: string; slots: AvailableSlot[] }[] {
  const byKey = new Map<string, { label: string; slots: AvailableSlot[] }>()
  for (const s of [...slots].sort((a, b) => a.slot_starts_at.localeCompare(b.slot_starts_at))) {
    const d = new Date(s.slot_starts_at)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const bucket = byKey.get(key) ?? { label: formatDayHeader(d), slots: [] }
    bucket.slots.push(s)
    byKey.set(key, bucket)
  }
  return [...byKey.entries()].map(([key, v]) => ({ key, label: v.label, slots: v.slots }))
}

export default function NeuerTerminScreen() {
  const router = useRouter()
  const t = useW14Theme()
  const insets = useSafeAreaInsets()
  const { actor } = useSession()

  const [type, setType] = useState<AppointmentType | null>(null)
  const [slots, setSlots] = useState<AvailableSlot[]>([])
  const [selected, setSelected] = useState<AvailableSlot | null>(null)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [booking, setBooking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Fetch availability whenever a type is chosen.
  const loadSlots = useCallback(
    async (chosen: AppointmentType) => {
      setError(null)
      setLoadingSlots(true)
      setSlots([])
      setSelected(null)
      try {
        const from = new Date()
        const to = startOfDay(addDays(from, SLOT_HORIZON_DAYS))
        const res = await availableSlots({
          type: chosen,
          from: from.toISOString(),
          to: to.toISOString(),
          ...(actor?.id ? { staffUserId: actor.id } : {}),
        })
        setSlots(res.slots)
      } catch (e) {
        setError(describeError(e))
      } finally {
        setLoadingSlots(false)
      }
    },
    [actor?.id],
  )

  useEffect(() => {
    if (type) void loadSlots(type)
  }, [type, loadSlots])

  async function book() {
    if (!type || !selected) return
    // The booking endpoint needs a concrete staff member. The slot row carries
    // the resolved staff id; fall back to the actor when present.
    const staffUserId = selected.staff_user_id || actor?.id
    if (!staffUserId) {
      setError("Kein Mitarbeiter für die Buchung ermittelbar — bitte neu anmelden.")
      return
    }
    setError(null)
    setBooking(true)
    try {
      // 403 STEP_UP_REQUIRED → PIN Dialog opens + the call retries automatically.
      await bookAppointment({
        type,
        startsAt: selected.slot_starts_at,
        staffUserId,
        bookedVia: "pos",
      })
      // Back to the agenda, which refetches on focus and shows the new row.
      router.back()
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBooking(false)
    }
  }

  const groups = groupByDay(slots)

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 16 }}
      >
        {error != null ? (
          <Card className="gap-1 border-destructive px-4 py-3">
            <Text className="text-sm font-semibold" style={{ color: t.colors.destructive }}>
              Fehler
            </Text>
            <Text className="text-muted-foreground text-sm">{error}</Text>
          </Card>
        ) : null}

        {/* Step 1 — type */}
        <SectionCard title="Terminart" subtitle="Worum geht es?" icon={CalendarClock}>
          <View className="flex-row flex-wrap gap-2">
            {BOOKABLE_TYPES.map((opt) => {
              const active = type === opt
              return (
                <Pressable
                  key={opt}
                  onPress={() => setType(opt)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  className="rounded-lg border px-3 py-2"
                  style={{
                    borderColor: active ? t.colors.primary : t.colors.border,
                    backgroundColor: active ? t.colors.primary : "transparent",
                  }}
                >
                  <Text
                    className="text-sm font-medium"
                    style={{ color: active ? t.colors.primaryForeground : t.colors.foreground }}
                  >
                    {typeLabel(opt)}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </SectionCard>

        {/* Step 2 — slot */}
        {type != null ? (
          loadingSlots ? (
            <Text className="text-muted-foreground px-1">Lade freie Termine…</Text>
          ) : groups.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Keine freien Termine"
              description="In den nächsten 14 Tagen ist für diese Terminart kein Slot frei."
            />
          ) : (
            groups.map((g) => (
              <View key={g.key} className="gap-2">
                <Text
                  className="text-xs font-semibold uppercase"
                  style={{ color: t.colors.mutedForeground, letterSpacing: 0.5 }}
                >
                  {g.label}
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {g.slots.map((s) => {
                    const active =
                      selected?.slot_starts_at === s.slot_starts_at &&
                      selected?.staff_user_id === s.staff_user_id
                    return (
                      <Pressable
                        key={`${s.staff_user_id}-${s.slot_starts_at}`}
                        onPress={() => setSelected(s)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        className="flex-row items-center gap-1.5 rounded-lg border px-3 py-2"
                        style={{
                          borderColor: active ? t.colors.primary : t.colors.border,
                          backgroundColor: active ? t.colors.primary : t.colors.card,
                        }}
                      >
                        {active ? (
                          <Check size={14} color={t.colors.primaryForeground} />
                        ) : null}
                        <Text
                          className="text-sm font-medium"
                          style={{
                            color: active ? t.colors.primaryForeground : t.colors.foreground,
                          }}
                        >
                          {formatTime(s.slot_starts_at)}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            ))
          )
        ) : (
          <Text className="text-muted-foreground px-1 text-sm">
            Wähle zuerst eine Terminart, um freie Slots zu sehen.
          </Text>
        )}
      </ScrollView>

      {/* Sticky book action */}
      <View
        className="bg-card border-border border-t px-4 pt-3"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        <Button
          onPress={() => void book()}
          disabled={!type || !selected || booking}
          className="h-12"
        >
          <Text>
            {booking
              ? "Buche…"
              : selected != null
                ? `Termin buchen · ${formatTime(selected.slot_starts_at)}`
                : "Termin buchen"}
          </Text>
        </Button>
      </View>
    </View>
  )
}
