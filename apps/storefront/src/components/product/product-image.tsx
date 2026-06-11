"use client";

import { useState } from "react";
import Image from "next/image";
import { Coin } from "@/components/logo";
import type { ProductImage as PImage } from "@/lib/storefront-data";
import { cn } from "@/lib/cn";

/* Quiet neutral matte for placeholder tiles and for the `contain` frame, where
 * the whole piece sits matted inside a generous margin (PDP gallery, cart).
 * Strictly the cream/raised family (#f1efea), no gold or yellow cast. */
const MATTE_BG = "radial-gradient(120% 120% at 30% 20%, #f7f6f3 0%, #f1efea 55%, #eae8e2 100%)";

/**
 * A product tile. Three rendering paths, one consistent frame:
 *
 *   1. placeholder mode → a "gradient:…" sentinel (or a missing image) paints a
 *      calm cream matte with the house Coin monogram in ink line-art and a
 *      small smallcaps "Foto folgt" caption. Deliberate, neutral, no emoji.
 *   2. no image at all  → the same matte (graceful fallback: every product
 *      still reads as a framed object).
 *   3. live image       → a real photo (api /api/photos/<id>/{raw,thumb} or an
 *      absolute CDN url) served via next/image, with a calm fade-in once decoded
 *      so the grid never flashes raw <img> pop-in.
 *
 * `fit` controls how the live photo meets the frame:
 *   • "contain" (DEFAULT — unchanged behaviour) → the whole piece is shown on the
 *      cream matte with a soft floor-shadow. Used by the PDP gallery + cart, where
 *      the object must read whole and uncropped.
 *   • "cover" → the photo fills the frame edge-to-edge, present and jewel-clean
 *      (the catalog card on mobile). No matte, no floor-shadow.
 *
 * Place inside a relative box; the component fills it.
 */
export function ProductImage({
  image,
  className,
  fit = "contain",
  label,
  emojiClassName = "text-6xl md:text-7xl",
  sizes = "(max-width: 768px) 100vw, 33vw",
  priority = false,
  quality = 82,
}: {
  image: PImage | null;
  className?: string;
  /** How the live photo meets the frame. Defaults to "contain" (matted, whole). */
  fit?: "contain" | "cover";
  /** Optional smallcaps caption for the placeholder tile (e.g. the category name). */
  label?: string | null;
  /** Legacy size hint (font-size classes). Now scales the placeholder monogram, which is drawn at 1em. */
  emojiClassName?: string;
  sizes?: string;
  /** Mark the LCP / above-the-fold image so Next eager-loads it. */
  priority?: boolean;
  quality?: number;
}) {
  const url = image?.url ?? "";
  const isGradient = !url || url.startsWith("gradient:");
  const [loaded, setLoaded] = useState(false);
  const isCover = fit === "cover";

  if (isGradient) {
    // "Foto folgt" presentation: cream ground, fine ink Coin monogram,
    // smallcaps caption. The caption only appears once the tile is wide
    // enough to carry type (container query), so tiny thumbs stay clean.
    const caption = label ?? image?.altDe ?? null;
    return (
      <div
        className={cn("relative overflow-hidden [container-type:inline-size]", className)}
        style={{ background: MATTE_BG }}
        role="img"
        aria-label={image?.altDe ?? "Foto folgt"}
      >
        <div
          className="absolute inset-0 flex select-none flex-col items-center justify-center gap-3 p-[8%]"
          aria-hidden="true"
        >
          <span className={cn("grid place-items-center leading-none text-ink opacity-30", emojiClassName)}>
            <Coin className="h-[1em] w-[1em]" />
          </span>
          <span className="hidden max-w-full flex-col items-center gap-1 text-center [@container(min-width:150px)]:flex">
            {caption && (
              <span className="smallcaps line-clamp-1 max-w-full px-2 text-[0.8125rem] text-ink-aged">
                {caption}
              </span>
            )}
            <span className="text-[0.625rem] uppercase tracking-[0.16em] text-ink-faded">Foto folgt</span>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("relative overflow-hidden bg-raised", className)}
      style={isCover ? undefined : { background: MATTE_BG }}
    >
      {/* contain: soft floor-shadow so the piece sits in the frame, not cut off */}
      {!isCover && (
        <span
          className="pointer-events-none absolute inset-x-[18%] bottom-[9%] h-[8%] rounded-[50%] bg-ink/[0.16] blur-md"
          aria-hidden="true"
        />
      )}
      <Image
        src={url}
        alt={image?.altDe ?? ""}
        fill
        sizes={sizes}
        quality={quality}
        priority={priority}
        loading={priority ? undefined : "lazy"}
        onLoad={() => setLoaded(true)}
        className={cn(
          "transition-opacity duration-slow ease-curator motion-reduce:transition-none",
          isCover ? "object-cover" : "object-contain p-[7%]",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
