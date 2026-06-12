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
 * Root slugs that are NOT a shop world and must never appear in the storefront
 * navigation. `ankauf` is a SERVICE (we BUY from customers) — it carries its own
 * "Goldankauf" link in the header/side-menu service group, so it has no place in
 * the Sortiment. The live `GET /api/storefront/categories` already excludes
 * `hidden_from_storefront = TRUE` rows server-side; this is the matching
 * client-side guard so it also stays out of the placeholder/fallback tree.
 */
const HIDDEN_ROOT_SLUGS = new Set(["ankauf"]);

/**
 * A category node that may carry the backend's `hiddenFromStorefront` flag.
 * The public projection drops hidden rows already, but we honour the flag too
 * (and the slug denylist) so a stray hidden category can never surface in nav.
 */
type MaybeHidden = CategoryNode & { hiddenFromStorefront?: boolean | null };

function isVisible(node: CategoryNode): boolean {
  if (HIDDEN_ROOT_SLUGS.has(node.slug)) return false;
  if ((node as MaybeHidden).hiddenFromStorefront === true) return false;
  return true;
}

/** Drop hidden nodes at every level, preserving the visible tree shape. */
function pruneHidden(nodes: CategoryNode[]): CategoryNode[] {
  return nodes
    .filter(isVisible)
    .map((n) => (n.children.length > 0 ? { ...n, children: pruneHidden(n.children) } : n));
}

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
        const visible = pruneHidden(t);
        cache = visible;
        return visible;
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
