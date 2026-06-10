"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, TrendingUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { searchSuggestions } from "@/lib/placeholder-data";

export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const router = useRouter();

  function navigate(term: string) {
    const trimmed = term.trim();
    if (!trimmed) return;
    router.push("/suche?q=" + encodeURIComponent(trimmed));
    onClose();
    setQuery("");
  }

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 120);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  // Reset query when overlay closes.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[80] bg-ink/45 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-x-0 top-0 z-[90] flex justify-center px-4 pt-[12vh]"
            initial={{ opacity: 0, y: -24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -24 }}
            transition={{ ease: [0.16, 1, 0.3, 1], duration: 0.35 }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Produktsuche"
              className="w-full max-w-2xl overflow-hidden rounded-card bg-card shadow-modal"
              style={{ overscrollBehavior: "contain" }}
            >
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  navigate(query);
                }}
              >
                <div className="flex items-center gap-3 border-b border-rule px-5 py-4">
                  <Search className="h-5 w-5 text-gold" aria-hidden="true" />
                  <input
                    ref={inputRef}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Suche nach Münzen, Gold, Antiquitäten, Briefmarken …"
                    autoComplete="off"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    className="w-full bg-transparent text-lg text-ink placeholder:text-ink-faded focus-visible:outline-none"
                  />
                  <button
                    type="button"
                    aria-label="Schließen"
                    onClick={onClose}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-button text-ink-faded transition-colors hover:bg-raised hover:text-ink"
                  >
                    <X className="h-[18px] w-[18px]" aria-hidden="true" />
                  </button>
                </div>
              </form>
              <div className="p-5">
                <div className="smallcaps mb-3 flex items-center gap-1.5 text-xs font-semibold text-ink-faded">
                  <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> Beliebte Suchen
                </div>
                <div className="flex flex-wrap gap-2">
                  {searchSuggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => navigate(s)}
                      className="rounded-full border border-rule bg-surface px-3.5 py-1.5 text-sm text-ink-aged transition-colors hover:border-gold/50 hover:text-ink"
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <p className="mt-5 text-xs text-ink-faded">
                  Tipp: Tippfehler-tolerant &amp; auf Deutsch optimiert. "Goldmünze" findet auch "Gold Münze".
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
