/**
 * Neuer Kunde — POST /api/customers via customersApi.create (ADMIN).
 *
 * Collects the personal data (Name, Geburtsdatum, Kontakt, Adresse, USt-IdNr.,
 * Sprache, Notiz) through the shared CustomerFields + the FormScreen scaffold.
 * On success the new customer detail opens, where KYC/Vertrauen are stamped.
 *
 * Reached from the „Mehr"-Hub (/customer/neu) and the Kunden-Tab add button.
 */
import { useState } from "react"
import { router } from "expo-router"
import type { CustomerCreateBody } from "@warehouse14/api-client"

import { createCustomer } from "@/warehouse14/api"
import {
  CustomerFields,
  EMPTY_CUSTOMER_FORM,
  validateCustomerForm,
  type CustomerFormState,
} from "@/warehouse14/customer-form"
import { FormScreen } from "@/warehouse14/ui/FormScreen"

export default function NeuerKundeScreen() {
  const [form, setForm] = useState<CustomerFormState>(EMPTY_CUSTOMER_FORM)

  async function submit() {
    const problem = validateCustomerForm(form)
    if (problem) throw new Error(problem)

    const body: CustomerCreateBody = {
      fullName: form.fullName.trim(),
      preferredLanguage: form.preferredLanguage,
      ...(form.dateOfBirth.trim() ? { dateOfBirth: form.dateOfBirth.trim() } : {}),
      ...(form.email.trim() ? { email: form.email.trim() } : {}),
      ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      ...(form.address.trim() ? { address: form.address.trim() } : {}),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      ...(form.vatId.trim() ? { vatId: form.vatId.trim() } : {}),
    }

    const res = await createCustomer(body)
    // Land on the fresh customer detail so KYC/Vertrauen can be stamped next.
    router.replace({ pathname: "/customer/[id]", params: { id: res.id } })
  }

  return (
    <FormScreen
      title="Neuer Kunde"
      subtitle="Stammdaten erfassen. KYC und Vertrauen folgen im Kundenprofil."
      submitLabel="Anlegen"
      successMessage="Kunde angelegt."
      submitDisabled={!form.fullName.trim()}
      onSubmit={submit}
    >
      <CustomerFields value={form} onChange={setForm} />
    </FormScreen>
  )
}
