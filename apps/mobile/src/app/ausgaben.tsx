/**
 * Ausgaben — the Owner cost ledger. Two truths sit behind a segmented control:
 *
 *   • Fixkosten — the recurring monthly fixed costs (rent, insurance, …). Their
 *     summed active burden is exactly the number the break-even gauge on the
 *     Schatzkammer needs; this is the surface that lets the owner enter it.
 *   • Ausgaben — the one-off operating expenses (Wareneinkauf, Reparaturen, …),
 *     newest first, each carrying its category glyph + de-DE amount + date.
 *
 * Two honest KPI tiles sit above the list: the summed MONTHLY fixed burden
 * (count-up) and the one-off total booked in the CURRENT calendar month — both
 * derived only from the fetched rows, never fabricated. The header „+" opens the
 * create modal for the active tab; each row swipes right (or taps „Bearbeiten")
 * into its edit modal. Reached from the „Mehr"-Hub (/ausgaben).
 *
 * Built on the shared spine (DESIGN.md): both lists load through ONE
 * `useMultiQuery` (so the KPI tiles can read fixed + one-off totals together and
 * a single failing read never blanks the whole board — per-source honesty),
 * refetch-on-focus brings a new/edited row in on return, pull-to-refresh +
 * in-flight de-dupe come free. The four list states (skeleton / error+retry /
 * empty / content) render inside the list body so the segmented header + KPIs
 * stay mounted across every state change. Creates/edits are ADMIN + step-up
 * gated server-side; the global StepUpDialogHost fires the PIN transparently.
 * Motion: staggered list entrance, count-up KPIs, swipe-to-edit. Haptics §7:
 * selection on a segment change / row-open, the rest live in the modals.
 *
 * Honesty rule (DESIGN.md §4): every amount + every KPI is a real value from a
 * real endpoint (money in integer CENTS, formatted through `formatCents`); an
 * empty list shows the EmptyState, never a fabricated cost. de-DE money + dates;
 * all labels German; no native deps added.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import { FlatList, Pressable, RefreshControl, View } from "react-native"
import { useNavigation, useRouter } from "expo-router"
import type { ExpenseRow, FixedCostRow } from "@warehouse14/api-client"
import { Plus, Receipt, RotateCw, Wallet } from "lucide-react-native"
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
import { Text } from "@/components/ui/text"
import { formatCents, listExpenses, listFixedCosts } from "@/warehouse14/api"
import {
  activeFixedCount,
  activeFixedMonthlyCents,
  currentMonthKey,
  EXPENSE_CATEGORY_ICON,
  EXPENSE_CATEGORY_LABELS,
  expensesInMonthCents,
  expensesSummaryLine,
  FIXED_COST_STATE_LABEL,
  FIXED_COST_STATE_VARIANT,
  fixedCostState,
  fixedCostsSummaryLine,
  formatBusinessDay,
  formatMonthLabel,
  sortExpenses,
  sortFixedCosts,
} from "@/warehouse14/ausgaben-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  CountUp,
  ErrorState,
  Gesture,
  GestureDetector,
  haptics,
  hapticOnUI,
  PressableScale,
  Skeleton,
  StaggerItem,
  StatTile,
  useMultiQuery,
  useScreenInsets,
} from "@/warehouse14/ui"

type Tab = "fixkosten" | "ausgaben"

/** A list item is one of the two row kinds; `category` discriminates an
 *  ExpenseRow (the FixedCostRow has none). */
type RowItem = FixedCostRow | ExpenseRow
function isExpenseRow(row: RowItem): row is ExpenseRow {
  return "category" in row
}

// ── Segmented control ─────────────────────────────────────────────────────────
/** The Fixkosten / Ausgaben switch — a sliding brass pill over two equal cells. */
function Segmented({ value, onChange }: { value: Tab; onChange: (next: Tab) => void }) {
  const t = useW14Theme()
  const options: readonly { key: Tab; label: string }[] = [
    { key: "fixkosten", label: "Fixkosten" },
    { key: "ausgaben", label: "Ausgaben" },
  ]
  return (
    <View
      className="flex-row rounded-md border p-1"
      style={{ backgroundColor: t.colors.background, borderColor: t.colors.border }}
      accessibilityRole="tablist"
    >
      {options.map((opt) => {
        const active = value === opt.key
        return (
          <PressableScale
            key={opt.key}
            className="flex-1"
            onPress={() => {
              if (active) return
              haptics.selection()
              onChange(opt.key)
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={opt.label}
          >
            <View
              className="items-center justify-center rounded-md py-2"
              style={{
                minHeight: t.touch.min,
                backgroundColor: active ? t.colors.card : "transparent",
                borderWidth: active ? 1 : 0,
                borderColor: t.colors.border,
              }}
            >
              <Text
                className="text-sm font-semibold"
                style={{ color: active ? t.colors.foreground : t.colors.mutedForeground }}
              >
                {opt.label}
              </Text>
            </View>
          </PressableScale>
        )
      })}
    </View>
  )
}

// ── Swipe-to-edit backdrop ────────────────────────────────────────────────────
/** The calm brass „Bearbeiten" affordance revealed as a row is dragged right. */
function EditBackdrop({ progress }: { progress: SharedValue<number> }) {
  const t = useW14Theme()
  const style = useAnimatedStyle(() => {
    "worklet"
    return { opacity: progress.value }
  })
  return (
    <Animated.View
      pointerEvents="none"
      className="absolute inset-0 flex-row items-center rounded-xl px-5"
      style={[{ backgroundColor: t.colors.primary + "1f" }, style]}
    >
      <RotateCw size={t.icon.lg} color={t.colors.primary} />
      <Text className="font-semibold" style={{ color: t.colors.primary, marginLeft: 8 }}>
        Bearbeiten
      </Text>
    </Animated.View>
  )
}

/** Shared swipe-right-to-edit wrapper: drag past the threshold to open the edit
 *  modal. A downward scroll always wins; a light haptic fires on commit. */
function SwipeToEdit({ onEdit, children }: { onEdit: () => void; children: React.ReactNode }) {
  const SWIPE_THRESHOLD = 88
  const translateX = useSharedValue(0)
  const progress = useSharedValue(0)

  const commitRef = useRef(onEdit)
  commitRef.current = onEdit
  const fire = useCallback(() => commitRef.current(), [])

  const rowStyle = useAnimatedStyle(() => {
    "worklet"
    return { transform: [{ translateX: translateX.value }] }
  })

  const pan = useMemo(
    () =>
      Gesture.Pan()
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
          if (e.translationX >= SWIPE_THRESHOLD) {
            hapticOnUI("impactLight")
            runOnJS(fire)()
          }
          translateX.value = withTiming(0, { duration: 160 })
          progress.value = withTiming(0, { duration: 160 })
        }),
    [fire, translateX, progress],
  )

  return (
    <View>
      <EditBackdrop progress={progress} />
      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  )
}

// ── Fixed-cost row ────────────────────────────────────────────────────────────
function FixedCostCard({ row, onEdit }: { row: FixedCostRow; onEdit: () => void }) {
  const t = useW14Theme()
  const state = fixedCostState(row)
  const fromLabel = formatBusinessDay(row.activeFrom)
  const toLabel = row.activeTo ? formatBusinessDay(row.activeTo) : null
  const railColor =
    state === "aktiv"
      ? t.colors.verdigris
      : state === "geplant"
        ? t.colors.primary
        : t.colors.border

  return (
    <SwipeToEdit onEdit={onEdit}>
      <Pressable
        onPress={() => {
          haptics.selection()
          onEdit()
        }}
        accessibilityRole="button"
        accessibilityLabel={`Fixkosten bearbeiten: ${row.label}, ${formatCents(row.monthlyAmountCents)} monatlich`}
      >
        <Card className="overflow-hidden p-0">
          <View className="flex-row">
            <View style={{ width: 4, backgroundColor: railColor }} />
            <View className="flex-1 flex-row items-center gap-3 px-4 py-4">
              <View className="flex-1 gap-1">
                <Text className="text-base font-semibold" numberOfLines={1}>
                  {row.label}
                </Text>
                <View className="flex-row items-center gap-2">
                  <Badge variant={FIXED_COST_STATE_VARIANT[state]} dot>
                    <Text>{FIXED_COST_STATE_LABEL[state]}</Text>
                  </Badge>
                  <Text className="text-muted-foreground text-xs" numberOfLines={1}>
                    {toLabel ? `${fromLabel} – ${toLabel}` : `seit ${fromLabel}`}
                  </Text>
                </View>
              </View>
              <View className="items-end">
                <Text
                  className="font-mono-medium text-base"
                  style={{
                    color: state === "beendet" ? t.colors.mutedForeground : t.colors.foreground,
                  }}
                >
                  {formatCents(row.monthlyAmountCents)}
                </Text>
                <Text className="text-muted-foreground text-2xs">pro Monat</Text>
              </View>
            </View>
          </View>
        </Card>
      </Pressable>
    </SwipeToEdit>
  )
}

// ── One-off expense row ───────────────────────────────────────────────────────
function ExpenseCard({ row, onEdit }: { row: ExpenseRow; onEdit: () => void }) {
  const t = useW14Theme()
  const Icon = EXPENSE_CATEGORY_ICON[row.category]
  const dateLabel = formatBusinessDay(row.date)

  return (
    <SwipeToEdit onEdit={onEdit}>
      <Pressable
        onPress={() => {
          haptics.selection()
          onEdit()
        }}
        accessibilityRole="button"
        accessibilityLabel={`Ausgabe bearbeiten: ${EXPENSE_CATEGORY_LABELS[row.category]}, ${formatCents(row.amountCents)}`}
      >
        <Card className="flex-row items-center gap-3 px-4 py-4">
          <View
            className="h-10 w-10 items-center justify-center rounded-md"
            style={{ backgroundColor: t.colors.primary + "14" }}
          >
            <Icon size={t.icon.md} color={t.colors.primary} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="text-base font-semibold" numberOfLines={1}>
              {EXPENSE_CATEGORY_LABELS[row.category]}
            </Text>
            <Text className="text-muted-foreground text-xs" numberOfLines={1}>
              {row.note?.trim() ? row.note.trim() : (dateLabel ?? "")}
            </Text>
          </View>
          <View className="items-end">
            <Text className="font-mono-medium text-base">{formatCents(row.amountCents)}</Text>
            {row.note?.trim() && dateLabel ? (
              <Text className="text-muted-foreground text-2xs">{dateLabel}</Text>
            ) : null}
          </View>
        </Card>
      </Pressable>
    </SwipeToEdit>
  )
}

// ── First-load skeleton — the list's own shape, never a mid-screen spinner. ────
function RowsSkeleton() {
  return (
    <View className="gap-3 pt-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="flex-row items-center gap-3 px-4 py-4">
          <Skeleton width={40} height={40} radius="button" />
          <View className="flex-1 gap-2">
            <Skeleton width="54%" height={15} />
            <Skeleton width="34%" height={12} />
          </View>
          <Skeleton width={72} height={16} />
        </Card>
      ))}
    </View>
  )
}

// ── Honest KPI tiles (derived only from the fetched rows) ──────────────────────
function KpiTiles({
  fixed,
  expenses,
}: {
  fixed: readonly FixedCostRow[] | null
  expenses: readonly ExpenseRow[] | null
}) {
  const ym = currentMonthKey()
  const monthlyBurden = fixed != null ? activeFixedMonthlyCents(fixed) : null
  const activeCount = fixed != null ? activeFixedCount(fixed) : 0
  const thisMonth = expenses != null ? expensesInMonthCents(expenses, ym) : null
  const monthLabel = formatMonthLabel(`${ym}-01`)

  return (
    <View className="flex-row justify-between">
      {monthlyBurden != null ? (
        <CountTile
          label="Fixkosten / Monat"
          value={monthlyBurden}
          hint={`${activeCount} aktiv`}
          tone="primary"
        />
      ) : (
        <StatTile label="Fixkosten / Monat" value="—" hint="nicht verfügbar" muted />
      )}
      {thisMonth != null ? (
        <CountTile
          label="Ausgaben diesen Monat"
          value={thisMonth}
          hint={monthLabel}
          tone="accent"
        />
      ) : (
        <StatTile label="Ausgaben diesen Monat" value="—" hint="nicht verfügbar" muted />
      )}
    </View>
  )
}

/** A StatTile whose money value count-ups to the live magnitude (DESIGN.md §6 —
 *  "let it land"), kept honest by formatting through `formatCents`. */
function CountTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: number
  hint?: string
  tone: "primary" | "accent"
}) {
  const t = useW14Theme()
  const color = tone === "accent" ? t.colors.verdigris : t.colors.primary
  return (
    <Card className="gap-2 px-3 py-3" style={{ width: "48%" }}>
      <Text
        className="text-muted-foreground text-xs font-medium uppercase"
        style={{ letterSpacing: 0.4 }}
        numberOfLines={1}
      >
        {label}
      </Text>
      <CountUp
        value={value}
        format={formatCents}
        className="font-mono-medium text-2xl"
        style={{ color }}
      />
      {hint != null ? <Text className="text-muted-foreground text-2xs">{hint}</Text> : null}
    </Card>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function AusgabenScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const t = useW14Theme()
  const insets = useScreenInsets()

  const [tab, setTab] = useState<Tab>("fixkosten")

  // One fan-out read powers both tabs + the KPI tiles. Per-source honesty: a
  // failing fixed-costs read never blanks the expenses list (and vice versa).
  const q = useMultiQuery(
    {
      fixed: () => listFixedCosts({ limit: 200 }),
      expenses: () => listExpenses({ limit: 200 }),
    },
    { key: "ausgaben" },
  )

  const fixedRes = q.results.fixed
  const expensesRes = q.results.expenses

  const fixedRows = useMemo(
    () => (fixedRes.data ? sortFixedCosts(fixedRes.data.items) : null),
    [fixedRes.data],
  )
  const expenseRows = useMemo(
    () => (expensesRes.data ? sortExpenses(expensesRes.data.items) : null),
    [expensesRes.data],
  )

  // The active tab's create route.
  const createRoute = tab === "fixkosten" ? "/ausgaben/fixkosten" : "/ausgaben/ausgabe"

  // Header „+" → the create modal for the active tab.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => {
            haptics.selection()
            router.push(createRoute)
          }}
          accessibilityRole="button"
          accessibilityLabel={tab === "fixkosten" ? "Neue Fixkosten" : "Neue Ausgabe"}
          hitSlop={12}
          style={{ paddingHorizontal: 12 }}
        >
          <Plus color={t.colors.primary} size={t.icon.lg} />
        </Pressable>
      ),
    })
  }, [navigation, router, createRoute, tab, t.colors.primary, t.icon.lg])

  const onRefresh = useCallback(() => void q.refresh(), [q])

  // Sticky header — KPI tiles + the segmented control + an honest summary line.
  const header = useMemo(
    () => (
      <View className="bg-background gap-3 pb-2">
        <KpiTiles fixed={fixedRows} expenses={expenseRows} />
        <Segmented value={tab} onChange={setTab} />
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)}>
          <Text className="text-muted-foreground text-xs">
            {tab === "fixkosten"
              ? fixedRows != null && fixedRows.length > 0
                ? fixedCostsSummaryLine(fixedRows)
                : "Laufende monatliche Kosten — die Basis für den Break-even."
              : expenseRows != null && expenseRows.length > 0
                ? expensesSummaryLine(expenseRows)
                : "Einmalige Betriebsausgaben, nach Datum sortiert."}
          </Text>
        </Animated.View>
      </View>
    ),
    [tab, fixedRows, expenseRows],
  )

  // The active tab decides which rows + which per-source state we render.
  const activeRows: RowItem[] | null = tab === "fixkosten" ? fixedRows : expenseRows
  const activeRes = tab === "fixkosten" ? fixedRes : expensesRes

  const empty =
    tab === "fixkosten" ? (
      <EmptyTab
        icon={Wallet}
        title="Keine Fixkosten erfasst"
        body="Trage Miete, Versicherungen und andere laufende Kosten ein — sie bilden die Basis für deinen Break-even."
        cta="Fixkosten anlegen"
        onPress={() => router.push("/ausgaben/fixkosten")}
      />
    ) : (
      <EmptyTab
        icon={Receipt}
        title="Keine Ausgaben erfasst"
        body="Erfasse einmalige Betriebsausgaben wie Wareneinkauf oder Reparaturen — sie fließen in deinen Nettogewinn."
        cta="Ausgabe erfassen"
        onPress={() => router.push("/ausgaben/ausgabe")}
      />
    )

  return (
    <View className="flex-1 bg-background">
      <FlatList<RowItem>
        data={activeRows ?? []}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.contentBottom,
          gap: 12,
        }}
        refreshControl={
          <RefreshControl
            refreshing={q.isRefreshing}
            onRefresh={onRefresh}
            progressViewOffset={8}
          />
        }
        renderItem={({ item, index }) => (
          <StaggerItem index={Math.min(index, 8)} exit={false}>
            {isExpenseRow(item) ? (
              <ExpenseCard
                row={item}
                onEdit={() =>
                  router.push({ pathname: "/ausgaben/ausgabe", params: { id: item.id } })
                }
              />
            ) : (
              <FixedCostCard
                row={item}
                onEdit={() =>
                  router.push({ pathname: "/ausgaben/fixkosten", params: { id: item.id } })
                }
              />
            )}
          </StaggerItem>
        )}
        ListEmptyComponent={
          // First load with nothing yet → the shaped skeleton.
          q.isLoading && activeRows == null ? (
            <RowsSkeleton />
          ) : activeRes.error != null && activeRows == null ? (
            <View className="pt-6">
              <ErrorState
                message={activeRes.error}
                cause={activeRes.errorCause}
                onRetry={() => void q.refetch()}
                retrying={q.isFetching}
              />
            </View>
          ) : activeRows != null && activeRows.length === 0 ? (
            empty
          ) : null
        }
      />
    </View>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────
function EmptyTab({
  icon: Icon,
  title,
  body,
  cta,
  onPress,
}: {
  icon: typeof Wallet
  title: string
  body: string
  cta: string
  onPress: () => void
}) {
  const t = useW14Theme()
  return (
    <View className="items-center justify-center gap-3 px-6 py-12">
      <View
        className="h-16 w-16 items-center justify-center rounded-full"
        style={{
          backgroundColor: t.colors.primary + "14",
          borderColor: t.colors.border,
          borderWidth: 1,
        }}
      >
        <Icon size={t.icon.xl} color={t.colors.primary} />
      </View>
      <Text className="text-center text-base font-semibold">{title}</Text>
      <Text className="text-muted-foreground max-w-xs text-center text-sm leading-5">{body}</Text>
      <Button
        variant="outline"
        className="mt-2"
        onPress={() => {
          haptics.selection()
          onPress()
        }}
        accessibilityLabel={cta}
      >
        <Text>{cta}</Text>
      </Button>
    </View>
  )
}
