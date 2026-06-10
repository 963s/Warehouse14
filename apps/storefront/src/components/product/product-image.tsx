"use client";

import { useState } from "react";
import Image from "next/image";
import type { ProductImage as PImage } from "@/lib/storefront-data";
import { cn } from "@/lib/cn";

/* Warm cream wash for placeholder/emoji tiles and for the `contain` frame, where
 * the whole piece sits matted inside a generous margin (PDP gallery, cart). */
const TILE_BG = "radial-gradient(120% 120% at 30% 20%, #fbf6e7 0%, #f1e7cb 45%, #e7d9b3 100%)";

/**
 * A product tile. Three rendering paths, one consistent frame:
 *
 *   1. placeholder mode → a "gradient:<emoji>" sentinel paints a warm parchment
 *      tile with the emoji.
 *   2. no image at all  → the same parchment tile with a neutral coin glyph
 *      (graceful fallback: every product still reads as a framed object).
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
  emojiClassName = "text-6xl md:text-7xl",
  sizes = "(max-width: 768px) 100vw, 33vw",
  priority = false,
  quality = 82,
}: {
  image: PImage | null;
  className?: string;
  /** How the live photo meets the frame. Defaults to "contain" (matted, whole). */
  fit?: "contain" | "cover";
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
    const emoji = url.startsWith("gradient:") ? url.slice(9) : "🪙";
    return (
      <div className={cn("relative overflow-hidden", className)} style={{ background: TILE_BG }}>
        <span
          className={cn(
            "absolute inset-0 grid select-none place-items-center opacity-90 drop-shadow-sm",
            emojiClassName,
          )}
          aria-hidden={image?.altDe ? undefined : true}
        >
          {emoji}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn("relative overflow-hidden bg-raised", className)}
      style={isCover ? undefined : { background: TILE_BG }}
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
