/**
 * Shared building blocks for the Kunden „Neu"/„Bearbeiten"-Formulare.
 *
 * Both screens collect the same personal fields (Name, Geburtsdatum, Kontakt,
 * Adresse, USt-IdNr., Sprache, Notiz). This module owns the controlled-state
 * shape + a single `CustomerFields` renderer so the create and edit surfaces
 * stay pixel-identical and only differ in the api-client call they fire.
 *
 * Money is not involved here — a Kunde carries no price. The Field/ChipSelect
 * primitives are reused from product-form so every owner intake reads the same.
 */
import { type Dispatch, type SetStateAction } from "react"
import { View } from "react-native"
import type { CustomerLanguage } from "@warehouse14/api-client"

import { Input } from "@/components/ui/input"
import { LANGUAGE_OPTIONS } from "@/warehouse14/customer-ui"
import { ChipSelect, Field } from "@/warehouse14/product-form"

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

/** Client-side guard → a German message, or null when the draft is valid. */
export function validateCustomerForm(s: CustomerFormState): string | null {
  if (!s.fullName.trim()) return "Name ist erforderlich."
  if (s.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim()))
    return "E-Mail-Adresse ungültig."
  return null
}

/**
 * Render the labelled personal-data inputs. The parent owns the state object and
 * a single setter; each input patches one key. Keeps both screens declarative.
 */
export function CustomerFields({
  value,
  onChange,
}: {
  value: CustomerFormState
  onChange: Dispatch<SetStateAction<CustomerFormState>>
}) {
  const patch = (key: keyof CustomerFormState) => (text: string) =>
    onChange((prev) => ({ ...prev, [key]: text }))

  return (
    <View className="gap-3.5">
      <Field label="Name">
        <Input
          value={value.fullName}
          onChangeText={patch("fullName")}
          placeholder="Vor- und Nachname"
          autoCapitalize="words"
        />
      </Field>

      <Field label="Geburtsdatum" hint="Optional — z. B. 1985-04-23.">
        <Input
          value={value.dateOfBirth}
          onChangeText={patch("dateOfBirth")}
          placeholder="JJJJ-MM-TT"
          autoCorrect={false}
        />
      </Field>

      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field label="E-Mail">
            <Input
              value={value.email}
              onChangeText={patch("email")}
              placeholder="kunde@beispiel.de"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>
        </View>
        <View className="flex-1">
          <Field label="Telefon">
            <Input
              value={value.phone}
              onChangeText={patch("phone")}
              placeholder="+49 …"
              keyboardType="phone-pad"
            />
          </Field>
        </View>
      </View>

      <Field label="Adresse" hint="Optional — Straße, PLZ und Ort.">
        <Input
          value={value.address}
          onChangeText={patch("address")}
          placeholder="Musterstraße 1, 12345 Musterstadt"
        />
      </Field>

      <Field label="USt-IdNr." hint="Optional — nur bei gewerblichen Kunden.">
        <Input
          value={value.vatId}
          onChangeText={patch("vatId")}
          placeholder="DE123456789"
          autoCapitalize="characters"
          autoCorrect={false}
        />
      </Field>

      <Field label="Bevorzugte Sprache">
        <ChipSelect
          options={LANGUAGE_OPTIONS}
          value={value.preferredLanguage}
          onChange={(lang) =>
            onChange((prev) => ({ ...prev, preferredLanguage: lang ?? "de" }))
          }
        />
      </Field>

      <Field label="Notiz" hint="Optional — interne Anmerkung.">
        <Input
          value={value.notes}
          onChangeText={patch("notes")}
          placeholder="z. B. Stammkunde, Sammler …"
        />
      </Field>
    </View>
  )
}
