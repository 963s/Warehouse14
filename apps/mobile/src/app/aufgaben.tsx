/**
 * Aufgaben — die Owner-Aufgabenliste. Echte Aufgaben (tasksApi.list), nach Status
 * in Abschnitte gruppiert (Offen, In Arbeit, Blockiert, Erledigt, Abgebrochen).
 * Jede Zeile trägt ihren Prioritäts-Faden, das Fälligkeitsdatum, eine ruhige
 * Status-Marke und einen Satz legaler Zustandsübergänge (tasksApi.transition,
 * abgesichert über ALLOWED_TASK_TRANSITIONS). Der primäre Schritt nach vorn
 * (Starten / Erledigen / Fortsetzen) ist auch per Wisch nach rechts erreichbar;
 * die übrigen bleiben leise Umriss-Aktionen. Die Kopf-Aktion oben rechts öffnet
 * die Maske für eine neue Aufgabe (aufgaben/neu); je Zeile öffnet „Bearbeiten"
 * die Bearbeiten-Maske (aufgaben/edit). Erreichbar über den Mehr-Hub (/aufgaben).
 *
 * Form (DESIGN-SYSTEM.md): keine Kästen in Kästen. Die Liste lebt direkt auf dem
 * warmen Papier — ein ruhiger Kopf mit bespoke Listen-Siegel, eine boxlose
 * Filter-Reihe mit einem Gilt-Faden unter dem aktiven Status, und die Aufgaben
 * als nackte Zeilen, getrennt nur durch eine einzige warme Haarlinie. Jede Zeile
 * trägt vorn einen schmalen Prioritäts-/Dringlichkeits-Faden statt eines Kastens.
 * Tiefe kommt aus dem geschichteten Papier und der Linie, nie aus gestapelten
 * Karten.
 *
 * Ehrlichkeitsregel (wie Schatzkammer): jede Zeile und die Kopf-Bilanz sind echte
 * Werte aus einer echten Antwort; eine leere Liste zeigt den ehrlichen leeren
 * Zustand, nie eine erfundene Aufgabe. Übergänge sind serverseitig per Step-up
 * abgesichert — der globale StepUpDialogHost erscheint transparent und das PATCH
 * läuft nach der PIN weiter. Das Abbrechen braucht einen Grund (≥ 4 Zeichen laut
 * DB-CHECK), erfasst in einem kleinen Blatt vor dem Übergang.
 *
 * de-DE-Daten; alle Texte deutsch; keine nativen Abhängigkeiten ergänzt.
 */
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
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
import Svg, { Circle, Path } from "react-native-svg"
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

import { Button } from "@/components/ui/button"
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
  STATUS_GROUP_ORDER,
  summaryLine,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  transitionAccessibilityLabel,
  transitionActionLabel,
} from "@/warehouse14/aufgaben-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  EmptyState,
  ErrorState,
  Gesture,
  GestureDetector,
  duration,
  Hairline,
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

// ── Bespoke Listen-Siegel (react-native-svg) ──────────────────────────────────
// Ein gestempelter Ring mit einem eingravierten Häkchen: die ruhige Marke der
// Aufgabenliste. Der Ring bleibt Tinte, der Haken zieht den Gilt-Faden — Gold
// nur als Faden/Siegel (DESIGN-SYSTEM.md §1, §6).
function TaskSeal({ size = 26, ink, gilt }: { size?: number; ink: string; gilt: string }): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden>
      <Circle cx={12} cy={12} r={8.4} stroke={ink} strokeWidth={1.4} fill="none" />
      <Circle cx={12} cy={12} r={6.2} stroke={ink} strokeWidth={0.7} strokeOpacity={0.4} fill="none" />
      {/* Das Häkchen — der Gilt-Faden im Siegel. */}
      <Path
        d="M8.6 12.2 L11 14.6 L15.4 9.6"
        stroke={gilt}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  )
}

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
          KeyboardAvoidingScreen so focusing Grund lifts the whole sheet
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
              <Ban size={t.icon.lg} color={t.colors.destructive} />
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
 *  opacity tracks how far the row has travelled toward the threshold. A leading
 *  glyph + verb, on the parchment-raised step, never a heavy filled box. */
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
      className="absolute inset-0 flex-row items-center rounded-xl px-4"
      style={[{ backgroundColor: t.colors.raised }, style]}
    >
      <Icon size={t.icon.lg} color={t.colors.verdigris} />
      <Text className="font-semibold" style={{ color: t.colors.verdigris, marginLeft: 8 }}>
        {label}
      </Text>
    </Animated.View>
  )
}

// ── Aufgaben-Zeile ────────────────────────────────────────────────────────────
/** Eine Aufgabe als NACKTE Zeile auf dem Papier (kein Kasten). Vorn ein schmaler
 *  Prioritäts-/Dringlichkeits-Faden, dann Titel + Beschreibung + ruhige
 *  Fälligkeits-Meta, die Status-Marke als leiser Punkt-und-Wort, und der Satz
 *  legaler Übergänge (der primäre Schritt als gefüllte Tinten-Taste, die übrigen
 *  als leise Umriss-Aktionen). Eine lebende Zeile lässt sich nach rechts wischen,
 *  um ihren primären Schritt zu bestätigen; terminale Zeilen lesen ruhig. */
function TaskRowItem({
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
  const transitions = allowedTransitions(task.status)
  const primary = primaryTransition(task.status)
  const terminal = task.status === "DONE" || task.status === "CANCELLED"

  // The leading thread tint: a real loss-of-time signal (overdue) is destructive;
  // due-today / HIGH is the gilt thread of attention; URGENT is destructive;
  // a calm row keeps a quiet hairline thread. Gold stays a thread, never a fill.
  const threadColor = overdue
    ? t.colors.destructive
    : task.priority === "URGENT"
      ? t.colors.destructive
      : dueToday || task.priority === "HIGH"
        ? t.colors.gilt
        : t.colors.border

  // Die Status-Marke: ein kleiner Punkt + das deutsche Statuswort, getönt nach
  // Bedeutung (erledigt = verdigris, blockiert = wax-red, sonst Tinte/leise).
  const statusColor =
    task.status === "DONE"
      ? t.colors.verdigris
      : task.status === "BLOCKED"
        ? t.colors.destructive
        : task.status === "CANCELLED"
          ? t.colors.mutedForeground
          : t.colors.inkAged

  const dueColor = overdue
    ? t.colors.destructive
    : dueToday
      ? t.colors.gilt
      : t.colors.mutedForeground

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
    <Animated.View style={rowStyle} className="bg-background">
      <View
        className="flex-row gap-3 py-3.5"
        style={{ opacity: terminal ? 0.62 : 1 }}
      >
        {/* Prioritäts-/Dringlichkeits-Faden — ein schmaler Strich, kein Kasten. */}
        <View
          style={{
            width: 3,
            borderRadius: 2,
            backgroundColor: threadColor,
            marginTop: 2,
            marginBottom: 2,
          }}
        />

        <View className="flex-1 gap-1.5">
          {/* Titel-Zeile: Titel + leise Status-Marke (Punkt + Wort). */}
          <View className="flex-row items-start justify-between gap-3">
            <Text className="flex-1 text-base font-semibold leading-snug" numberOfLines={2}>
              {task.title}
            </Text>
            <View className="flex-row items-center gap-1.5 pt-0.5">
              <View
                style={{ height: 6, width: 6, borderRadius: 3, backgroundColor: statusColor }}
              />
              <Text
                className="text-2xs font-medium"
                style={{ color: statusColor, letterSpacing: 0.2 }}
                numberOfLines={1}
              >
                {TASK_STATUS_LABELS[task.status]}
              </Text>
            </View>
          </View>

          {task.description ? (
            <Text className="text-muted-foreground text-sm leading-5" numberOfLines={2}>
              {task.description}
            </Text>
          ) : null}

          {/* Leise Meta-Reihe: Fälligkeit + (nur HIGH/URGENT) ein Prioritäts-Wort. */}
          {due != null || task.priority === "HIGH" || task.priority === "URGENT" ? (
            <View className="flex-row flex-wrap items-center gap-x-2.5 gap-y-0.5 pt-0.5">
              {due != null ? (
                <View className="flex-row items-center gap-1.5">
                  <CalendarClock size={t.icon.xs} color={dueColor} />
                  <Text className="text-xs" style={{ color: dueColor }}>
                    {overdue
                      ? `Überfällig · ${due}`
                      : dueToday
                        ? `Heute fällig · ${due}`
                        : `Fällig · ${due}`}
                  </Text>
                </View>
              ) : null}
              {task.priority === "HIGH" || task.priority === "URGENT" ? (
                <View className="flex-row items-center gap-1.5">
                  <View
                    style={{
                      height: 5,
                      width: 5,
                      borderRadius: 3,
                      backgroundColor:
                        task.priority === "URGENT" ? t.colors.destructive : t.colors.gilt,
                    }}
                  />
                  <Text
                    className="text-2xs font-medium"
                    style={{
                      color:
                        task.priority === "URGENT" ? t.colors.destructive : t.colors.inkAged,
                      letterSpacing: 0.2,
                    }}
                  >
                    {TASK_PRIORITY_LABELS[task.priority]}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {error != null ? (
            <View className="pt-1">
              <InlineError message={error} onDismiss={onDismissError} />
            </View>
          ) : null}

          {transitions.length > 0 ? (
            <View className="flex-row flex-wrap items-center gap-2 pt-1.5">
              {/* Primärer Schritt nach vorn zuerst, als gefüllte Tinten-Taste. */}
              {primary != null ? (
                <Button
                  size="sm"
                  className="flex-row gap-1.5"
                  onPress={() => onTransition(primary)}
                  disabled={busy}
                  accessibilityLabel={transitionAccessibilityLabel(primary, task.title)}
                >
                  <PrimaryIcon size={t.icon.sm} color={t.colors.primaryForeground} />
                  <Text>{transitionActionLabel(primary)}</Text>
                </Button>
              ) : null}
              {/* Die übrigen legalen Schritte als leise Umriss-Aktionen. */}
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
            // Terminale Zeilen: keine Übergänge, aber Bearbeiten bleibt leise da.
            <View className="flex-row pt-1">
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

// ── Status-Filter — eine boxlose Reihe; der aktive Status trägt einen Gilt-Faden
// (DESIGN-SYSTEM.md §1: Gold als Faden/Kante). Keine Pillen, keine Kästen. ──────
function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  const t = useW14Theme()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`Filter: ${label}`}
      style={{ minHeight: t.touch.min, justifyContent: "center" }}
    >
      <View className="items-center gap-1.5 px-0.5 pb-1">
        <Text
          className="text-sm"
          style={{
            color: active ? t.colors.foreground : t.colors.mutedForeground,
            fontFamily: active ? t.fonts.semibold : t.fonts.medium,
          }}
          numberOfLines={1}
        >
          {label}
        </Text>
        {/* Der Gilt-Faden unter dem aktiven Status — Gold nur als Kante. */}
        <View
          style={{
            height: 2,
            width: "100%",
            borderRadius: 1,
            backgroundColor: active ? t.colors.gilt : "transparent",
          }}
        />
      </View>
    </Pressable>
  )
}

function StatusFilter({
  value,
  onChange,
}: {
  value: TaskStatus | null
  onChange: (next: TaskStatus | null) => void
}) {
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
      contentContainerStyle={{ gap: 18, paddingHorizontal: 16, paddingRight: 24 }}
      accessibilityRole="tablist"
      renderItem={({ item: opt }) => (
        <FilterChip
          label={opt.label}
          active={value === opt.key}
          onPress={() => {
            if (value === opt.key) return
            haptics.selection()
            onChange(opt.key)
          }}
        />
      )}
    />
  )
}

// ── First-load skeleton — die nackte Listen-Form, nie ein mittiger Spinner. ────
function TasksSkeleton() {
  return (
    <View className="pt-1" accessibilityElementsHidden>
      {Array.from({ length: 5 }).map((_, i) => (
        <View key={i}>
          {i > 0 ? <Hairline inset={16} /> : null}
          <View className="flex-row gap-3 py-3.5">
            <View style={{ width: 3 }} />
            <View className="flex-1 gap-2">
              <Skeleton width="64%" height={15} />
              <Skeleton width="46%" height={11} />
              <View className="flex-row gap-2 pt-1">
                <Skeleton width={104} height={32} radius="button" />
                <Skeleton width={88} height={32} radius="button" />
              </View>
            </View>
          </View>
        </View>
      ))}
    </View>
  )
}

// A flat, render-ready list item: either a section header or a task row, so the
// virtualised FlatList keeps the grouped layout while the header stays sticky.
type ListItem =
  | { kind: "header"; status: TaskStatus; label: string; count: number }
  | { kind: "task"; task: TaskRow; firstInGroup: boolean }

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
      g.tasks.forEach((task, i) => flat.push({ kind: "task", task, firstInGroup: i === 0 }))
    }
    return flat
  }, [groups])

  // Kopf-Aktion „Neue Aufgabe" → die Maske für eine neue Aufgabe.
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

  // Sticky header — der Kicker + das Listen-Siegel, die Filter-Reihe und eine
  // ehrliche Bilanz-Zeile, abgesetzt durch die einzige warme Haarlinie. Scrollt
  // nie weg.
  const header = useMemo(
    () => (
      <View className="bg-background gap-3 pb-2.5 pt-1">
        {/* Kicker + Titel — der Aufgaben-Faden öffnet mit dem bespoke Siegel. */}
        <View className="gap-1.5 px-4">
          <View className="flex-row items-center gap-2">
            <View style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: t.colors.gilt }} />
            <Text
              className="text-muted-foreground text-2xs font-semibold"
              style={{ letterSpacing: 1.2 }}
            >
              AUFGABENLISTE
            </Text>
          </View>
          <View className="flex-row items-center gap-2.5">
            <TaskSeal size={26} ink={t.colors.primary} gilt={t.colors.gilt} />
            <Text className="text-2xl font-display-semibold leading-tight" numberOfLines={1}>
              Aufgaben
            </Text>
          </View>
          {rows != null && rows.length > 0 ? (
            <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)}>
              <Text className="text-muted-foreground text-xs">
                {summaryLine(rows, serverTotal ?? undefined)}
              </Text>
            </Animated.View>
          ) : null}
        </View>

        {/* Die warme Haarlinie kappt den Kopf vom Filter — die einzige Linie. */}
        <View className="gap-1">
          <Hairline />
          <StatusFilter value={filter} onChange={changeFilter} />
        </View>
      </View>
    ),
    [filter, rows, serverTotal, changeFilter, t.colors.gilt, t.colors.primary],
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
      {/* The aged-paper grain canvas: depth from the layered cream plus this
          faint warm tooth, never a flat fill (DESIGN-SYSTEM.md §1, §5). */}
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
          paddingTop: 0,
        }}
        refreshControl={<RefreshControl {...rc} progressViewOffset={8} />}
        renderItem={({ item, index }) =>
          item.kind === "header" ? (
            <View
              className="flex-row items-center justify-between pb-1"
              // The first group header hugs the sticky filter bar; later headers
              // earn extra air above to separate the sections.
              style={{ paddingTop: index === 0 ? 12 : 22 }}
            >
              <Text
                className="text-muted-foreground text-2xs font-semibold"
                style={{ letterSpacing: 0.8 }}
              >
                {item.label}
              </Text>
              <Text className="text-muted-foreground font-mono text-2xs">{item.count}</Text>
            </View>
          ) : (
            <StaggerItem index={Math.min(index, 8)} exit={false}>
              {/* Eine einzige warme Haarlinie trennt die Zeilen innerhalb einer
                  Gruppe — getrennt nur durch die Linie, nie durch Karten. */}
              {!item.firstInGroup ? <Hairline inset={16} /> : null}
              <TaskRowItem
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
            <View className="pt-6">
              <EmptyState
                icon={ListChecks}
                title={
                  filter != null ? `Keine Aufgaben ${TASK_STATUS_LABELS[filter]}` : "Keine Aufgaben"
                }
                description={
                  filter != null
                    ? "In diesem Status liegt gerade nichts. Wähle Alle oder lege eine neue Aufgabe an."
                    : "Lege über das Plus oben rechts eine neue Aufgabe an."
                }
                actionLabel="Neue Aufgabe"
                onAction={() => {
                  haptics.selection()
                  router.push("/aufgaben/neu")
                }}
              />
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
