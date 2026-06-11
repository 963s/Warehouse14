'use client';

import { cn } from '@/lib/cn';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

interface PaginationBarProps {
  total: number;
  limit: number;
  currentPage: number;
}

/** Client component: updates ?page= in the URL. On the phone it renders two
 * thumb-sized Zurück/Weiter buttons around a clear "Seite x von y" readout
 * (a long number row would overflow 390px); from sm up the full numbered
 * row appears. */
export function PaginationBar({ total, limit, currentPage }: PaginationBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (total <= limit) return null;

  const totalPages = Math.ceil(total / limit);

  function goToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (page === 1) {
      params.delete('page');
    } else {
      params.set('page', String(page));
    }
    const qs = params.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ''}`);
  }

  // Build visible page numbers: always show first, last, and a window around current
  const pages: (number | 'ellipsis')[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1) {
      pages.push(p);
    } else if (pages[pages.length - 1] !== 'ellipsis') {
      pages.push('ellipsis');
    }
  }

  const prevDisabled = currentPage <= 1;
  const nextDisabled = currentPage >= totalPages;

  return (
    <nav aria-label="Seitennavigation" className="mt-w14-5">
      {/* Phone: two generous buttons, the current page spelled out between */}
      <div className="flex items-center justify-between gap-w14-2 sm:hidden">
        <button
          type="button"
          onClick={() => goToPage(currentPage - 1)}
          disabled={prevDisabled}
          className={cn(
            'inline-flex min-h-[48px] items-center gap-1 rounded-button border border-rule bg-surface pl-3 pr-4 text-sm font-medium text-ink-aged transition-colors duration-fast ease-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40',
            prevDisabled ? 'cursor-not-allowed opacity-40' : 'hover:border-ink/40 hover:text-ink',
          )}
        >
          <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
          Zurück
        </button>
        <span className="text-sm text-ink-aged">
          Seite <span className="tnum">{currentPage}</span> von{' '}
          <span className="tnum">{totalPages}</span>
        </span>
        <button
          type="button"
          onClick={() => goToPage(currentPage + 1)}
          disabled={nextDisabled}
          className={cn(
            'inline-flex min-h-[48px] items-center gap-1 rounded-button border border-rule bg-surface pl-4 pr-3 text-sm font-medium text-ink-aged transition-colors duration-fast ease-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40',
            nextDisabled ? 'cursor-not-allowed opacity-40' : 'hover:border-ink/40 hover:text-ink',
          )}
        >
          Weiter
          <ChevronRight className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
        </button>
      </div>

      {/* sm and up: the full numbered row */}
      <div className="hidden items-center justify-center gap-1.5 sm:flex">
        <button
          type="button"
          onClick={() => goToPage(currentPage - 1)}
          disabled={prevDisabled}
          aria-label="Vorherige Seite"
          className={cn(
            'grid h-11 w-11 place-items-center rounded-button border border-rule bg-surface text-ink-aged transition-colors duration-fast ease-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40',
            prevDisabled ? 'cursor-not-allowed opacity-40' : 'hover:border-ink/40 hover:text-ink',
          )}
        >
          <ChevronLeft className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
        </button>

        {pages.map((p, i) =>
          p === 'ellipsis' ? (
            <span
              key={`ellipsis-${i}`}
              className="grid h-11 w-11 place-items-center text-ink-faded select-none"
            >
              &middot;&middot;&middot;
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => goToPage(p as number)}
              aria-current={p === currentPage ? 'page' : undefined}
              className={cn(
                'tnum grid h-11 min-w-[2.75rem] place-items-center rounded-button border px-2 text-sm font-medium transition-colors duration-fast ease-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40',
                p === currentPage
                  ? 'border-ink bg-ink text-white'
                  : 'border-rule bg-surface text-ink-aged hover:border-ink/40 hover:text-ink',
              )}
            >
              {p}
            </button>
          ),
        )}

        <button
          type="button"
          onClick={() => goToPage(currentPage + 1)}
          disabled={nextDisabled}
          aria-label="Nächste Seite"
          className={cn(
            'grid h-11 w-11 place-items-center rounded-button border border-rule bg-surface text-ink-aged transition-colors duration-fast ease-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40',
            nextDisabled ? 'cursor-not-allowed opacity-40' : 'hover:border-ink/40 hover:text-ink',
          )}
        >
          <ChevronRight className="h-[18px] w-[18px]" strokeWidth={1.7} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
