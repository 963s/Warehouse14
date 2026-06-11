"use client";

import { useEffect, useState } from "react";
import { data, type CategoryNode } from "@/lib/storefront-data";

/**
 * Client-side access to the live category tree for the chrome (header nav +
 * side menu), which renders in client trees where a server fetch cannot be
 * threaded in. One module-level cache → at most one fetch per page load:
 * placeholder mode resolves in-memory, live mode rides the same-origin
 * /api/storefront/categories proxy.
 */

let cache: CategoryNode[] | null = null;
let inflight: Promise<CategoryNode[]> | null = null;

/**
 * SSR fallback so the header carries real links before the tree arrives
 * (and if the backend is briefly unreachable): the owner's roots, slug-true.
 * Names/children are replaced by the live tree the moment it loads.
 */
export const FALLBACK_ROOT_LINKS: ReadonlyArray<{ slug: string; nameDe: string }> = [
  { slug: "gold", nameDe: "Gold" },
  { slug: "muenzen", nameDe: "Münzen" },
  { slug: "briefmarken", nameDe: "Briefmarken" },
  { slug: "schmuck", nameDe: "Schmuck" },
  { slug: "barren", nameDe: "Barren" },
];

export function useCategories(): CategoryNode[] | null {
  const [tree, setTree] = useState<CategoryNode[] | null>(cache);

  useEffect(() => {
    if (cache) return;
    let alive = true;
    inflight ??= data
      .listCategories()
      .then((t) => {
        cache = t;
        return t;
      })
      .catch(() => {
        inflight = null; // a failed fetch may retry on the next mount
        return [] as CategoryNode[];
      });
    inflight.then((t) => {
      if (alive && t.length > 0) setTree(t);
    });
    return () => {
      alive = false;
    };
  }, []);

  return tree;
}
