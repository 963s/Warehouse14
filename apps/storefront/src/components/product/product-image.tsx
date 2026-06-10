"use client";

import { useState } from "react";
import Image from "next/image";
import type { ProductImage as PImage } from "@/lib/storefront-data";
import { cn } from "@/lib/cn";

const TILE_BG = "radial-gradient(120% 120% at 30% 20%, #fbf6e7 0%, #f1e7cb 45%, #e7d9b3 100%)";

/**
 * A product tile. Three rendering paths, one consistent frame:
 *
 *   1. placeholder mode → a "gradient:<emoji>" sentinel paints a warm parchment
 *      tile with the emoji.
 *   2. no image at all  → the same parchment tile with a neutral coin glyph
 *      (graceful fallback: every product still reads as a framed object).
 *   3. live image       → a real photo (api /api/photos/<id>/{raw,thumb} or an
 *      absolute CDN url) served via next/image, object-contain so the whole
 *      piece is shown, settled on a soft floor-shadow, with a calm fade-in once
 *      decoded so the grid never flashes raw <img> pop-in.
 *
 * Place inside a relative box; the component fills it.
 */
export function ProductImage({
  image,
  className,
  emojiClassName = "text-6xl md:text-7xl",
  sizes = "(max-width: 768px) 100vw, 33vw",
  priority = false,
  quality = 82,
}: {
  image: PImage | null;
  className?: string;
  emojiClassName?: string;
  sizes?: string;
  /** Mark the LCP / above-the-fold image so Next eager-loads it. */
  priority?: boolean;
  quality?: number;
}) {
  const url = image?.url ?? "";
  const isGradient = !url || url.startsWith("gradient:");
  const [loaded, setLoaded] = useState(false);

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
    <div className={cn("relative overflow-hidden bg-raised", className)} style={{ background: TILE_BG }}>
      {/* soft floor-shadow: the piece sits in the frame rather than being cut off */}
      <span
        className="pointer-events-none absolute inset-x-[18%] bottom-[9%] h-[8%] rounded-[50%] bg-ink/[0.16] blur-md"
        aria-hidden="true"
      />
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
          "object-contain p-[7%] transition-opacity duration-slow ease-curator motion-reduce:transition-none",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
