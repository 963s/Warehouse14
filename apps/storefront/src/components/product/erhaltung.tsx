import { cn } from "@/lib/cn";
import type { ProductSummary, StampErhaltung } from "@/lib/storefront-data";

/**
 * Erhaltung — the stamp preservation grade, in the owner's dealer notation:
 *
 *   Postfrisch = ⭐⭐ (**) · Falz = ⭐ (*) · Gestempelt = (,) · Auf Brief
 *
 * One source for labels, URL params and the dignified badge, so the card
 * meta, the facet sidebar and the Exponat-Karte all speak the same words.
 * (Gestempelt's cryptic "(,)" mark stays off the customer UI — the German
 * word carries it; the stars convention is shown because collectors read it.)
 */

export const ERHALTUNG_VALUES: readonly StampErhaltung[] = [
  "POSTFRISCH",
  "FALZ",
  "GESTEMPELT",
  "AUF_BRIEF",
] as const;

export const ERHALTUNG_LABELS: Record<StampErhaltung, string> = {
  POSTFRISCH: "Postfrisch",
  FALZ: "Falz",
  GESTEMPELT: "Gestempelt",
  AUF_BRIEF: "Auf Brief",
};

/** The collector's star shorthand — shown as a quiet hint, never alone. */
export const ERHALTUNG_NOTATION: Record<StampErhaltung, string | null> = {
  POSTFRISCH: "⭐⭐",
  FALZ: "⭐",
  GESTEMPELT: null,
  AUF_BRIEF: null,
};

/** URL-facing value (?erhaltung=postfrisch | falz | gestempelt | auf-brief). */
export function erhaltungToParam(v: StampErhaltung): string {
  return v.toLowerCase().replace(/_/g, "-");
}

/** Parse the URL param back; unknown/absent → undefined (never throws). */
export function erhaltungFromParam(raw: string | undefined): StampErhaltung | undefined {
  if (!raw) return undefined;
  const v = raw.toUpperCase().replace(/-/g, "_");
  return (ERHALTUNG_VALUES as readonly string[]).includes(v)
    ? (v as StampErhaltung)
    : undefined;
}

/**
 * The collector's one-liner, e.g. "MiNr. 27 · Postfrisch".
 * Either half may be missing; null when neither exists.
 */
export function stampLine(
  p: Pick<ProductSummary, "stampMinr" | "stampErhaltung">,
): string | null {
  const parts: string[] = [];
  if (p.stampMinr != null) parts.push(`MiNr. ${p.stampMinr}`);
  if (p.stampErhaltung) parts.push(ERHALTUNG_LABELS[p.stampErhaltung]);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The dignified Erhaltung badge — a quiet hairline pill in the house voice,
 * the stars as a muted suffix where the convention carries them.
 */
export function ErhaltungBadge({
  value,
  className,
}: {
  value: StampErhaltung;
  className?: string;
}) {
  const notation = ERHALTUNG_NOTATION[value];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-rule bg-surface px-2.5 py-0.5 text-[0.8125rem] font-medium text-ink",
        className,
      )}
    >
      {ERHALTUNG_LABELS[value]}
      {notation && (
        <span aria-hidden="true" className="text-[0.625rem] leading-none">
          {notation}
        </span>
      )}
    </span>
  );
}
