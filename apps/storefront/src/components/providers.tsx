"use client";

import type { ReactNode } from "react";
import { CartProvider } from "@/components/cart/cart-provider";
import { CartDrawer } from "@/components/cart/cart-drawer";
import { WishlistProvider } from "@/components/wishlist/wishlist-provider";

/** App-wide client providers. Wraps everything so any header/page can useCart() and useWishlist(). */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <WishlistProvider>
      <CartProvider>
        {children}
        <CartDrawer />
      </CartProvider>
    </WishlistProvider>
  );
}
