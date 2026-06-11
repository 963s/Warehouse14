import { cn } from "@/lib/cn";

/**
 * Dignified eyebrow that marks a one-of-a-kind piece.
 * No count, no urgency — just the fact that the piece is unique.
 * The border is the house gilt as a hairline seal (never a fill).
 * Server component, no interactivity.
 */
export function UnikatBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-gilt/70 bg-raised px-2.5 py-0.5 text-xs font-semibold tracking-wide text-ink-aged",
        className,
      )}
    >
      Einzelstück
    </span>
  );
}
