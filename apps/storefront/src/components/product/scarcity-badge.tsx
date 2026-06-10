import { cn } from "@/lib/cn";

/**
 * Dignified eyebrow that marks a one-of-a-kind piece.
 * No count, no urgency — just the fact that the piece is unique.
 * Server component, no interactivity.
 */
export function UnikatBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-[#bf9430]/40 bg-[#bf9430]/10 px-2.5 py-0.5 text-xs font-semibold tracking-wide text-[#8a6a1f]",
        className,
      )}
    >
      Einzelstück
    </span>
  );
}
