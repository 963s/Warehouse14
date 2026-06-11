'use client';

import {
  ERHALTUNG_LABELS,
  ERHALTUNG_NOTATION,
  ERHALTUNG_VALUES,
  erhaltungToParam,
} from '@/components/product/erhaltung';
import { cn } from '@/lib/cn';
import type { CategoryNode } from '@/lib/storefront-data';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const EASE_OUT = [0.16, 1, 0.3, 1] as const; // curator entrance ease

interface FacetSidebarProps {
  categories: CategoryNode[];
  activeCategory?: string;
  activeMetal?: string;
  activeSort?: string;
  activeMin?: string;
  activeMax?: string;
  /** Stamp facets, URL-form (?erhaltung=postfrisch&minrVon=1&minrBis=910). */
  activeErhaltung?: string;
  activeMinrVon?: string;
  activeMinrBis?: string;
}

/** All slugs of a subtree — used to decide when the stamp facets apply. */
function collectSlugs(node: CategoryNode, into: Set<string> = new Set()): Set<string> {
  into.add(node.slug);
  for (const c of node.children) collectSlugs(c, into);
  return into;
}

/** The slug path from a root down to `slug`, or null when absent. */
function pathToSlug(nodes: CategoryNode[], slug: string): string[] | null {
  for (const n of nodes) {
    if (n.slug === slug) return [n.slug];
    const sub = pathToSlug(n.children, slug);
    if (sub) return [n.slug, ...sub];
  }
  return null;
}

const METALS = [
  { value: 'gold', label: 'Gold' },
  { value: 'silber', label: 'Silber' },
  { value: 'platin', label: 'Platin' },
  { value: 'palladium', label: 'Palladium' },
  { value: 'antiquitaeten', label: 'Antiquitäten' },
] as const;

const SORT_OPTIONS = [
  { value: 'published_desc', label: 'Neueste zuerst' },
  { value: 'price_asc', label: 'Preis aufsteigend' },
  { value: 'price_desc', label: 'Preis absteigend' },
  { value: 'year_desc', label: 'Jahrgang (neu zu alt)' },
] as const;

/** Client component: category list, metal filter, price range, sort select.
 * Updates URL searchParams. Desktop renders a quiet sidebar; on the phone the
 * same panel lives in a bottom sheet behind a "Filter" button with a count
 * badge — body scroll locked, ESC/backdrop closes, all targets >= 44px. */
export function FacetSidebar({
  categories,
  activeCategory,
  activeMetal,
  activeSort,
  activeMin,
  activeMax,
  activeErhaltung,
  activeMinrVon,
  activeMinrBis,
}: FacetSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const reduce = useReducedMotion();

  const [minInput, setMinInput] = useState(activeMin ?? '');
  const [maxInput, setMaxInput] = useState(activeMax ?? '');
  const [minrVonInput, setMinrVonInput] = useState(activeMinrVon ?? '');
  const [minrBisInput, setMinrBisInput] = useState(activeMinrBis ?? '');
  const [mobileOpen, setMobileOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  /* The tree folds: the path down to the active category starts open, the
   * visitor's own toggles are kept on top of that. */
  const activePath = useMemo(
    () => (activeCategory ? (pathToSlug(categories, activeCategory) ?? []) : []),
    [categories, activeCategory],
  );
  const [openSlugs, setOpenSlugs] = useState<Set<string>>(() => new Set(activePath));
  useEffect(() => {
    if (activePath.length === 0) return;
    setOpenSlugs((prev) => new Set([...prev, ...activePath]));
  }, [activePath]);

  function toggleBranch(slug: string) {
    setOpenSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  /* The stamp facets (Erhaltung + MiNr) belong to the Briefmarken world:
   * shown on the unfiltered Kollektion, anywhere inside the Briefmarken
   * subtree, and whenever one of them is already active. */
  const briefmarkenSlugs = useMemo(() => {
    const root = categories.find((c) => c.slug === 'briefmarken');
    return root ? collectSlugs(root) : new Set<string>();
  }, [categories]);
  const stampContext =
    !activeCategory ||
    briefmarkenSlugs.has(activeCategory) ||
    !!activeErhaltung ||
    !!(activeMinrVon || activeMinrBis);

  const buildParams = useCallback(
    (overrides: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      // Reset page when filters change
      params.delete('page');
      for (const [key, value] of Object.entries(overrides)) {
        if (value == null || value === '') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      return params.toString();
    },
    [searchParams],
  );

  function navigate(overrides: Record<string, string | undefined>) {
    const qs = buildParams(overrides);
    router.push(`${pathname}${qs ? `?${qs}` : ''}`);
  }

  function setMetal(metal: string) {
    navigate({ metal: activeMetal === metal ? undefined : metal });
  }

  function setSort(sort: string) {
    navigate({ sort });
  }

  /* Applies every pending range input in one navigation: price + MiNr. */
  function applyPrice() {
    navigate({
      min: minInput || undefined,
      max: maxInput || undefined,
      minrVon: minrVonInput || undefined,
      minrBis: minrBisInput || undefined,
    });
  }

  function setErhaltung(param: string) {
    navigate({ erhaltung: activeErhaltung === param ? undefined : param });
  }

  function clearAll() {
    setMinInput('');
    setMaxInput('');
    setMinrVonInput('');
    setMinrBisInput('');
    router.push(pathname.startsWith('/kategorien') ? '/kollektion' : pathname);
  }

  /* "Alle Kategorien" must leave a /kategorien/<slug> page, otherwise the
   * link would keep the visitor inside the category it claims to clear. */
  const allCategoriesBase = pathname.startsWith('/kategorien') ? '/kollektion' : pathname;
  const allCategoriesQs = buildParams({ category: undefined });
  const allCategoriesHref = `${allCategoriesBase}${allCategoriesQs ? `?${allCategoriesQs}` : ''}`;

  // Count of active facets — drives the badge on the phone "Filter" button.
  const activeCount =
    (activeCategory ? 1 : 0) +
    (activeMetal ? 1 : 0) +
    (activeMin || activeMax ? 1 : 0) +
    (activeErhaltung ? 1 : 0) +
    (activeMinrVon || activeMinrBis ? 1 : 0) +
    (activeSort && activeSort !== 'published_desc' ? 1 : 0);
  const hasActiveFilters = activeCount > 0;

  /* Native-feeling sheet behaviour: lock the page scroll behind it, close on
   * ESC, keep Tab cycling inside, focus the close button once open. */
  useEffect(() => {
    if (!mobileOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => closeRef.current?.focus(), 80);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobileOpen(false);
        return;
      }
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const focusables = sheetRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select',
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
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [mobileOpen]);

  /* Shared facet sections. Tap targets are >= 44px on the phone and compact
   * again from lg up, where a pointer is precise. The sections are composed
   * twice below: the desktop sidebar keeps the classic order (categories
   * first, sort last), the phone sheet leads with Sortierung — the sheet is
   * titled "Filter & Sortierung", so the sort control must be visible before
   * the long category list pushes it below the fold. */
  const clearAllSection = hasActiveFilters && (
    <button
      type="button"
      onClick={clearAll}
      className="flex min-h-[44px] items-center gap-1.5 rounded text-sm text-ink-faded transition-colors duration-fast ease-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 lg:min-h-0"
    >
      <X className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
      Alle Filter zurücksetzen
    </button>
  );

  /* The FULL category tree from the data seam — every world stays navigable
   * even when the current result set holds nothing from it. The seam delivers
   * no per-category counts, so none are shown (never invented). Depth ≤ 3:
   * branches fold behind a chevron, the active path stands open. */
  function renderCategoryNode(node: CategoryNode, depth: number): React.ReactNode {
    const hasKids = node.children.length > 0;
    const open = openSlugs.has(node.slug);
    const isActive = activeCategory === node.slug;
    return (
      <li key={node.id}>
        <div className="flex items-center gap-0.5">
          <Link
            href={`/kategorien/${node.slug}`}
            className={cn(
              'flex min-h-[44px] min-w-0 flex-1 items-center rounded px-2.5 transition-colors duration-fast ease-hover lg:min-h-0',
              depth === 0 ? 'text-sm lg:py-1.5' : 'text-sm lg:py-1 lg:text-xs',
              isActive
                ? 'bg-raised font-medium text-ink'
                : depth === 0
                  ? 'text-ink-aged hover:bg-raised hover:text-ink'
                  : 'text-ink-faded hover:text-ink',
            )}
          >
            <span className="truncate">{node.nameDe}</span>
          </Link>
          {hasKids && (
            <button
              type="button"
              onClick={() => toggleBranch(node.slug)}
              aria-expanded={open}
              aria-label={open ? `${node.nameDe} einklappen` : `${node.nameDe} aufklappen`}
              className="grid h-11 w-11 shrink-0 place-items-center rounded text-ink-faded transition-colors duration-fast ease-hover hover:bg-raised hover:text-ink lg:h-7 lg:w-7"
            >
              <ChevronDown
                className={cn(
                  'h-4 w-4 transition-transform duration-base ease-hover motion-reduce:transition-none',
                  open && 'rotate-180',
                )}
                strokeWidth={1.7}
                aria-hidden="true"
              />
            </button>
          )}
        </div>
        {hasKids && open && (
          <ul className="ml-2.5 mt-0.5 space-y-0.5 border-l border-rule pl-2.5">
            {node.children.map((child) => renderCategoryNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  }

  const categoriesSection = (
    <section>
        <h3 className="eyebrow mb-w14-2">Kategorie</h3>
        <ul className="space-y-0.5">
          <li>
            <Link
              href={allCategoriesHref}
              className={cn(
                'flex min-h-[44px] items-center rounded px-2.5 text-sm transition-colors duration-fast ease-hover lg:min-h-0 lg:py-1.5',
                !activeCategory
                  ? 'bg-raised font-medium text-ink'
                  : 'text-ink-aged hover:bg-raised hover:text-ink',
              )}
            >
              Alle Kategorien
            </Link>
          </li>
          {categories.map((cat) => renderCategoryNode(cat, 0))}
        </ul>
      </section>
  );

  /* Erhaltung — the stamp preservation grade in the owner's dealer notation
   * (Postfrisch ⭐⭐ · Falz ⭐ · Gestempelt · Auf Brief). One active grade. */
  const erhaltungSection = stampContext && (
    <section>
        <h3 className="eyebrow mb-w14-2">Erhaltung</h3>
        <div className="flex flex-wrap gap-2">
          {ERHALTUNG_VALUES.map((v) => {
            const param = erhaltungToParam(v);
            const active = activeErhaltung === param;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setErhaltung(param)}
                aria-pressed={active}
                className={cn(
                  'inline-flex min-h-[44px] items-center gap-1.5 rounded-button border px-4 text-sm font-medium transition-[border-color,color,background-color] duration-fast ease-hover motion-reduce:transition-none lg:min-h-0 lg:px-3 lg:py-1.5 lg:text-xs',
                  active
                    ? 'border-ink bg-ink text-white'
                    : 'border-rule bg-surface text-ink-aged hover:border-ink/50 hover:text-ink',
                )}
              >
                {ERHALTUNG_LABELS[v]}
                {ERHALTUNG_NOTATION[v] && (
                  <span aria-hidden="true" className="text-[0.625rem] leading-none">
                    {ERHALTUNG_NOTATION[v]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>
  );

  /* Michel number range — 16px inputs so iOS never zoom-jumps. Applied
   * together with the price range (desktop "Übernehmen" / phone footer). */
  const minrSection = stampContext && (
    <section>
        <h3 className="eyebrow mb-w14-2">Michel-Nr. (MiNr.)</h3>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            placeholder="von"
            value={minrVonInput}
            name="minr_von"
            inputMode="numeric"
            autoComplete="off"
            aria-label="Michel-Nummer von"
            onChange={(e) => setMinrVonInput(e.target.value)}
            className="tnum h-11 w-full rounded border border-rule bg-surface px-3 text-base text-ink placeholder-ink-faded transition-colors duration-fast ease-hover focus:border-ink/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
          />
          <span className="text-ink-faded text-xs shrink-0">bis</span>
          <input
            type="number"
            min={1}
            placeholder="bis"
            value={minrBisInput}
            name="minr_bis"
            inputMode="numeric"
            autoComplete="off"
            aria-label="Michel-Nummer bis"
            onChange={(e) => setMinrBisInput(e.target.value)}
            className="tnum h-11 w-full rounded border border-rule bg-surface px-3 text-base text-ink placeholder-ink-faded transition-colors duration-fast ease-hover focus:border-ink/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
          />
        </div>
        <button
          type="button"
          onClick={applyPrice}
          className="mt-w14-2 hidden w-full rounded-button border border-rule bg-surface py-1.5 text-xs font-medium text-ink-aged transition-colors duration-fast ease-hover hover:border-ink/50 hover:text-ink lg:block"
        >
          Übernehmen
        </button>
      </section>
  );

  const metalSection = (
    <section>
        <h3 className="eyebrow mb-w14-2">Metall / Art</h3>
        <div className="flex flex-wrap gap-2">
          {METALS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setMetal(value)}
              aria-pressed={activeMetal === value}
              className={cn(
                'min-h-[44px] rounded-button border px-4 text-sm font-medium transition-[border-color,color,background-color] duration-fast ease-hover motion-reduce:transition-none lg:min-h-0 lg:px-3 lg:py-1.5 lg:text-xs',
                activeMetal === value
                  ? 'border-ink bg-ink text-white'
                  : 'border-rule bg-surface text-ink-aged hover:border-ink/50 hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
  );

  /* Price range — 16px inputs so iOS never zoom-jumps */
  const priceSection = (
    <section>
        <h3 className="eyebrow mb-w14-2">Preis (EUR)</h3>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            placeholder="von"
            value={minInput}
            name="min_price"
            inputMode="numeric"
            autoComplete="off"
            aria-label="Mindestpreis in Euro"
            onChange={(e) => setMinInput(e.target.value)}
            className="tnum h-11 w-full rounded border border-rule bg-surface px-3 text-base text-ink placeholder-ink-faded transition-colors duration-fast ease-hover focus:border-ink/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
          />
          <span className="text-ink-faded text-xs shrink-0">bis</span>
          <input
            type="number"
            min={0}
            placeholder="bis"
            value={maxInput}
            name="max_price"
            inputMode="numeric"
            autoComplete="off"
            aria-label="Höchstpreis in Euro"
            onChange={(e) => setMaxInput(e.target.value)}
            className="tnum h-11 w-full rounded border border-rule bg-surface px-3 text-base text-ink placeholder-ink-faded transition-colors duration-fast ease-hover focus:border-ink/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
          />
        </div>
        <button
          type="button"
          onClick={applyPrice}
          className="mt-w14-2 hidden w-full rounded-button border border-rule bg-surface py-1.5 text-xs font-medium text-ink-aged transition-colors duration-fast ease-hover hover:border-ink/50 hover:text-ink lg:block"
        >
          Übernehmen
        </button>
      </section>
  );

  /* Sort — the select pushes the same ?sort= param the kollektion and
   * kategorien pages already read; no second mechanism. */
  const sortSection = (
    <section>
        <h3 className="eyebrow mb-w14-2">Sortierung</h3>
        <div className="relative">
          <select
            value={activeSort ?? 'published_desc'}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Sortierung"
            className="h-11 w-full appearance-none rounded border border-rule bg-surface px-3 pr-8 text-base text-ink transition-colors duration-fast ease-hover focus:border-ink/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
          >
            {SORT_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-faded"
            strokeWidth={1.7}
            aria-hidden="true"
          />
        </div>
      </section>
  );

  /* Phone sheet: Sortierung first, then the filters. */
  const sheetPanel = (
    <div className="space-y-w14-4">
      {clearAllSection}
      {sortSection}
      {categoriesSection}
      {erhaltungSection}
      {minrSection}
      {metalSection}
      {priceSection}
    </div>
  );

  /* Desktop sidebar: categories lead, sort closes the column. */
  const sidebarPanel = (
    <div className="space-y-w14-4">
      {clearAllSection}
      {categoriesSection}
      {erhaltungSection}
      {minrSection}
      {metalSection}
      {priceSection}
      {sortSection}
    </div>
  );

  return (
    <>
      {/* Phone: a "Filter" button opening a bottom sheet */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={mobileOpen}
          className="flex min-h-[48px] w-full items-center justify-between rounded-card border border-rule bg-card px-4 text-sm font-medium text-ink shadow-card transition-colors duration-fast ease-hover hover:border-ink/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal
              className="h-[18px] w-[18px] text-ink-aged"
              strokeWidth={1.7}
              aria-hidden="true"
            />
            Filter & Sortierung
          </span>
          {hasActiveFilters && (
            <span
              className="tnum grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-ink px-1.5 text-[0.6875rem] font-medium text-white"
              aria-label={`${activeCount} Filter aktiv`}
            >
              {activeCount}
            </span>
          )}
        </button>

        <AnimatePresence>
          {mobileOpen && (
            <>
              <motion.div
                className="fixed inset-0 z-[80] bg-ink/45 backdrop-blur-sm lg:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.32, ease: EASE_OUT }}
                onClick={() => setMobileOpen(false)}
              />
              <motion.div
                ref={sheetRef}
                role="dialog"
                aria-modal="true"
                aria-label="Filter und Sortierung"
                className="fixed inset-x-0 bottom-0 z-[90] flex max-h-[85dvh] flex-col rounded-t-card bg-card shadow-modal lg:hidden"
                initial={reduce ? { opacity: 0 } : { y: '100%' }}
                animate={reduce ? { opacity: 1 } : { y: 0 }}
                exit={reduce ? { opacity: 0 } : { y: '100%' }}
                transition={{ duration: 0.42, ease: EASE_OUT }}
              >
                {/* Sheet header */}
                <div className="flex items-center justify-between border-b border-rule py-2 pl-5 pr-2">
                  <h2 className="flex items-center gap-2 text-sm font-medium text-ink">
                    Filter & Sortierung
                    {hasActiveFilters && (
                      <span className="tnum grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-ink px-1.5 text-[0.6875rem] font-medium text-white">
                        {activeCount}
                      </span>
                    )}
                  </h2>
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={() => setMobileOpen(false)}
                    aria-label="Filter schließen"
                    className="grid h-11 w-11 place-items-center rounded-button text-ink-faded transition-colors duration-fast ease-hover hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
                  >
                    <X className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
                  </button>
                </div>

                {/* Scrollable panel — generous bottom padding so the last
                 * control never sits clipped against the apply bar */}
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-w14-3 pb-8">
                  {sheetPanel}
                </div>

                {/* Sticky footer: applies pending price inputs, then closes.
                 * The upward fade above the hairline is the scroll affordance:
                 * content visibly continues underneath. */}
                <div
                  className="relative border-t border-rule px-5 pt-3"
                  style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
                >
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-full h-8 bg-gradient-to-t from-card to-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      applyPrice();
                      setMobileOpen(false);
                    }}
                    className="h-12 w-full rounded-button bg-ink text-base font-medium text-white transition-colors duration-fast ease-hover hover:bg-ink-aged focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
                  >
                    Ergebnisse anzeigen
                  </button>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden lg:block">{sidebarPanel}</aside>
    </>
  );
}
