/**
 * Ausgaben — the Owner cost ledger. Two truths sit behind a segmented control:
 *
 *   • Fixkosten — the recurring monthly fixed costs (rent, insurance, …). Their
 *     summed active burden is exactly the number the break-even gauge on the
 *     Schatzkammer needs; this is the surface that lets the owner enter it.
 *   • Ausgaben — the one-off operating expenses (Wareneinkauf, Reparaturen, …),
 *     newest first, each carrying its category glyph + de-DE amount + date.
 *
 * One honest KPI band sits above the list: the summed MONTHLY fixed burden
 * (count-up) and the one-off total booked in the CURRENT calendar month — both
 * derived only from the fetched rows, never fabricated. The band is a single
 * bare two-column ledger split by ONE warm vertical hairline — not two stacked
 * cards. The header „+" opens the create modal for the active tab; each row
 * swipes right (or taps) into its edit modal. Reached from the „Mehr"-Hub.
 *
 * Composition (DESIGN-SYSTEM.md §1, §9 — the one-line test): the whole screen
 * is bare rows on warm parchment, separated by a single inset hairline, never
 * boxes inside boxes. Depth comes from the layered cream + the grain tooth + the
 * one rule, never from stacked card shadows. The gilt diamond kicker + the brass
 * status seal are the only gold; functional verdigris/wax flag meaning only.
 *
 * Built on the shared spine (DESIGN.md): both lists load through ONE
 * `useMultiQuery` (so the band can read fixed + one-off totals together and a
 * single failing read never blanks the whole board — per-source honesty),
 * refetch-on-focus brings a new/edited row in on return, pull-to-refresh +
 * in-flight de-dupe come free. The four list states (skeleton / error+retry /
 * empty / content) render inside the list body so the band + segment stay
 * mounted across every state change. Creates/edits are ADMIN + step-up gated
 * server-side; the global StepUpDialogHost fires the PIN transparently.
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
import Svg, { Path } from "react-native-svg"

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
  fixedCostState,
  type FixedCostState,
  fixedCostsSummaryLine,
  formatBusinessDay,
  formatMonthLabel,
  sortExpenses,
  sortFixedCosts,
} from "@/warehouse14/ausgaben-ui"
import { useW14Theme } from "@/warehouse14/theme"
import {
  CountUp,
  EmptyState,
  ErrorState,
  Gesture,
  GestureDetector,
  Hairline,
  duration,
  haptics,
  hapticOnUI,
  PaperGrain,
  PressableScale,
  Skeleton,
  StaggerItem,
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

// ── Diamond kicker ────────────────────────────────────────────────────────────
/** The bespoke gilt diamond ◆ that opens a region (DESIGN-SYSTEM.md §6: every
 *  section opens with a gold diamond + a small-caps line). A tiny react-native-svg
 *  rhombus, the ONLY gold on the band — a seal, never a fill. */
function GiltDiamond({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" accessibilityElementsHidden>
      <Path d="M6 0 L12 6 L6 12 L0 6 Z" fill={color} />
    </Svg>
  )
}

/** A small-caps tracked eyebrow opened by the gilt diamond — the region kicker. */
function Kicker({ label }: { label: string }) {
  const t = useW14Theme()
  return (
    <View className="flex-row items-center gap-2">
      <GiltDiamond size={8} color={t.colors.gilt} />
      <Text
        className="text-muted-foreground text-2xs font-semibold uppercase"
        style={{ letterSpacing: 1.4 }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  )
}

// ── Honest KPI band (one bare ledger, split by ONE hairline — not two cards) ────
/**
 * The two truths the break-even needs sit side by side on the bare parchment,
 * divided by a single warm vertical rule. No card box around either: the layered
 * cream + the grain carry the ground, the hairline carries the split. Each side
 * count-ups its live magnitude, formatted through `formatCents` so it stays
 * honest; a missing source shows „—" rather than a fabricated zero.
 */
function KpiBand({
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
    <View className="gap-3">
      <Kicker label="Kostenübersicht" />
      <View className="flex-row items-stretch">
        <KpiCell
          label="Fixkosten / Monat"
          value={monthlyBurden}
          hint={monthlyBurden != null ? `${activeCount} aktiv` : "nicht verfügbar"}
          tone="primary"
        />
        {/* The ONE warm rule that splits the band — depth from a hairline, not a box. */}
        <View className="px-4">
          <Hairline vertical />
        </View>
        <KpiCell
          label="Ausgaben diesen Monat"
          value={thisMonth}
          hint={thisMonth != null ? monthLabel : "nicht verfügbar"}
          tone="accent"
        />
      </View>
      <Hairline />
    </View>
  )
}

/** One ledger column: caption · big mono count-up value · faint hint. Bare on
 *  parchment. `null` → an honest dim „—" (live source unavailable). */
function KpiCell({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: number | null
  hint: string
  tone: "primary" | "accent"
}) {
  const t = useW14Theme()
  const color =
    value == null
      ? t.colors.mutedForeground
      : tone === "accent"
        ? t.colors.verdigris
        : t.colors.foreground
  return (
    <View className="flex-1 gap-1.5">
      <Text
        className="text-muted-foreground text-2xs font-medium uppercase"
        style={{ letterSpacing: 0.8 }}
        numberOfLines={1}
      >
        {label}
      </Text>
      {value != null ? (
        <CountUp
          value={value}
          format={formatCents}
          motion="timing"
          className="font-mono-medium text-2xl leading-tight"
          style={{ color }}
        />
      ) : (
        <Text className="font-mono-medium text-2xl leading-tight" style={{ color }}>
          —
        </Text>
      )}
      <Text className="text-muted-foreground text-2xs" numberOfLines={1}>
        {hint}
      </Text>
    </View>
  )
}

// ── Segmented control ─────────────────────────────────────────────────────────
/** The Fixkosten / Ausgaben switch — two equal cells on a single hairline track,
 *  the active cell lifted onto the lighter parchment leaf. No nested border box. */
function Segmented({ value, onChange }: { value: Tab; onChange: (next: Tab) => void }) {
  const t = useW14Theme()
  const options: readonly { key: Tab; label: string }[] = [
    { key: "fixkosten", label: "Fixkosten" },
    { key: "ausgaben", label: "Ausgaben" },
  ]
  return (
    <View
      className="flex-row rounded-md p-1"
      style={{ backgroundColor: t.colors.raised }}
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
/** The calm „Bearbeiten" affordance revealed as a row is dragged right. Sits on
 *  the deeper parchment-3 leaf (a step down), no card edge. */
function EditBackdrop({ progress }: { progress: SharedValue<number> }) {
  const t = useW14Theme()
  const style = useAnimatedStyle(() => {
    "worklet"
    return { opacity: progress.value }
  })
  return (
    <Animated.View
      pointerEvents="none"
      className="absolute inset-0 flex-row items-center rounded-md px-4"
      style={[{ backgroundColor: t.colors.raised }, style]}
    >
      <RotateCw size={t.icon.md} color={t.colors.primary} />
      <Text className="ml-2 font-semibold" style={{ color: t.colors.foreground }}>
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
          translateX.value = withTiming(0, { duration: duration.fast })
          progress.value = withTiming(0, { duration: duration.fast })
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

/** The status tint for a fixed-cost row: a quiet seal dot, meaning only. */
function fixedStateColor(state: FixedCostState, t: ReturnType<typeof useW14Theme>): string {
  return state === "aktiv"
    ? t.colors.verdigris
    : state === "geplant"
      ? t.colors.gilt
      : t.colors.mutedForeground
}

// ── Fixed-cost row (bare on parchment) ────────────────────────────────────────
/** A recurring fixed cost as a bare ledger line: a small state seal · the label
 *  + its run window · the monthly amount in mono. No card, no rail box — the row
 *  sits on the canvas and the list hairline divides it from the next. */
function FixedCostRowItem({ row, onEdit }: { row: FixedCostRow; onEdit: () => void }) {
  const t = useW14Theme()
  const state = fixedCostState(row)
  const fromLabel = formatBusinessDay(row.activeFrom)
  const toLabel = row.activeTo ? formatBusinessDay(row.activeTo) : null
  const seal = fixedStateColor(state, t)
  const ended = state === "beendet"

  return (
    <SwipeToEdit onEdit={onEdit}>
      <PressableScale
        onPress={() => {
          haptics.selection()
          onEdit()
        }}
        accessibilityRole="button"
        accessibilityLabel={`Fixkosten bearbeiten: ${row.label}, ${formatCents(row.monthlyAmountCents)} monatlich, ${FIXED_COST_STATE_LABEL[state]}`}
        style={{ backgroundColor: t.colors.background }}
      >
        <View className="min-h-[56px] flex-row items-center gap-3 py-3">
          {/* The seal dot — the calm way to flag state without a badge box. */}
          <View
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: seal, opacity: ended ? 0.55 : 1 }}
          />
          <View className="flex-1 gap-0.5" style={ended ? { opacity: 0.7 } : undefined}>
            <Text className="text-base font-semibold" numberOfLines={1}>
              {row.label}
            </Text>
            <Text className="text-muted-foreground text-xs" numberOfLines={1}>
              {state === "aktiv"
                ? toLabel
                  ? `Aktiv · ${fromLabel} bis ${toLabel}`
                  : `Aktiv · seit ${fromLabel}`
                : state === "geplant"
                  ? `Geplant · ab ${fromLabel}`
                  : toLabel
                    ? `Beendet · bis ${toLabel}`
                    : "Beendet"}
            </Text>
          </View>
          <View className="items-end gap-0.5">
            <Text
              className="font-mono-medium text-base"
              style={{ color: ended ? t.colors.mutedForeground : t.colors.foreground }}
            >
              {formatCents(row.monthlyAmountCents)}
            </Text>
            <Text className="text-muted-foreground text-2xs">pro Monat</Text>
          </View>
        </View>
      </PressableScale>
    </SwipeToEdit>
  )
}

// ── One-off expense row (bare on parchment) ───────────────────────────────────
/** A one-off expense as a bare ledger line: the category glyph (bare ink, no
 *  tinted chip box) · the category + its note/date · the amount in mono. */
function ExpenseRowItem({ row, onEdit }: { row: ExpenseRow; onEdit: () => void }) {
  const t = useW14Theme()
  const Icon = EXPENSE_CATEGORY_ICON[row.category]
  const dateLabel = formatBusinessDay(row.date)
  const note = row.note?.trim()

  return (
    <SwipeToEdit onEdit={onEdit}>
      <PressableScale
        onPress={() => {
          haptics.selection()
          onEdit()
        }}
        accessibilityRole="button"
        accessibilityLabel={`Ausgabe bearbeiten: ${EXPENSE_CATEGORY_LABELS[row.category]}, ${formatCents(row.amountCents)}`}
        style={{ backgroundColor: t.colors.background }}
      >
        <View className="min-h-[56px] flex-row items-center gap-3 py-3">
          {/* A bare ink glyph — no tinted chip box (DESIGN-SYSTEM.md §9: box-free). */}
          <View className="h-9 w-9 items-center justify-center">
            <Icon size={t.icon.md} color={t.colors.foreground} />
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="text-base font-semibold" numberOfLines={1}>
              {EXPENSE_CATEGORY_LABELS[row.category]}
            </Text>
            <Text className="text-muted-foreground text-xs" numberOfLines={1}>
              {note ? note : (dateLabel ?? "")}
            </Text>
          </View>
          <View className="items-end gap-0.5">
            <Text className="font-mono-medium text-base">{formatCents(row.amountCents)}</Text>
            {note && dateLabel ? (
              <Text className="text-muted-foreground text-2xs">{dateLabel}</Text>
            ) : null}
          </View>
        </View>
      </PressableScale>
    </SwipeToEdit>
  )
}

// ── First-load skeleton — the bare row shape, never a mid-screen spinner. ──────
function RowsSkeleton() {
  return (
    <View accessibilityElementsHidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <View key={i}>
          <View className="min-h-[56px] flex-row items-center gap-3 py-3">
            <Skeleton width={36} height={36} radius="button" />
            <View className="flex-1 gap-2">
              <Skeleton width="54%" height={15} />
              <Skeleton width="34%" height={11} />
            </View>
            <Skeleton width={72} height={16} />
          </View>
          {i < 5 ? <Hairline inset={48} /> : null}
        </View>
      ))}
    </View>
  )
}

// ── Screen ────────────────────────────────────────────────────────────────────
export default function AusgabenScreen() {
  const router = useRouter()
  const navigation = useNavigation()
  const t = useW14Theme()
  const insets = useScreenInsets()

  const [tab, setTab] = useState<Tab>("fixkosten")

  // One fan-out read powers both tabs + the KPI band. Per-source honesty: a
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

  // Sticky header — the KPI band, the segmented control, and the active tab's
  // honest summary kicker. All bare on the parchment ground (no header card).
  const header = useMemo(
    () => (
      <View className="gap-4 pb-3">
        <KpiBand fixed={fixedRows} expenses={expenseRows} />
        <Segmented value={tab} onChange={setTab} />
        <Animated.View
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(160)}
          className="flex-row items-center gap-2"
        >
          <GiltDiamond size={7} color={t.colors.gilt} />
          <Text className="text-muted-foreground text-xs" numberOfLines={1}>
            {tab === "fixkosten"
              ? fixedRows != null && fixedRows.length > 0
                ? fixedCostsSummaryLine(fixedRows)
                : "Laufende monatliche Kosten, die Basis für den Break-even."
              : expenseRows != null && expenseRows.length > 0
                ? expensesSummaryLine(expenseRows)
                : "Einmalige Betriebsausgaben, nach Datum sortiert."}
          </Text>
        </Animated.View>
      </View>
    ),
    [tab, fixedRows, expenseRows, t.colors.gilt],
  )

  // The active tab decides which rows + which per-source state we render.
  const activeRows: RowItem[] | null = tab === "fixkosten" ? fixedRows : expenseRows
  const activeRes = tab === "fixkosten" ? fixedRes : expensesRes
  // The hairline inset under each row: aligned past the leading glyph/seal so the
  // rule starts under the label, list-row style (DESIGN-SYSTEM.md §5).
  const rowInset = tab === "fixkosten" ? 22 : 48

  const empty =
    tab === "fixkosten" ? (
      <EmptyState
        icon={Wallet}
        title="Keine Fixkosten erfasst"
        description="Trage Miete, Versicherungen und andere laufende Kosten ein, sie bilden die Basis für deinen Break-even."
        actionLabel="Fixkosten anlegen"
        onAction={() => {
          haptics.selection()
          router.push("/ausgaben/fixkosten")
        }}
      />
    ) : (
      <EmptyState
        icon={Receipt}
        title="Keine Ausgaben erfasst"
        description="Erfasse einmalige Betriebsausgaben wie Wareneinkauf oder Reparaturen, sie fließen in deinen Nettogewinn."
        actionLabel="Ausgabe erfassen"
        onAction={() => {
          haptics.selection()
          router.push("/ausgaben/ausgabe")
        }}
      />
    )

  const hasRows = activeRows != null && activeRows.length > 0

  return (
    <View className="flex-1 bg-background">
      {/* The aged-paper grain canvas: depth from the layered cream plus this
          faint warm tooth, never a flat fill (DESIGN-SYSTEM.md §1, §5). */}
      <PaperGrain />
      <FlatList<RowItem>
        data={activeRows ?? []}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 12,
          paddingBottom: insets.contentBottom,
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
              <ExpenseRowItem
                row={item}
                onEdit={() =>
                  router.push({ pathname: "/ausgaben/ausgabe", params: { id: item.id } })
                }
              />
            ) : (
              <FixedCostRowItem
                row={item}
                onEdit={() =>
                  router.push({ pathname: "/ausgaben/fixkosten", params: { id: item.id } })
                }
              />
            )}
            {/* The ONE warm rule between rows — the only divider weight. The last
                row carries none so the list ends clean on the canvas. */}
            {index < (activeRows?.length ?? 0) - 1 ? <Hairline inset={rowInset} /> : null}
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
        ListFooterComponent={hasRows ? <View className="h-2" /> : null}
      />
    </View>
  )
}
