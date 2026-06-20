/**
 * Ausgabe erfassen / bearbeiten — the one-off operating-expense modal. With no
 * `id` it CREATES (expensesApi.create); with an `id` it loads the row
 * (expensesApi.list, filtered to find it) and PATCHes it (expensesApi.update).
 * Fields: amount (Pflicht, de-DE Euro → integer CENTS), category (a chip
 * picker), business day (TT.MM.JJJJ, defaults to today), and an optional note.
 *
 * Money is integer CENTS on the wire; the field parses de-DE Euro input
 * (comma OR dot decimals, thousands ignored) through `parseEuroToCents`, so the
 * shown + sent amount is always honest. The date is a plain `YYYY-MM-DD`
 * business day (NOT an ISO date-time) — the finance routes reject a date-time.
 *
 * ADMIN + step-up: both writes are gated server-side; the global
 * StepUpDialogHost fires the PIN transparently and the call retries after it.
 * On success: one Success haptic (§7) + a brief gold flood, then pop — the list
 * refetches on focus and shows the row. No DELETE (GoBD: corrections are an edit
 * or an offsetting entry). All labels German; no native deps added.
 */
import { useEffect, useState } from "react"
import { View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import type { CreateExpenseBody, ExpenseCategory, UpdateExpenseBody } from "@warehouse14/api-client"

import { Text } from "@/components/ui/text"
import { createExpense, describeError, listExpenses, updateExpense } from "@/warehouse14/api"
import {
  businessDayInput,
  centsToEuroInput,
  EXPENSE_CATEGORY_ICON,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_CATEGORY_OPTIONS,
  parseBusinessDayInput,
  parseEuroToCents,
  todayBusinessDay,
} from "@/warehouse14/ausgaben-ui"
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

export default function AusgabeScreen() {
  const router = useRouter()
  const t = useW14Theme()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const isEdit = typeof id === "string" && id.length > 0

  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [celebrate, setCelebrate] = useState(false)

  const [amount, setAmount] = useState("")
  const [amountError, setAmountError] = useState<string | null>(null)
  const [category, setCategory] = useState<ExpenseCategory>("WARENEINKAUF")
  const [dateInput, setDateInput] = useState(businessDayInput(todayBusinessDay()))
  const [dateError, setDateError] = useState<string | null>(null)
  const [note, setNote] = useState("")

  // Edit: load the row. The api-client has no get-by-id for an expense, so we
  // pull the (paged) list and find it — the dev set is small and the list is
  // already the surface's source of truth.
  useEffect(() => {
    if (!isEdit) return
    let active = true
    setLoading(true)
    setLoadError(null)
    void (async () => {
      try {
        const res = await listExpenses({ limit: 200 })
        if (!active) return
        const row = res.items.find((r) => r.id === id)
        if (!row) {
          setLoadError("Diese Ausgabe wurde nicht gefunden.")
          return
        }
        setAmount(centsToEuroInput(row.amountCents))
        setCategory(row.category)
        setDateInput(businessDayInput(row.date))
        setNote(row.note ?? "")
      } catch (e) {
        if (active) setLoadError(describeError(e))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [id, isEdit, reloadKey])

  const parsedAmount = parseEuroToCents(amount)
  const canSubmit = parsedAmount != null

  async function submit(): Promise<boolean> {
    // Client-side field validation surfaces ONLY at the offending field (the
    // precise, contextual place) and returns `false` — it must NOT also throw,
    // or FormScreen's catch would echo the same problem in the top-of-form
    // "Fehler" banner (the owner would see it reported twice). The `false`
    // tells FormScreen to skip the success banner too. Only a real api-client
    // rejection below is allowed to reach the error banner.
    const cents = parseEuroToCents(amount)
    if (cents == null) {
      haptics.error()
      setAmountError("Bitte einen gültigen Betrag größer als 0 eingeben.")
      return false
    }
    setAmountError(null)

    const parsedDate = parseBusinessDayInput(dateInput)
    if (!parsedDate.ok || parsedDate.day == null) {
      haptics.error()
      setDateError("Bitte ein gültiges Datum im Format TT.MM.JJJJ eingeben.")
      return false
    }
    setDateError(null)

    const trimmedNote = note.trim()

    if (isEdit) {
      const body: UpdateExpenseBody = {
        amountCents: cents,
        category,
        date: parsedDate.day,
        note: trimmedNote ? trimmedNote : null,
      }
      // 403 STEP_UP_REQUIRED → PIN Dialog opens + the call retries automatically.
      await updateExpense(id as string, body)
    } else {
      const body: CreateExpenseBody = {
        amountCents: cents,
        category,
        date: parsedDate.day,
        ...(trimmedNote ? { note: trimmedNote } : {}),
      }
      await createExpense(body)
    }

    // A committed money write — one Success haptic (§7) + a brief flood, then
    // pop back to the list, which refetches on focus and shows the row.
    haptics.success()
    setCelebrate(true)
    return true
  }

  function categoryChip(opt: ExpenseCategory) {
    const active = category === opt
    const Icon = EXPENSE_CATEGORY_ICON[opt]
    return (
      <PressableScale
        key={opt}
        onPress={() => {
          haptics.selection()
          setCategory(opt)
        }}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`Kategorie ${EXPENSE_CATEGORY_LABELS[opt]}`}
      >
        <View
          className="flex-row items-center gap-1.5 rounded-md border px-3 py-2"
          style={{
            borderColor: active ? t.colors.primary : t.colors.border,
            backgroundColor: active ? t.colors.primary : t.colors.card,
          }}
        >
          <Icon
            size={t.icon.sm}
            color={active ? t.colors.primaryForeground : t.colors.mutedForeground}
          />
          <Text
            className="text-sm font-medium"
            style={{ color: active ? t.colors.primaryForeground : t.colors.foreground }}
          >
            {EXPENSE_CATEGORY_LABELS[opt]}
          </Text>
        </View>
      </PressableScale>
    )
  }

  if (loading) {
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
          onRetry={isEdit ? () => setReloadKey((k) => k + 1) : undefined}
        />
      </View>
    )
  }

  return (
    <View className="flex-1">
      <FormScreen
        title={isEdit ? "Ausgabe bearbeiten" : "Ausgabe erfassen"}
        subtitle={
          isEdit
            ? "Betrag, Kategorie und Datum anpassen."
            : "Einmalige Betriebsausgabe — fließt in deinen Nettogewinn."
        }
        submitLabel={isEdit ? "Änderungen speichern" : "Ausgabe speichern"}
        successMessage={isEdit ? "Ausgabe aktualisiert." : "Ausgabe gespeichert."}
        submitDisabled={!canSubmit}
        onSubmit={submit}
        money
      >
        <FormField
          label="Betrag"
          required
          hint="In Euro, z. B. 49,90."
          error={amountError}
          inputProps={{
            value: amount,
            onChangeText: (v: string) => {
              setAmount(v)
              if (amountError) setAmountError(null)
            },
            placeholder: "0,00",
            keyboardType: "decimal-pad",
            autoCorrect: false,
          }}
        />

        <FormField label="Kategorie">
          <View className="flex-row flex-wrap gap-2">
            {EXPENSE_CATEGORY_OPTIONS.map(categoryChip)}
          </View>
        </FormField>

        <FormField
          label="Datum"
          required
          hint="Format TT.MM.JJJJ."
          error={dateError}
          inputProps={{
            value: dateInput,
            onChangeText: (v: string) => {
              setDateInput(v)
              if (dateError) setDateError(null)
            },
            placeholder: "TT.MM.JJJJ",
            autoCapitalize: "none",
            autoCorrect: false,
            keyboardType: "numbers-and-punctuation",
          }}
        />

        <FormField
          label="Notiz"
          hint="Optional — z. B. Lieferant oder Beleg-Nr."
          inputProps={{
            value: note,
            onChangeText: setNote,
            placeholder: "Optionaler Kontext",
            autoCapitalize: "sentences",
            maxLength: 500,
            multiline: true,
            numberOfLines: 2,
          }}
        />
      </FormScreen>

      {/* The committed-write flood — visual only (the Success haptic already
          fired). When it fades, pop back to the list, which refetches on focus. */}
      <GoldFlood visible={celebrate} onDone={() => router.back()} />
    </View>
  )
}
