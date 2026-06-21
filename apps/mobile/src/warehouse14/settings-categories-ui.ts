/**
 * Sammlungen-Editor - pure helpers for the category-taxonomy admin in
 * Einstellungen. No React, no I/O: the screen imports these so the UI is a thin
 * shell over the verified `categoriesApi` contract.
 *
 * The truth source is the backend: GET /api/categories returns `{ roots }` (a
 * tree, up to 3 levels per migration 0063), each node carrying its OWN
 * productCount (not inclusive of children). create/update/delete are ADMIN, no
 * step-up. A delete the FK refuses (a product or a child still references the
 * node) comes back as a themed 409 the surface shows verbatim - we never
 * reimplement that guard here.
 *
 * Honesty: every count shown is the server's `productCount`. A „gesamt"-figure
 * is summed from the real nodes the tree gave us, never from the api-client's
 * `totalCount` field (the route does not send it, so reading it would surface
 * `undefined` - exactly the fabricated number the honesty rule forbids).
 */
import type { CategoryNode } from "@warehouse14/api-client"

/** The DB hierarchy cap (migration 0063: roots → children → grandchildren). */
export const CATEGORY_MAX_DEPTH = 3

/** A flattened tree row carrying its depth, so the UI can indent honestly. */
export interface FlatCategory {
  node: CategoryNode
  /** 0 = root, 1 = child, 2 = grandchild. */
  depth: number
  /** True when this node has at least one child. */
  hasChildren: boolean
}

/**
 * Depth-first flatten of the root list, preserving the server's order
 * (display_order, name_de). Each row knows its depth and whether it has
 * children - enough for an indented, expandable list.
 */
export function flattenCategoryTree(roots: readonly CategoryNode[]): FlatCategory[] {
  const out: FlatCategory[] = []
  const walk = (nodes: readonly CategoryNode[], depth: number): void => {
    for (const node of nodes) {
      const children = node.children ?? []
      out.push({ node, depth, hasChildren: children.length > 0 })
      if (children.length > 0) walk(children, depth + 1)
    }
  }
  walk(roots, 0)
  return out
}

/** Total number of nodes across the whole tree (summed from real nodes). */
export function countCategories(roots: readonly CategoryNode[]): number {
  let n = 0
  const walk = (nodes: readonly CategoryNode[]): void => {
    for (const node of nodes) {
      n += 1
      if (node.children?.length) walk(node.children)
    }
  }
  walk(roots)
  return n
}

/** Sum of every node's OWN productCount across the tree (counts are per-node). */
export function countAssignedProducts(roots: readonly CategoryNode[]): number {
  let n = 0
  const walk = (nodes: readonly CategoryNode[]): void => {
    for (const node of nodes) {
      n += node.productCount
      if (node.children?.length) walk(node.children)
    }
  }
  walk(roots)
  return n
}

/**
 * A parent option for the „neue Sammlung"-Picker. Only nodes that can legally
 * take a child are offered: a node at depth < CATEGORY_MAX_DEPTH − 1 (a root or
 * a child, never a grandchild - adding under it would be a 4th level).
 */
export interface ParentOption {
  id: string
  label: string
  depth: number
}

/** Build the list of legal parents (plus an implicit „- (oberste Ebene)" = null). */
export function parentOptions(roots: readonly CategoryNode[]): ParentOption[] {
  const out: ParentOption[] = []
  for (const flat of flattenCategoryTree(roots)) {
    // A new child sits at depth+1; that must stay ≤ CATEGORY_MAX_DEPTH − 1
    // (0-indexed), i.e. the parent's depth must be ≤ MAX_DEPTH − 2.
    if (flat.depth <= CATEGORY_MAX_DEPTH - 2) {
      out.push({
        id: flat.node.id,
        label: `${"  ".repeat(flat.depth)}${flat.node.nameDe}`,
        depth: flat.depth,
      })
    }
  }
  return out
}

// ── Slug ──────────────────────────────────────────────────────────────────────

/** The server slug rule, mirrored for a friendly client-side pre-check. */
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Derive a URL-safe slug from a German display name: lowercase, transliterate
 * the umlauts/ß, strip everything that is not [a-z0-9], collapse to single
 * dashes. Matches the server pattern `^[a-z0-9]+(-[a-z0-9]+)*$`.
 */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .normalize("NFD")
      // Strip combining diacritical marks (U+0300-U+036F) left by NFD.
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64)
  )
}

/** True when a slug is non-empty, ≤ 64 chars, and matches the server pattern. */
export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && slug.length <= 64 && SLUG_RE.test(slug)
}

export interface CategoryNameValidation {
  ok: boolean
  /** Trimmed display name. */
  nameDe: string
  /** Derived (or supplied) slug. */
  slug: string
  /** German reason when not ok, else null. */
  error: string | null
}

/**
 * Validate a new/renamed category name (+ optional explicit slug). When no slug
 * is given we derive one; if the derived slug is empty (e.g. an emoji-only
 * name) we ask for a real name rather than sending junk.
 */
export function validateCategoryName(rawName: string, rawSlug?: string): CategoryNameValidation {
  const nameDe = rawName.trim()
  if (nameDe.length === 0) {
    return { ok: false, nameDe, slug: "", error: "Bitte einen Namen eingeben." }
  }
  if (nameDe.length > 128) {
    return { ok: false, nameDe, slug: "", error: "Höchstens 128 Zeichen." }
  }
  const slug = rawSlug && rawSlug.trim().length > 0 ? rawSlug.trim() : slugify(nameDe)
  if (!isValidSlug(slug)) {
    return {
      ok: false,
      nameDe,
      slug,
      error: "Kurzname (Slug) ungültig - nur Kleinbuchstaben, Ziffern und Bindestriche.",
    }
  }
  return { ok: true, nameDe, slug, error: null }
}

/**
 * Whether a node may be deleted from the phone WITHOUT hitting the server's FK
 * guard. A node with children or assigned products would 409; we surface that
 * up-front as a calm disabled state instead of letting the owner tap into an
 * error. (The server remains the authority - this is only a friendlier gate.)
 */
export function canDeleteCategory(node: CategoryNode): boolean {
  const childCount = node.children?.length ?? 0
  return childCount === 0 && node.productCount === 0
}

/** The honest reason a node can't be deleted yet, or null when it can. */
export function deleteBlockedReason(node: CategoryNode): string | null {
  const childCount = node.children?.length ?? 0
  if (childCount > 0) {
    return childCount === 1
      ? "Enthält 1 Unter-Sammlung - zuerst diese entfernen."
      : `Enthält ${childCount} Unter-Sammlungen - zuerst diese entfernen.`
  }
  if (node.productCount > 0) {
    return node.productCount === 1
      ? "1 Artikel zugeordnet - zuerst zuweisen."
      : `${node.productCount} Artikel zugeordnet - zuerst zuweisen.`
  }
  return null
}

/** „3 Artikel" / „kein Artikel" - a de-DE product-count label for a node. */
export function productCountLabel(count: number): string {
  if (count <= 0) return "kein Artikel"
  return count === 1 ? "1 Artikel" : `${count.toLocaleString("de-DE")} Artikel`
}
