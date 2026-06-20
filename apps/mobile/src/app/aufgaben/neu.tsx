/**
 * Neue Aufgabe — the Owner task-create modal. A titled form (FormScreen) over
 * tasksApi.create: title (Pflicht), description, a priority chip picker, an
 * optional de-DE due date ("TT.MM.JJJJ"), and an optional „mir zuweisen"-toggle.
 *
 * Assignment: the api-client exposes no staff directory, and the backend
 * auto-fills the creator as the assignee when `assignedToUserId` is omitted. So
 * the only honest assignment we can offer is „mir zuweisen" — which sends the
 * logged-in actor's id (the same person, made explicit). Leaving it off lets the
 * server default to the creator. We never fabricate a staff list.
 *
 * On success the modal pops; the agenda refetches on focus and shows the row.
 * Step-up is transparent via the global StepUpDialogHost. All labels German.
 */
import { useState } from "react"
import { Pressable, Switch, View } from "react-native"
import { useRouter } from "expo-router"
import type { CreateTaskBody, TaskPriority } from "@warehouse14/api-client"

import { Text } from "@/components/ui/text"
import { createTask } from "@/warehouse14/api"
import { parseDueDateInput, TASK_PRIORITIES, TASK_PRIORITY_LABELS } from "@/warehouse14/aufgaben-ui"
import { useSession } from "@/warehouse14/session"
import { useW14Theme } from "@/warehouse14/theme"
import { FormField, FormScreen, GoldFlood, haptics, PressableScale } from "@/warehouse14/ui"

export default function NeueAufgabeScreen() {
  const router = useRouter()
  const t = useW14Theme()
  const { actor } = useSession()

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState<TaskPriority>("NORMAL")
  const [dueInput, setDueInput] = useState("")
  const [assignToMe, setAssignToMe] = useState(false)
  const [dueError, setDueError] = useState<string | null>(null)
  const [celebrate, setCelebrate] = useState(false)

  const titleTrimmed = title.trim()
  const canSubmit = titleTrimmed.length > 0

  async function submit() {
    const parsedDue = parseDueDateInput(dueInput)
    if (!parsedDue.ok) {
      haptics.error()
      setDueError("Bitte im Format TT.MM.JJJJ eingeben.")
      // Throwing keeps FormScreen's busy state correct and shows the banner.
      throw new Error("Fälligkeitsdatum ungültig.")
    }
    setDueError(null)

    const body: CreateTaskBody = {
      title: titleTrimmed,
      priority,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(parsedDue.date ? { dueDate: parsedDue.date } : {}),
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

  function priorityChip(opt: TaskPriority) {
    const active = priority === opt
    return (
      <PressableScale
        key={opt}
        onPress={() => {
          haptics.selection()
          setPriority(opt)
        }}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`Priorität ${TASK_PRIORITY_LABELS[opt]}`}
      >
        <View
          className="rounded-md border px-3 py-2"
          style={{
            borderColor: active ? t.colors.primary : t.colors.border,
            backgroundColor: active ? t.colors.primary : t.colors.card,
          }}
        >
          <Text
            className="text-sm font-medium"
            style={{ color: active ? t.colors.primaryForeground : t.colors.foreground }}
          >
            {TASK_PRIORITY_LABELS[opt]}
          </Text>
        </View>
      </PressableScale>
    )
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

        <FormField
          label="Beschreibung"
          hint="Optional — Details oder nächste Schritte."
          inputProps={{
            value: description,
            onChangeText: setDescription,
            placeholder: "Optionaler Kontext",
            autoCapitalize: "sentences",
            multiline: true,
            numberOfLines: 3,
          }}
        />

        <FormField label="Priorität">
          <View className="flex-row flex-wrap gap-2">{TASK_PRIORITIES.map(priorityChip)}</View>
        </FormField>

        <FormField
          label="Fällig am"
          hint="Optional — Format TT.MM.JJJJ."
          error={dueError}
          inputProps={{
            value: dueInput,
            onChangeText: (v: string) => {
              setDueInput(v)
              if (dueError) setDueError(null)
            },
            placeholder: "TT.MM.JJJJ",
            autoCapitalize: "none",
            autoCorrect: false,
            keyboardType: "numbers-and-punctuation",
          }}
        />

        <FormField label="Zuweisung" hint="Sonst übernimmt sie automatisch der Ersteller.">
          <Pressable
            onPress={() => setAssignToMe((v) => !v)}
            accessibilityRole="switch"
            accessibilityState={{ checked: assignToMe }}
            className="border-border flex-row items-center justify-between rounded-lg border px-3 py-2.5"
          >
            <Text className="text-sm font-medium">Mir zuweisen</Text>
            <Switch
              value={assignToMe}
              onValueChange={setAssignToMe}
              trackColor={{ true: t.colors.primary, false: t.colors.border }}
              thumbColor={t.colors.card}
            />
          </Pressable>
        </FormField>
      </FormScreen>

      {/* The new-task milestone flood — visual only (the Success haptic already
          fired). When it fades, pop back to the list, which refetches on focus. */}
      <GoldFlood visible={celebrate} onDone={() => router.back()} />
    </View>
  )
}
