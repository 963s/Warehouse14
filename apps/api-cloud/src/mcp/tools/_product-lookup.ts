/**
 * Shared lookups for the assistant's product write-tools.
 *
 * `resolveProduct` — voice dictation never carries a UUID, so every write tool
 * accepts a SKU ("JV-3F2A…", "W14-0042") or, as a fallback, an exact
 * (case-insensitive) product name. UUIDs still work for tool-chaining (the
 * model may pass an id it received from find_product/list_products).
 *
 * `assignInboxPhotos` — the one shared TX primitive of the photo bridge: takes
 * unassigned local photos (the "Fotoeingang" the phone fills) and binds them to
 * a product — newest-first when `latest` is used, or exactly the given ids.
 * Sets workflow ZUGEORDNET (its DB CHECK requires productId — satisfied in the
 * same UPDATE), appends displayOrder after the product's existing photos, and
 * promotes the first bound photo to primary when the product has none.
 */

import { and, asc, desc, eq, isNull, max, sql } from 'drizzle-orm';

import { productPhotos, products } from '@warehouse14/db/schema';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResolvedProduct {
  id: string;
  sku: string;
  name: string;
  status: 'DRAFT' | 'AVAILABLE' | 'RESERVED' | 'SOLD';
  archivedAt: Date | null;
  listPriceEur: string;
  condition: string;
  descriptionDe: string | null;
  weightGrams: string | null;
}

/** Resolve a spoken reference (sku, uuid, or exact name) to one product. */
export async function resolveProduct(
  db: { select: any },
  ref: string,
): Promise<{ product: ResolvedProduct | null; ambiguous: boolean }> {
  const needle = ref.trim();
  const base = {
    id: products.id,
    sku: products.sku,
    name: products.name,
    status: products.status,
    archivedAt: products.archivedAt,
    listPriceEur: products.listPriceEur,
    condition: products.condition,
    descriptionDe: products.descriptionDe,
    weightGrams: products.weightGrams,
  };

  if (UUID_RE.test(needle)) {
    const rows = await db.select(base).from(products).where(eq(products.id, needle)).limit(1);
    return { product: (rows[0] as ResolvedProduct) ?? null, ambiguous: false };
  }

  // SKU/barcode exact (case-insensitive) — the strongest spoken handle.
  const bySku = await db
    .select(base)
    .from(products)
    .where(sql`upper(${products.sku}) = upper(${needle}) OR upper(${products.barcode}) = upper(${needle})`)
    .limit(1);
  if (bySku[0]) return { product: bySku[0] as ResolvedProduct, ambiguous: false };

  // Exact name (case-insensitive), non-archived. Two hits = ambiguous — the
  // tool answers honestly and asks for the SKU instead of guessing.
  const byName = await db
    .select(base)
    .from(products)
    .where(and(sql`lower(${products.name}) = lower(${needle})`, isNull(products.archivedAt)))
    .orderBy(desc(products.createdAt))
    .limit(2);
  if (byName.length > 1) return { product: null, ambiguous: true };
  return { product: (byName[0] as ResolvedProduct) ?? null, ambiguous: false };
}

export interface AssignResult {
  assigned: number;
  primarySet: boolean;
  photoIds: string[];
}

/**
 * Bind unassigned local photos to a product inside the caller's transaction.
 * Pass EITHER `photoIds` (exact set, all must be unassigned+local) OR `latest`
 * (the N newest inbox photos). Returns what was actually bound.
 */
export async function assignInboxPhotos(
  tx: any,
  productId: string,
  pick: { photoIds?: string[] | undefined; latest?: number | undefined },
): Promise<AssignResult> {
  let ids: string[] = [];

  if (pick.photoIds && pick.photoIds.length > 0) {
    const rows = await tx
      .select({ id: productPhotos.id })
      .from(productPhotos)
      .where(
        and(
          isNull(productPhotos.productId),
          eq(productPhotos.storageKind, 'local'),
          sql`${productPhotos.id} = any(${pick.photoIds})`,
        ),
      );
    ids = rows.map((r: { id: string }) => r.id);
  } else if (pick.latest && pick.latest > 0) {
    const rows = await tx
      .select({ id: productPhotos.id })
      .from(productPhotos)
      .where(and(isNull(productPhotos.productId), eq(productPhotos.storageKind, 'local')))
      .orderBy(desc(productPhotos.createdAt))
      .limit(pick.latest);
    ids = rows.map((r: { id: string }) => r.id);
  }

  if (ids.length === 0) return { assigned: 0, primarySet: false, photoIds: [] };

  // Current tail of the product's photo strip + whether a primary exists.
  const [tail] = await tx
    .select({
      maxOrder: max(productPhotos.displayOrder),
      primaries: sql<number>`count(*) filter (where ${productPhotos.isPrimary})`,
    })
    .from(productPhotos)
    .where(eq(productPhotos.productId, productId));
  let nextOrder = Number(tail?.maxOrder ?? -1) + 1;
  const hasPrimary = Number(tail?.primaries ?? 0) > 0;

  let primarySet = false;
  // Oldest-first of the picked set so the strip reads in capture order.
  const ordered = await tx
    .select({ id: productPhotos.id })
    .from(productPhotos)
    .where(sql`${productPhotos.id} = any(${ids})`)
    .orderBy(asc(productPhotos.createdAt));

  for (const row of ordered as { id: string }[]) {
    const makePrimary = !hasPrimary && !primarySet;
    await tx
      .update(productPhotos)
      .set({
        productId,
        workflowState: 'ZUGEORDNET',
        displayOrder: nextOrder,
        isPrimary: makePrimary,
      })
      .where(eq(productPhotos.id, row.id));
    if (makePrimary) primarySet = true;
    nextOrder += 1;
  }

  return { assigned: ordered.length, primarySet, photoIds: ordered.map((r: { id: string }) => r.id) };
}
