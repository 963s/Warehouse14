/**
 * Aufgabe bearbeiten — the Owner task-edit modal. Loads the task by id
 * (tasksApi.get), prefills the fields, and PATCHes the metadata
 * (tasksApi.update): title, description, priority, due date. Status is NOT
 * edited here — lifecycle moves go through the list's transition buttons
 * (tasksApi.transition), the single legal path through the state machine.
 *
 * On success the modal pops; the list refetches on focus. Step-up is transparent
 * via the global StepUpDialogHost. All labels German; no native deps added.
 */
import { useEffect, useState } from "react"
import { View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import type { TaskPriority, UpdateTaskBody } from "@warehouse14/api-client"

import { Text } from "@/components/ui/text"
import { describeError, getTask, updateTask } from "@/warehouse14/api"
import {
  dueDateInput,
  parseDueDateInput,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
} from "@/warehouse14/aufgaben-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  ErrorState,
  FormField,
  FormScreen,
  GoldFlood,
  haptics,
  PressableScale,
  SkeletonCard,
} from "@/warehouse14/ui"

export default function AufgabeBearbeitenScreen() {
  const router = useRouter()
  const t = useW14Theme()
  const { id } = useLocalSearchParams<{ id: string }>()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [celebrate, setCelebrate] = useState(false)

  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState<TaskPriority>("NORMAL")
  const [dueInput, setDueInput] = useState("")
  const [dueError, setDueError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!id) {
      setLoadError("Keine Aufgabe ausgewählt.")
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    void (async () => {
      try {
        const task = await getTask(id)
        if (!active) return
        setTitle(task.title)
        setDescription(task.description ?? "")
        setPriority(task.priority)
        setDueInput(dueDateInput(task.dueDate))
      } catch (e) {
        if (active) setLoadError(describeError(e))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [id, reloadKey])

  const titleTrimmed = title.trim()
  const canSubmit = titleTrimmed.length > 0

  async function submit() {
    if (!id) throw new Error("Keine Aufgabe ausgewählt.")
    const parsedDue = parseDueDateInput(dueInput)
    if (!parsedDue.ok) {
      haptics.error()
      setDueError("Bitte im Format TT.MM.JJJJ eingeben.")
      throw new Error("Fälligkeitsdatum ungültig.")
    }
    setDueError(null)

    // PATCH the editable metadata. dueDate/description accept null to clear.
    const body: UpdateTaskBody = {
      title: titleTrimmed,
      priority,
      description: description.trim() ? description.trim() : null,
      dueDate: parsedDue.date,
    }
    // 403 STEP_UP_REQUIRED → PIN Dialog opens + the call retries automatically.
    await updateTask(id, body)
    // Saved changes are a real write — one Success haptic (§7) + a brief flood,
    // then pop back to the list, which refetches on focus.
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

  if (loading) {
    // The form's own shape while the task loads — never a mid-screen spinner.
    return (
      <View className="flex-1 bg-background p-4">
        <SkeletonCard rows={5} />
      </View>
    )
  }

  if (loadError != null) {
    return (
      <View className="flex-1 justify-center bg-background p-4">
        <ErrorState
          message={loadError}
          onRetry={id ? () => setReloadKey((k) => k + 1) : undefined}
        />
      </View>
    )
  }

  return (
    <View className="flex-1">
      <FormScreen
        title="Aufgabe bearbeiten"
        subtitle="Titel, Priorität und Fälligkeit anpassen."
        submitLabel="Änderungen speichern"
        successMessage="Aufgabe aktualisiert."
        submitDisabled={!canSubmit}
        onSubmit={submit}
      >
        <FormField
          label="Titel"
          required
          inputProps={{
            value: title,
            onChangeText: setTitle,
            placeholder: "Titel der Aufgabe",
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
          hint="Optional — Format TT.MM.JJJJ. Leer lassen entfernt das Datum."
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
      </FormScreen>

      {/* The saved-changes flood — visual only (the Success haptic already fired).
          When it fades, pop back to the list, which refetches on focus. */}
      <GoldFlood visible={celebrate} onDone={() => router.back()} />
    </View>
  )
}
