"use client";

import { useEffect, useState } from "react";
import { Calculator, ChevronDown } from "lucide-react";
import { data, eur } from "@/lib/storefront-data";
import type { MetalRate } from "@/lib/storefront-data";

const METAL_ORDER: MetalRate["metal"][] = ["gold", "silver", "platinum", "palladium"];

function normalizeDecimal(raw: string): string {
  return raw.replace(",", ".");
}

export function MetalCalculator() {
  const [rates, setRates] = useState<MetalRate[]>([]);
  const [selectedMetal, setSelectedMetal] = useState<MetalRate["metal"]>("gold");
  const [weightInput, setWeightInput] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    data.getMetalRates().then((r) => {
      const ordered = METAL_ORDER.map((m) => r.find((x) => x.metal === m)).filter(
        Boolean,
      ) as MetalRate[];
      setRates(ordered.length > 0 ? ordered : r);
      setLoading(false);
    });
  }, []);

  const activeRate = rates.find((r) => r.metal === selectedMetal);
  const weightNum = parseFloat(normalizeDecimal(weightInput));
  const indicativeValue =
    activeRate && !isNaN(weightNum) && weightNum > 0
      ? weightNum * activeRate.pricePerGramEur
      : null;

  return (
    <div className="rounded-card border border-rule bg-card p-6 shadow-card md:p-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-raised text-ink">
          <Calculator aria-hidden="true" className="h-5 w-5" strokeWidth={1.7} />
        </div>
        <div>
          <h3 className="font-display text-xl font-semibold text-ink">
            Ankaufswert berechnen
          </h3>
          <p className="text-xs text-ink-faded">Indikativ auf Basis des Tagespreises</p>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        {/* Metallauswahl */}
        <div className="space-y-1.5">
          <label htmlFor="calc-metal" className="block text-sm font-medium text-ink">
            Metall
          </label>
          <div className="relative">
            <select
              id="calc-metal"
              value={selectedMetal}
              onChange={(e) => setSelectedMetal(e.target.value as MetalRate["metal"])}
              className="min-h-[44px] w-full appearance-none rounded-button border border-rule bg-surface px-4 py-2.5 pr-10 text-base text-ink focus:outline-none focus:ring-2 focus:ring-ink/40 transition-[border-color,box-shadow]"
            >
              {loading && (
                <option value="gold">Gold wird geladen …</option>
              )}
              {rates.map((r) => (
                <option key={r.metal} value={r.metal}>
                  {r.label}, {eur(r.pricePerGramEur)}/g
                </option>
              ))}
            </select>
            <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faded" />
          </div>
        </div>

        {/* Gewichtseingabe */}
        <div className="space-y-1.5">
          <label htmlFor="calc-weight" className="block text-sm font-medium text-ink">
            Gewicht in Gramm
          </label>
          <input
            id="calc-weight"
            type="text"
            inputMode="decimal"
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
            placeholder="z. B. 31,1 oder 100"
            className="min-h-[44px] w-full rounded-button border border-rule bg-surface px-4 py-2.5 text-base text-ink placeholder:text-ink-faded focus:outline-none focus:ring-2 focus:ring-ink/40 transition-[border-color,box-shadow]"
          />
        </div>
      </div>

      {/* Ergebnis */}
      <div aria-live="polite" aria-atomic="true" className="mt-6 rounded-card border border-rule bg-surface p-5">
        {indicativeValue !== null ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-widest text-ink-faded">
              Indikativer Ankaufswert
            </span>
            <span className="tnum text-3xl font-semibold text-ink">
              {eur(indicativeValue)}
            </span>
            {activeRate && (
              <span className="mt-1 text-xs text-ink-faded">
                Basis: {eur(activeRate.pricePerGramEur)}/g Tagespreis {activeRate.label}
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-faded">
            Bitte Metall und Gewicht eingeben, um den indikativen Wert zu sehen.
          </p>
        )}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-ink-faded">
        Indikativ, finaler Preis nach Prüfung. Gewichtsangabe in Feingold, Feinsilber
        oder entsprechendem Reinmetall. Legierungen werden anteilig bewertet.
      </p>
    </div>
  );
}
