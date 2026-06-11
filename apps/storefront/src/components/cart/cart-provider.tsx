"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { data, productHref, type Cart, type CartItem, type ProductImage, type ProductSummary } from "@/lib/storefront-data";

/** Display metadata we keep client-side so the drawer can show names + images. */
export type ItemMeta = { name: string; href: string; image: ProductImage | null; priceEur: string };

const STORAGE_KEY = "w14.cart.v1";

/** Snapshot persisted across hard navigations: line items plus display meta. */
type StoredCart = { cart: Cart; meta: Record<string, ItemMeta> };

function readStorage(): StoredCart | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredCart;
    if (!parsed?.cart || !Array.isArray(parsed.cart.items)) return null;
    return { cart: parsed.cart, meta: parsed.meta ?? {} };
  } catch {
    return null;
  }
}

function writeStorage(snapshot: StoredCart): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // storage full or private mode, silently ignore
  }
}

type CartContextValue = {
  cart: Cart | null;
  count: number;
  meta: Record<string, ItemMeta>;
  isOpen: boolean;
  pending: boolean;
  /** Cart line currently mutated by a stepper, serializes rapid taps. */
  mutatingId: string | null;
  openCart: () => void;
  closeCart: () => void;
  add: (product: Pick<ProductSummary, "id" | "name" | "slug" | "sku" | "primaryImage" | "listPriceEur">) => Promise<void>;
  remove: (cartItemId: string) => Promise<void>;
  /** Quantity steppers, built ONLY on the seam's addToCart/removeFromCart. */
  increase: (item: CartItem) => Promise<void>;
  decrease: (item: CartItem) => Promise<void>;
  /** Empties the cart and its stored snapshot, used after a submitted order. */
  clear: () => Promise<void>;
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
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  /** productIds we already tried to backfill, so a missing product never loops. */
  const metaAttempted = useRef<Set<string>>(new Set());

  /* Hydrate after mount (mirrors the wishlist provider, avoids SSR mismatch):
   * the stored snapshot paints immediately, then the seam cart stays the
   * source of truth. If the seam comes back empty after a hard navigation
   * (placeholder mode keeps its cart in memory only), the stored lines are
   * replayed through addToCart so seam state and line ids stay consistent
   * for the steppers. Live mode with a server cart wins untouched. */
  useEffect(() => {
    let cancelled = false;
    const stored = readStorage();
    if (stored && stored.cart.items.length > 0) {
      setCart(stored.cart);
      setMeta((m) => ({ ...stored.meta, ...m }));
    }
    (async () => {
      try {
        let live = await data.getCart();
        if (live.items.length === 0 && stored && stored.cart.items.length > 0) {
          for (const line of stored.cart.items) {
            try {
              for (let n = 0; n < line.quantity; n++) {
                live = await data.addToCart(line.productId);
              }
            } catch {
              // product no longer available, drop the line quietly
            }
          }
        }
        if (!cancelled) setCart(live);
      } catch {
        // seam unreachable, keep the stored snapshot
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Persist on every change so the cart survives hard navigations. */
  useEffect(() => {
    if (!cart) return;
    writeStorage({ cart, meta });
  }, [cart, meta]);

  /* Backfill display metadata after a full reload: the cart itself persists
   * server-side (live mode), but names/images live only in this client map.
   * One catalog sweep via the existing seam function fills the gaps so the
   * Warenkorb never shows anonymous "Artikel" rows. Quiet on failure. */
  useEffect(() => {
    if (!cart) return;
    const missing = cart.items.filter(
      (i) => !meta[i.productId] && !metaAttempted.current.has(i.productId),
    );
    if (missing.length === 0) return;
    missing.forEach((i) => metaAttempted.current.add(i.productId));
    let cancelled = false;
    data
      .listProducts({ limit: 100 })
      .then(({ items }) => {
        if (cancelled) return;
        setMeta((m) => {
          const next = { ...m };
          for (const line of missing) {
            const p = items.find((x) => x.id === line.productId);
            if (p && !next[line.productId]) {
              next[line.productId] = {
                name: p.name,
                href: productHref(p),
                image: p.primaryImage,
                priceEur: p.listPriceEur,
              };
            }
          }
          return next;
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cart, meta]);

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

  /* The seam exposes addToCart (+1) and removeFromCart (whole line) only, so
   * the steppers are composed from exactly those two primitives. "+" re-adds
   * by productId, "−" removes the line and, above quantity 1, rebuilds it at
   * quantity − 1. mutatingId serializes taps so seam calls never interleave. */
  const increase: CartContextValue["increase"] = useCallback(
    async (item) => {
      if (mutatingId) return;
      setMutatingId(item.id);
      try {
        setCart(await data.addToCart(item.productId));
      } finally {
        setMutatingId(null);
      }
    },
    [mutatingId],
  );

  const decrease: CartContextValue["decrease"] = useCallback(
    async (item) => {
      if (mutatingId) return;
      setMutatingId(item.id);
      try {
        let next = await data.removeFromCart(item.id);
        for (let n = 0; n < item.quantity - 1; n++) {
          next = await data.addToCart(item.productId);
        }
        setCart(next);
      } finally {
        setMutatingId(null);
      }
    },
    [mutatingId],
  );

  /* Empties every line through the seam, then drops the stored snapshot.
   * Used by the Bestätigung once the order recap has been handed over. */
  const clear: CartContextValue["clear"] = useCallback(async () => {
    setPending(true);
    try {
      let next: Cart | null = null;
      for (const line of cart?.items ?? []) {
        try {
          next = await data.removeFromCart(line.id);
        } catch {
          // line already gone, keep emptying
        }
      }
      setCart((prev) => next ?? (prev ? { ...prev, items: [], totalEur: "0.00" } : prev));
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // silently ignore, the persist effect rewrites the empty cart anyway
      }
    } finally {
      setPending(false);
    }
  }, [cart]);

  const count = cart?.items.reduce((n, i) => n + i.quantity, 0) ?? 0;

  return (
    <CartContext.Provider
      value={{
        cart,
        count,
        meta,
        isOpen,
        pending,
        mutatingId,
        openCart: () => setIsOpen(true),
        closeCart: () => setIsOpen(false),
        add,
        remove,
        increase,
        decrease,
        clear,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}
