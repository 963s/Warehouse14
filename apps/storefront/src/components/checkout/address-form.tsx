"use client";

import { useState, type FormEvent } from "react";
import type { Address } from "@/lib/storefront-data";
import { cn } from "@/lib/cn";

// ─────────────────────────────────────────────────────────────────────────────
// Reusable field wrapper with inline validation (wax-red carries the negative)
// ─────────────────────────────────────────────────────────────────────────────

function Field({
  label,
  required,
  error,
  errorId,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  errorId?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-aged">
        {label}
        {required && <span className="ml-0.5 text-ink-faded" aria-hidden="true">*</span>}
      </span>
      {children}
      {error && (
        <span id={errorId} className="text-xs leading-relaxed text-wax-red">
          {error}
        </span>
      )}
    </label>
  );
}

/* text-base (16px) so iOS never zoom-jumps; min-h 44px touch target. */
const inputClass =
  "min-h-[44px] rounded-button border bg-surface px-3.5 py-2.5 text-base text-ink placeholder:text-ink-faded outline-none transition-shadow focus:ring-2";

function inputState(invalid: boolean) {
  return cn(
    inputClass,
    invalid
      ? "border-wax-red/60 focus:border-wax-red focus:ring-wax-red/15"
      : "border-rule focus:border-ink focus:ring-ink/10",
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

type Errors = Record<string, string>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateAddress(prefix: string, a: Address, errors: Errors) {
  if (!a.recipientName.trim()) errors[`${prefix}-recipientName`] = "Bitte geben Sie Vor- und Nachnamen an.";
  if (!a.line1.trim()) errors[`${prefix}-line1`] = "Bitte geben Sie Straße und Hausnummer an.";
  if (!a.postalCode.trim()) errors[`${prefix}-postalCode`] = "Bitte geben Sie die Postleitzahl an.";
  if (!a.city.trim()) errors[`${prefix}-city`] = "Bitte geben Sie den Ort an.";
}

// ─────────────────────────────────────────────────────────────────────────────
// AddressBlock
// ─────────────────────────────────────────────────────────────────────────────

interface AddressBlockProps {
  idPrefix: string;
  values: Address;
  errors: Errors;
  onChange: (patch: Partial<Address>) => void;
}

function AddressBlock({ idPrefix, values, errors, onChange }: AddressBlockProps) {
  /* "shipping"/"billing" group tokens let browser autofill target the right block */
  const ac = idPrefix === "billing" ? "billing" : "shipping";
  const err = (field: string) => errors[`${idPrefix}-${field}`];
  const errId = (field: string) => `${idPrefix}-${field}-error`;
  const aria = (field: string) =>
    err(field)
      ? { "aria-invalid": true as const, "aria-describedby": errId(field) }
      : {};
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Vor- und Nachname" required error={err("recipientName")} errorId={errId("recipientName")}>
          <input
            id={`${idPrefix}-recipientName`}
            type="text"
            autoComplete={`${ac} name`}
            placeholder="Maria Muster"
            value={values.recipientName}
            onChange={(e) => onChange({ recipientName: e.target.value })}
            className={inputState(Boolean(err("recipientName")))}
            {...aria("recipientName")}
          />
        </Field>
      </div>

      <div className="sm:col-span-2">
        <Field label="Straße und Hausnummer" required error={err("line1")} errorId={errId("line1")}>
          <input
            id={`${idPrefix}-line1`}
            type="text"
            autoComplete={`${ac} address-line1`}
            placeholder="Musterstraße 14"
            value={values.line1}
            onChange={(e) => onChange({ line1: e.target.value })}
            className={inputState(Boolean(err("line1")))}
            {...aria("line1")}
          />
        </Field>
      </div>

      <div className="sm:col-span-2">
        <Field label="Adresszusatz (optional)">
          <input
            id={`${idPrefix}-line2`}
            type="text"
            autoComplete={`${ac} address-line2`}
            placeholder="c/o, Etage, Appartement ..."
            value={values.line2 ?? ""}
            onChange={(e) => onChange({ line2: e.target.value || undefined })}
            className={inputState(false)}
          />
        </Field>
      </div>

      <Field label="Postleitzahl" required error={err("postalCode")} errorId={errId("postalCode")}>
        <input
          id={`${idPrefix}-postalCode`}
          type="text"
          inputMode="numeric"
          autoComplete={`${ac} postal-code`}
          placeholder="73614"
          value={values.postalCode}
          onChange={(e) => onChange({ postalCode: e.target.value })}
          className={inputState(Boolean(err("postalCode")))}
          {...aria("postalCode")}
        />
      </Field>

      <Field label="Ort" required error={err("city")} errorId={errId("city")}>
        <input
          id={`${idPrefix}-city`}
          type="text"
          autoComplete={`${ac} address-level2`}
          placeholder="Schorndorf"
          value={values.city}
          onChange={(e) => onChange({ city: e.target.value })}
          className={inputState(Boolean(err("city")))}
          {...aria("city")}
        />
      </Field>

      <div className="sm:col-span-2">
        <Field label="Land" required>
          <select
            id={`${idPrefix}-country`}
            autoComplete={`${ac} country`}
            value={values.country}
            onChange={(e) => onChange({ country: e.target.value })}
            className={cn(inputState(false), "cursor-pointer")}
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

export interface ContactValues {
  email: string;
  phone?: string;
}

export interface AddressFormValues {
  contact: ContactValues;
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
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [shipping, setShipping] = useState<Address>(emptyAddress());
  const [separateBilling, setSeparateBilling] = useState(false);
  const [billing, setBilling] = useState<Address>(emptyAddress());
  const [errors, setErrors] = useState<Errors>({});

  function clearErrors(prefix: string, patch: Record<string, unknown>) {
    setErrors((prev) => {
      const keys = Object.keys(patch).map((k) => `${prefix}-${k}`);
      if (!keys.some((k) => prev[k])) return prev;
      const next = { ...prev };
      for (const k of keys) delete next[k];
      return next;
    });
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;

    const nextErrors: Errors = {};
    if (!email.trim()) {
      nextErrors["contact-email"] = "Bitte geben Sie Ihre E-Mail-Adresse an.";
    } else if (!EMAIL_RE.test(email.trim())) {
      nextErrors["contact-email"] = "Bitte prüfen Sie das Format der E-Mail-Adresse.";
    }
    validateAddress("shipping", shipping, nextErrors);
    if (separateBilling) validateAddress("billing", billing, nextErrors);

    setErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      // bring the first invalid field into view and hand it the focus
      const el = document.getElementById(firstInvalid);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus({ preventScroll: true });
      return;
    }

    onSubmit({
      contact: { email: email.trim(), phone: phone.trim() || undefined },
      shipping,
      billing: separateBilling ? billing : undefined,
    });
  }

  const emailError = errors["contact-email"];

  return (
    <form id="checkout-address-form" onSubmit={handleSubmit} noValidate>
      <p className="text-xs text-ink-faded">* Pflichtfeld</p>

      {/* Kontakt */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="E-Mail-Adresse" required error={emailError} errorId="contact-email-error">
          <input
            id="contact-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="maria@beispiel.de"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearErrors("contact", { email: true });
            }}
            className={inputState(Boolean(emailError))}
            {...(emailError
              ? { "aria-invalid": true as const, "aria-describedby": "contact-email-error" }
              : {})}
          />
        </Field>
        <Field label="Telefon (optional)">
          <input
            id="contact-phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+49 7181 000000"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputState(false)}
          />
        </Field>
      </div>

      {/* Lieferadresse */}
      <section className="mt-7 border-t border-rule pt-6">
        <h3 className="smallcaps text-sm font-semibold text-ink-faded">Lieferadresse</h3>
        <div className="mt-4">
          <AddressBlock
            idPrefix="shipping"
            values={shipping}
            errors={errors}
            onChange={(patch) => {
              setShipping((prev) => ({ ...prev, ...patch }));
              clearErrors("shipping", patch);
            }}
          />
        </div>
      </section>

      {/* Separate Rechnungsadresse — whole row stays a 44px touch target */}
      <div className="mt-4 flex min-h-[44px] items-center gap-3">
        <input
          id="separate-billing"
          type="checkbox"
          checked={separateBilling}
          onChange={(e) => setSeparateBilling(e.target.checked)}
          className="h-5 w-5 shrink-0 cursor-pointer rounded border-rule accent-ink"
        />
        <label
          htmlFor="separate-billing"
          className="cursor-pointer select-none py-2.5 text-sm text-ink-aged"
        >
          Abweichende Rechnungsadresse angeben
        </label>
      </div>

      {separateBilling && (
        <section className="mt-4 border-t border-rule pt-6">
          <h3 className="smallcaps text-sm font-semibold text-ink-faded">Rechnungsadresse</h3>
          <div className="mt-4">
            <AddressBlock
              idPrefix="billing"
              values={billing}
              errors={errors}
              onChange={(patch) => {
                setBilling((prev) => ({ ...prev, ...patch }));
                clearErrors("billing", patch);
              }}
            />
          </div>
        </section>
      )}

      {/*
        The submit button lives in the parent page so it can sit beside the
        order summary (and in the sticky phone bar). We expose the form via
        id="checkout-address-form" so any button can use form="checkout-address-form".
      */}
    </form>
  );
}
