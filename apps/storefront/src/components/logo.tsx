import { cn } from "@/lib/cn";

/** A small coin mark with an embossed "14", recolours via currentColor. */
function Coin({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" fill="none">
      <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="24" cy="24" r="17.6" stroke="currentColor" strokeWidth="0.8" strokeDasharray="0.6 2.6" opacity="0.65" />
      <path d="M11 24a13 13 0 0 0 5 10" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" opacity="0.5" />
      <path d="M37 24a13 13 0 0 1-5 10" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" opacity="0.5" />
      <text
        x="24"
        y="25"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="var(--font-cormorant), Georgia, serif"
        fontWeight={600}
        fontSize="17"
        fill="currentColor"
      >
        14
      </text>
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <Coin className="h-8 w-8 shrink-0 sm:h-9 sm:w-9" />
      {!compact && (
        <span className="flex flex-col leading-none">
          <span className="font-display text-[1.2rem] font-semibold leading-none tracking-[0.16em] sm:text-[1.35rem] sm:tracking-[0.18em]">
            WAREHOUSE
          </span>
          {/* the descriptor reads on a phone but the long form is reserved for
           * the roomier ≥sm header so the wordmark never crowds the controls */}
          <span className="eyebrow mt-1.5 leading-none opacity-65">
            <span className="sm:hidden">Gold &amp; Raritäten</span>
            <span className="hidden sm:inline">Gold · Münzen · Antiquitäten</span>
          </span>
        </span>
      )}
    </span>
  );
}

export { Coin };
