"use client";

import { Heart } from "lucide-react";
import { cn } from "@/lib/cn";
import { useWishlist, type WishlistSnapshot } from "./wishlist-provider";

interface WishlistButtonProps {
  product: WishlistSnapshot;
}

/**
 * Heart button rendered inside product cards.
 * Filled ink when saved, outline otherwise. On touch screens there is no
 * hover, so the chip is ALWAYS visible there (a hover-revealed heart would be
 * unreachable). Only where a real hover pointer exists does it stay quiet
 * until the card is hovered, the button is focused, or the item is saved.
 * Prevents the click from propagating to the card link.
 */
export function WishlistButton({ product }: WishlistButtonProps) {
  const { has, toggle } = useWishlist();
  const saved = has(product.id);

  return (
    <button
      type="button"
      aria-label={saved ? "Von der Merkliste entfernen" : "Auf die Merkliste"}
      aria-pressed={saved}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(product);
      }}
      className={cn(
        "absolute right-2 top-2 grid h-11 w-11 place-items-center rounded-full bg-card/85 text-ink ring-1 ring-rule backdrop-blur transition-[opacity,color] duration-fast focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none",
        // touch: always visible; hover devices: revealed on card hover/focus
        "opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100",
        saved && "[@media(hover:hover)]:opacity-100",
      )}
    >
      <Heart
        aria-hidden="true"
        className="h-5 w-5 transition-colors"
        strokeWidth={1.7}
        fill={saved ? "currentColor" : "none"}
      />
    </button>
  );
}
