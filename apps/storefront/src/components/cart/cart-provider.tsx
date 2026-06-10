"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { data, productHref, type Cart, type ProductImage, type ProductSummary } from "@/lib/storefront-data";

/** Display metadata we keep client-side so the drawer can show names + images. */
export type ItemMeta = { name: string; href: string; image: ProductImage | null; priceEur: string };

type CartContextValue = {
  cart: Cart | null;
  count: number;
  meta: Record<string, ItemMeta>;
  isOpen: boolean;
  pending: boolean;
  openCart: () => void;
  closeCart: () => void;
  add: (product: Pick<ProductSummary, "id" | "name" | "slug" | "sku" | "primaryImage" | "listPriceEur">) => Promise<void>;
  remove: (cartItemId: string) => Promise<void>;
};

const CartContext = createContext<CartContextValue | null>(null);

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within <CartProvider>");
  return ctx;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [meta, setMeta] = useState<Record<string, ItemMeta>>({});
  const [isOpen, setIsOpen] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    data.getCart().then(setCart).catch(() => {});
  }, []);

  const add: CartContextValue["add"] = useCallback(async (product) => {
    setPending(true);
    try {
      const next = await data.addToCart(product.id);
      setCart(next);
      setMeta((m) => ({
        ...m,
        [product.id]: {
          name: product.name,
          href: productHref(product),
          image: product.primaryImage,
          priceEur: product.listPriceEur,
        },
      }));
      setIsOpen(true);
    } finally {
      setPending(false);
    }
  }, []);

  const remove: CartContextValue["remove"] = useCallback(async (cartItemId) => {
    setPending(true);
    try {
      setCart(await data.removeFromCart(cartItemId));
    } finally {
      setPending(false);
    }
  }, []);

  const count = cart?.items.reduce((n, i) => n + i.quantity, 0) ?? 0;

  return (
    <CartContext.Provider
      value={{
        cart,
        count,
        meta,
        isOpen,
        pending,
        openCart: () => setIsOpen(true),
        closeCart: () => setIsOpen(false),
        add,
        remove,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}
