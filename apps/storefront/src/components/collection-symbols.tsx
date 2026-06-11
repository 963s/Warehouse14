import type { ComponentType, ReactNode } from "react";
import {
  EngravedBar,
  EngravedCandelabra,
  EngravedCarton,
  EngravedRing,
  EngravedStamp,
  EngravedTaler,
} from "@/components/brand/engraved-icons";

/* RETIRED neutral placeholder marks → the engraved icon set. This file now
 * only redirects, so product-image fallbacks and older call sites keep
 * compiling while every world draws from one engraver's hand
 * (src/components/brand/engraved-icons.tsx). Prefer importing the engraved
 * set directly in new code. */

export type SymbolKey = "muenzen" | "edelmetalle" | "antiquitaeten" | "schmuck" | "briefmarken" | "sammlerobjekte";

const ENGRAVED: Record<SymbolKey, ComponentType<{ className?: string }>> = {
  muenzen: EngravedTaler,
  edelmetalle: EngravedBar,
  antiquitaeten: EngravedCandelabra,
  schmuck: EngravedRing,
  briefmarken: EngravedStamp,
  sammlerobjekte: EngravedCarton,
};

/* Compat: callers spliced these into their own 48-viewBox <svg>. Each entry
 * is now the full engraved miniature as a nested <svg> (fills the parent
 * viewport), so the drawing stays authoritative in one place. */
export const SYMBOL_PATHS: Record<SymbolKey, ReactNode> = {
  muenzen: <EngravedTaler />,
  edelmetalle: <EngravedBar />,
  antiquitaeten: <EngravedCandelabra />,
  schmuck: <EngravedRing />,
  briefmarken: <EngravedStamp />,
  sammlerobjekte: <EngravedCarton />,
};

/* Deliberate monochrome, unchanged: `card` is the stroke ink, `hero` a pale
 * stone wash for large grounds. Kept so existing call sites compile. */
export const SYMBOL_TINTS: Record<SymbolKey, { card: string; hero: string }> = {
  muenzen: { card: "#1c1c1c", hero: "#e9e7e1" },
  edelmetalle: { card: "#1c1c1c", hero: "#e9e7e1" },
  antiquitaeten: { card: "#1c1c1c", hero: "#e9e7e1" },
  schmuck: { card: "#1c1c1c", hero: "#e9e7e1" },
  briefmarken: { card: "#1c1c1c", hero: "#e9e7e1" },
  sammlerobjekte: { card: "#1c1c1c", hero: "#e9e7e1" },
};

/** Same signature as before; `strokeWidth` is retained for call-site
 * compatibility but intentionally inert — the engraved set carries its own
 * calibrated line weights. */
export function CollectionSymbol({
  name,
  size = 48,
  color,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  strokeWidth = 1.5,
}: {
  name: SymbolKey;
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  const Icon = ENGRAVED[name];
  return (
    <span className="inline-block align-middle" style={{ width: size, height: size, color }}>
      <Icon className="block h-full w-full" />
    </span>
  );
}
