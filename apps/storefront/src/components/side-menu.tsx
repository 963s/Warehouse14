"use client";

import { motion, AnimatePresence } from "framer-motion";
import {
  X, Search, ChevronRight, Coins, Circle, CircleDot, Watch, Landmark,
  Stamp, Layers, Gem, Gift, ArrowRight,
} from "lucide-react";
import { megaCategories } from "@/lib/placeholder-data";
import { Logo } from "@/components/logo";

const EASE_OUT = [0.16, 1, 0.3, 1] as const; // curator entrance ease

const icons: Record<string, typeof Coins> = {
  coins: Coins, circle: Circle, "circle-dot": CircleDot, watch: Watch,
  landmark: Landmark, stamp: Stamp, layers: Layers, gem: Gem, gift: Gift,
};

const secondary = [
  { label: "Goldankauf", href: "/goldankauf" },
  { label: "Bewertung & Schätzung", href: "/goldankauf" },
  { label: "Über uns", href: "/ueber-uns" },
  { label: "Kontakt", href: "/kontakt" },
];

export function SideMenu({
  open,
  onClose,
  onSignIn,
}: {
  open: boolean;
  onClose: () => void;
  onSignIn: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[80] bg-ink/45 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.42, ease: EASE_OUT }}
            onClick={onClose}
          />
          <motion.aside
            id="side-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Navigationsmenü"
            className="grain fixed inset-y-0 left-0 z-[90] flex w-[min(380px,88vw)] flex-col bg-card shadow-modal overscroll-contain"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ duration: 0.42, ease: EASE_OUT }}
          >
            <div className="flex items-center justify-between border-b border-rule px-5 py-4">
              <Logo className="text-ink" />
              <button
                aria-label="Menü schließen"
                onClick={onClose}
                className="grid h-11 w-11 place-items-center rounded-button text-ink-faded transition-colors duration-fast ease-hover hover:bg-raised hover:text-ink"
              >
                <X className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            </div>

            <div className="px-5 py-4">
              <button
                onClick={onClose}
                className="flex w-full items-center gap-2.5 rounded-button border border-rule bg-surface px-3.5 py-3 text-left text-sm text-ink-faded transition-colors duration-fast ease-hover hover:border-gold/40 hover:text-ink-aged"
              >
                <Search className="h-[18px] w-[18px]" aria-hidden="true" />
                Suche nach Münzen, Gold, Antiquitäten …
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 pb-4">
              <div className="smallcaps px-2 pb-2 text-xs font-semibold text-ink-faded">Sortiment</div>
              <ul>
                {megaCategories.map((c, i) => {
                  const Icon = icons[c.icon] ?? Circle;
                  return (
                    <motion.li
                      key={c.slug}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.42, delay: 0.05 + i * 0.07, ease: EASE_OUT }}
                    >
                      <a
                        href={`/kollektion?category=${c.slug}`}
                        onClick={onClose}
                        className="group flex min-h-[44px] items-center gap-3.5 rounded-button px-2 py-2.5 transition-colors duration-fast ease-hover hover:bg-raised"
                      >
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-button bg-gold/10 text-gold ring-gold-soft transition-colors duration-base ease-hover group-hover:bg-gold group-hover:text-white">
                          <Icon className="h-[19px] w-[19px]" strokeWidth={1.6} aria-hidden="true" />
                        </span>
                        <span className="flex-1">
                          <span className="block font-medium leading-tight text-ink">{c.name}</span>
                          <span className="block text-xs text-ink-faded">{c.hint}</span>
                        </span>
                        <span className="tnum text-xs text-ink-faded">{c.count.toLocaleString("de-DE")}</span>
                        <ChevronRight className="h-4 w-4 text-ink-faded transition-transform duration-base ease-hover group-hover:translate-x-0.5 group-hover:text-gold" aria-hidden="true" />
                      </a>
                    </motion.li>
                  );
                })}
              </ul>

              <div className="my-3 h-px bg-rule" />
              <ul className="px-2">
                {secondary.map((s) => (
                  <li key={s.label}>
                    <a
                      href={s.href}
                      onClick={onClose}
                      className="flex min-h-[44px] items-center text-sm text-ink-aged transition-colors duration-fast ease-hover hover:text-gold"
                    >
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="border-t border-rule p-4">
              <button
                onClick={() => {
                  onClose();
                  onSignIn();
                }}
                className="bg-gold-gradient flex min-h-[44px] w-full items-center justify-center gap-2 rounded-button px-4 py-3 text-sm font-semibold text-[#2b210a] transition-transform duration-fast ease-hover hover:-translate-y-0.5"
              >
                Anmelden / Konto erstellen <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
