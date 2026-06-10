"use client";

import { ShieldCheck, TrendingUp, FileCheck2, Lock, Truck, Award } from "lucide-react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { Reveal } from "@/components/ui/reveal";

const props = [
  { icon: ShieldCheck, title: "Versichert & zertifiziert", body: "Jedes Stück geprüft, dokumentiert und auf dem Versandweg vollständig versichert." },
  { icon: TrendingUp, title: "Live-Marktpreise", body: "Anlagegold zum transparenten Tageskurs, keine versteckten Aufschläge." },
  { icon: FileCheck2, title: "GoBD- & GwG-konform", body: "Fiskalisch sauber nach deutschem Recht, von der Kasse bis zum Online-Beleg." },
  { icon: Lock, title: "Sichere Zahlung", body: "Stripe-verschlüsselt, SEPA, Klarna und Vorkasse für Anlagegold." },
  { icon: Truck, title: "Diskreter Versand", body: "Wertversichert per DHL, neutral verpackt, mit Sendungsverfolgung." },
  { icon: Award, title: "Geprüfte Sachkunde", body: "Fundierte Expertise in Numismatik, Edelmetallen und Antiquitäten." },
];

const itemV: Variants = {
  hidden: { opacity: 0, y: 24, filter: "blur(5px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};
const iconV: Variants = {
  hidden: { opacity: 0, scale: 0.4, rotate: -12 },
  show: { opacity: 1, scale: 1, rotate: 0, transition: { type: "spring", stiffness: 320, damping: 17, delay: 0.08 } },
};

export function ValueProps() {
  const reduce = useReducedMotion();

  return (
    <section className="py-section">
      <div className="mx-auto max-w-edge px-5">
        <Reveal className="max-w-measure">
          <p className="eyebrow">Worauf Sie zählen können</p>
          <motion.span
            className="mt-w14-3 block h-px w-16 origin-left bg-gradient-to-r from-gold to-transparent"
            aria-hidden="true"
            initial={reduce ? false : { scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true, margin: "-12%" }}
            transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          />
        </Reveal>

        <motion.div
          className="mt-w14-4 grid gap-x-w14-4 gap-y-w14-4 sm:grid-cols-2 lg:grid-cols-3"
          initial={reduce ? false : "hidden"}
          whileInView="show"
          viewport={{ once: true, margin: "-12%" }}
          variants={{ hidden: {}, show: { transition: { staggerChildren: 0.1 } } }}
        >
          {props.map((p, i) => (
            <motion.div key={i} variants={reduce ? undefined : itemV} className="group flex gap-w14-3" style={{ willChange: "transform, opacity" }}>
              <motion.span
                className="relative grid h-12 w-12 shrink-0 place-items-center rounded-card bg-raised text-gold ring-gold-soft transition-colors duration-base ease-hover group-hover:bg-[color:color-mix(in_srgb,var(--w14-gold)_8%,transparent)]"
                variants={reduce ? undefined : iconV}
                transition={{ type: "spring", stiffness: 300, damping: 18 }}
              >
                <p.icon className="relative h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
              </motion.span>
              <div>
                <h3 className="font-display text-fluid-h3 font-medium leading-snug">
                  <span className="underline-draw decoration-gold">{p.title}</span>
                </h3>
                <p className="mt-w14-1 max-w-measure text-fluid-body text-ink-aged">{p.body}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
