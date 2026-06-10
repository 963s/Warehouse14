"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { data, eur } from "@/lib/storefront-data";

type Rate = Awaited<ReturnType<typeof data.getMetalRates>>[number];

/**
 * A living live-price strip. Reads the data layer (live metal_prices in live
 * mode) after mount, so it embeds safely in server pages (home) and client
 * pages (PageShell). A single buttery marquee glides the kurse past forever,
 * edge-masked so they fade in/out rather than pop, and pauses on hover so a
 * reader can settle on a number. Reduced-motion users get a calm static row.
 */
export function MetalTicker() {
  const [rates, setRates] = useState<Rate[]>([]);
  const reduce = useReducedMotion();

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
      className="relative overflow-hidden border-b border-white/10 bg-[#14110b] text-white/85"
    >
      {/* faint gold under-light so the strip reads as a lit terminal, not a bar */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 160% at 50% -40%, rgba(191,148,48,0.10), transparent 60%)",
        }}
      />

      <div className="relative mx-auto flex max-w-edge items-center gap-x-w14-4 px-5 py-2">
        <span className="eyebrow flex shrink-0 items-center gap-2 text-gold/80">
          <LiveDot reduce={!!reduce} />
          Tageskurse
        </span>

        {reduce ? (
          /* calm: a plain, static, wrapping list — no motion at all */
          <ul className="flex flex-wrap items-center gap-x-w14-4 gap-y-1">
            {rates.map((m) => (
              <RateItem key={m.metal} m={m} />
            ))}
          </ul>
        ) : (
          /* dazzle: an endless, edge-faded marquee that pauses on hover */
          <div className="group/mq relative min-w-0 flex-1 overflow-hidden marquee-mask">
            <motion.ul
              className="flex w-max items-center gap-x-w14-4 group-hover/mq:[animation-play-state:paused]"
              style={{ willChange: "transform" }}
              animate={{ x: ["0%", "-50%"] }}
              transition={{
                duration: Math.max(22, rates.length * 6),
                ease: "linear",
                repeat: Infinity,
              }}
            >
              {/* two identical halves → the -50% loop is perfectly seamless */}
              {[0, 1].map((half) => (
                <li key={half} className="flex items-center gap-x-w14-4" aria-hidden={half === 1}>
                  {rates.map((m) => (
                    <RateItem key={`${half}-${m.metal}`} m={m} />
                  ))}
                </li>
              ))}
            </motion.ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* One kurs entry. The change figure breathes in colour-coded ink; on the
 * marquee a thin divider trails each so the strip reads as a continuous tape. */
function RateItem({ m }: { m: Rate }) {
  const up = m.changePct >= 0;
  return (
    <span className="flex shrink-0 items-baseline gap-2 whitespace-nowrap text-[0.78rem]">
      <span className="text-white/85">{m.label}</span>
      <span className="tnum text-white/65">{eur(m.pricePerGramEur)}/g</span>
      <span className={`tnum inline-flex items-center gap-0.5 ${up ? "text-verdigris" : "text-wax-red"}`}>
        <span aria-hidden="true" className="text-[0.62rem] leading-none">
          {up ? "▲" : "▼"}
        </span>
        {Math.abs(m.changePct).toFixed(2)} %
      </span>
      <span aria-hidden="true" className="mx-1 h-3 w-px bg-white/10" />
    </span>
  );
}

/* A breathing gold dot — the heartbeat that says "these prices are live". */
function LiveDot({ reduce }: { reduce: boolean }) {
  return (
    <span className="relative inline-flex h-2 w-2 items-center justify-center">
      {!reduce && (
        <motion.span
          className="absolute inset-0 rounded-full bg-gold"
          animate={{ scale: [1, 2.4], opacity: [0.5, 0] }}
          transition={{ duration: 1.8, ease: "easeOut", repeat: Infinity }}
        />
      )}
      <span className="relative h-1.5 w-1.5 rounded-full bg-gold" />
    </span>
  );
}
