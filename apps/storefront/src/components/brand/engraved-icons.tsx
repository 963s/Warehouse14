import type { ComponentType, ReactNode } from "react";
import { BrandLoupe } from "./marks";

/**
 * THE ENGRAVED ICON SET — miniature engravings for the worlds of the house.
 *
 * Drawn in the same hand as the official loupe sketch (BrandLoupeSketch):
 * a living main line, a quieter re-struck companion line, sparse hatching
 * for shade, and the occasional motion tick. Everything is stroke work —
 * fill none, currentColor — so the surface decides the ink, exactly like
 * the brand marks.
 *
 * Each miniature carries ONE small accent group (class
 * `w14-engraved-accent`, pre-wired with `group-hover:text-gilt`): the
 * sparkle on the ring, the flames of the candelabra, the gilded
 * perforation of the stamp. Inside a `group` hover the accent gilds —
 * one calm change. Outside a group it stays ink and is simply part of
 * the drawing.
 */

type IconProps = { className?: string };

/** Shared plate setup: 48-grid, round stroke, engraver's weight. */
function Plate({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** The gilt thread: pre-wired to warm up inside a hovered `group`. */
function Accent({ children }: { children: ReactNode }) {
  return <g className="w14-engraved-accent transition-colors duration-300 group-hover:text-gilt">{children}</g>;
}

/** A GILT EDGE: a thin gilt hairline tracing ONLY the object's outermost
 * contour, so the gold seasons just the silhouette's edge — never a fill,
 * never a glow. Low opacity keeps it a whisper in every context (ink card
 * icon, faint watermark plate), gold on the LINE not the field. */
function GiltEdge({ children }: { children: ReactNode }) {
  return (
    <g stroke="var(--w14-gilt)" strokeWidth={0.9} opacity={0.45} fill="none">
      {children}
    </g>
  );
}

/** A struck taler: reeded rim, re-struck inner ring, small crest, luster ticks. */
export function EngravedTaler({ className }: IconProps) {
  return (
    <Plate className={className}>
      {/* rim */}
      <circle cx="24" cy="24.6" r="16.4" />
      {/* reeding, hand-spaced */}
      <path
        strokeWidth={0.9}
        opacity={0.5}
        d="M40.3 24.5L38.5 24.5M39.8 28.3L38.1 27.9M38.2 32.3L37.0 31.7M35.8 35.8L34.3 34.4M32.9 38.1L31.8 36.5M30.0 39.7L29.5 38.4M26.6 40.7L26.3 38.7M21.6 40.7L21.9 39.3M18.0 39.9L18.7 37.9M15.2 38.1L16.0 36.8M12.1 35.6L13.3 34.5M9.8 32.4L11.0 31.7M8.1 28.4L9.7 28.0M7.8 24.4L9.5 24.4M8.4 20.6L10.0 21.0M9.7 16.7L11.5 17.7M11.8 14.0L13.0 15.0M14.2 11.6L15.3 13.0M17.7 9.6L18.4 11.3M21.8 8.4L22.0 10.0M25.8 8.4L25.6 10.1M29.8 9.3L29.1 11.2M33.1 11.2L32.2 12.4M36.7 14.3L35.0 15.7M38.2 16.6L36.7 17.5M40.0 21.3L37.9 21.8"
      />
      {/* re-struck inner ring, broken like a sketch line */}
      <path strokeWidth={1} opacity={0.6} d="M36.6 22.4a12.9 12.9 0 0 1-10.4 14.7M11.5 27.2a12.9 12.9 0 0 1 9.9-15.1" />
      {/* crest */}
      <path strokeWidth={1.3} d="M24 17.6c2.9 0 5.2.9 5.2.9v5.6c0 4-2.7 6.4-5.2 7.6-2.5-1.2-5.2-3.6-5.2-7.6v-5.6s2.3-.9 5.2-.9z" />
      <path strokeWidth={0.9} opacity={0.7} d="M19.4 21.4l9.2 4.4" />
      <path strokeWidth={0.8} opacity={0.5} d="M21.2 27.2l4.6 2.3M20.4 24.7l2.6 1.3" />
      {/* mint luster */}
      <Accent>
        <path strokeWidth={1.3} d="M37.2 9.8l2.5-2.6M40 13.6l2.6-1.4M33.8 7.4l1.2-2.3" />
      </Accent>
      {/* gilt edge — the reeded rim */}
      <GiltEdge>
        <circle cx="24" cy="24.6" r="16.4" />
      </GiltEdge>
    </Plate>
  );
}

/** An old ring: double-line band, faceted stone, sparkle ticks off the table. */
export function EngravedRing({ className }: IconProps) {
  return (
    <Plate className={className}>
      {/* band, with a quieter inner line */}
      <circle cx="24" cy="30" r="9.8" />
      <path strokeWidth={1} opacity={0.55} d="M16 31.6a8.1 8.1 0 0 0 13.8 4.5M31.9 28.4a8.1 8.1 0 0 0-2.4-4.3" />
      {/* stone: table, girdle, crown and pavilion facets */}
      <path strokeWidth={1.4} d="M21 12h6M18.6 16h10.8M21 12l-2.4 4M27 12l2.4 4M18.6 16l5.3 4.3 5.5-4.3" />
      <path strokeWidth={0.9} opacity={0.65} d="M21 12l2.9 4M27 12l-3.1 4M23.9 16v4.3" />
      {/* the sparkle — same gesture as the loupe's motion strokes */}
      <Accent>
        <path strokeWidth={1.3} d="M32.6 12.4l3.1-1M31.6 8.8l2.3-2.1M28.3 7.3l.6-2.6" />
      </Accent>
      {/* gilt edge — the band */}
      <GiltEdge>
        <circle cx="24" cy="30" r="9.8" />
      </GiltEdge>
    </Plate>
  );
}

/** A pocket watch: case, bow, three chain links, the hands set late. */
export function EngravedPocketWatch({ className }: IconProps) {
  return (
    <Plate className={className}>
      {/* case and bezel */}
      <circle cx="22" cy="28.4" r="12.4" />
      <path strokeWidth={1} opacity={0.55} d="M32.2 26.1a10.4 10.4 0 0 1-9.1 12.6M11.8 30.6a10.4 10.4 0 0 1 7-11.7" />
      {/* stem and bow */}
      <path strokeWidth={1.3} d="M20.7 16.2v-2.4M23.3 16.2v-2.4M19.8 13.6h4.4" />
      <circle cx="22" cy="10.4" r="2.3" strokeWidth={1.3} />
      {/* chain links wandering off */}
      <path
        strokeWidth={1.1}
        opacity={0.8}
        d="M26.5 8.3c.5-1 1.8-1.5 2.9-1s1.4 1.7.9 2.7-1.8 1.4-2.9.9-1.4-1.6-.9-2.6zM32.4 6.7c.5-.9 1.7-1.3 2.7-.9s1.3 1.6.8 2.5-1.7 1.3-2.7.9-1.3-1.6-.8-2.5zM38.1 5.9c.4-.8 1.5-1.2 2.4-.8s1.2 1.4.8 2.2-1.5 1.1-2.4.8-1.2-1.4-.8-2.2z"
      />
      {/* quarter marks */}
      <path strokeWidth={1} opacity={0.65} d="M22 18.8v1.7M22 38v-1.7M12.4 28.4h1.7M31.6 28.4h-1.7" />
      {/* shade, lower left of the dial */}
      <path strokeWidth={0.8} opacity={0.5} d="M14.6 33.2l1.7 1.7M16.1 35.1l1.4 1.3M13.6 31.2l1.5 1.5" />
      {/* hands */}
      <Accent>
        <path strokeWidth={1.4} d="M22 28.4v-6.2M22 28.4l4.6-2.6" />
        <circle cx="22" cy="28.4" r="0.9" strokeWidth={1.2} />
      </Accent>
      {/* gilt edge — the case */}
      <GiltEdge>
        <circle cx="22" cy="28.4" r="12.4" />
      </GiltEdge>
    </Plate>
  );
}

/** A rare stamp: gilded perforation, double frame, engraved oval vignette. */
export function EngravedStamp({ className }: IconProps) {
  return (
    <Plate className={className}>
      {/* inner frame, re-struck */}
      <rect x="14.6" y="14.6" width="18.8" height="18.8" strokeWidth={1.3} />
      <path strokeWidth={0.9} opacity={0.5} d="M16.5 31.4v-9.6M31.5 16.6v9.4" />
      {/* vignette oval with banknote hatching */}
      <ellipse cx="24" cy="22.8" rx="4.9" ry="5.8" strokeWidth={1.1} />
      <path strokeWidth={0.8} opacity={0.55} d="M19.9 24.6h8.2M20.5 26.4h7M21.6 28.1h4.8" />
      {/* value line */}
      <path strokeWidth={1} opacity={0.7} d="M18.4 31h11.2" />
      {/* the perforated edge — the gilded rim of a rare stamp */}
      <Accent>
        <rect x="10.4" y="10.4" width="27.2" height="27.2" strokeWidth={1.6} strokeDasharray="0.1 3.4" />
      </Accent>
      {/* gilt edge — the inner frame contour */}
      <GiltEdge>
        <rect x="14.6" y="14.6" width="18.8" height="18.8" />
      </GiltEdge>
    </Plate>
  );
}

/** A three-flame candelabra for the Antiquitäten world. */
export function EngravedCandelabra({ className }: IconProps) {
  return (
    <Plate className={className}>
      {/* center candle and cup */}
      <path strokeWidth={1.3} d="M22.9 12.4v5.2M25.1 12.4v5.2M21.6 18.2h4.8" />
      {/* stem, knop, base */}
      <path d="M24 18.2v14.6" strokeWidth={1.4} />
      <path strokeWidth={1.2} d="M24 24.4l1.7 1.8-1.7 1.8-1.7-1.8z" />
      <path strokeWidth={1.4} d="M18.4 36.4c1.4-2.4 3.6-3.6 5.6-3.6s4.2 1.2 5.6 3.6" />
      <path d="M15.8 36.4h16.4" />
      {/* arms sweeping to the side cups */}
      <path d="M23.6 29.6c-6.8-.4-11.1-4-11.1-9.4" />
      <path d="M24.4 29.6c6.8-.4 11.1-4 11.1-9.4" />
      {/* side candles */}
      <path strokeWidth={1.2} d="M11.5 19.4v-4.6M13.5 19.4v-4.6M10.4 20.2h4.2" />
      <path strokeWidth={1.2} d="M34.5 19.4v-4.6M36.5 19.4v-4.6M33.4 20.2h4.2" />
      {/* shade under the foot */}
      <path strokeWidth={0.8} opacity={0.5} d="M19.6 38.6l-1.1 1.4M23.4 38.6l-1.1 1.4M27.2 38.6l-1.1 1.4" />
      {/* the three flames */}
      <Accent>
        <path strokeWidth={1.2} d="M24 6.6c1.2 1.4 1 3-.1 4-1-1.1-1.1-2.7.1-4z" />
        <path strokeWidth={1.1} d="M12.5 9.8c1 1.2.9 2.6-.1 3.5-.9-1-1-2.4.1-3.5z" />
        <path strokeWidth={1.1} d="M35.5 9.8c1 1.2.9 2.6-.1 3.5-.9-1-1-2.4.1-3.5z" />
      </Accent>
      {/* gilt edge — the foot and base line */}
      <GiltEdge>
        <path d="M18.4 36.4c1.4-2.4 3.6-3.6 5.6-3.6s4.2 1.2 5.6 3.6" />
        <path d="M15.8 36.4h16.4" />
      </GiltEdge>
    </Plate>
  );
}

/** A cameo brooch: double oval, faceted center, a run of seed pearls. */
export function EngravedBrooch({ className }: IconProps) {
  return (
    <Plate className={className}>
      {/* mount */}
      <ellipse cx="24" cy="24" rx="9.4" ry="12" />
      <path strokeWidth={1} opacity={0.55} d="M30.9 19.6a7.5 7.5 0 0 1 .6 4.4c-.3 3.6-2.2 6.8-4.9 8.6M17.4 28.6a10.6 10.6 0 0 1-.9-4.6" />
      {/* faceted center stone */}
      <path strokeWidth={1.3} d="M24 17.8l4.4 6.2-4.4 6.2-4.4-6.2z" />
      <path strokeWidth={0.9} opacity={0.65} d="M19.6 24h8.8M24 17.8v3.4" />
      <path strokeWidth={0.8} opacity={0.5} d="M22 27.2l2 2.4M21 25.6l1.4 1.7" />
      {/* seed pearls */}
      <Accent>
        <ellipse cx="24" cy="24" rx="12" ry="14.6" strokeWidth={1.6} strokeDasharray="0.1 4.55" />
      </Accent>
      {/* gilt edge — the mount oval */}
      <GiltEdge>
        <ellipse cx="24" cy="24" rx="9.4" ry="12" />
      </GiltEdge>
    </Plate>
  );
}

/** Two cast bars, stacked the way they sit in the tray. */
export function EngravedBar({ className }: IconProps) {
  return (
    <Plate className={className}>
      {/* lower bar, cast profile */}
      <path d="M11 37.2l3-8.6h20l3 8.6z" />
      {/* upper bar, resting a touch off-centre */}
      <path d="M16.2 28.6l2.9-8h10.6l2.9 8" />
      {/* bevel re-strike along the lower bar's top edge */}
      <path strokeWidth={0.9} opacity={0.5} d="M14.6 30.4h18.6" />
      {/* fineness engraving on the upper face */}
      <path strokeWidth={0.9} opacity={0.65} d="M20.8 24.6h6.8" />
      {/* shade on the right flank */}
      <path strokeWidth={0.8} opacity={0.5} d="M33.8 31.2l1.4 3.6M32.2 31.2l1.2 3M35.5 33.4l.8 2.2" />
      {/* the assay seal */}
      <Accent>
        <ellipse cx="23" cy="33.4" rx="3.9" ry="1.9" strokeWidth={1.1} />
      </Accent>
      {/* gilt edge — the lower cast bar's profile */}
      <GiltEdge>
        <path d="M11 37.2l3-8.6h20l3 8.6z" />
      </GiltEdge>
    </Plate>
  );
}

/** The Nachlass carton: worn box, open flaps, a glint rising from inside. */
export function EngravedCarton({ className }: IconProps) {
  return (
    <Plate className={className}>
      {/* front and side faces */}
      <path d="M10 22.6l.3 13.6 17.7 2.4-.2-14.2" />
      <path d="M28 38.6l9.8-4.6-.3-13.3" />
      {/* the mouth of the box */}
      <path strokeWidth={1.4} d="M10 22.6l17.8 1.8 9.7-3.7-17.3-2z" />
      {/* back flap, standing open */}
      <path strokeWidth={1.3} d="M20.2 18.7l1.6-6.2 14.2 1.7 1.5 6.5" />
      {/* left flap, dropped outward and a little tired */}
      <path strokeWidth={1.2} d="M10 22.6l-4.6-3.4 1.8-4.6 13-.9" />
      {/* seam and wear */}
      <path strokeWidth={0.9} opacity={0.5} d="M19.3 24.2l.2 13M14.2 21l11.7 1.3" />
      <path strokeWidth={0.8} opacity={0.5} d="M31.5 30l4-1.8M31.6 32.8l3.9-1.8M31.5 35.5l2.4-1.1" />
      {/* the glint of something good in the carton */}
      <Accent>
        <path strokeWidth={1.3} d="M28.8 8.2v4.4M26.6 10.4H31M24.4 6.9l-1 2.4M33.2 14.2l2-1.4" />
      </Accent>
      {/* gilt edge — the mouth of the box */}
      <GiltEdge>
        <path d="M10 22.6l17.8 1.8 9.7-3.7-17.3-2z" />
      </GiltEdge>
    </Plate>
  );
}

/** The magnifier slot belongs to the official loupe — never redrawn. */
export const EngravedMagnifier = BrandLoupe;

/**
 * Category slug → miniature. Covers the real seam slugs
 * (listCategories/placeholder tree) plus the legacy home slugs.
 * Anything unknown falls back to the taler.
 */
export const engravedIconBySlug: Record<string, ComponentType<{ className?: string }>> = {
  gold: EngravedBar,
  silber: EngravedBar,
  platin: EngravedBar,
  edelmetalle: EngravedBar,
  goldbarren: EngravedBar,
  muenzen: EngravedTaler,
  goldmuenzen: EngravedTaler,
  silbermuenzen: EngravedTaler,
  schmuck: EngravedRing,
  uhren: EngravedPocketWatch,
  antiquitaeten: EngravedCandelabra,
  briefmarken: EngravedStamp,
  sammlerobjekte: EngravedCarton,
};

/** Lookup with the house fallback. */
export function engravedIconForSlug(slug: string): ComponentType<{ className?: string }> {
  return engravedIconBySlug[slug] ?? EngravedTaler;
}
