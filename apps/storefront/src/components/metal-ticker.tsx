"use client";

import { useEffect, useState } from "react";
import { data, eur } from "@/lib/storefront-data";

type Rate = Awaited<ReturnType<typeof data.getMetalRates>>[number];

/**
 * A whisper-thin live-price strip — not a marquee. Reads the data layer (live
 * metal_prices in live mode) after mount, so it embeds safely in server pages
 * (home) and client pages (PageShell). Prices stand still; facts stated plainly.
 */
export function MetalTicker() {
  const [rates, setRates] = useState<Rate[]>([]);

  useEffect(() => {
    let active = true;
    data
      .getMetalRates()
      .then((r) => {
        if (active) setRates(r);
      })
      .catch(() => {
        /* leave the strip empty if rates are unavailable — no error noise */
      });
    return () => {
      active = false;
    };
  }, []);

  if (rates.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Aktuelle Edelmetallkurse"
      className="border-b border-white/10 bg-[#14110b] text-white/85"
    >
      <div className="mx-auto flex max-w-edge flex-wrap items-center gap-x-w14-4 gap-y-1 px-5 py-2">
        <span className="eyebrow shrink-0 text-gold/80">Tageskurse</span>
        <ul className="flex flex-wrap items-center gap-x-w14-4 gap-y-1">
          {rates.map((m) => (
            <li key={m.metal} className="flex items-baseline gap-2 text-[0.78rem]">
              <span className="text-white/85">{m.label}</span>
              <span className="tnum text-white/65">{eur(m.pricePerGramEur)}/g</span>
              <span
                className={`tnum ${m.changePct >= 0 ? "text-verdigris" : "text-wax-red"}`}
              >
                {m.changePct >= 0 ? "+" : "−"}
                {Math.abs(m.changePct).toFixed(2)} %
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
