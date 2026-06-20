/**
 * Neuer Kunde — POST /api/customers via customersApi.create (ADMIN).
 *
 * Collects the personal data (Name, Geburtsdatum, Kontakt, Adresse, USt-IdNr.,
 * Sprache, Notiz) through the shared CustomerFields + the FormScreen scaffold.
 * Validation is field-level: an invalid draft paints the offending inputs red,
 * fires the Error haptic, and lands the first message in the FormScreen banner —
 * the operator sees exactly which line to fix.
 *
 * A successful create is a real milestone (a new customer record exists), so it
 * lands with the Success haptic and a single gold flood (DESIGN.md §6/§7) before
 * the screen replaces itself with the fresh customer detail, where KYC/Vertrauen
 * are stamped next. Reached from the „Mehr"-Hub (/customer/neu) and the Kunden-
 * Tab add button.
 */
import { useRef, useState } from "react"
import { router } from "expo-router"
import type { CustomerCreateBody } from "@warehouse14/api-client"

import { createCustomer } from "@/warehouse14/api"
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
import { GoldFlood, haptics } from "@/warehouse14/ui"
import { FormScreen } from "@/warehouse14/ui/FormScreen"

export default function NeuerKundeScreen() {
  const [form, setForm] = useState<CustomerFormState>(EMPTY_CUSTOMER_FORM)
  const [errors, setErrors] = useState<CustomerFormErrors>({})
  const [celebrate, setCelebrate] = useState(false)
  // Idempotency guard: once a create succeeds we navigate after a short flood,
  // but FormScreen re-enables the button the instant submit() resolves. This ref
  // latches the moment the POST lands so a second tap in that window can't fire a
  // second POST → no duplicate customer. A ref (not state) so the guard is set
  // synchronously, before React re-renders the button.
  const submittedRef = useRef(false)

  const clearError = (key: CustomerFieldKey) =>
    setErrors((prev) => {
      if (!(key in prev)) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })

  async function submit() {
    // Already created + navigating away: swallow a second tap silently so we
    // never POST twice. (The button is also disabled below, but a tap can race
    // the re-enable; this is the hard stop.)
    if (submittedRef.current) return

    const problems = validateCustomerForm(form)
    setErrors(problems)
    if (!isCustomerFormValid(problems)) {
      // Pair the red inputs with the Error haptic; the banner shows the first.
      haptics.error()
      throw new Error(firstCustomerError(problems) ?? "Bitte Eingaben prüfen.")
    }

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
    // Latch BEFORE the await-free tail returns: the record now exists, so any
    // further tap must be a no-op until we navigate away.
    submittedRef.current = true
    // One haptic per action: the Success notification IS the confirm; the gold
    // flood that follows is visual-only, never a second buzz (DESIGN.md §7).
    haptics.success()
    setCelebrate(true)
    // Let the flood breathe, then land on the fresh detail so KYC/Vertrauen can
    // be stamped next. The replace clears this screen from the back stack.
    setTimeout(() => {
      router.replace({ pathname: "/customer/[id]", params: { id: res.id } })
    }, 620)
  }

  return (
    <>
      <FormScreen
        title="Neuer Kunde"
        subtitle="Stammdaten erfassen. KYC und Vertrauen folgen im Kundenprofil."
        submitLabel="Anlegen"
        successMessage="Kunde angelegt."
        // Disabled until navigation: no name yet, or the create already landed
        // and the gold flood is playing before we replace the screen.
        submitDisabled={!form.fullName.trim() || celebrate}
        onSubmit={submit}
      >
        <CustomerFields value={form} onChange={setForm} errors={errors} onClearError={clearError} />
      </FormScreen>

      {/* The new-customer milestone flood — visual only (the Success haptic
          already fired); once per create, above content, never blocks a tap. */}
      <GoldFlood visible={celebrate} onDone={() => setCelebrate(false)} />
    </>
  )
}
