"use client";

import { useState, type FormEvent } from "react";
import type { Address } from "@/lib/storefront-data";
import { cn } from "@/lib/cn";

// ─────────────────────────────────────────────────────────────────────────────
// Reusable field wrapper
// ─────────────────────────────────────────────────────────────────────────────

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-aged">
        {label}
        {required && <span className="ml-0.5 text-gold">*</span>}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "rounded-button border border-rule bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faded outline-none transition-shadow focus-visible:ring-2 ring-gold-soft";

// ─────────────────────────────────────────────────────────────────────────────
// AddressBlock
// ─────────────────────────────────────────────────────────────────────────────

interface AddressBlockProps {
  idPrefix: string;
  values: Address;
  onChange: (patch: Partial<Address>) => void;
}

function AddressBlock({ idPrefix, values, onChange }: AddressBlockProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Vor- und Nachname" required>
          <input
            id={`${idPrefix}-recipientName`}
            type="text"
            autoComplete="name"
            placeholder="Maria Muster"
            required
            value={values.recipientName}
            onChange={(e) => onChange({ recipientName: e.target.value })}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="sm:col-span-2">
        <Field label="Adresszeile 1" required>
          <input
            id={`${idPrefix}-line1`}
            type="text"
            autoComplete="address-line1"
            placeholder="Musterstraße 14"
            required
            value={values.line1}
            onChange={(e) => onChange({ line1: e.target.value })}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="sm:col-span-2">
        <Field label="Adresszusatz (optional)">
          <input
            id={`${idPrefix}-line2`}
            type="text"
            autoComplete="address-line2"
            placeholder="c/o, Etage, Appartement ..."
            value={values.line2 ?? ""}
            onChange={(e) =>
              onChange({ line2: e.target.value || undefined })
            }
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Postleitzahl" required>
        <input
          id={`${idPrefix}-postalCode`}
          type="text"
          autoComplete="postal-code"
          placeholder="73614"
          required
          value={values.postalCode}
          onChange={(e) => onChange({ postalCode: e.target.value })}
          className={inputClass}
        />
      </Field>

      <Field label="Ort" required>
        <input
          id={`${idPrefix}-city`}
          type="text"
          autoComplete="address-level2"
          placeholder="Schorndorf"
          required
          value={values.city}
          onChange={(e) => onChange({ city: e.target.value })}
          className={inputClass}
        />
      </Field>

      <div className="sm:col-span-2">
        <Field label="Land" required>
          <select
            id={`${idPrefix}-country`}
            autoComplete="country"
            required
            value={values.country}
            onChange={(e) => onChange({ country: e.target.value })}
            className={cn(inputClass, "cursor-pointer")}
          >
            <option value="DE">Deutschland</option>
            <option value="AT">Österreich</option>
            <option value="CH">Schweiz</option>
            <option value="LU">Luxemburg</option>
            <option value="NL">Niederlande</option>
            <option value="BE">Belgien</option>
            <option value="FR">Frankreich</option>
            <option value="IT">Italien</option>
            <option value="ES">Spanien</option>
            <option value="PL">Polen</option>
            <option value="CZ">Tschechien</option>
          </select>
        </Field>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AddressForm (exported)
// ─────────────────────────────────────────────────────────────────────────────

export interface AddressFormValues {
  shipping: Address;
  billing?: Address;
}

interface AddressFormProps {
  onSubmit: (values: AddressFormValues) => void;
  pending?: boolean;
}

const emptyAddress = (): Address => ({
  recipientName: "",
  line1: "",
  line2: undefined,
  postalCode: "",
  city: "",
  country: "DE",
});

export function AddressForm({ onSubmit, pending = false }: AddressFormProps) {
  const [shipping, setShipping] = useState<Address>(emptyAddress());
  const [separateBilling, setSeparateBilling] = useState(false);
  const [billing, setBilling] = useState<Address>(emptyAddress());

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSubmit({ shipping, billing: separateBilling ? billing : undefined });
  }

  return (
    <form id="checkout-address-form" onSubmit={handleSubmit} noValidate={false}>
      {/* Lieferadresse */}
      <section>
        <h2 className="font-display text-xl font-semibold text-ink">
          Lieferadresse
        </h2>
        <p className="mt-1 text-sm text-ink-faded">
          Bitte geben Sie die Adresse an, an die wir Ihre Bestellung liefern sollen.
        </p>
        <div className="mt-5">
          <AddressBlock
            idPrefix="shipping"
            values={shipping}
            onChange={(patch) => setShipping((prev) => ({ ...prev, ...patch }))}
          />
        </div>
      </section>

      {/* Separate Rechnungsadresse */}
      <div className="mt-6 flex items-start gap-3">
        <input
          id="separate-billing"
          type="checkbox"
          checked={separateBilling}
          onChange={(e) => setSeparateBilling(e.target.checked)}
          className="mt-0.5 h-4 w-4 cursor-pointer rounded border-rule accent-[#bf9430]"
        />
        <label
          htmlFor="separate-billing"
          className="cursor-pointer select-none text-sm text-ink-aged"
        >
          Abweichende Rechnungsadresse angeben
        </label>
      </div>

      {separateBilling && (
        <section className="mt-6 border-t border-rule pt-6">
          <h2 className="font-display text-xl font-semibold text-ink">
            Rechnungsadresse
          </h2>
          <div className="mt-5">
            <AddressBlock
              idPrefix="billing"
              values={billing}
              onChange={(patch) => setBilling((prev) => ({ ...prev, ...patch }))}
            />
          </div>
        </section>
      )}

      {/*
        The submit button lives in the parent page so it can sit beside the
        order summary. We expose the form via id="checkout-address-form" so the
        parent button can use form="checkout-address-form".
      */}
    </form>
  );
}
