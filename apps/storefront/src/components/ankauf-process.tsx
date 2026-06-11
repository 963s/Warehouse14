"use client";

import { useEffect, useRef, useState } from "react";
import { ScanLine, BadgeCheck, Banknote, ArrowRight } from "lucide-react";
import { motion, useReducedMotion, useScroll, useSpring, type Variants } from "framer-motion";
import { Kicker } from "@/components/brand/kicker";
import { WhatsAppIcon } from "@/components/brand-icons";
import { Reveal } from "@/components/ui/reveal";
import { waLink } from "@/lib/contact";
import { data, eur } from "@/lib/storefront-data";

/* The full treasure intake — Gold, Schmuck, Münzen, Briefmarken, ganze
 * Nachlässe — told as the same calm three-step thread. */
const steps = [
  {
    icon: ScanLine,
    title: "Bewerten lassen",
    body: "Foto senden oder vorbeibringen: Gold, Schmuck, Münzen, Briefmarken oder der ganze Karton. Kostenlos und unverbindlich.",
  },
  {
    icon: BadgeCheck,
    title: "Prüfen & Angebot",
    body: "Sachkundige Prüfung mit der Lupe im Haus. Sie erhalten ein faires, schriftliches Angebot, bei Edelmetallen auf Basis des Tageskurses.",
  },
  {
    icon: Banknote,
    title: "Sofort-Auszahlung",
    body: "Bei Zustimmung zahlen wir sofort aus, bar oder per Überweisung, GwG-konform dokumentiert.",
  },
];

/* One-pass slide on the curator ease — transform/opacity only, the entrance
 * blur and the spinning badge were decorative noise on a phone GPU. */
const stepV: Variants = {
  hidden: { opacity: 0, x: 28 },
  show: { opacity: 1, x: 0, transition: { duration: 0.72, ease: [0.16, 1, 0.3, 1] } },
};
const badgeV: Variants = {
  hidden: { opacity: 0, scale: 0.6 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.12 } },
};

export function AnkaufProcess() {
  /* Live Tageskurs through the one data seam — never a hardcoded quote. The
   * tile simply stays hidden until real rates arrive (or in error). */
  const [goldRate, setGoldRate] = useState<
    Awaited<ReturnType<typeof data.getMetalRates>>[number] | null
  >(null);
  useEffect(() => {
    let on = true;
    data
      .getMetalRates()
      .then((rs) => {
        if (!on) return;
        const g = rs.find((r) => r.metal.toLowerCase().includes("gold")) ?? rs[0] ?? null;
        setGoldRate(g);
      })
      .catch(() => {});
    return () => {
      on = false;
    };
  }, []);
  const reduce = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);

  // The connecting hairline draws itself as the column scrolls through the
  // viewport — the signature "progress thread" stitching the three steps.
  const { scrollYProgress } = useScroll({
    target: listRef,
    offset: ["start 80%", "end 60%"],
  });
  const lineScale = useSpring(scrollYProgress, { stiffness: 120, damping: 28, mass: 0.4 });

  return (
    <section id="ankauf" className="border-y border-rule bg-raised py-section">
      <div className="mx-auto max-w-edge px-5">
        <div className="grid items-center gap-w14-5 lg:grid-cols-[0.9fr_1.1fr]">
          <Reveal>
            <Kicker>Ankauf &amp; Bewertung</Kicker>
            <h2 className="mt-w14-3 font-display text-fluid-h2 font-medium leading-tight">
              Schätze verkaufen in&nbsp;drei&nbsp;Schritten
            </h2>
            <motion.span
              className="mt-w14-3 block h-px w-16 origin-left bg-[color:color-mix(in_srgb,var(--w14-ink)_35%,transparent)]"
              aria-hidden="true"
              initial={reduce ? false : { scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true, margin: "-12%" }}
              transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            />
            <p className="mt-w14-3 max-w-measure text-fluid-body text-ink-aged">
              Ob Gold, Schmuck, Münzen, Briefmarken oder ein ganzer Nachlass:
              faire Preise, sachkundige Bewertung und sofortige Auszahlung.
            </p>

            {/* The quote tile renders only once REAL rates arrive through the
             * data seam — never a hardcoded number, never an empty shell. */}
            {goldRate && (
              <Reveal delay={0.15} blur={false}>
                <motion.div
                  className="group mt-w14-4 flex flex-col gap-w14-3 rounded-card border border-rule bg-card p-card sm:flex-row sm:items-center"
                  whileHover={reduce ? undefined : { y: -4 }}
                  transition={{ type: "spring", stiffness: 320, damping: 24 }}
                >
                  <div className="flex items-center gap-w14-3">
                    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-rule bg-raised text-ink">
                      <Banknote className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
                    </span>
                    <div>
                      <div className="eyebrow">Tagespreis Gold</div>
                      {/* tnum carries the mono price voice — no display face on numbers */}
                      <div className="tnum mt-w14-1 text-fluid-h3 font-medium text-ink">
                        {eur(goldRate.pricePerGramEur)}/g
                      </div>
                    </div>
                  </div>
                  <a
                    href="/goldankauf"
                    className="group/cta inline-flex min-h-[48px] items-center justify-center gap-2 rounded-button border border-ink/25 bg-card px-5 py-3 text-fluid-body font-medium text-ink transition-colors duration-base ease-hover hover:border-ink/60 sm:ml-auto"
                  >
                    Bewerten lassen
                    <ArrowRight className="h-[18px] w-[18px] transition-transform duration-base ease-hover group-hover/cta:translate-x-1" strokeWidth={1.8} aria-hidden="true" />
                  </a>
                </motion.div>
              </Reveal>
            )}
          </Reveal>

          <div ref={listRef} className="relative">
            {/* the static track + the draw-on-scroll ink thread — a single
                quiet hairline that stitches the three steps as you scroll.
                left = card border + p-card + half disc, so the thread runs
                straight through the disc centres */}
            <div className="absolute left-[56px] top-14 hidden h-[calc(100%-7rem)] w-px bg-rule md:block" aria-hidden="true">
              <motion.span
                className="absolute inset-x-0 top-0 origin-top bg-[color:color-mix(in_srgb,var(--w14-ink)_35%,transparent)]"
                style={reduce ? { height: "100%" } : { height: "100%", scaleY: lineScale, willChange: "transform" }}
              />
            </div>

            <motion.ol
              className="space-y-w14-3"
              initial={reduce ? false : "hidden"}
              whileInView="show"
              viewport={{ once: true, margin: "-12%" }}
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.16 } } }}
            >
              {steps.map((s, i) => (
                <motion.li
                  key={i}
                  variants={reduce ? undefined : stepV}
                  style={{ willChange: "transform, opacity" }}
                >
                  <motion.div
                    className="hover-lift group relative flex gap-w14-3 rounded-card border border-rule bg-card p-card shadow-card hover:shadow-lift"
                    whileHover={reduce ? undefined : { y: -5 }}
                    transition={{ type: "spring", stiffness: 320, damping: 24 }}
                  >
                    {/* 56px disc, 20px/1.7 icon — same optical weight as the
                        ValueProps chips; the card-ring punches the badge
                        out of the disc instead of letting ink blend into ink */}
                    <div className="relative z-10 grid h-14 w-14 shrink-0 place-items-center rounded-full bg-ink text-white">
                      <s.icon className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
                      <motion.span
                        className="tnum absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-ink text-[0.72rem] font-semibold text-white ring-2 ring-card"
                        variants={reduce ? undefined : badgeV}
                      >
                        {i + 1}
                      </motion.span>
                    </div>
                    <div>
                      <h3 className="font-display text-fluid-h3 font-medium leading-snug">{s.title}</h3>
                      <p className="mt-w14-1 max-w-measure text-fluid-body text-ink-aged">{s.body}</p>
                    </div>
                  </motion.div>
                </motion.li>
              ))}
            </motion.ol>
          </div>
        </div>

        {/* The foot of the funnel: the booked half hour or the direct line.
            One solid action, one quiet outline — WhatsApp green stays on the
            icon and the hover edge only. */}
        <Reveal delay={0.1}>
          <div className="mt-w14-5 flex flex-col gap-w14-3 border-t border-rule pt-w14-4 lg:flex-row lg:items-center">
            <p className="text-sm leading-relaxed text-ink-aged lg:mr-auto lg:max-w-md">
              Am liebsten persönlich: Wir nehmen uns eine halbe Stunde Zeit für Sie.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                href="/termin"
                className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-button bg-ink px-6 py-3 text-sm font-semibold text-white transition-[background-color,transform] duration-fast ease-hover hover:-translate-y-px hover:bg-ink-aged"
              >
                Termin vereinbaren
              </a>
              <a
                href={waLink()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[48px] items-center justify-center gap-2.5 rounded-button border border-ink/25 bg-card px-6 py-3 text-sm font-medium text-ink transition-colors duration-fast ease-hover hover:border-[#25D366]/60"
              >
                <WhatsAppIcon className="h-[18px] w-[18px] text-[#25D366]" />
                Direkt per WhatsApp
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
