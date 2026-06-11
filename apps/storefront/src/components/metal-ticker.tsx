"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { data, eur } from "@/lib/storefront-data";

type Rate = Awaited<ReturnType<typeof data.getMetalRates>>[number];

/* Fixed-width edge fade for the marquee: 32px on both sides regardless of
 * viewport, narrower than the 40px lead-in of the tape. */
const EDGE_FADE_MASK =
  "linear-gradient(90deg, transparent, #000 32px, #000 calc(100% - 32px), transparent)";

/**
 * A calm live-price strip. Reads the data layer (live metal_prices in live
 * mode) after mount, so it embeds safely in server pages (home) and client
 * pages (PageShell). A single smooth marquee glides the kurse past at a
 * steady pace — no blinking, no glow — edge-masked so they fade in/out
 * rather than pop, and pauses on hover so a reader can settle on a number.
 * Reduced-motion users get a calm static row.
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

  // Solid bg-raised — the old /70 opacity modifier never compiled against the
  // var() theme colors, so the strip was sitting on a transparent ground.
  return (
    <div
      role="region"
      aria-label="Aktuelle Edelmetallkurse"
      className="relative overflow-hidden border-b border-rule bg-raised text-ink"
    >
      <div className="relative mx-auto flex max-w-edge items-center gap-x-w14-4 px-5 py-2">
        <span className="eyebrow flex shrink-0 items-center gap-2">
          <LiveDot />
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
          /* dazzle: an endless, edge-faded marquee that pauses on hover.
           * The fade is a FIXED 32px (the old 7%-wide mask swallowed the
           * first label on wide screens), and each half carries its own
           * 40px lead-in, so at the start the first item sits complete and
           * readable past the fade — label and value never separate. The
           * lead-in lives INSIDE each identical half, keeping the -50%
           * loop perfectly seamless. */
          <div
            className="group/mq relative min-w-0 flex-1 overflow-hidden"
            style={{ WebkitMaskImage: EDGE_FADE_MASK, maskImage: EDGE_FADE_MASK }}
          >
            <motion.ul
              className="flex w-max items-center group-hover/mq:[animation-play-state:paused]"
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
                <li key={half} className="flex items-center gap-x-w14-4 pl-w14-4" aria-hidden={half === 1}>
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
      <span className="text-ink-aged">{m.label}</span>
      <span className="tnum text-ink-faded">{eur(m.pricePerGramEur)}/g</span>
      <span className={`tnum inline-flex items-center gap-0.5 ${up ? "text-verdigris" : "text-wax-red"}`}>
        <span aria-hidden="true" className="text-[0.62rem] leading-none">
          {up ? "▲" : "▼"}
        </span>
        {Math.abs(m.changePct).toFixed(2)} %
      </span>
      <span aria-hidden="true" className="mx-1 h-3 w-px bg-[color:color-mix(in_srgb,var(--w14-ink)_12%,transparent)]" />
    </span>
  );
}

/* A steady verdigris dot — a quiet "live" marker. No ping, no blink; the
 * gliding tape itself is what says the prices are moving. */
function LiveDot() {
  return (
    <span className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full bg-verdigris" />
  );
}
