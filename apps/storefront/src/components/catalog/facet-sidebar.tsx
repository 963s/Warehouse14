'use client';

import { cn } from '@/lib/cn';
import type { CategoryNode } from '@/lib/storefront-data';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';

interface FacetSidebarProps {
  categories: CategoryNode[];
  activeCategory?: string;
  activeMetal?: string;
  activeSort?: string;
  activeMin?: string;
  activeMax?: string;
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
  { value: 'year_desc', label: 'Jahrgang (neu-alt)' },
] as const;

/** Client component: category list, metal filter, price range, sort select. Updates URL searchParams. */
export function FacetSidebar({
  categories,
  activeCategory,
  activeMetal,
  activeSort,
  activeMin,
  activeMax,
}: FacetSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [minInput, setMinInput] = useState(activeMin ?? '');
  const [maxInput, setMaxInput] = useState(activeMax ?? '');
  const [mobileOpen, setMobileOpen] = useState(false);

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

  function applyPrice() {
    navigate({
      min: minInput || undefined,
      max: maxInput || undefined,
    });
  }

  function clearAll() {
    setMinInput('');
    setMaxInput('');
    router.push(pathname);
  }

  const hasActiveFilters = !!(
    activeCategory ||
    activeMetal ||
    activeMin ||
    activeMax ||
    (activeSort && activeSort !== 'published_desc')
  );

  const sidebar = (
    <aside className="space-y-w14-4">
      {/* Clear all */}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={clearAll}
          className="flex items-center gap-1.5 rounded text-sm text-ink-faded transition-colors duration-fast ease-hover hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Alle Filter zurücksetzen
        </button>
      )}

      {/* Categories */}
      <section>
        <h3 className="eyebrow mb-w14-2">Kategorie</h3>
        <ul className="space-y-0.5">
          <li>
            <Link
              href={`${pathname}${buildParams({ category: undefined }) ? `?${buildParams({ category: undefined })}` : ''}`}
              className={cn(
                'block rounded px-2.5 py-1.5 text-sm transition-colors duration-fast ease-hover',
                !activeCategory
                  ? 'font-medium text-gold'
                  : 'text-ink-aged hover:bg-raised hover:text-ink',
              )}
            >
              Alle Kategorien
            </Link>
          </li>
          {categories.map((cat) => (
            <li key={cat.id}>
              <Link
                href={`/kategorien/${cat.slug}`}
                className={cn(
                  'block rounded px-2.5 py-1.5 text-sm transition-colors duration-fast ease-hover',
                  activeCategory === cat.slug
                    ? 'font-medium text-gold'
                    : 'text-ink-aged hover:bg-raised hover:text-ink',
                )}
              >
                {cat.nameDe}
              </Link>
              {cat.children.length > 0 && (
                <ul className="ml-3 mt-0.5 space-y-0.5 border-l border-rule pl-3">
                  {cat.children.map((child) => (
                    <li key={child.id}>
                      <Link
                        href={`/kategorien/${child.slug}`}
                        className={cn(
                          'block rounded px-2.5 py-1 text-xs transition-colors duration-fast ease-hover',
                          activeCategory === child.slug
                            ? 'font-medium text-gold'
                            : 'text-ink-faded hover:text-ink',
                        )}
                      >
                        {child.nameDe}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Metal filter */}
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
                'rounded-button border px-3 py-1.5 text-xs font-medium transition-[border-color,color,background-color] duration-fast ease-hover motion-reduce:transition-none',
                activeMetal === value
                  ? 'border-gold bg-gold/[0.08] text-gold-deep'
                  : 'border-rule bg-surface text-ink-aged hover:border-gold/60 hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {/* Price range */}
      <section>
        <h3 className="eyebrow mb-w14-2">Preis (EUR)</h3>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            placeholder="von"
            value={minInput}
            name="min_price"
            autoComplete="off"
            aria-label="Mindestpreis in Euro"
            onChange={(e) => setMinInput(e.target.value)}
            className="tnum w-full rounded border border-rule bg-surface px-3 py-2 text-sm text-ink placeholder-ink-faded transition-colors duration-fast ease-hover focus:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          />
          <span className="text-ink-faded text-xs shrink-0">bis</span>
          <input
            type="number"
            min={0}
            placeholder="bis"
            value={maxInput}
            name="max_price"
            autoComplete="off"
            aria-label="Höchstpreis in Euro"
            onChange={(e) => setMaxInput(e.target.value)}
            className="tnum w-full rounded border border-rule bg-surface px-3 py-2 text-sm text-ink placeholder-ink-faded transition-colors duration-fast ease-hover focus:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          />
        </div>
        <button
          type="button"
          onClick={applyPrice}
          className="mt-w14-2 w-full rounded-button border border-rule bg-surface py-1.5 text-xs font-medium text-ink-aged transition-colors duration-fast ease-hover hover:border-gold hover:text-gold"
        >
          Übernehmen
        </button>
      </section>

      {/* Sort */}
      <section>
        <h3 className="eyebrow mb-w14-2">Sortierung</h3>
        <div className="relative">
          <select
            value={activeSort ?? 'published_desc'}
            onChange={(e) => setSort(e.target.value)}
            aria-label="Sortierung"
            className="w-full appearance-none rounded border border-rule bg-surface px-3 py-2 pr-8 text-sm text-ink transition-colors duration-fast ease-hover focus:border-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            {SORT_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faded" />
        </div>
      </section>
    </aside>
  );

  return (
    <>
      {/* Mobile toggle */}
      <div className="lg:hidden mb-w14-2">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          aria-expanded={mobileOpen}
          aria-controls="mobile-filter-panel"
          className="flex w-full items-center justify-between rounded-card border border-rule bg-surface px-4 py-3 text-sm font-medium text-ink transition-colors duration-fast ease-hover hover:border-gold/50"
        >
          <span className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-gold" aria-hidden="true" />
            Filter
            {hasActiveFilters && (
              <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-label="Filter aktiv" />
            )}
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 text-ink-faded transition-transform duration-base ease-hover',
              mobileOpen && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </button>
        {mobileOpen && (
          <div
            id="mobile-filter-panel"
            className="mt-w14-2 rounded-card border border-rule bg-surface p-w14-3"
          >
            {sidebar}
          </div>
        )}
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:block">{sidebar}</div>
    </>
  );
}
