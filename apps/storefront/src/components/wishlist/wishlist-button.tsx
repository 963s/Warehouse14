"use client";

import { Heart } from "lucide-react";
import { useWishlist, type WishlistSnapshot } from "./wishlist-provider";

interface WishlistButtonProps {
  product: WishlistSnapshot;
}

/**
 * Heart button rendered inside product cards.
 * Filled gold when saved, outline otherwise.
 * Prevents the click from propagating to the card link.
 */
export function WishlistButton({ product }: WishlistButtonProps) {
  const { has, toggle } = useWishlist();
  const saved = has(product.id);

  return (
    <button
      type="button"
      aria-label={saved ? "Von der Merkliste entfernen" : "Auf die Merkliste"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(product);
      }}
      className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/85 text-ink-aged opacity-0 backdrop-blur transition-[opacity,color] duration-300 hover:text-wax-red group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
    >
      <Heart
        aria-hidden="true"
        className="h-[18px] w-[18px] transition-colors"
        fill={saved ? "currentColor" : "none"}
        style={saved ? { color: "var(--color-gold, #b8972a)" } : undefined}
      />
    </button>
  );
}
