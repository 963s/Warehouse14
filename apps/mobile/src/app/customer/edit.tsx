/**
 * Kunde bearbeiten — PUT /api/customers/:id via customersApi.update (ADMIN).
 *
 * Preloads the current Stammdaten with customersApi.get, then patches the
 * editable PII fields. Validation is field-level (the offending inputs paint red,
 * the first message lands in the FormScreen banner with the Error haptic). The
 * backend enforces step-up when the customer is already KYC-verified; the 403
 * STEP_UP_REQUIRED is handled transparently by stepUpMiddleware → the global
 * StepUpDialogHost retries after the PIN. A saved change lands with the Success
 * haptic and the verdigris banner.
 *
 * Loading + load-failure reuse the shared state spine (a Skeleton in the form's
 * shape, then ErrorState + Retry) so this surface reads like every other. The
 * prefill is a deliberate one-shot — it never refetches on focus, so returning
 * to the screen mid-edit never clobbers the operator's draft.
 *
 * Reached as /customer/edit?id=<id> from the customer detail screen.
 */
import { useEffect, useState } from "react"
import { ScrollView, View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import type { CustomerUpdateBody } from "@warehouse14/api-client"

import { describeError, getCustomer, updateCustomer } from "@/warehouse14/api"
import { addressInputValue } from "@/warehouse14/customer-ui"
import {
  type CustomerFieldKey,
  CustomerFields,
  type CustomerFormErrors,
  EMPTY_CUSTOMER_FORM,
  type CustomerFormState,
  firstCustomerError,
  isCustomerFormValid,
  validateCustomerForm,
} from "@/warehouse14/customer-form"
import { ErrorState, haptics, PaperGrain, Skeleton, useScreenInsets } from "@/warehouse14/ui"
import { FormScreen } from "@/warehouse14/ui/FormScreen"

/** Send `null` to clear a previously-set optional field, omit when untouched. */
function patchField(next: string, previous: string | null): string | null | undefined {
  const trimmed = next.trim()
  const prev = previous ?? ""
  if (trimmed === prev) return undefined
  return trimmed.length > 0 ? trimmed : null
}

/** The decrypted current values — diffed against the draft so we only PUT the
 *  fields the operator actually changed. */
interface CustomerOriginal {
  fullName: string
  dateOfBirth: string | null
  email: string | null
  phone: string | null
  address: string | null
  vatId: string | null
  notes: string | null
}

export default function KundeBearbeitenScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()

  const [form, setForm] = useState<CustomerFormState>(EMPTY_CUSTOMER_FORM)
  const [errors, setErrors] = useState<CustomerFormErrors>({})
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadCause, setLoadCause] = useState<unknown>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [original, setOriginal] = useState<CustomerOriginal | null>(null)

  useEffect(() => {
    if (!id) {
      setLoadError("Kein Kunde ausgewählt.")
      return
    }
    let alive = true
    setLoadError(null)
    setLoadCause(null)
    void (async () => {
      try {
        const c = await getCustomer(id)
        if (!alive) return
        // A POS/seed customer stores `address` as a JSON blob with English keys.
        // Fold it to a clean German one-liner for BOTH the prefill and the diff
        // baseline, so the owner never edits raw JSON and an untouched field
        // diffs as unchanged (no silent re-write). When the owner DOES edit, the
        // clean string replaces the blob — the intended outcome.
        const addressClean = addressInputValue(c.address)
        setOriginal({
          fullName: c.fullName,
          dateOfBirth: c.dateOfBirth,
          email: c.email,
          phone: c.phone,
          address: addressClean.length > 0 ? addressClean : null,
          vatId: c.vatId,
          notes: c.notes,
        })
        setForm({
          fullName: c.fullName,
          dateOfBirth: c.dateOfBirth ?? "",
          email: c.email ?? "",
          phone: c.phone ?? "",
          address: addressClean,
          vatId: c.vatId ?? "",
          notes: c.notes ?? "",
          preferredLanguage: c.preferredLanguage,
        })
        setLoaded(true)
      } catch (e) {
        if (alive) {
          setLoadError(describeError(e))
          setLoadCause(e)
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [id, reloadKey])

  const clearError = (key: CustomerFieldKey) =>
    setErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })

  async function submit() {
    if (!id || !original) throw new Error("Kunde nicht geladen.")
    const problems = validateCustomerForm(form)
    setErrors(problems)
    if (!isCustomerFormValid(problems)) {
      haptics.error()
      throw new Error(firstCustomerError(problems) ?? "Bitte Eingaben prüfen.")
    }

    const body: CustomerUpdateBody = {}
    if (form.fullName.trim() !== original.fullName) body.fullName = form.fullName.trim()

    const dob = patchField(form.dateOfBirth, original.dateOfBirth)
    if (dob !== undefined) body.dateOfBirth = dob
    const email = patchField(form.email, original.email)
    if (email !== undefined) body.email = email
    const phone = patchField(form.phone, original.phone)
    if (phone !== undefined) body.phone = phone
    const address = patchField(form.address, original.address)
    if (address !== undefined) body.address = address
    const vatId = patchField(form.vatId, original.vatId)
    if (vatId !== undefined) body.vatId = vatId
    const notes = patchField(form.notes, original.notes)
    if (notes !== undefined) body.notes = notes

    if (Object.keys(body).length === 0) {
      haptics.warning()
      throw new Error("Keine Änderungen.")
    }

    // 403 STEP_UP_REQUIRED (KYC-verified customer) → PIN-Dialog + retry (auto).
    await updateCustomer(id, body)
    // The Success notification IS the confirm (pairs with the verdigris banner).
    haptics.success()
    router.back()
  }

  if (loadError != null) {
    return (
      <View className="flex-1 justify-center bg-background px-4">
        <PaperGrain />
        <ErrorState
          message={loadError}
          cause={loadCause}
          onRetry={id ? () => setReloadKey((k) => k + 1) : () => router.back()}
          retryLabel={id ? "Erneut versuchen" : "Zurück"}
        />
      </View>
    )
  }

  if (!loaded) {
    return <EditSkeleton />
  }

  return (
    <FormScreen
      title="Kunde bearbeiten"
      subtitle="Stammdaten ändern. Bei bestätigtem KYC ist eine PIN-Bestätigung nötig."
      submitLabel="Speichern"
      successMessage="Gespeichert."
      submitDisabled={!form.fullName.trim()}
      onSubmit={submit}
    >
      <CustomerFields value={form} onChange={setForm} errors={errors} onClearError={clearError} />
    </FormScreen>
  )
}

/** The first-load placeholder — the edit form's own shape (title + labelled
 *  fields), never a mid-screen spinner (DESIGN.md §6). */
function EditSkeleton() {
  const insets = useScreenInsets()
  return (
    <View className="flex-1 bg-background">
      <PaperGrain />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: insets.contentBottom, gap: 14 }}
      >
        <View className="gap-1.5">
          <Skeleton width="56%" height={20} />
          <Skeleton width="82%" height={13} />
        </View>
        <View className="gap-3.5 pt-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} className="gap-2">
              <Skeleton width="34%" height={13} />
              <Skeleton width="100%" height={44} radius="button" />
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  )
}
