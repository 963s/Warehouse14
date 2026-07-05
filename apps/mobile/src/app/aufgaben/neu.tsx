/**
 * Neue Aufgabe — the Owner task-create modal. A titled form (FormScreen) over
 * tasksApi.create: title (Pflicht), description, a priority picker, an optional
 * due date on the shared DateWheel, and an optional „mir zuweisen"-toggle.
 *
 * Assignment: the api-client exposes no staff directory, and the backend
 * auto-fills the creator as the assignee when `assignedToUserId` is omitted. So
 * the only honest assignment we can offer is „mir zuweisen" — which sends the
 * logged-in actor's id (the same person, made explicit). Leaving it off lets the
 * server default to the creator. We never fabricate a staff list.
 *
 * Form (DESIGN-SYSTEM.md): keine Kästen in Kästen. Die Felder leben als nackte
 * Reihen direkt auf dem Papier, getrennt nur durch eine warme Haarlinie. Die
 * Priorität ist eine boxlose Reihe mit einem Gilt-Faden unter der aktiven Stufe
 * (Gold nur als Faden/Kante), nicht ein Raster gefüllter Kästchen. Die Zuweisung
 * ist eine bare Schalter-Reihe ohne Rahmen. Tiefe kommt aus dem geschichteten
 * Papier und der Linie, nie aus gestapelten Karten.
 *
 * On success the modal pops; the agenda refetches on focus and shows the row.
 * Step-up is transparent via the global StepUpDialogHost. All labels German.
 */
import { type ReactNode, useMemo, useState } from "react"
import { Pressable, Switch, View } from "react-native"
import { useRouter } from "expo-router"
import Svg, { Circle, Path } from "react-native-svg"
import type { CreateTaskBody, TaskPriority } from "@warehouse14/api-client"

import { Text } from "@/components/ui/text"
import { createTask } from "@/warehouse14/api"
import { TASK_PRIORITIES, TASK_PRIORITY_LABELS } from "@/warehouse14/aufgaben-ui"
import { DateWheel } from "@/warehouse14/product-form"
import { useSession } from "@/warehouse14/session"
import { useW14Theme } from "@/warehouse14/theme"
import {
  FormField,
  FormScreen,
  GoldFlood,
  Hairline,
  haptics,
  PressableScale,
  StaggerItem,
} from "@/warehouse14/ui"

const CURRENT_YEAR = new Date().getFullYear()

// ────────────────────────────────────────────────────────────────────────────
// QuillMark — ein bespoke Aufgaben-Siegel (react-native-svg). Ein Häkchen in
// einem gestempelten Kreis: die ruhige Marke der neuen Aufgabe. Der Ring bleibt
// Tinte, das Häkchen tönt in Gilt — Gold nur als Faden/Siegel (§1).
// ────────────────────────────────────────────────────────────────────────────

function QuillMark({ size = 26, ink, gilt }: { size?: number; ink: string; gilt: string }): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      <Circle cx={12} cy={12} r={8.4} stroke={ink} strokeWidth={1.4} fill="none" />
      <Circle cx={12} cy={12} r={6.2} stroke={ink} strokeWidth={0.7} strokeOpacity={0.4} fill="none" />
      {/* Das Häkchen — der Gilt-Faden im Siegel. */}
      <Path
        d="M8.6 12.2 L11 14.4 L15.4 9.6"
        stroke={gilt}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  )
}

// ────────────────────────────────────────────────────────────────────────────
// Prioritäts-Reihe — eine boxlose Auswahl. Jede Stufe trägt einen ruhigen
// Bedeutungs-Punkt (Dringend → Wachsrot, sonst Tinte), und die aktive Stufe
// einen Gilt-Faden darunter (Gold nur als Kante). Keine gefüllten Kästchen.
// ────────────────────────────────────────────────────────────────────────────

/** Honest meaning-colour per priority dot: only urgent earns the wax-red seal. */
function priorityDotColor(opt: TaskPriority, ink: string, red: string, faded: string): string {
  if (opt === "URGENT") return red
  if (opt === "HIGH") return ink
  return faded
}

/** A quiet German line describing what the selected priority signals. */
const PRIORITY_DESCRIPTION: Readonly<Record<TaskPriority, string>> = {
  LOW: "Kann warten, ohne Eile.",
  NORMAL: "Im üblichen Tagesablauf.",
  HIGH: "Bald erledigen, vor dem Üblichen.",
  URGENT: "Heute, vor allem anderen.",
}

function PriorityRow({
  value,
  onChange,
}: {
  value: TaskPriority
  onChange: (next: TaskPriority) => void
}): ReactNode {
  const t = useW14Theme()
  return (
    <View className="flex-row">
      {TASK_PRIORITIES.map((opt) => {
        const active = value === opt
        const dot = priorityDotColor(
          opt,
          t.colors.foreground,
          t.colors.destructive,
          t.colors.mutedForeground,
        )
        return (
          <Pressable
            key={opt}
            onPress={() => {
              if (active) return
              haptics.selection()
              onChange(opt)
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Priorität ${TASK_PRIORITY_LABELS[opt]}`}
            style={{ flex: 1, minHeight: t.touch.min, justifyContent: "center" }}
          >
            <View className="items-center gap-1.5 pb-1">
              <View className="flex-row items-center gap-1.5">
                <View
                  style={{
                    height: 5,
                    width: 5,
                    borderRadius: 3,
                    backgroundColor: active ? dot : t.colors.border,
                  }}
                />
                <Text
                  className="text-sm"
                  style={{
                    color: active ? t.colors.foreground : t.colors.mutedForeground,
                    fontFamily: active ? t.fonts.semibold : t.fonts.medium,
                  }}
                  numberOfLines={1}
                >
                  {TASK_PRIORITY_LABELS[opt]}
                </Text>
              </View>
              {/* Der Gilt-Faden unter der aktiven Stufe — Gold nur als Kante. */}
              <View
                style={{
                  height: 2,
                  width: "70%",
                  borderRadius: 1,
                  backgroundColor: active ? t.colors.gilt : "transparent",
                }}
              />
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

export default function NeueAufgabeScreen() {
  const router = useRouter()
  const t = useW14Theme()
  const { actor } = useSession()

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState<TaskPriority>("NORMAL")
  // Bare "YYYY-MM-DD" straight from the shared DateWheel — already the wire
  // shape the Postgres DATE column wants, so no de-DE parsing remains here.
  const [dueDate, setDueDate] = useState("")
  const [assignToMe, setAssignToMe] = useState(false)
  const [celebrate, setCelebrate] = useState(false)

  const titleTrimmed = title.trim()
  const canSubmit = titleTrimmed.length > 0

  // SessionActor carries only id + role (the device certificate resolves the
  // user identity), so there is no display name to show honestly — the
  // „mir zuweisen"-row stays name-free rather than fabricate one.
  const meName: string | null = null

  async function submit() {
    // The DateWheel composes only real calendar days, so there is nothing left
    // to validate here — an empty string simply means "kein Fälligkeitsdatum".
    const body: CreateTaskBody = {
      title: titleTrimmed,
      priority,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(assignToMe && actor?.id ? { assignedToUserId: actor.id } : {}),
    }
    // 403 STEP_UP_REQUIRED → PIN Dialog opens + the call retries automatically.
    await createTask(body)
    // A new task record exists — a real milestone. One Success haptic (§7) and a
    // single gold flood; the flood's onDone pops back to the list, which
    // refetches on focus and shows the new row.
    haptics.success()
    setCelebrate(true)
  }

  return (
    <View className="flex-1">
      <FormScreen
        title="Neue Aufgabe"
        subtitle="Lege ein To-do für den Betrieb an."
        submitLabel="Aufgabe anlegen"
        successMessage="Aufgabe angelegt."
        submitDisabled={!canSubmit}
        onSubmit={submit}
      >
        {/* Kicker + Siegel — der warme Auftakt des Formulars, boxlos auf dem
            Papier. Der Gilt-Punkt und das Häkchen sind der einzige Goldfaden. */}
        <StaggerItem index={0} exit={false}>
          <View className="flex-row items-center gap-2.5 pb-0.5">
            <QuillMark size={26} ink={t.colors.primary} gilt={t.colors.gilt} />
            <View className="flex-1 gap-1">
              <View className="flex-row items-center gap-1.5">
                <View style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }} />
                <Text
                  className="text-muted-foreground text-2xs font-semibold"
                  style={{ letterSpacing: 1.2 }}
                >
                  AUFGABE FÜR DEN BETRIEB
                </Text>
              </View>
              <Text className="text-muted-foreground text-xs leading-4">
                Titel genügt. Alles andere ist optional und lässt sich später ändern.
              </Text>
            </View>
          </View>
        </StaggerItem>

        <Hairline />

        <StaggerItem index={1} exit={false}>
          <FormField
            label="Titel"
            required
            inputProps={{
              value: title,
              onChangeText: setTitle,
              placeholder: "z. B. Schaufenster neu dekorieren",
              autoCapitalize: "sentences",
            }}
          />
        </StaggerItem>

        <StaggerItem index={2} exit={false}>
          <FormField
            label="Beschreibung"
            hint="Optional Details oder nächste Schritte."
            inputProps={{
              value: description,
              onChangeText: setDescription,
              placeholder: "Optionaler Kontext",
              autoCapitalize: "sentences",
              multiline: true,
              numberOfLines: 3,
            }}
          />
        </StaggerItem>

        <Hairline />

        {/* Priorität — boxlose Reihe mit Gilt-Faden + ehrlicher Beschreibung. */}
        <StaggerItem index={3} exit={false}>
          <FormField label="Priorität" hint={PRIORITY_DESCRIPTION[priority]}>
            <PriorityRow value={priority} onChange={setPriority} />
          </FormField>
        </StaggerItem>

        <StaggerItem index={4} exit={false}>
          <FormField label="Fällig am" hint="Optional Tag, Monat und Jahr wählen. Das × entfernt das Datum.">
            <DateWheel
              value={dueDate || null}
              onChange={setDueDate}
              onClear={() => setDueDate("")}
              accessibilityLabel="Fällig am"
              minYear={CURRENT_YEAR - 1}
              maxYear={CURRENT_YEAR + 5}
              defaultYear={CURRENT_YEAR}
            />
          </FormField>
        </StaggerItem>

        <Hairline />

        {/* Zuweisung — eine bare Schalter-Reihe, kein Rahmen-Kasten. Der Untertext
            bleibt ehrlich: ohne Schalter übernimmt der Ersteller die Aufgabe. */}
        <StaggerItem index={5} exit={false}>
          <FormField
            label="Zuweisung"
            hint={
              assignToMe
                ? meName
                  ? `Die Aufgabe geht an dich (${meName}).`
                  : "Die Aufgabe geht an dich."
                : "Sonst übernimmt sie automatisch der Ersteller."
            }
          >
            <Pressable
              onPress={() => {
                haptics.selection()
                setAssignToMe((v) => !v)
              }}
              accessibilityRole="switch"
              accessibilityState={{ checked: assignToMe }}
              accessibilityLabel="Mir zuweisen"
              className="flex-row items-center justify-between gap-3 py-1.5"
              style={{ minHeight: t.touch.min }}
            >
              <View className="flex-1 flex-row items-center gap-2.5">
                <View
                  style={{
                    height: 6,
                    width: 6,
                    borderRadius: 3,
                    backgroundColor: assignToMe ? t.colors.gilt : t.colors.border,
                  }}
                />
                <Text
                  className="text-base"
                  style={{
                    color: t.colors.foreground,
                    fontFamily: assignToMe ? t.fonts.semibold : t.fonts.medium,
                  }}
                >
                  Mir zuweisen
                </Text>
              </View>
              <Switch
                value={assignToMe}
                onValueChange={(v) => {
                  haptics.selection()
                  setAssignToMe(v)
                }}
                trackColor={{ true: t.colors.primary, false: t.colors.border }}
                thumbColor={t.colors.card}
              />
            </Pressable>
          </FormField>
        </StaggerItem>
      </FormScreen>

      {/* The new-task milestone flood visual only (the Success haptic already
          fired). When it fades, pop back to the list, which refetches on focus. */}
      <GoldFlood visible={celebrate} onDone={() => router.back()} />
    </View>
  )
}
