"use client";

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Search, ChevronRight, Coins, Circle, CircleDot, Watch, Landmark,
  Stamp, Layers, Gem, Hexagon, ArrowRight, Clock,
} from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { useCart } from "@/components/cart/cart-provider";
import { useWishlist } from "@/components/wishlist/wishlist-provider";

const EASE_OUT = [0.16, 1, 0.3, 1] as const; // curator entrance ease

/* The shop's real category tree (slugs match storefront-data, the
 * /kollektion?category= filter resolves every one of them). No counts:
 * we never show numbers the backend does not deliver. */
const categories = [
  { slug: "gold", name: "Gold", icon: Coins, hint: "Anlagemünzen & Barren" },
  { slug: "silber", name: "Silber", icon: CircleDot, hint: "Münzen & Barren" },
  { slug: "platin", name: "Platin", icon: Hexagon, hint: "Münzen & Barren" },
  { slug: "muenzen", name: "Münzen", icon: Circle, hint: "Historisch & numismatisch" },
  { slug: "schmuck", name: "Schmuck", icon: Gem, hint: "Gold, Silber & Vintage" },
  { slug: "uhren", name: "Uhren", icon: Watch, hint: "Vintage & Klassiker" },
  { slug: "antiquitaeten", name: "Antiquitäten", icon: Landmark, hint: "Mit Provenienz" },
  { slug: "briefmarken", name: "Briefmarken", icon: Stamp, hint: "Deutschland & weltweit" },
  { slug: "sammlerobjekte", name: "Sammlerobjekte", icon: Layers, hint: "Militaria & Raritäten" },
];

const services = [
  { label: "Goldankauf", href: "/goldankauf" },
  { label: "Termin vereinbaren", href: "/termin" },
];

const about = [
  { label: "Über uns", href: "/ueber-uns" },
  { label: "Kontakt", href: "/kontakt" },
];

export function SideMenu({
  open,
  onClose,
  onSignIn,
  onSearch,
}: {
  open: boolean;
  onClose: () => void;
  onSignIn: () => void;
  onSearch: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { count: cartCount } = useCart();
  const { count: wishlistCount } = useWishlist();

  /* Native-feeling overlay behaviour: lock the page scroll behind the menu,
   * close on ESC, keep Tab cycling inside the panel, focus the close button
   * once the slide-in has begun. Everything restores on close. */
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
          {/* `grain` forces position:relative, so it must NOT sit on the fixed
           * panel itself (that broke fixed positioning entirely). The texture
           * lives on the inner full-height wrapper instead. */}
          <motion.aside
            ref={panelRef}
            id="side-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Navigationsmenü"
            className="fixed inset-y-0 left-0 z-[90] w-[min(380px,88vw)] bg-card shadow-modal"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ duration: 0.42, ease: EASE_OUT }}
          >
            <div className="grain flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-rule px-5 py-4">
                {/* compact official lockup: wordmark, then roundel, no trade line */}
                <Logo compact className="text-ink" />
                <button
                  ref={closeRef}
                  aria-label="Menü schließen"
                  onClick={onClose}
                  className="grid h-11 w-11 place-items-center rounded-button text-ink-faded transition-colors duration-fast ease-hover hover:bg-raised hover:text-ink"
                >
                  <X className="h-[18px] w-[18px]" aria-hidden="true" />
                </button>
              </div>

              <div className="px-5 py-4">
                {/* hands over to the search overlay: close menu, open search */}
                <button
                  onClick={() => {
                    onClose();
                    onSearch();
                  }}
                  className="flex min-h-[44px] w-full items-center gap-2.5 rounded-button border border-rule bg-surface px-3.5 py-3 text-left text-sm text-ink-faded transition-colors duration-fast ease-hover hover:border-ink/30 hover:text-ink-aged"
                >
                  <Search className="h-[18px] w-[18px]" aria-hidden="true" />
                  Suche nach Münzen, Gold, Antiquitäten …
                </button>
              </div>

              {/* extra bottom padding: the pinned panel below must never sit
               * on a half-visible row */}
              <nav className="flex-1 overflow-y-auto overscroll-contain px-3 pb-10">
                <div className="smallcaps px-2 pb-2 text-xs font-semibold text-ink-faded">Sortiment</div>
                <ul>
                  {categories.map((c, i) => {
                    const Icon = c.icon;
                    return (
                      <motion.li
                        key={c.slug}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.42, delay: 0.05 + i * 0.07, ease: EASE_OUT }}
                      >
                        <Link
                          href={`/kollektion?category=${c.slug}`}
                          onClick={onClose}
                          className="group flex min-h-[44px] items-center gap-3.5 rounded-button px-2 py-2 transition-colors duration-fast ease-hover hover:bg-raised"
                        >
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-button bg-ink/5 text-ink-aged transition-colors duration-base ease-hover group-hover:bg-ink group-hover:text-white">
                            <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
                          </span>
                          <span className="flex-1">
                            <span className="block font-medium leading-tight text-ink">{c.name}</span>
                            <span className="block text-xs text-ink-faded">{c.hint}</span>
                          </span>
                          <ChevronRight className="h-4 w-4 text-ink-faded transition-transform duration-base ease-hover group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden="true" />
                        </Link>
                      </motion.li>
                    );
                  })}
                </ul>
                <Link
                  href="/kollektion"
                  onClick={onClose}
                  className="group mt-1 flex min-h-[44px] items-center gap-2 rounded-button px-2 text-sm font-medium text-ink transition-colors duration-fast ease-hover hover:bg-raised"
                >
                  Gesamte Kollektion
                  <ArrowRight className="h-4 w-4 transition-transform duration-base ease-hover group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>

                <div className="my-3 h-px bg-rule" />
                <div className="smallcaps px-2 pb-1 text-xs font-semibold text-ink-faded">Service</div>
                <ul className="px-2">
                  {services.map((s) => (
                    <li key={s.label}>
                      <Link
                        href={s.href}
                        onClick={onClose}
                        className="flex min-h-[44px] items-center text-sm text-ink-aged transition-colors duration-fast ease-hover hover:text-ink"
                      >
                        {s.label}
                      </Link>
                    </li>
                  ))}
                </ul>

                <div className="my-3 h-px bg-rule" />
                <div className="smallcaps px-2 pb-1 text-xs font-semibold text-ink-faded">Ihr Konto</div>
                <ul className="px-2">
                  <li>
                    <Link
                      href="/merkliste"
                      onClick={onClose}
                      className="flex min-h-[44px] items-center justify-between text-sm text-ink-aged transition-colors duration-fast ease-hover hover:text-ink"
                    >
                      Merkliste
                      {wishlistCount > 0 && <span className="tnum text-xs text-ink-faded">{wishlistCount}</span>}
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/warenkorb"
                      onClick={onClose}
                      className="flex min-h-[44px] items-center justify-between text-sm text-ink-aged transition-colors duration-fast ease-hover hover:text-ink"
                    >
                      Warenkorb
                      {cartCount > 0 && <span className="tnum text-xs text-ink-faded">{cartCount}</span>}
                    </Link>
                  </li>
                </ul>

                <div className="my-3 h-px bg-rule" />
                <ul className="px-2">
                  {about.map((s) => (
                    <li key={s.label}>
                      <Link
                        href={s.href}
                        onClick={onClose}
                        className="flex min-h-[44px] items-center text-sm text-ink-aged transition-colors duration-fast ease-hover hover:text-ink"
                      >
                        {s.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>

              <div className="relative border-t border-rule p-4">
                {/* soft upward fade above the hairline: the list visibly
                 * continues underneath instead of hard-clipping mid-row */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-full h-8 bg-gradient-to-t from-card to-transparent"
                />
                {/* same hours as the site footer, nothing invented */}
                <p className="mb-3 flex items-center gap-2 px-1 text-xs text-ink-faded">
                  <Clock className="h-[18px] w-[18px] shrink-0" strokeWidth={1.7} aria-hidden="true" />
                  Mo bis Fr 10 bis 18 Uhr, Sa 10 bis 14 Uhr
                </p>
                <button
                  onClick={() => {
                    onClose();
                    onSignIn();
                  }}
                  className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-button bg-ink px-4 py-3 text-sm font-semibold text-white transition-[transform,background-color] duration-fast ease-hover hover:-translate-y-0.5 hover:bg-ink-aged"
                >
                  Anmelden / Konto erstellen <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
