/**
 * Shared building blocks for the Kunden „Neu"/„Bearbeiten"-Formulare.
 *
 * Both screens collect the same personal fields (Name, Geburtsdatum, Kontakt,
 * Adresse, USt-IdNr., Sprache, Notiz). This module owns the controlled-state
 * shape, the per-field validation, and a single `CustomerFields` renderer so the
 * create and edit surfaces stay pixel-identical and only differ in the
 * api-client call they fire.
 *
 * Validation is field-level and German: `validateCustomerForm` returns an error
 * MAP (keyed by field), so the screens can paint the offending input red via the
 * shared `FormField` kit and the operator sees exactly which line to fix — never
 * a single opaque banner for a typo two fields up. The first message is also
 * returned by `firstCustomerError` for the FormScreen banner + the Error haptic.
 *
 * Keyboard handling is native-feel: the inputs chain with `returnKeyType="next"`
 * and `onSubmitEditing` focus-forwarding (refs held here), `textContentType`
 * hints feed the OS autofill, and the last field's „Fertig"-Taste submits the
 * form. We compose the spine's `FormField` for the label/hint/error chrome and
 * render a ref-bearing `Input` as its child (the kit's documented escape hatch),
 * so we keep one visual contract without forking the shared component. Money is
 * not involved here — a Kunde carries no price.
 */
import {
  type ComponentRef,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  useRef,
} from "react"
import { View, type TextInputProps } from "react-native"
import type { CustomerLanguage } from "@warehouse14/api-client"

import { Input } from "@/components/ui/input"
import { LANGUAGE_OPTIONS } from "@/warehouse14/customer-ui"
import { ChipSelect, DateWheel } from "@/warehouse14/product-form"
import { useW14Theme } from "@/warehouse14/theme"
import { FormField } from "@/warehouse14/ui"
import * as haptics from "@/warehouse14/ui/native/haptics"

/** The controlled draft shared by both forms — all strings for the inputs. */
export interface CustomerFormState {
  fullName: string
  dateOfBirth: string
  email: string
  phone: string
  address: string
  vatId: string
  notes: string
  preferredLanguage: CustomerLanguage
}

/** A blank draft (the „Neuer Kunde"-Startwert, Deutsch als Default). */
export const EMPTY_CUSTOMER_FORM: CustomerFormState = {
  fullName: "",
  dateOfBirth: "",
  email: "",
  phone: "",
  address: "",
  vatId: "",
  notes: "",
  preferredLanguage: "de",
}

/** The text fields that can carry a per-field error message. */
export type CustomerFieldKey = "fullName" | "dateOfBirth" | "email" | "phone" | "vatId"

/** Per-field German error messages (only the fields with a problem appear). */
export type CustomerFormErrors = Partial<Record<CustomerFieldKey, string>>

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// JJJJ-MM-TT, the one date shape the rest of the app reads (de-DE rendering of
// an ISO day). We accept it leniently — the field is optional — but reject an
// obviously malformed entry early rather than letting the server 400.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// A German/EU VAT id is country code + digits; keep the guard permissive but
// catch a value too short to be real so a fat-fingered entry fails here, not at
// the till. Spaces are tolerated (operators paste them) and stripped on submit.
const VAT_RE = /^[A-Za-z]{2}[A-Za-z0-9 ]{6,}$/

/** True when the date is a real calendar day in the past, not just the shape.
 *
 *  `new Date("1985-02-30T…")` does NOT return NaN — JS silently rolls the
 *  overflow day forward (→ 2. März), so a non-existent day would pass the naïve
 *  parse and then 400 at the server (`format: "date"` is strict). We build the
 *  date from its parts and re-serialise it: a real day round-trips back to the
 *  same yyyy-mm-dd; a rolled-over one does not, so we reject it here in German
 *  instead of letting an English ajv error reach the operator. */
function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  // UTC keeps the comparison free of the device timezone (no DST/offset slips).
  const d = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(d.getTime())) return false
  // The round-trip check: Date normalises overflow (Feb 30 → Mar 2), so an
  // invalid calendar day no longer matches the digits the operator typed.
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return false
  }
  // Reject a future birth date — a Kunde cannot be born tomorrow. Compare day
  // boundaries in UTC so "today" is never rejected by an hours-only offset.
  const now = new Date()
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return d.getTime() <= todayUtc
}

/**
 * Field-level guard → a German message per offending field. An empty object
 * means the draft is valid. Optional fields are only checked when filled in.
 */
export function validateCustomerForm(s: CustomerFormState): CustomerFormErrors {
  const errors: CustomerFormErrors = {}

  if (!s.fullName.trim()) {
    errors.fullName = "Name ist erforderlich."
  } else if (s.fullName.trim().length < 2) {
    errors.fullName = "Name ist zu kurz."
  }

  if (s.dateOfBirth.trim() && !isRealIsoDate(s.dateOfBirth.trim())) {
    // Via the DateWheel the only reachable failure is a birth date after
    // today; a legacy row loaded with a malformed value trips it too, so the
    // copy names both without claiming a typing format that no longer exists.
    errors.dateOfBirth = "Geburtsdatum ungültig oder in der Zukunft."
  }

  if (s.email.trim() && !EMAIL_RE.test(s.email.trim())) {
    errors.email = "E-Mail-Adresse ungültig."
  }

  if (s.phone.trim() && s.phone.trim().replace(/[^\d]/g, "").length < 5) {
    errors.phone = "Telefonnummer ungültig."
  }

  if (s.vatId.trim() && !VAT_RE.test(s.vatId.trim())) {
    errors.vatId = "USt-IdNr. ungültig z. B. DE123456789."
  }

  return errors
}

/** True when the error map has no entries (the draft passes). */
export function isCustomerFormValid(errors: CustomerFormErrors): boolean {
  return Object.keys(errors).length === 0
}

/** The first field error in reading order — for the FormScreen banner copy. */
export function firstCustomerError(errors: CustomerFormErrors): string | null {
  const order: CustomerFieldKey[] = ["fullName", "dateOfBirth", "email", "phone", "vatId"]
  for (const key of order) {
    const msg = errors[key]
    if (msg) return msg
  }
  return null
}

/** The imperative handle of the spine's `Input` wrapper — a TextInput instance,
 *  derived from the component so we never import the restricted RN symbol. */
type InputRef = ComponentRef<typeof Input>

/**
 * A labelled text input that composes the spine's `FormField` chrome (label +
 * required marker + per-field error/hint) with a ref-bearing `Input`, so the
 * keyboard can forward focus while every field keeps the one visual contract.
 * The invalid state paints the input's border destructive, mirroring the kit's
 * own default-Input behaviour.
 */
function TextField({
  label,
  required,
  hint,
  error,
  inputRef,
  ...inputProps
}: {
  label: string
  required?: boolean
  hint?: string
  error?: string
  inputRef?: RefObject<InputRef | null>
} & TextInputProps): ReactNode {
  const t = useW14Theme()
  const invalid = !!error
  return (
    <FormField label={label} required={required} hint={hint} error={error}>
      <Input
        ref={inputRef}
        aria-invalid={invalid}
        style={invalid ? { borderColor: t.colors.destructive } : undefined}
        {...inputProps}
      />
    </FormField>
  )
}

/**
 * Render the labelled personal-data inputs. The parent owns the state object + a
 * single setter; each input patches one key and clears its own error on edit (so
 * a red line goes calm the moment the operator starts fixing it). `errors`
 * paints the per-field messages; the inputs chain focus with the keyboard's
 * „Weiter"-Taste and the last submits the form.
 */
export function CustomerFields({
  value,
  onChange,
  errors = {},
  onClearError,
  onSubmitForm,
}: {
  value: CustomerFormState
  onChange: Dispatch<SetStateAction<CustomerFormState>>
  /** Per-field error map — paints the offending inputs red. */
  errors?: CustomerFormErrors
  /** Clear one field's error as the operator edits it. */
  onClearError?: (key: CustomerFieldKey) => void
  /** Submit the form from the keyboard's „Fertig"-Taste on the last field. */
  onSubmitForm?: () => void
}) {
  // Refs for keyboard focus-forwarding: each „Weiter" jumps to the next field.
  // (Geburtsdatum is a DateWheel, not a text input — Name forwards to E-Mail.)
  const emailRef = useRef<InputRef>(null)
  const phoneRef = useRef<InputRef>(null)
  const addressRef = useRef<InputRef>(null)
  const vatRef = useRef<InputRef>(null)
  const notesRef = useRef<InputRef>(null)

  const patch = (key: keyof CustomerFormState) => (text: string) => {
    onChange((prev) => ({ ...prev, [key]: text }))
    if ((key as CustomerFieldKey) in errors) onClearError?.(key as CustomerFieldKey)
  }

  const focusNext = (ref: RefObject<InputRef | null>) => () => ref.current?.focus()

  return (
    <View className="gap-3.5">
      <TextField
        label="Name"
        required
        error={errors.fullName}
        value={value.fullName}
        onChangeText={patch("fullName")}
        placeholder="Vor- und Nachname"
        autoCapitalize="words"
        textContentType="name"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={focusNext(emailRef)}
        accessibilityLabel="Name"
      />

      {/* The same shared DateWheel as everywhere else in the app — birth-date
          shape (1920 … heute), the × empties the optional field again. */}
      <FormField
        label="Geburtsdatum"
        hint="Optional Tag, Monat und Jahr wählen."
        error={errors.dateOfBirth}
      >
        <DateWheel
          value={value.dateOfBirth || null}
          onChange={patch("dateOfBirth")}
          onClear={() => patch("dateOfBirth")("")}
          accessibilityLabel="Geburtsdatum"
        />
      </FormField>

      <View className="flex-row gap-3">
        <View className="flex-1">
          <TextField
            label="E-Mail"
            error={errors.email}
            inputRef={emailRef}
            value={value.email}
            onChangeText={patch("email")}
            placeholder="kunde@beispiel.de"
            keyboardType="email-address"
            textContentType="emailAddress"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={focusNext(phoneRef)}
            accessibilityLabel="E-Mail"
          />
        </View>
        <View className="flex-1">
          <TextField
            label="Telefon"
            error={errors.phone}
            inputRef={phoneRef}
            value={value.phone}
            onChangeText={patch("phone")}
            placeholder="+49 …"
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={focusNext(addressRef)}
            accessibilityLabel="Telefon"
          />
        </View>
      </View>

      <TextField
        label="Adresse"
        hint="Optional Straße, PLZ und Ort."
        inputRef={addressRef}
        value={value.address}
        onChangeText={patch("address")}
        placeholder="Musterstraße 1, 12345 Musterstadt"
        textContentType="fullStreetAddress"
        autoCapitalize="words"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={focusNext(vatRef)}
        accessibilityLabel="Adresse"
      />

      <TextField
        label="USt-IdNr."
        hint="Optional nur bei gewerblichen Kunden."
        error={errors.vatId}
        inputRef={vatRef}
        value={value.vatId}
        onChangeText={patch("vatId")}
        placeholder="DE123456789"
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={focusNext(notesRef)}
        accessibilityLabel="USt-IdNr."
      />

      <FormField label="Bevorzugte Sprache">
        <ChipSelect
          options={LANGUAGE_OPTIONS}
          value={value.preferredLanguage}
          onChange={(lang) => {
            haptics.selection()
            onChange((prev) => ({ ...prev, preferredLanguage: lang ?? "de" }))
          }}
        />
      </FormField>

      <TextField
        label="Notiz"
        hint="Optional interne Anmerkung."
        inputRef={notesRef}
        value={value.notes}
        onChangeText={patch("notes")}
        placeholder="z. B. Stammkunde, Sammler …"
        autoCapitalize="sentences"
        returnKeyType="done"
        onSubmitEditing={onSubmitForm}
        accessibilityLabel="Notiz"
      />
    </View>
  )
}
