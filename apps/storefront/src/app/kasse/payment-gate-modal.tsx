"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { CalendarDays, X } from "lucide-react";
import { Kicker } from "@/components/brand/kicker";
import { BrandRule } from "@/components/brand/marks";
import { WhatsAppIcon } from "@/components/brand-icons";
import { waLink } from "@/lib/contact";
import { eur } from "@/lib/storefront-data";

/** One line of the shopper's selection, used for the WhatsApp reservation text. */
export type GateItem = { name: string; quantity: number };

/**
 * Builds the prefilled WhatsApp reservation message from the cart recap.
 * Plain item names + total only — no addresses, no contact data.
 */
function reservationMessage(items: GateItem[], totalEur: string): string {
  const lines = items.map((it) => `· ${it.quantity} × ${it.name}`);
  return [
    "Guten Tag, ich möchte gern folgende Stücke reservieren:",
    ...lines,
    `Gesamt: ${eur(totalEur)}`,
  ].join("\n");
}

/**
 * The honest payment gate. Opens at the final ordering action: the online
 * payment connection is not live yet, so instead of a fake success the house
 * invites the shopper into the shop — per WhatsApp-Reservierung oder Termin.
 * Mirrors the CartDrawer overlay behaviour (scroll lock, ESC, focus trap).
 */
export function PaymentGateModal({
  open,
  onClose,
  items,
  totalEur,
}: {
  open: boolean;
  onClose: () => void;
  items: GateItem[];
  totalEur: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => closeRef.current?.focus(), 80);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              /* explicit rgba: token colors carry no alpha channel (see CartDrawer) */
              className="fixed inset-0 z-[95] bg-[rgba(28,28,28,0.45)] backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />
            <div className="fixed inset-0 z-[100] grid place-items-end p-0 sm:place-items-center sm:p-6">
              <motion.div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="payment-gate-title"
                aria-describedby="payment-gate-desc"
                className="w-full rounded-t-card bg-card p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-modal sm:max-w-md sm:rounded-card sm:p-8"
                initial={{ y: 48, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 48, opacity: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 34 }}
              >
                <div className="flex items-start justify-between gap-4">
                  <Kicker>Einen Schritt vor dem Ziel</Kicker>
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={onClose}
                    aria-label="Schließen"
                    className="-mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-button text-ink-faded transition-colors hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                  >
                    <X aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.7} />
                  </button>
                </div>

                <h2
                  id="payment-gate-title"
                  className="mt-3 font-display text-2xl font-semibold leading-snug text-ink"
                >
                  Online-Zahlung noch nicht verfügbar
                </h2>
                <p id="payment-gate-desc" className="mt-3 text-sm leading-relaxed text-ink-aged">
                  Die Zahlungsanbindung wird derzeit eingerichtet. Besuchen Sie uns im
                  Geschäft oder reservieren Sie telefonisch.
                </p>
                <p className="mt-2 text-sm leading-relaxed text-ink-aged">
                  Ihre Auswahl bleibt im Warenkorb gespeichert — gern legen wir die Stücke
                  für Sie zurück.
                </p>

                <BrandRule className="mt-6 block w-32 text-gilt" />

                {/* Direct channels: reserve per WhatsApp, or come by with a Termin */}
                <div className="mt-6 flex flex-col gap-3">
                  <a
                    href={waLink(reservationMessage(items, totalEur))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[48px] items-center justify-center gap-2.5 rounded-button border border-ink/25 bg-card px-5 py-3 text-sm font-semibold text-ink transition-colors hover:border-[#25D366]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                  >
                    <WhatsAppIcon className="h-[18px] w-[18px] text-[#25D366]" />
                    Per WhatsApp reservieren
                  </a>
                  <Link
                    href="/termin"
                    className="inline-flex min-h-[48px] items-center justify-center gap-2.5 rounded-button bg-ink px-5 py-3 text-sm font-semibold text-white shadow-card transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
                  >
                    <CalendarDays aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.7} />
                    Termin im Geschäft vereinbaren
                  </Link>
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex min-h-[44px] items-center justify-center text-sm font-medium text-ink-aged underline underline-offset-4 transition-colors hover:text-ink"
                  >
                    Zurück zur Kasse
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
