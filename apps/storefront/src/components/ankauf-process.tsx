"use client";

import { useRef } from "react";
import { ScanLine, BadgeCheck, Banknote, ArrowRight } from "lucide-react";
import { motion, useReducedMotion, useScroll, useSpring, type Variants } from "framer-motion";
import { Reveal } from "@/components/ui/reveal";
import { metalRates, eur } from "@/lib/placeholder-data";

const steps = [
  {
    icon: ScanLine,
    title: "Bewerten lassen",
    body: "Foto hochladen oder vorbeibringen. Wir bestimmen Material, Gewicht und Tagespreis, transparent und kostenlos.",
  },
  {
    icon: BadgeCheck,
    title: "Prüfen & Angebot",
    body: "Sachkundige Prüfung im Haus. Sie erhalten ein faires, schriftliches Angebot auf Basis des Live-Goldkurses.",
  },
  {
    icon: Banknote,
    title: "Sofort-Auszahlung",
    body: "Bei Zustimmung zahlen wir sofort aus, bar oder per Überweisung, GwG-konform dokumentiert.",
  },
];

const stepV: Variants = {
  hidden: { opacity: 0, x: 36, filter: "blur(6px)" },
  show: { opacity: 1, x: 0, filter: "blur(0px)", transition: { duration: 0.72, ease: [0.16, 1, 0.3, 1] } },
};
const badgeV: Variants = {
  hidden: { scale: 0, rotate: -30 },
  show: { scale: 1, rotate: 0, transition: { type: "spring", stiffness: 360, damping: 16, delay: 0.12 } },
};

export function AnkaufProcess() {
  const gold = metalRates[0];
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
    <section id="ankauf" className="border-y border-rule bg-card py-section">
      <div className="mx-auto max-w-edge px-5">
        <div className="grid items-center gap-w14-5 lg:grid-cols-[0.9fr_1.1fr]">
          <Reveal>
            <p className="eyebrow text-gold">Goldankauf</p>
            <h2 className="mt-w14-3 font-display text-fluid-h2 font-medium leading-tight">
              Gold verkaufen in&nbsp;drei&nbsp;Schritten
            </h2>
            <motion.span
              className="mt-w14-3 block h-px w-16 origin-left bg-gradient-to-r from-gold to-transparent"
              aria-hidden="true"
              initial={reduce ? false : { scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true, margin: "-12%" }}
              transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            />
            <p className="mt-w14-3 max-w-measure text-fluid-body text-ink-aged">
              Faire Tagespreise, sachkundige Bewertung und sofortige Auszahlung — mit
              echter Erfahrung in Gold, Münzen und Nachlässen.
            </p>

            <Reveal delay={0.15} blur={false}>
              <motion.div
                className="group mt-w14-4 flex flex-col gap-w14-3 rounded-card border border-rule bg-surface p-card sm:flex-row sm:items-center"
                whileHover={reduce ? undefined : { y: -4 }}
                transition={{ type: "spring", stiffness: 320, damping: 24 }}
              >
                <div className="flex items-center gap-w14-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-raised text-gold ring-gold-soft">
                    <Banknote className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="eyebrow">Tagespreis Gold</div>
                    <div className="tnum mt-w14-1 font-display text-fluid-h3 font-medium text-ink">
                      {eur(gold.pricePerGram)}/g
                    </div>
                  </div>
                </div>
                <a
                  href="/goldankauf"
                  className="group/cta inline-flex min-h-[48px] items-center justify-center gap-2 rounded-button border border-gold/40 bg-surface px-5 py-3 text-fluid-body font-medium text-ink transition-colors duration-base ease-hover hover:border-gold hover:text-gold-deep sm:ml-auto"
                >
                  Bewerten lassen
                  <ArrowRight className="h-4 w-4 transition-transform duration-base ease-hover group-hover/cta:translate-x-1" aria-hidden="true" />
                </a>
              </motion.div>
            </Reveal>
          </Reveal>

          <div ref={listRef} className="relative">
            {/* the static track + the draw-on-scroll gold thread — a single
                quiet hairline that stitches the three steps as you scroll */}
            <div className="absolute left-[34px] top-10 hidden h-[calc(100%-5rem)] w-px bg-rule md:block" aria-hidden="true">
              <motion.span
                className="absolute inset-x-0 top-0 origin-top bg-gradient-to-b from-gold via-gold-soft to-gold-deep"
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
                    className="hover-lift group relative flex gap-w14-3 rounded-card border border-rule bg-surface p-card shadow-card hover:shadow-lift"
                    whileHover={reduce ? undefined : { y: -5 }}
                    transition={{ type: "spring", stiffness: 320, damping: 24 }}
                  >
                    <div className="relative z-10 grid h-[68px] w-[68px] shrink-0 place-items-center rounded-full bg-ink text-gold">
                      <motion.span
                        whileHover={reduce ? undefined : { rotate: -6, scale: 1.06 }}
                        transition={{ type: "spring", stiffness: 280, damping: 16 }}
                      >
                        <s.icon className="h-7 w-7" strokeWidth={1.4} aria-hidden="true" />
                      </motion.span>
                      <motion.span
                        className="tnum absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full bg-gold text-[0.72rem] font-semibold text-white"
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
      </div>
    </section>
  );
}
