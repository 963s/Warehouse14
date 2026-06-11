import { cn } from "@/lib/cn";
import { BrandRoundel, BrandWordmark } from "@/components/brand/marks";

/**
 * The official lockup, straight from the registered plaque: WAREHOUSE in the
 * house serif first, then the 14 double-ring roundel (name, then number).
 * Under it the trade line ANTIQUITÄTEN · BRIEFMARKEN · MÜNZEN in quiet
 * smallcaps — hidden on phones and in `compact` settings so the mark never
 * crowds. Everything inherits currentColor from the surface.
 */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex flex-col items-start select-none", className)}>
      <span className="flex items-center gap-2">
        <BrandWordmark className="h-[17px] w-auto shrink-0 sm:h-[19px]" />
        {/* the roundel runs a touch taller than the caps and sits a hair low,
         * so its ring centres optically on the wordmark's weight */}
        <BrandRoundel className="mt-[1px] h-[24px] w-auto shrink-0 sm:h-[27px]" />
      </span>
      {!compact && (
        <span className="smallcaps mt-1.5 hidden whitespace-nowrap text-[0.6rem] font-medium leading-none text-ink-faded sm:block">
          Antiquitäten · Briefmarken · Münzen
        </span>
      )}
    </span>
  );
}

/** Legacy export: the old coin mark now resolves to the official roundel,
 * so existing call sites (auth pages, image placeholders) keep working
 * without redrawing anything. */
export function Coin({ className }: { className?: string }) {
  return <BrandRoundel className={className} />;
}
