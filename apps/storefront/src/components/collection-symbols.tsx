import type { ReactNode } from "react";

/* Shared crafted line-art for the six worlds of the house. Detailed and
 * complete, designed to fill a 48 viewBox so they read large and clear.
 * stroke = currentColor; tint is applied by the caller. */

export type SymbolKey = "muenzen" | "edelmetalle" | "antiquitaeten" | "schmuck" | "briefmarken" | "sammlerobjekte";

const stroke = { fill: "none" as const, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const SYMBOL_PATHS: Record<SymbolKey, ReactNode> = {
  // A struck coin: reeded rim, inner ring, tick marks, engraved star.
  muenzen: (
    <>
      <circle cx="24" cy="24" r="17.5" />
      <circle cx="24" cy="24" r="13.5" strokeWidth={1.1} opacity={0.55} />
      {Array.from({ length: 36 }).map((_, i) => {
        const a = (i / 36) * Math.PI * 2;
        const r1 = 17.5, r2 = 19;
        return (
          <line key={i} x1={+(24 + Math.cos(a) * r1).toFixed(2)} y1={+(24 + Math.sin(a) * r1).toFixed(2)} x2={+(24 + Math.cos(a) * r2).toFixed(2)} y2={+(24 + Math.sin(a) * r2).toFixed(2)} strokeWidth={1} opacity={0.5} />
        );
      })}
      <path d="M24 17.5l1.7 3.6 3.9.5-2.9 2.7.8 3.9-3.5-1.9-3.5 1.9.8-3.9-2.9-2.7 3.9-.5z" strokeWidth={1.1} opacity={0.85} />
    </>
  ),
  // A minted bar with bevel, fineness lines and a stamp.
  edelmetalle: (
    <>
      <path d="M9 31.5l2.5-13h25l2.5 13z" />
      <path d="M11.5 18.5l2-3h21l2 3" strokeWidth={1.1} opacity={0.7} />
      <path d="M14.5 24h19M13.7 28h20.6" strokeWidth={1} opacity={0.45} />
      <rect x="20" y="20.4" width="8" height="3.4" rx="0.6" strokeWidth={1} opacity={0.7} />
    </>
  ),
  // A handled amphora with a decorative band.
  antiquitaeten: (
    <>
      <path d="M17 13.5h14" />
      <path d="M19 13.5c-1.6 4.5-1 6-4 9.5-2.8 3.2-2.4 11 1 14 2.4 2.1 5.5 2.6 8 2.6s5.6-.5 8-2.6c3.4-3 3.8-10.8 1-14-3-3.5-2.4-5-4-9.5" />
      <path d="M19.5 17c-4-.6-5.4 4.6-2.4 6.8" strokeWidth={1.1} opacity={0.7} />
      <path d="M28.5 17c4-.6 5.4 4.6 2.4 6.8" strokeWidth={1.1} opacity={0.7} />
      <path d="M16.6 27h14.8" strokeWidth={1} opacity={0.45} />
    </>
  ),
  // A ring with a faceted gemstone.
  schmuck: (
    <>
      <circle cx="24" cy="30" r="11" />
      <circle cx="24" cy="30" r="8.2" strokeWidth={1.1} opacity={0.45} />
      <path d="M16.5 14h15l-7.5 8z" />
      <path d="M16.5 14l7.5 8 7.5-8M24 11v3M20.2 14l3.8 8 3.8-8" strokeWidth={1.1} opacity={0.7} />
    </>
  ),
  // A perforated stamp with portrait oval and value.
  briefmarken: (
    <>
      <rect x="10.5" y="10.5" width="27" height="27" rx="1.6" strokeDasharray="2.3 2.5" />
      <rect x="15" y="15" width="18" height="18" rx="1" strokeWidth={1.1} opacity={0.55} />
      <ellipse cx="24" cy="22.5" rx="5" ry="6" strokeWidth={1.1} opacity={0.6} />
      <path d="M18 31h12" strokeWidth={1} opacity={0.5} />
    </>
  ),
  // A pocket watch with face, hands, crown and bow.
  sammlerobjekte: (
    <>
      <circle cx="24" cy="27" r="13" />
      <circle cx="24" cy="27" r="10.4" strokeWidth={1.1} opacity={0.4} />
      <path d="M24 14.5v-3M20.5 11.5h7" strokeWidth={1.2} />
      <path d="M24 18.5v1.6M24 33.4V35M15 27h1.6M31.4 27H33" strokeWidth={1.1} opacity={0.65} />
      <path d="M24 27v-5.5M24 27l4 2.4" strokeWidth={1.2} opacity={0.85} />
    </>
  ),
};

export const SYMBOL_TINTS: Record<SymbolKey, { card: string; hero: string }> = {
  muenzen: { card: "#b08a33", hero: "#ecd391" },
  edelmetalle: { card: "#6f757b", hero: "#cdd3d9" },
  antiquitaeten: { card: "#a3623c", hero: "#e6ad82" },
  schmuck: { card: "#9c5b64", hero: "#ebc0c6" },
  briefmarken: { card: "#4f6378", hero: "#bbcadc" },
  sammlerobjekte: { card: "#5d6a4c", hero: "#c9d8a8" },
};

export function CollectionSymbol({ name, size = 48, color, strokeWidth = 1.5 }: { name: SymbolKey; size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} stroke={color ?? "currentColor"} strokeWidth={strokeWidth} {...stroke}>
      {SYMBOL_PATHS[name]}
    </svg>
  );
}
