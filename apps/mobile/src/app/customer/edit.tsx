/**
 * Kunde bearbeiten — PUT /api/customers/:id via customersApi.update (ADMIN).
 *
 * Preloads the current Stammdaten with customersApi.get, then patches the
 * editable PII fields. The backend enforces step-up when the customer is already
 * KYC-verified; the 403 STEP_UP_REQUIRED is handled transparently by
 * stepUpMiddleware → the global StepUpDialogHost retries after the PIN.
 *
 * Reached as /customer/edit?id=<id> from the customer detail screen.
 */
import { useEffect, useState } from "react"
import { View } from "react-native"
import { router, useLocalSearchParams } from "expo-router"
import type { CustomerUpdateBody } from "@warehouse14/api-client"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Text } from "@/components/ui/text"
import { describeError, getCustomer, updateCustomer } from "@/warehouse14/api"
import {
  CustomerFields,
  EMPTY_CUSTOMER_FORM,
  validateCustomerForm,
  type CustomerFormState,
} from "@/warehouse14/customer-form"
import { FormScreen } from "@/warehouse14/ui/FormScreen"

/** Send `null` to clear a previously-set optional field, omit when untouched. */
function patchField(next: string, previous: string | null): string | null | undefined {
  const trimmed = next.trim()
  const prev = previous ?? ""
  if (trimmed === prev) return undefined
  return trimmed.length > 0 ? trimmed : null
}

export default function KundeBearbeitenScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()

  const [form, setForm] = useState<CustomerFormState>(EMPTY_CUSTOMER_FORM)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  // The decrypted current values — diffed against the draft on submit so we only
  // PUT the fields the operator actually changed.
  const [original, setOriginal] = useState<{
    fullName: string
    dateOfBirth: string | null
    email: string | null
    phone: string | null
    address: string | null
    vatId: string | null
    notes: string | null
  } | null>(null)

  useEffect(() => {
    if (!id) return
    let alive = true
    void (async () => {
      try {
        const c = await getCustomer(id)
        if (!alive) return
        setOriginal({
          fullName: c.fullName,
          dateOfBirth: c.dateOfBirth,
          email: c.email,
          phone: c.phone,
          address: c.address,
          vatId: c.vatId,
          notes: c.notes,
        })
        setForm({
          fullName: c.fullName,
          dateOfBirth: c.dateOfBirth ?? "",
          email: c.email ?? "",
          phone: c.phone ?? "",
          address: c.address ?? "",
          vatId: c.vatId ?? "",
          notes: c.notes ?? "",
          preferredLanguage: c.preferredLanguage,
        })
        setLoaded(true)
      } catch (e) {
        if (alive) setLoadError(describeError(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [id])

  async function submit() {
    if (!id || !original) throw new Error("Kunde nicht geladen.")
    const problem = validateCustomerForm(form)
    if (problem) throw new Error(problem)

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
      throw new Error("Keine Änderungen.")
    }

    // 403 STEP_UP_REQUIRED (KYC-verified customer) → PIN-Dialog + retry (auto).
    await updateCustomer(id, body)
    router.back()
  }

  if (loadError) {
    return (
      <View className="flex-1 justify-center bg-background px-4">
        <Card className="gap-2 border-destructive px-4 py-4">
          <Text className="text-destructive text-base font-semibold">Fehler</Text>
          <Text className="text-muted-foreground text-sm">{loadError}</Text>
          <Button variant="outline" onPress={() => router.back()}>
            <Text>Zurück</Text>
          </Button>
        </Card>
      </View>
    )
  }

  if (!loaded) {
    return (
      <View className="flex-1 justify-center bg-background px-4">
        <Text className="text-muted-foreground">Lade Kunde…</Text>
      </View>
    )
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
      <CustomerFields value={form} onChange={setForm} />
    </FormScreen>
  )
}
