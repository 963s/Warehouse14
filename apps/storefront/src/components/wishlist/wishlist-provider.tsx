"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ProductSummary, ProductImage } from "@/lib/storefront-data";

const STORAGE_KEY = "w14_wishlist";

/** Minimal snapshot stored per saved item. */
export type WishlistSnapshot = Pick<
  ProductSummary,
  "id" | "name" | "slug" | "sku" | "primaryImage" | "listPriceEur"
>;

type WishlistContextValue = {
  items: WishlistSnapshot[];
  count: number;
  has: (id: string) => boolean;
  toggle: (snapshot: WishlistSnapshot) => void;
  remove: (id: string) => void;
};

const WishlistContext = createContext<WishlistContextValue | null>(null);

export function useWishlist(): WishlistContextValue {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error("useWishlist must be used within <WishlistProvider>");
  return ctx;
}

function readStorage(): Record<string, WishlistSnapshot> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, WishlistSnapshot>) : {};
  } catch {
    return {};
  }
}

function writeStorage(record: Record<string, WishlistSnapshot>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // storage full or private mode, silently ignore
  }
}

export function WishlistProvider({ children }: { children: ReactNode }) {
  const [record, setRecord] = useState<Record<string, WishlistSnapshot>>({});

  // Hydrate from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    setRecord(readStorage());
  }, []);

  const has = useCallback((id: string) => id in record, [record]);

  const toggle = useCallback((snapshot: WishlistSnapshot) => {
    setRecord((prev) => {
      const next = { ...prev };
      if (snapshot.id in next) {
        delete next[snapshot.id];
      } else {
        next[snapshot.id] = snapshot;
      }
      writeStorage(next);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setRecord((prev) => {
      const next = { ...prev };
      delete next[id];
      writeStorage(next);
      return next;
    });
  }, []);

  const items = Object.values(record);
  const count = items.length;

  return (
    <WishlistContext.Provider value={{ items, count, has, toggle, remove }}>
      {children}
    </WishlistContext.Provider>
  );
}
