/**
 * Aufgaben — the Owner to-do list. Tasks (tasksApi.list) grouped by status into
 * labelled sections (Offen, In Arbeit, Blockiert, Erledigt, Abgebrochen), each
 * row carrying its priority, due date and a one-tap set of legal state-machine
 * transitions (tasksApi.transition, gated by ALLOWED_TASK_TRANSITIONS). A header
 * „Neue Aufgabe"-Aktion opens the create modal (aufgaben/neu); tapping a row's
 * „Bearbeiten" opens the edit modal (aufgaben/edit). Reached from the „Mehr"-Hub
 * (/aufgaben).
 *
 * Honesty rule (mirrors Termine + Schatzkammer): every row is a real task from a
 * real endpoint; an empty list shows the EmptyState, never a fabricated to-do.
 * Transitions are step-up gated server-side — the global StepUpDialogHost fires
 * transparently and the middleware retries the PATCH after the PIN. Cancelling
 * needs a reason (≥ 4 chars per the DB CHECK), collected in a small RN-Modal
 * sheet before the transition is sent.
 *
 * Status filter chips narrow the fetch; all labels German; no native deps added.
 */
import { useCallback, useLayoutEffect, useState } from "react"
import { Modal, Pressable, RefreshControl, ScrollView, View } from "react-native"
import { useFocusEffect, useNavigation, useRouter } from "expo-router"
import type { TaskRow, TaskStatus } from "@warehouse14/api-client"
import { CalendarClock, ListChecks, ListPlus, Pencil, XCircle } from "lucide-react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Text } from "@/components/ui/text"
import { describeError, listTasks, transitionTask } from "@/warehouse14/api"
import {
  allowedTransitions,
  formatDueDate,
  groupByStatus,
  isOverdue,
  priorityBadgeVariant,
  STATUS_BADGE_VARIANT,
  STATUS_GROUP_ORDER,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  transitionActionLabel,
} from "@/warehouse14/aufgaben-ui"
import { useW14Theme } from "@/warehouse14/theme"
import { EmptyState } from "@/warehouse14/ui"

// ── Cancellation reason sheet ─────────────────────────────────────────────────
/** A minimal RN-Modal collecting the mandatory cancellation reason (≥ 4 chars,
 *  per the backend DB CHECK) before a task is moved to CANCELLED. */
function CancelSheet({
  task,
  onClose,
  onConfirm,
}: {
  task: TaskRow
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  const t = useW14Theme()
  const insets = useSafeAreaInsets()
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  function submit() {
    const trimmed = reason.trim()
    if (trimmed.length < 4) {
      setError("Bitte mindestens 4 Zeichen angeben.")
      return
    }
    onConfirm(trimmed)
  }

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.45)" }}>
        <View
          className="bg-background gap-4 rounded-t-2xl px-5 pt-5"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <View className="gap-1">
            <Text className="text-lg font-bold">Aufgabe abbrechen</Text>
            <Text className="text-muted-foreground text-sm" numberOfLines={2}>
              {task.title}
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
            <Text className="text-sm font-medium">Grund</Text>
            <Input
              value={reason}
              onChangeText={setReason}
              placeholder="z. B. Nicht mehr nötig"
              autoCapitalize="sentences"
            />
          </View>

          <View className="flex-row gap-3 pt-1">
            <Button variant="outline" className="flex-1" onPress={onClose}>
              <Text>Zurück</Text>
            </Button>
            <Button variant="destructive" className="flex-1" onPress={submit}>
              <Text>Abbrechen</Text>
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// ── Task row ──────────────────────────────────────────────────────────────────
function TaskCard({
  task,
  busy,
  onTransition,
  onEdit,
}: {
  task: TaskRow
  busy: boolean
  onTransition: (target: TaskStatus) => void
  onEdit: () => void
}) {
  const t = useW14Theme()
  const due = formatDueDate(task.dueDate)
  const overdue = isOverdue(task)
  const priorityVariant = priorityBadgeVariant(task.priority)
  const transitions = allowedTransitions(task.status)

  return (
    <Card className="gap-3 px-4 py-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text className="text-base font-semibold" numberOfLines={2}>
            {task.title}
          </Text>
          {task.description ? (
            <Text className="text-muted-foreground text-sm" numberOfLines={2}>
              {task.description}
            </Text>
          ) : null}
          {due != null ? (
            <View className="flex-row items-center gap-1.5 pt-0.5">
              <CalendarClock
                size={13}
                color={overdue ? t.colors.destructive : t.colors.mutedForeground}
              />
              <Text
                className="text-sm"
                style={{ color: overdue ? t.colors.destructive : t.colors.mutedForeground }}
              >
                {overdue ? `Überfällig · ${due}` : `Fällig · ${due}`}
              </Text>
            </View>
          ) : null}
        </View>
        <View className="items-end gap-1.5">
          <Badge variant={STATUS_BADGE_VARIANT[task.status]}>
            <Text>{TASK_STATUS_LABELS[task.status]}</Text>
          </Badge>
          {priorityVariant != null ? (
            <Badge variant={priorityVariant}>
              <Text>{TASK_PRIORITY_LABELS[task.priority]}</Text>
            </Badge>
          ) : null}
        </View>
      </View>

      <View className="flex-row flex-wrap gap-2">
        {transitions.map((target) => (
          <Button
            key={target}
            size="sm"
            variant={target === "CANCELLED" ? "outline" : "default"}
            onPress={() => onTransition(target)}
            disabled={busy}
          >
            <Text>{transitionActionLabel(target)}</Text>
          </Button>
        ))}
        <Button size="sm" variant="outline" onPress={onEdit} disabled={busy}>
          <Pencil size={14} color={t.colors.foreground} />
          <Text>Bearbeiten</Text>
        </Button>
      </View>
    </Card>
  )
}

// ── Status filter chips ───────────────────────────────────────────────────────
function StatusFilter({
  value,
  onChange,
}: {
  value: TaskStatus | null
  onChange: (next: TaskStatus | null) => void
}) {
  const t = useW14Theme()
  const options: readonly { key: TaskStatus | null; label: string }[] = [
    { key: null, label: "Alle" },
    ...STATUS_GROUP_ORDER.map((status) => ({ key: status, label: TASK_STATUS_LABELS[status] })),
  ]
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingVertical: 10 }}
    >
      {options.map((opt) => {
        const active = value === opt.key
        return (
          <Pressable
            key={opt.key ?? "ALL"}
            onPress={() => onChange(opt.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            className="rounded-full border px-3 py-1.5"
            style={{
              borderColor: active ? t.colors.primary : t.colors.border,
              backgroundColor: active ? t.colors.primary : "transparent",
            }}
          >
            <Text
              className="text-sm font-medium"
              style={{ color: active ? t.colors.primaryForeground : t.colors.foreground }}
            >
              {opt.label}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function AufgabenScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const t = useW14Theme()
  const insets = useSafeAreaInsets()

  const [filter, setFilter] = useState<TaskStatus | null>(null)
  const [rows, setRows] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<TaskRow | null>(null)

  // Header „Neue Aufgabe"-Aktion → the create modal.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => router.push("/aufgaben/neu")}
          accessibilityRole="button"
          accessibilityLabel="Neue Aufgabe"
          hitSlop={12}
          style={{ paddingHorizontal: 12 }}
        >
          <ListPlus color={t.colors.primary} size={22} />
        </Pressable>
      ),
    })
  }, [navigation, router, t.colors.primary])

  const load = useCallback(async (status: TaskStatus | null) => {
    setError(null)
    try {
      const res = await listTasks({ ...(status ? { status } : {}), limit: 200 })
      setRows(res.items)
    } catch (e) {
      setError(describeError(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  // Reload on focus (so a new/edited task from the modals shows on return) and
  // whenever the filter changes.
  useFocusEffect(
    useCallback(() => {
      setLoading(true)
      void load(filter)
    }, [filter, load]),
  )

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    await load(filter)
    setRefreshing(false)
  }, [filter, load])

  async function applyTransition(task: TaskRow, target: TaskStatus, cancellationReason?: string) {
    setBusyId(task.id)
    setError(null)
    try {
      // 403 STEP_UP_REQUIRED → PIN Dialog opens + the call retries automatically.
      await transitionTask(task.id, {
        status: target,
        ...(cancellationReason ? { cancellationReason } : {}),
      })
      await load(filter)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusyId(null)
    }
  }

  function onTransition(task: TaskRow, target: TaskStatus) {
    // CANCELLED needs a mandatory reason — collect it first, then transition.
    if (target === "CANCELLED") {
      setCancelling(task)
      return
    }
    void applyTransition(task, target)
  }

  const groups = groupByStatus(rows)

  return (
    <View className="flex-1 bg-background">
      <View className="border-border border-b">
        <StatusFilter value={filter} onChange={setFilter} />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 18 }}
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
          <Text className="text-muted-foreground">Lade Aufgaben…</Text>
        ) : groups.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="Keine Aufgaben"
            description="Lege über das Plus oben rechts eine neue Aufgabe an."
            actionLabel="Neue Aufgabe"
            onAction={() => router.push("/aufgaben/neu")}
          />
        ) : (
          groups.map((group) => (
            <View key={group.status} className="gap-3">
              <View className="flex-row items-center justify-between">
                <Text
                  className="text-xs font-semibold uppercase"
                  style={{ color: t.colors.mutedForeground, letterSpacing: 0.5 }}
                >
                  {group.label}
                </Text>
                <Text className="text-muted-foreground text-xs">{group.tasks.length}</Text>
              </View>
              {group.tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  busy={busyId === task.id}
                  onTransition={(target) => onTransition(task, target)}
                  onEdit={() => router.push({ pathname: "/aufgaben/edit", params: { id: task.id } })}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>

      {cancelling != null ? (
        <CancelSheet
          task={cancelling}
          onClose={() => setCancelling(null)}
          onConfirm={(reason) => {
            const task = cancelling
            setCancelling(null)
            void applyTransition(task, "CANCELLED", reason)
          }}
        />
      ) : null}
    </View>
  )
}
