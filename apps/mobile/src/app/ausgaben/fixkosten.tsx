/**
 * Fixkosten anlegen / bearbeiten — the recurring monthly fixed-cost modal. With
 * no `id` it CREATES (fixedCostsApi.create); with an `id` it loads the row
 * (fixedCostsApi.list, filtered to find it) and PATCHes it
 * (fixedCostsApi.update). Fields: label (Pflicht, 1–200), monthly amount
 * (Pflicht, de-DE Euro → integer CENTS), the active-from date (Pflicht, the
 * shared DateWheel, seeded with the first of the current month) and an optional
 * active-to (leer = läuft weiter). A retired line keeps past allocations honest
 * (there is no DELETE — you END it by setting active-to).
 *
 * The summed monthly amount of the active lines IS the break-even denominator on
 * the Schatzkammer, so this is the surface that lets the owner enter it. Money
 * is integer CENTS on the wire (`parseEuroToCents`); both dates are plain
 * `YYYY-MM-DD` business days, and we enforce active-to ≥ active-from client-side
 * to match the DB CHECK so a malformed range never round-trips.
 *
 * ADMIN + step-up: both writes are gated server-side; the global
 * StepUpDialogHost fires the PIN transparently. On success: one Success haptic
 * (§7) + a brief gold flood, then pop — the list refetches on focus. In edit
 * mode an „Aktiv bis heute setzen"-shortcut fills active-to with today so the
 * owner can retire a line in one tap. All labels German; no native deps added.
 */
import { useEffect, useState } from "react"
import { View } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import type { CreateFixedCostBody, UpdateFixedCostBody } from "@warehouse14/api-client"

import { Button } from "@/components/ui/button"
import { Text } from "@/components/ui/text"
import { createFixedCost, describeError, listFixedCosts, updateFixedCost } from "@/warehouse14/api"
import { centsToEuroInput, parseEuroToCents, todayBusinessDay } from "@/warehouse14/ausgaben-ui"
import { DateWheel } from "@/warehouse14/product-form"
import {
  ErrorState,
  FormField,
  FormScreen,
  GoldFlood,
  haptics,
  SkeletonCard,
} from "@/warehouse14/ui"

/** The first day of the current month as `YYYY-MM-DD` — the sensible default a
 *  recurring cost starts being allocated from. */
function firstOfThisMonth(): string {
  return `${todayBusinessDay().slice(0, 7)}-01`
}

const CURRENT_YEAR = new Date().getFullYear()

export default function FixkostenScreen() {
  const router = useRouter()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const isEdit = typeof id === "string" && id.length > 0

  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [celebrate, setCelebrate] = useState(false)

  const [label, setLabel] = useState("")
  const [labelError, setLabelError] = useState<string | null>(null)
  const [amount, setAmount] = useState("")
  const [amountError, setAmountError] = useState<string | null>(null)
  // Bare "YYYY-MM-DD" business days straight from the shared DateWheels — the
  // wire shape itself. `from` is seeded with the first of the month; `to` may
  // stay "" (offener Posten).
  const [from, setFrom] = useState(firstOfThisMonth())
  const [to, setTo] = useState("")
  const [toError, setToError] = useState<string | null>(null)

  // Edit: load the row from the (paged) list — no get-by-id wrapper exists, and
  // the list is already this surface's source of truth.
  useEffect(() => {
    if (!isEdit) return
    let active = true
    setLoading(true)
    setLoadError(null)
    void (async () => {
      try {
        const res = await listFixedCosts({ limit: 200 })
        if (!active) return
        const row = res.items.find((r) => r.id === id)
        if (!row) {
          setLoadError("Dieser Fixkosten-Posten wurde nicht gefunden.")
          return
        }
        setLabel(row.label)
        setAmount(centsToEuroInput(row.monthlyAmountCents))
        setFrom(row.activeFrom)
        setTo(row.activeTo ?? "")
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

  const labelTrimmed = label.trim()
  const parsedAmount = parseEuroToCents(amount)
  const canSubmit = labelTrimmed.length > 0 && parsedAmount != null

  async function submit(): Promise<boolean> {
    // Client-side field validation surfaces ONLY at the offending field (the
    // precise, contextual place) and returns `false` — it must NOT also throw,
    // or FormScreen's catch would echo the same problem in the top-of-form
    // "Fehler" banner (the owner would see it reported twice). The `false`
    // tells FormScreen to skip the success banner too. Only a real api-client
    // rejection below is allowed to reach the error banner.
    if (labelTrimmed.length === 0) {
      haptics.error()
      setLabelError("Bitte eine Bezeichnung eingeben.")
      return false
    }
    setLabelError(null)

    const cents = parseEuroToCents(amount)
    if (cents == null) {
      haptics.error()
      setAmountError("Bitte einen gültigen Betrag größer als 0 eingeben.")
      return false
    }
    setAmountError(null)

    // The DateWheels compose only real calendar days — only the ORDER can
    // still be wrong. The DB CHECK enforces active_to >= active_from; bare
    // ISO days compare lexicographically, so catch it before the round-trip.
    if (to !== "" && to < from) {
      haptics.error()
      setToError("Das Enddatum darf nicht vor dem Startdatum liegen.")
      return false
    }
    setToError(null)

    if (isEdit) {
      const body: UpdateFixedCostBody = {
        label: labelTrimmed,
        monthlyAmountCents: cents,
        activeFrom: from,
        activeTo: to || null,
      }
      // 403 STEP_UP_REQUIRED → PIN Dialog opens + the call retries automatically.
      await updateFixedCost(id as string, body)
    } else {
      const body: CreateFixedCostBody = {
        label: labelTrimmed,
        monthlyAmountCents: cents,
        activeFrom: from,
        ...(to ? { activeTo: to } : {}),
      }
      await createFixedCost(body)
    }

    haptics.success()
    setCelebrate(true)
    return true
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
        title={isEdit ? "Fixkosten bearbeiten" : "Fixkosten anlegen"}
        subtitle={
          isEdit
            ? "Bezeichnung, Betrag und Laufzeit anpassen."
            : "Laufende monatliche Kosten die Basis für deinen Break-even."
        }
        submitLabel={isEdit ? "Änderungen speichern" : "Fixkosten speichern"}
        successMessage={isEdit ? "Fixkosten aktualisiert." : "Fixkosten gespeichert."}
        submitDisabled={!canSubmit}
        onSubmit={submit}
        money
      >
        <FormField
          label="Bezeichnung"
          required
          error={labelError}
          inputProps={{
            value: label,
            onChangeText: (v: string) => {
              setLabel(v)
              if (labelError) setLabelError(null)
            },
            placeholder: "z. B. Ladenmiete",
            autoCapitalize: "sentences",
            maxLength: 200,
          }}
        />

        <FormField
          label="Betrag pro Monat"
          required
          hint="In Euro, z. B. 1500,00."
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

        <FormField label="Aktiv ab" required hint="Ab wann der Posten anfällt.">
          <DateWheel
            value={from}
            onChange={setFrom}
            accessibilityLabel="Aktiv ab"
            minYear={CURRENT_YEAR - 10}
            maxYear={CURRENT_YEAR + 1}
            defaultYear={CURRENT_YEAR}
          />
        </FormField>

        <FormField
          label="Aktiv bis"
          hint="Optional ohne Datum läuft der Posten weiter."
          error={toError}
        >
          <DateWheel
            value={to || null}
            onChange={(v) => {
              setTo(v)
              if (toError) setToError(null)
            }}
            onClear={() => {
              setTo("")
              if (toError) setToError(null)
            }}
            accessibilityLabel="Aktiv bis"
            minYear={CURRENT_YEAR - 10}
            maxYear={CURRENT_YEAR + 10}
            defaultYear={CURRENT_YEAR}
          />
        </FormField>

        {/* Edit shortcut: retire the line as of today in one tap (sets active-to). */}
        {isEdit ? (
          <Button
            variant="outline"
            onPress={() => {
              haptics.selection()
              setToError(null)
              setTo(todayBusinessDay())
            }}
            accessibilityLabel="Aktiv bis heute setzen"
          >
            <Text>Aktiv bis heute setzen</Text>
          </Button>
        ) : null}
      </FormScreen>

      {/* The committed-write flood visual only (the Success haptic already
          fired). When it fades, pop back to the list, which refetches on focus. */}
      <GoldFlood visible={celebrate} onDone={() => router.back()} />
    </View>
  )
}
