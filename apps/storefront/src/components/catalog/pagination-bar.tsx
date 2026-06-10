'use client';

import { cn } from '@/lib/cn';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

interface PaginationBarProps {
  total: number;
  limit: number;
  currentPage: number;
}

/** Client component: renders prev/next and page number buttons, updates ?page= in URL. */
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

  return (
    <nav
      aria-label="Seitennavigation"
      className="mt-w14-5 flex items-center justify-center gap-1.5"
    >
      <button
        type="button"
        onClick={() => goToPage(currentPage - 1)}
        disabled={currentPage <= 1}
        aria-label="Vorherige Seite"
        className={cn(
          'grid h-11 w-11 place-items-center rounded-button border border-rule bg-surface text-ink-aged transition-colors duration-fast ease-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold',
          currentPage <= 1 ? 'cursor-not-allowed opacity-40' : 'hover:border-gold hover:text-gold',
        )}
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
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
              'tnum grid h-11 min-w-[2.75rem] place-items-center rounded-button border px-2 text-sm font-medium transition-colors duration-fast ease-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold',
              p === currentPage
                ? 'border-gold text-gold-deep'
                : 'border-rule bg-surface text-ink-aged hover:border-gold hover:text-gold',
            )}
          >
            {p}
          </button>
        ),
      )}

      <button
        type="button"
        onClick={() => goToPage(currentPage + 1)}
        disabled={currentPage >= totalPages}
        aria-label="Nächste Seite"
        className={cn(
          'grid h-11 w-11 place-items-center rounded-button border border-rule bg-surface text-ink-aged transition-colors duration-fast ease-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold',
          currentPage >= totalPages
            ? 'cursor-not-allowed opacity-40'
            : 'hover:border-gold hover:text-gold',
        )}
      >
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </nav>
  );
}
