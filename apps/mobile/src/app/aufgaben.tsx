/**
 * Aufgaben — the Owner to-do list. Real tasks (tasksApi.list) grouped by status
 * into labelled sections (Offen, In Arbeit, Blockiert, Erledigt, Abgebrochen),
 * each row carrying its priority accent, due date, a dotted status badge and a
 * one-tap set of legal state-machine transitions (tasksApi.transition, gated by
 * ALLOWED_TASK_TRANSITIONS). The primary forward move (Starten / Erledigen /
 * Fortsetzen) is also reachable by swiping the row right; the rest stay quiet
 * outline actions. A header „Neue Aufgabe"-Aktion opens the create modal
 * (aufgaben/neu); each row's „Bearbeiten" opens the edit modal (aufgaben/edit).
 * Reached from the „Mehr"-Hub (/aufgaben).
 *
 * Built on the shared spine (DESIGN.md): live data through `useQuery` (re-keyed
 * on the active status filter, refetch-on-focus, pull-to-refresh via
 * `useRefreshControl`), one-tap transitions through `useMutation` (the row spins
 * on `busyId`, then the list refetches so badge + grouping reflect server truth,
 * never a guessed local state), the spine's `InlineError` pinned to the failing
 * row, a staggered list entrance, and the §7 haptic vocabulary (selection on a
 * filter / forward step, Light on opening the cancel sheet, Success on a
 * committed transition, Error on a refusal). The filter chips + honest summary
 * sit in a sticky header that never scrolls away; the four list states (skeleton
 * / error+retry / empty / content) render inside the list body so the header
 * stays mounted across every state change.
 *
 * Honesty rule (mirrors Schatzkammer): every row + the summary line are
 * real values from a real endpoint; an empty list shows the EmptyState, never a
 * fabricated to-do. Transitions are step-up gated server-side — the global
 * StepUpDialogHost fires transparently and the middleware retries the PATCH after
 * the PIN. Cancelling needs a reason (≥ 4 chars per the DB CHECK), collected in a
 * small sheet before the transition is sent.
 *
 * de-DE dates; all labels German; no native deps added.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  View,
} from "react-native"
import { useNavigation, useRouter } from "expo-router"
import type { TaskRow, TaskStatus } from "@warehouse14/api-client"
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CalendarClock,
  CheckCircle2,
  ListChecks,
  ListPlus,
  PlayCircle,
  RotateCcw,
} from "lucide-react-native"
import Animated, {
  FadeIn,
  FadeOut,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated"

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
  isDueToday,
  isOverdue,
  primaryTransition,
  priorityBadgeVariant,
  STATUS_BADGE_VARIANT,
  STATUS_GROUP_ORDER,
  summaryLine,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  transitionAccessibilityLabel,
  transitionActionLabel,
} from "@/warehouse14/aufgaben-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  ErrorState,
  Gesture,
  GestureDetector,
  duration,
  haptics,
  hapticOnUI,
  InlineError,
  PaperGrain,
  PressableScale,
  Skeleton,
  StaggerItem,
  useMutation,
  useQuery,
  useRefreshControl,
  useScreenInsets,
} from "@/warehouse14/ui"

// The matched glyph for a transition target — the action it performs, not the
// resulting noun. Forward steps get a confident filled glyph; reopen/cancel a
// quieter one.
function transitionIcon(target: TaskStatus) {
  switch (target) {
    case "IN_PROGRESS":
      return PlayCircle
    case "DONE":
      return CheckCircle2
    case "BLOCKED":
      return AlertTriangle
    case "OPEN":
      return RotateCcw
    case "CANCELLED":
      return Ban
    default:
      return ArrowRight
  }
}

// ── Cancellation reason sheet ─────────────────────────────────────────────────
/** A spine-native bottom sheet collecting the mandatory cancellation reason
 *  (≥ 4 chars, per the backend DB CHECK) before a task moves to CANCELLED.
 *  Grabber + brass header + tap-scrim-to-dismiss + InlineError, comfortable
 *  48px actions off the home indicator. Opens with the Light press haptic. */
function CancelSheet({
  task,
  busy,
  onClose,
  onConfirm,
}: {
  task: TaskRow
  busy: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  const t = useW14Theme()
  const insets = useScreenInsets()
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  function submit() {
    const trimmed = reason.trim()
    if (trimmed.length < 4) {
      haptics.error()
      setError("Bitte mindestens 4 Zeichen angeben.")
      return
    }
    onConfirm(trimmed)
  }

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      {/* Keyboard avoidance, same per-platform behavior as the spine's
          KeyboardAvoidingScreen so focusing Grund" lifts the whole sheet
          (input + Zurück/Abbrechen) clear of the keyboard on small screens. */}
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
                style={{ backgroundColor: t.colors.destructive + "1f" }}
              >
                <Ban size={t.icon.md} color={t.colors.destructive} />
              </View>
              <View className="flex-1">
                <Text className="text-lg font-display-semibold leading-tight">
                  Aufgabe abbrechen
                </Text>
                <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                  {task.title}
                </Text>
              </View>
            </View>

            {error != null ? <InlineError message={error} /> : null}

            <View className="gap-1.5">
              <Text className="text-sm font-medium">Grund</Text>
              <Input
                value={reason}
                onChangeText={(v) => {
                  setReason(v)
                  if (error) setError(null)
                }}
                placeholder="z. B. Nicht mehr nötig"
                autoCapitalize="sentences"
                accessibilityLabel="Grund für den Abbruch"
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
                <Text>Zurück</Text>
              </Button>
              <Button
                variant="destructive"
                size="lg"
                className="h-12 flex-1"
                onPress={submit}
                disabled={busy}
              >
                <Text>{busy ? "Breche ab…" : "Abbrechen"}</Text>
              </Button>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ── Swipe-to-act backdrop ─────────────────────────────────────────────────────
/** The verdigris "Erledigen / Starten" affordance revealed behind a row as it is
 *  dragged right — the calm hint that the swipe commits the forward step. Its
 *  opacity tracks how far the row has travelled toward the threshold. */
function SwipeBackdrop({
  progress,
  label,
  Icon,
}: {
  progress: SharedValue<number>
  label: string
  Icon: ReturnType<typeof transitionIcon>
}) {
  const t = useW14Theme()
  const style = useAnimatedStyle(() => {
    "worklet"
    return { opacity: progress.value }
  })
  return (
    <Animated.View
      pointerEvents="none"
      className="absolute inset-0 flex-row items-center rounded-xl px-5"
      style={[{ backgroundColor: t.colors.verdigris + "26" }, style]}
    >
      <Icon size={t.icon.lg} color={t.colors.verdigris} />
      <Text className="font-semibold" style={{ color: t.colors.verdigris, marginLeft: 8 }}>
        {label}
      </Text>
    </Animated.View>
  )
}

// ── Task row ──────────────────────────────────────────────────────────────────
/** One task row: a leading priority accent rail, the title + description + due
 *  meta, a dotted status badge, and the one-tap action strip (the primary
 *  forward move as a filled brass button, the rest as outline). A live row can
 *  also be swiped right to commit its primary move; terminal rows read quietly. */
function TaskCard({
  task,
  busy,
  error,
  onTransition,
  onEdit,
  onDismissError,
}: {
  task: TaskRow
  busy: boolean
  error: string | null
  onTransition: (target: TaskStatus) => void
  onEdit: () => void
  onDismissError: () => void
}) {
  const t = useW14Theme()
  const due = formatDueDate(task.dueDate)
  const overdue = isOverdue(task)
  const dueToday = isDueToday(task)
  const priorityVariant = priorityBadgeVariant(task.priority)
  const transitions = allowedTransitions(task.status)
  const primary = primaryTransition(task.status)

  // The accent rail tint: a real loss-of-time signal (overdue) is destructive;
  // due-today is brass attention; otherwise the priority drives it (urgent red,
  // high brass), and a calm row gets a hairline border tint.
  const railColor = overdue
    ? t.colors.destructive
    : task.priority === "URGENT"
      ? t.colors.destructive
      : dueToday || task.priority === "HIGH"
        ? t.colors.primary
        : t.colors.border

  // Swipe-to-act: drag right past the threshold to commit the primary move.
  const SWIPE_THRESHOLD = 96
  const translateX = useSharedValue(0)
  const progress = useSharedValue(0)
  const PrimaryIcon = primary != null ? transitionIcon(primary) : ArrowRight
  const canSwipe = primary != null && !busy

  const rowStyle = useAnimatedStyle(() => {
    "worklet"
    return { transform: [{ translateX: translateX.value }] }
  })

  // The forward step to commit when the swipe passes the threshold. Held in a
  // ref so the gesture's worklet always calls the latest handler without
  // rebuilding the gesture on every render.
  const commitRef = useRef<() => void>(() => {})
  commitRef.current = () => {
    if (primary != null) onTransition(primary)
  }
  const fireCommit = useCallback(() => commitRef.current(), [])

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(canSwipe)
        // Engage only on a clear rightward drag; let a downward scroll win.
        .activeOffsetX([-9999, 12])
        .failOffsetY([-12, 12])
        .onUpdate((e) => {
          "worklet"
          const x = Math.max(0, Math.min(e.translationX, SWIPE_THRESHOLD * 1.4))
          translateX.value = x
          progress.value = Math.min(1, x / SWIPE_THRESHOLD)
        })
        .onEnd((e) => {
          "worklet"
          const passed = e.translationX >= SWIPE_THRESHOLD
          if (passed) {
            hapticOnUI("impactLight")
            runOnJS(fireCommit)()
          }
          translateX.value = withTiming(0, { duration: duration.fast })
          progress.value = withTiming(0, { duration: duration.fast })
        }),
    [canSwipe, fireCommit, translateX, progress],
  )

  const body = (
    <Animated.View style={rowStyle}>
      <Card className="overflow-hidden p-0">
        <View className="flex-row">
          {/* Priority / urgency accent rail. */}
          <View style={{ width: 4, backgroundColor: railColor }} />

          <View className="flex-1 gap-3 px-4 py-4">
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
                      size={t.icon.xs}
                      color={
                        overdue
                          ? t.colors.destructive
                          : dueToday
                            ? t.colors.primary
                            : t.colors.mutedForeground
                      }
                    />
                    <Text
                      className="text-sm"
                      style={{
                        color: overdue
                          ? t.colors.destructive
                          : dueToday
                            ? t.colors.primary
                            : t.colors.mutedForeground,
                      }}
                    >
                      {overdue
                        ? `Überfällig · ${due}`
                        : dueToday
                          ? `Heute fällig · ${due}`
                          : `Fällig · ${due}`}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View className="items-end gap-1.5">
                <Badge variant={STATUS_BADGE_VARIANT[task.status]} dot>
                  <Text>{TASK_STATUS_LABELS[task.status]}</Text>
                </Badge>
                {priorityVariant != null ? (
                  <Badge variant={priorityVariant}>
                    <Text>{TASK_PRIORITY_LABELS[task.priority]}</Text>
                  </Badge>
                ) : null}
              </View>
            </View>

            {error != null ? <InlineError message={error} onDismiss={onDismissError} /> : null}

            {transitions.length > 0 ? (
              <View className="flex-row flex-wrap gap-2">
                {/* Primary forward move first, as a filled brass button. */}
                {primary != null ? (
                  <Button
                    size="sm"
                    className="grow flex-row gap-1.5"
                    onPress={() => onTransition(primary)}
                    disabled={busy}
                    accessibilityLabel={transitionAccessibilityLabel(primary, task.title)}
                  >
                    <PrimaryIcon size={t.icon.sm} color={t.colors.primaryForeground} />
                    <Text>{transitionActionLabel(primary)}</Text>
                  </Button>
                ) : null}
                {/* The remaining legal moves as quiet outline actions. */}
                {transitions
                  .filter((target) => target !== primary)
                  .map((target) => {
                    const Icon = transitionIcon(target)
                    return (
                      <Button
                        key={target}
                        size="sm"
                        variant="outline"
                        className="flex-row gap-1.5"
                        onPress={() => onTransition(target)}
                        disabled={busy}
                        accessibilityLabel={transitionAccessibilityLabel(target, task.title)}
                      >
                        <Icon
                          size={t.icon.sm}
                          color={
                            target === "CANCELLED" ? t.colors.destructive : t.colors.foreground
                          }
                        />
                        <Text>{transitionActionLabel(target)}</Text>
                      </Button>
                    )
                  })}
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={onEdit}
                  disabled={busy}
                  accessibilityLabel={`Aufgabe bearbeiten: ${task.title}`}
                >
                  <Text>Bearbeiten</Text>
                </Button>
              </View>
            ) : (
              // Terminal rows: no transitions, but edit is still reachable quietly.
              <View className="flex-row">
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={onEdit}
                  disabled={busy}
                  accessibilityLabel={`Aufgabe bearbeiten: ${task.title}`}
                >
                  <Text>Bearbeiten</Text>
                </Button>
              </View>
            )}
          </View>
        </View>
      </Card>
    </Animated.View>
  )

  if (!canSwipe) return body

  return (
    <View>
      <SwipeBackdrop
        progress={progress}
        label={transitionActionLabel(primary!)}
        Icon={PrimaryIcon}
      />
      <GestureDetector gesture={pan}>{body}</GestureDetector>
    </View>
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
    <FlatList
      horizontal
      data={options}
      keyExtractor={(opt) => opt.key ?? "ALL"}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 2 }}
      renderItem={({ item: opt }) => {
        const active = value === opt.key
        return (
          <PressableScale
            onPress={() => {
              haptics.selection()
              onChange(opt.key)
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Filter: ${opt.label}`}
          >
            <View
              className="rounded-full border px-3.5 py-1.5"
              style={{
                borderColor: active ? t.colors.primary : t.colors.border,
                backgroundColor: active ? t.colors.primary : t.colors.card,
              }}
            >
              <Text
                className="text-sm font-medium"
                style={{ color: active ? t.colors.primaryForeground : t.colors.foreground }}
              >
                {opt.label}
              </Text>
            </View>
          </PressableScale>
        )
      }}
    />
  )
}

// ── First-load skeleton — the list's own shape, never a mid-screen spinner. ────
function TasksSkeleton() {
  return (
    <View className="gap-3 pt-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <Card key={i} className="gap-3 px-4 py-4">
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1 gap-2">
              <Skeleton width="62%" height={15} />
              <Skeleton width="44%" height={12} />
            </View>
            <Skeleton width={72} height={22} radius="button" />
          </View>
          <View className="flex-row gap-2">
            <Skeleton width={112} height={36} radius="button" />
            <Skeleton width={96} height={36} radius="button" />
          </View>
        </Card>
      ))}
    </View>
  )
}

// A flat, render-ready list item: either a section header or a task row, so the
// virtualised FlatList keeps the grouped layout while the header stays sticky.
type ListItem =
  | { kind: "header"; status: TaskStatus; label: string; count: number }
  | { kind: "task"; task: TaskRow }

// The list pages by `offset`, since `internal_tasks` is never pruned (forensic +
// GoBD-relevant) and can outgrow a single page. 200 is the endpoint's max limit.
const TASKS_PAGE_SIZE = 200

// ── Screen ────────────────────────────────────────────────────────────────────
export default function AufgabenScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const t = useW14Theme()
  const insets = useScreenInsets()

  const [filter, setFilter] = useState<TaskStatus | null>(null)
  // Per-row write state — the id currently mutating, and the last per-row error.
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null)
  const [cancelling, setCancelling] = useState<TaskRow | null>(null)

  // The FIRST page is the live read, re-keyed on the active filter. `useQuery`
  // already refetches on focus (so a new/edited task from the modals shows on
  // return) and de-dupes in-flight reads; pull-to-refresh comes free.
  const tasks = useQuery(
    () => listTasks({ ...(filter ? { status: filter } : {}), limit: TASKS_PAGE_SIZE, offset: 0 }),
    { key: `tasks:${filter ?? "all"}` },
  )
  const rc = useRefreshControl(tasks)

  // Pages BEYOND the first, fetched lazily on scroll. `internal_tasks` is never
  // pruned (forensic + GoBD-relevant), so the table can outgrow one 200-row
  // page; without this, rows past 200 would silently vanish from the list and
  // the summary would under-count. The base query owns page 0; this owns 1..N.
  const [extraRows, setExtraRows] = useState<TaskRow[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState(false)
  // The base page's identity — bumps on every fresh page-0 response (filter
  // change, focus refetch, pull-to-refresh). When it changes, the accumulated
  // tail is stale and must be dropped so we never splice old pages onto new.
  const basePage = tasks.data
  useEffect(() => {
    setExtraRows([])
    setLoadMoreError(false)
  }, [basePage])

  const serverTotal = basePage?.total ?? null
  const rows = useMemo<TaskRow[] | null>(() => {
    if (!basePage) return null
    return extraRows.length > 0 ? [...basePage.items, ...extraRows] : basePage.items
  }, [basePage, extraRows])

  // More rows exist on the server than we've loaded into `rows` so far.
  const hasMore = serverTotal != null && rows != null && rows.length < serverTotal

  // Fetch ONE more page at the current tail and append it. Shared by the
  // scroll-driven `loadMore` and the footer's "Erneut versuchen". The offset is
  // the count we already hold, so it always asks for the next unseen slice.
  const fetchNextPage = useCallback(async () => {
    if (rows == null) return
    const offset = rows.length
    setLoadingMore(true)
    setLoadMoreError(false)
    try {
      const page = await listTasks({
        ...(filter ? { status: filter } : {}),
        limit: TASKS_PAGE_SIZE,
        offset,
      })
      setExtraRows((prev) => [...prev, ...page.items])
    } catch {
      // A failed tail page is non-fatal — page 0 still shows. Surface a quiet
      // retriable footer rather than blowing up the whole list.
      setLoadMoreError(true)
      haptics.error()
    } finally {
      setLoadingMore(false)
    }
  }, [rows, filter])

  const loadMore = useCallback(() => {
    // Guard: nothing more to load, already loading, or a prior page errored
    // (don't hammer on scroll — the footer's retry button is the way back).
    if (!hasMore || loadingMore || loadMoreError) return
    void fetchNextPage()
  }, [hasMore, loadingMore, loadMoreError, fetchNextPage])

  const retryLoadMore = useCallback(() => {
    if (loadingMore) return
    haptics.selection()
    void fetchNextPage()
  }, [loadingMore, fetchNextPage])

  const groups = useMemo(() => (rows ? groupByStatus(rows) : []), [rows])

  // Flatten the groups into header + task items for the virtualised list.
  const items = useMemo<ListItem[]>(() => {
    const flat: ListItem[] = []
    for (const g of groups) {
      flat.push({ kind: "header", status: g.status, label: g.label, count: g.tasks.length })
      for (const task of g.tasks) flat.push({ kind: "task", task })
    }
    return flat
  }, [groups])

  // Header „Neue Aufgabe"-Aktion → the create modal.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => {
            haptics.selection()
            router.push("/aufgaben/neu")
          }}
          accessibilityRole="button"
          accessibilityLabel="Neue Aufgabe"
          hitSlop={12}
          style={{ paddingHorizontal: 12 }}
        >
          <ListPlus color={t.colors.primary} size={t.icon.lg} />
        </Pressable>
      ),
    })
  }, [navigation, router, t.colors.primary, t.icon.lg])

  // One mutation drives every status write (advance / block / reopen / cancel).
  // It carries the full body so cancel can attach a reason; the row id raises
  // `busyId` for the spinner, and on success the list refetches for server truth.
  const transition = useMutation(
    (vars: { id: string; body: { status: TaskStatus; cancellationReason?: string } }) =>
      transitionTask(vars.id, vars.body),
    {
      onSuccess: () => {
        haptics.success()
        void tasks.refetch()
      },
      onError: (e, vars) => {
        haptics.error()
        setRowError({ id: vars.id, message: describeError(e) })
      },
      onSettled: () => setBusyId(null),
    },
  )

  const applyTransition = useCallback(
    (task: TaskRow, target: TaskStatus, cancellationReason?: string) => {
      setRowError(null)
      setBusyId(task.id)
      // 403 STEP_UP_REQUIRED → the global host opens the PIN + retries the PATCH.
      void transition
        .mutate({
          id: task.id,
          body: { status: target, ...(cancellationReason ? { cancellationReason } : {}) },
        })
        .catch(() => {})
    },
    [transition],
  )

  const onTransition = useCallback(
    (task: TaskRow, target: TaskStatus) => {
      // CANCELLED needs a mandatory reason — collect it in the sheet first.
      if (target === "CANCELLED") {
        haptics.impactLight()
        setRowError(null)
        setCancelling(task)
        return
      }
      applyTransition(task, target)
    },
    [applyTransition],
  )

  const changeFilter = useCallback((next: TaskStatus | null) => {
    setRowError(null)
    setFilter(next)
  }, [])

  // Sticky header — the filter chips and an honest summary line derived only
  // from the fetched rows. Never scrolls away.
  const header = useMemo(
    () => (
      <View className="bg-background border-border gap-2 border-b pb-2.5 pt-2">
        <StatusFilter value={filter} onChange={changeFilter} />
        {rows != null && rows.length > 0 ? (
          <Animated.View
            entering={FadeIn.duration(160)}
            exiting={FadeOut.duration(160)}
            className="px-4"
          >
            <Text className="text-muted-foreground text-xs">
              {summaryLine(rows, serverTotal ?? undefined)}
            </Text>
          </Animated.View>
        ) : null}
      </View>
    ),
    [filter, rows, serverTotal, changeFilter],
  )

  // The list footer: a quiet "loading the next page" spinner while a tail page
  // is in flight, or a retriable line when one failed. Nothing while idle.
  const footer = useMemo(() => {
    if (loadMoreError) {
      return (
        <View className="items-center gap-2 px-4 py-5">
          <Text className="text-muted-foreground text-center text-xs">
            Weitere Aufgaben konnten nicht geladen werden.
          </Text>
          <Button
            variant="outline"
            size="sm"
            onPress={retryLoadMore}
            accessibilityLabel="Erneut versuchen"
          >
            <Text>Erneut versuchen</Text>
          </Button>
        </View>
      )
    }
    if (loadingMore) {
      return (
        <View className="items-center py-5">
          <ActivityIndicator color={t.colors.mutedForeground} />
        </View>
      )
    }
    return null
  }, [loadMoreError, loadingMore, retryLoadMore, t.colors.mutedForeground])

  return (
    <View className="flex-1 bg-background">
      {/* The aged-paper grain canvas depth from the layered cream plus this
          faint warm tooth, never a flat fill (DESIGN.md §1, §5). */}
      <PaperGrain />
      <FlatList
        data={items}
        keyExtractor={(it) => (it.kind === "header" ? `h:${it.status}` : `t:${it.task.id}`)}
        stickyHeaderIndices={[0]}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: insets.contentBottom,
          paddingTop: 12,
          gap: 12,
        }}
        refreshControl={<RefreshControl {...rc} progressViewOffset={8} />}
        renderItem={({ item, index }) =>
          item.kind === "header" ? (
            <View
              className="flex-row items-center justify-between pb-0.5"
              // The first group header hugs the sticky filter bar; later headers
              // earn a little extra air above to separate the sections.
              style={{ paddingTop: index === 0 ? 0 : 8 }}
            >
              <Text
                className="text-muted-foreground text-2xs font-semibold uppercase"
                style={{ letterSpacing: 0.5 }}
              >
                {item.label}
              </Text>
              <Text className="text-muted-foreground text-2xs">{item.count}</Text>
            </View>
          ) : (
            <StaggerItem index={Math.min(index, 8)} exit={false}>
              <TaskCard
                task={item.task}
                busy={busyId === item.task.id}
                error={rowError?.id === item.task.id ? rowError.message : null}
                onTransition={(target) => onTransition(item.task, target)}
                onEdit={() =>
                  router.push({ pathname: "/aufgaben/edit", params: { id: item.task.id } })
                }
                onDismissError={() => setRowError(null)}
              />
            </StaggerItem>
          )
        }
        ListEmptyComponent={
          // First load with nothing yet → the shaped skeleton.
          tasks.status === "loading" && rows == null ? (
            <TasksSkeleton />
          ) : tasks.status === "error" && rows == null ? (
            <View className="pt-6">
              <ErrorState
                message={tasks.error ?? describeError(tasks.errorCause)}
                cause={tasks.errorCause}
                onRetry={() => void tasks.refetch()}
                retrying={tasks.isFetching}
              />
            </View>
          ) : rows != null && rows.length === 0 ? (
            <View className="items-center justify-center gap-3 px-6 py-12">
              <View
                className="h-16 w-16 items-center justify-center rounded-full"
                style={{
                  backgroundColor: t.colors.raised,
                  borderColor: t.colors.border,
                  borderWidth: 1,
                }}
              >
                <ListChecks size={t.icon.xl} color={t.colors.primary} />
              </View>
              <Text className="text-center text-xl font-display-semibold leading-tight">
                {filter != null
                  ? `Keine Aufgaben ${TASK_STATUS_LABELS[filter]}`
                  : "Keine Aufgaben"}
              </Text>
              <Text className="text-muted-foreground max-w-xs text-center text-sm leading-5">
                {filter != null
                  ? "In diesem Status liegt gerade nichts. Wähle Alle oder lege eine neue Aufgabe an."
                  : "Lege über das Plus oben rechts eine neue Aufgabe an."}
              </Text>
              <Button
                variant="outline"
                className="mt-2"
                onPress={() => {
                  haptics.selection()
                  router.push("/aufgaben/neu")
                }}
                accessibilityLabel="Neue Aufgabe"
              >
                <Text>Neue Aufgabe</Text>
              </Button>
            </View>
          ) : null
        }
      />

      {cancelling != null ? (
        <CancelSheet
          task={cancelling}
          busy={busyId === cancelling.id}
          onClose={() => setCancelling(null)}
          onConfirm={(reason) => {
            const task = cancelling
            setCancelling(null)
            applyTransition(task, "CANCELLED", reason)
          }}
        />
      ) : null}
    </View>
  )
}
