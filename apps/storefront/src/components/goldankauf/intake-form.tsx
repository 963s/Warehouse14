"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { data } from "@/lib/storefront-data";

const ITEM_TYPES = [
  { value: "Goldmuenzen",   label: "Goldmunzen" },
  { value: "Goldbarren",    label: "Goldbarren" },
  { value: "Schmuck",       label: "Schmuck" },
  { value: "Silber",        label: "Silber" },
  { value: "Antiquitaet",   label: "Antiquitat" },
  { value: "Sonstiges",     label: "Sonstiges" },
] as const;

type Status = "idle" | "sending" | "sent" | "error";

function inputClass(extra = "") {
  return `w-full rounded-button border border-rule bg-surface px-4 py-2.5 text-sm text-ink placeholder:text-ink-faded focus:outline-none focus:ring-2 focus:ring-gold/40 transition-[border-color,box-shadow] ${extra}`.trim();
}

export function IntakeForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");

    const fd = new FormData(e.currentTarget);
    const weightRaw = (fd.get("weightEstimateGrams") as string | null)?.trim();
    const weightNum = weightRaw ? parseFloat(weightRaw.replace(",", ".")) : undefined;

    try {
      await data.submitGoldankaufLead({
        name:                 (fd.get("name") as string).trim(),
        email:                (fd.get("email") as string).trim(),
        phone:                (fd.get("phone") as string | null)?.trim() || undefined,
        itemType:             (fd.get("itemType") as string) || undefined,
        weightEstimateGrams:  weightNum && !isNaN(weightNum) ? weightNum : undefined,
        description:          (fd.get("description") as string).trim(),
      });
      setStatus("sent");
    } catch {
      setStatus("error");
      setErrorMsg(
        "Leider ist etwas schiefgelaufen. Bitte versuchen Sie es erneut oder rufen Sie uns an.",
      );
    }
  }

  if (status === "sent") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-4 rounded-card border border-rule bg-surface px-6 py-12 text-center"
      >
        <CheckCircle2 aria-hidden="true" className="h-12 w-12 text-gold" strokeWidth={1.4} />
        <p className="font-display text-2xl font-semibold text-ink">Vielen Dank.</p>
        <p className="max-w-sm text-sm leading-relaxed text-ink-aged">
          Wir haben Ihre Anfrage erhalten und melden uns in der Regel noch am gleichen Werktag
          bei Ihnen.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        {/* Name */}
        <div className="space-y-1.5">
          <label htmlFor="if-name" className="block text-sm font-medium text-ink">
            Name <span className="text-gold">*</span>
          </label>
          <input
            id="if-name"
            name="name"
            type="text"
            required
            autoComplete="name"
            placeholder="Ihr vollstandiger Name"
            className={inputClass()}
          />
        </div>

        {/* E-Mail */}
        <div className="space-y-1.5">
          <label htmlFor="if-email" className="block text-sm font-medium text-ink">
            E-Mail-Adresse <span className="text-gold">*</span>
          </label>
          <input
            id="if-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="ihre@email.de"
            className={inputClass()}
          />
        </div>

        {/* Telefon (optional) */}
        <div className="space-y-1.5">
          <label htmlFor="if-phone" className="block text-sm font-medium text-ink">
            Telefon{" "}
            <span className="text-ink-faded text-xs font-normal">(optional)</span>
          </label>
          <input
            id="if-phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="+49 7181 ..."
            className={inputClass()}
          />
        </div>

        {/* Artikelart */}
        <div className="space-y-1.5">
          <label htmlFor="if-itemType" className="block text-sm font-medium text-ink">
            Artikelart
          </label>
          <div className="relative">
            <select
              id="if-itemType"
              name="itemType"
              defaultValue=""
              className={inputClass("appearance-none pr-10")}
            >
              <option value="">Bitte wahlen...</option>
              {ITEM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faded" />
          </div>
        </div>
      </div>

      {/* Geschatztes Gewicht */}
      <div className="space-y-1.5">
        <label htmlFor="if-weight" className="block text-sm font-medium text-ink">
          Geschatztes Gewicht in Gramm{" "}
          <span className="text-ink-faded text-xs font-normal">(optional)</span>
        </label>
        <input
          id="if-weight"
          name="weightEstimateGrams"
          type="text"
          inputMode="decimal"
          placeholder="z. B. 31,1"
          className={inputClass("sm:max-w-xs")}
        />
        <p className="text-xs text-ink-faded">
          Angabe nicht erforderlich. Wir prufen vor Ort oder anhand von Fotos.
        </p>
      </div>

      {/* Beschreibung */}
      <div className="space-y-1.5">
        <label htmlFor="if-description" className="block text-sm font-medium text-ink">
          Kurzbeschreibung <span className="text-gold">*</span>
        </label>
        <textarea
          id="if-description"
          name="description"
          required
          rows={4}
          placeholder="Was mochten Sie verkaufen? Anzahl, Zustand, besondere Merkmale ..."
          className={inputClass("resize-none")}
        />
      </div>

      {status === "error" && (
        <p role="alert" className="rounded-button border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMsg}
        </p>
      )}

      <button
        type="submit"
        disabled={status === "sending"}
        className="bg-gold-gradient inline-flex items-center gap-2 rounded-button px-7 py-3 text-sm font-semibold text-[#2b210a] shadow-gold transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 disabled:opacity-60 disabled:cursor-not-allowed disabled:transform-none"
      >
        {status === "sending" ? "Wird gesendet..." : "Anfrage absenden"}
      </button>
    </form>
  );
}
