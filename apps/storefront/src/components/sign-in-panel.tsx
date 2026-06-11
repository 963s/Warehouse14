"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ShieldCheck } from "lucide-react";
import { GoogleG, AppleLogo } from "@/components/brand-icons";
import { Logo } from "@/components/logo";
import { data } from "@/lib/storefront-data";

export function SignInPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    // lock the page behind the dialog, close on ESC, restore on close
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await data.signIn({ email, password });
      window.location.assign("/konto");
    } catch {
      setError("Anmeldung fehlgeschlagen. Bitte E-Mail-Adresse und Passwort prüfen.");
      setPending(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[95] grid place-items-center px-4">
          <motion.div
            className="absolute inset-0 bg-ink/55 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="signin-title"
            className="grain relative w-full max-w-md overflow-hidden rounded-card bg-card p-7 shadow-modal sm:p-9"
            initial={{ opacity: 0, scale: 0.95, y: 14 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.4 }}
          >
            <button
              ref={closeButtonRef}
              aria-label="Schließen"
              onClick={onClose}
              className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-button text-ink-faded transition-colors hover:bg-raised hover:text-ink"
            >
              <X aria-hidden="true" className="h-[18px] w-[18px]" />
            </button>

            <div className="text-center">
              {/* the brand moment: the compact official lockup, not a chip */}
              <span aria-hidden="true" className="mb-4 inline-flex justify-center text-ink">
                <Logo compact />
              </span>
              <h2 id="signin-title" className="font-display text-2xl font-semibold">Willkommen</h2>
              <p className="mx-auto mt-1.5 max-w-xs text-sm text-ink-aged">
                Anmelden oder Konto erstellen, in wenigen Sekunden.
              </p>
            </div>

            {/* E-Mail ist der einzige aktive Weg und steht deshalb zuerst */}
            <form className="mt-7 space-y-3" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="signin-email" className="sr-only">E-Mail-Adresse</label>
                <input
                  id="signin-email"
                  type="email"
                  name="email"
                  placeholder="E-Mail-Adresse"
                  required
                  autoComplete="email"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-button border border-rule bg-surface px-4 py-3 text-base text-ink outline-none placeholder:text-ink-faded focus:border-ink/40 focus:ring-2 focus:ring-ink/10"
                />
              </div>
              <div>
                <label htmlFor="signin-password" className="sr-only">Passwort</label>
                <input
                  id="signin-password"
                  type="password"
                  name="password"
                  placeholder="Passwort"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-button border border-rule bg-surface px-4 py-3 text-base text-ink outline-none placeholder:text-ink-faded focus:border-ink/40 focus:ring-2 focus:ring-ink/10"
                />
              </div>
              <div aria-live="polite" aria-atomic="true">
                {error && (
                  <p className="rounded-button border border-wax-red/30 bg-wax-red/5 px-3 py-2 text-xs text-wax-red">
                    {error}
                  </p>
                )}
              </div>
              <button
                type="submit"
                disabled={pending}
                className="w-full rounded-button border border-ink/15 bg-ink px-4 py-3 text-[0.95rem] font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {pending ? "Anmeldung läuft …" : "Mit E-Mail fortfahren"}
              </button>
            </form>

            <div className="my-5 flex items-center gap-3 text-xs text-ink-faded">
              <span className="h-px flex-1 bg-rule" /> oder <span className="h-px flex-1 bg-rule" />
            </div>

            {/* Google und Apple sind bewusst noch nicht angebunden: ehrlich
             * deaktiviert statt scheinbar klickbar, sie kehren später zurück */}
            <div className="space-y-3">
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Bald verfügbar"
                className="relative flex min-h-[48px] w-full cursor-not-allowed items-center justify-center gap-3 rounded-button border border-rule bg-surface px-4 py-3 text-[0.95rem] font-medium text-ink-faded"
              >
                <GoogleG aria-hidden="true" className="h-5 w-5 opacity-50 grayscale" /> Mit Google fortfahren
                <span className="absolute -top-2 right-3 rounded-full border border-rule bg-raised px-2 py-0.5 text-[0.6875rem] leading-4 text-ink-faded">
                  Bald verfügbar
                </span>
              </button>
              <button
                type="button"
                disabled
                aria-disabled="true"
                title="Bald verfügbar"
                className="relative flex min-h-[48px] w-full cursor-not-allowed items-center justify-center gap-2.5 rounded-button border border-rule bg-surface px-4 py-3 text-[0.95rem] font-medium text-ink-faded"
              >
                <AppleLogo aria-hidden="true" className="h-[19px] w-[19px] opacity-50" /> Mit Apple fortfahren
                <span className="absolute -top-2 right-3 rounded-full border border-rule bg-raised px-2 py-0.5 text-[0.6875rem] leading-4 text-ink-faded">
                  Bald verfügbar
                </span>
              </button>
            </div>

            <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-ink-faded">
              <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-verdigris" />
              Sichere Anmeldung per E-Mail. Google und Apple folgen in Kürze. Es gelten AGB und Datenschutz.
            </p>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
