/**
 * MCP tool: `create_product` — the assistant's deliberate catalogue write.
 *
 * Lets the owner dictate a complete new catalogue item to Vierzehn ("leg an:
 * goldene Taschenuhr, Kategorie Uhren, 480 Euro, 62 Gramm, 5 mal 5 Zentimeter,
 * veröffentlichen"). Since 2026-07-20 (owner directive) it can create the item
 * ACTIVE (status AVAILABLE) and even published to the web shop in one call —
 * the safety gate is the SPOKEN CONFIRMATION: the persona reads every detail
 * back and only calls this tool after an explicit "ja".
 *
 * GUARDRAILS (step-up is unreachable from the MCP context, so these stand in):
 *   • Voice confirmation — the persona (realtime-session.ts) instructs
 *     Vierzehn to read ALL details back and get a spoken "ja" BEFORE calling.
 *   • `activate` is opt-in — without it the item stays a reviewable DRAFT.
 *     `publishToWeb` additionally requires `activate`.
 *   • Name idempotency — a repeated dictation (model retry, owner repeats
 *     themselves) returns the existing open item instead of a duplicate.
 *   • Provisional locked fields — Einkaufspreis + Steuersatz are intake-locked
 *     (§25a integrity) and default to placeholder values; the response tells
 *     the owner to verify them; precise buy-ins still belong in the Ankauf.
 */

import { randomUUID } from 'node:crypto';
import { type Static, Type } from '@sinclair/typebox';
import { and, ilike, inArray, isNull, or, sql } from 'drizzle-orm';

import { auditLog, categories, productCategories, products } from '@warehouse14/db/schema';

import { ItemType, Metal, ProductCondition } from '../../schemas/product.js';
import type { ToolHandler, ToolInvocationContext, ToolResult } from '../types.js';
import { assignInboxPhotos } from './_product-lookup.js';

/** Decimal-EUR string, e.g. "480" or "480.00" — matches the products surface (NOT cents). */
const MoneyString = Type.String({
  pattern: '^[0-9]+(\\.[0-9]{1,2})?$',
  description: 'Betrag in Euro als Dezimalzahl, zum Beispiel „480" oder „480.00" (keine Cent-Zahl).',
});

/** Decimal measure string (grams / centimetres), e.g. "62" or "5.5". */
const DecimalString = Type.String({ pattern: '^[0-9]+(\\.[0-9]{1,2})?$' });

export const CreateProductArgs = Type.Object({
  name: Type.String({
    minLength: 1,
    maxLength: 200,
    description: 'Bezeichnung des Artikels, zum Beispiel „Goldene Taschenuhr Doxa".',
  }),
  itemType: Type.Unsafe<Static<typeof ItemType>>({
    ...ItemType,
    description:
      'Art des Artikels. Passende Kategorie wählen: gold_coin (Goldmünze), gold_bar (Goldbarren), ' +
      'gold_jewelry (Goldschmuck), silver_coin/silver_bar/silver_jewelry, platinum_*, antique ' +
      '(Antiquität), watch (Uhr) oder other.',
  }),
  listPriceEur: {
    ...MoneyString,
    description: 'Angebots- bzw. Verkaufspreis in Euro (Dezimalzahl).',
  },
  metal: Type.Optional(
    Type.Unsafe<Static<typeof Metal>>({
      ...Metal,
      description: 'Edelmetall, falls zutreffend: gold, silver, platinum oder palladium.',
    }),
  ),
  weightGrams: Type.Optional({
    ...DecimalString,
    description: 'Gewicht in Gramm als Dezimalzahl, falls bekannt.',
  }),
  lengthCm: Type.Optional({
    ...DecimalString,
    description: 'Länge in Zentimetern als Dezimalzahl, falls bekannt.',
  }),
  widthCm: Type.Optional({
    ...DecimalString,
    description: 'Breite in Zentimetern als Dezimalzahl, falls bekannt.',
  }),
  heightCm: Type.Optional({
    ...DecimalString,
    description: 'Höhe in Zentimetern als Dezimalzahl, falls bekannt.',
  }),
  categoryName: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 120,
      description:
        'Katalog-Kategorie mit ihrem Namen, zum Beispiel „Uhren" oder „Münzen". Wird gegen den ' +
        'bestehenden Katalog aufgelöst; eine unbekannte Kategorie wird gemeldet, bricht aber nichts ab.',
    }),
  ),
  acquisitionCostEur: Type.Optional({
    ...MoneyString,
    description:
      'Einkaufspreis in Euro, falls bekannt. Dieser Wert ist danach fest (Intake-gesperrt); ohne ' +
      'Angabe wird 0 gesetzt und muss vom Inhaber geprüft werden.',
  }),
  condition: Type.Optional(
    Type.Unsafe<Static<typeof ProductCondition>>({
      ...ProductCondition,
      description:
        'Zustand: NEW, USED_EXCELLENT, USED_GOOD, USED_FAIR, ANTIQUE_RESTORED oder ANTIQUE_AS_FOUND. ' +
        'Standard ist USED_GOOD.',
    }),
  ),
  descriptionDe: Type.Optional(
    Type.String({ maxLength: 2000, description: 'Beschreibung des Artikels, optional.' }),
  ),
  attachInboxPhotos: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 12,
      description:
        'Die N neuesten Fotos aus dem Fotoeingang (vom Telefon gesendet) direkt an den neuen ' +
        'Artikel anhängen. Das erste wird das Hauptfoto.',
    }),
  ),
  activate: Type.Optional(
    Type.Boolean({
      description:
        'true = Artikel sofort AKTIV anlegen (Status AVAILABLE, sofort verkäuflich) statt als ' +
        'Entwurf. NUR nach ausdrücklicher gesprochener Bestätigung des Inhabers setzen.',
    }),
  ),
  publishToWeb: Type.Optional(
    Type.Boolean({
      description:
        'true = zusätzlich sofort im Online-Shop sichtbar machen. Erfordert activate=true. NUR ' +
        'setzen, wenn der Inhaber das ausdrücklich möchte.',
    }),
  ),
});

type ArgsShape = Static<typeof CreateProductArgs>;

/** A short, human-readable, unique SKU for an assistant-created item. */
function generateDraftSku(): string {
  return `JV-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

const handler: ToolHandler<ArgsShape> = async (
  ctx: ToolInvocationContext,
  args: ArgsShape,
): Promise<ToolResult> => {
  const name = args.name.trim();
  const activate = args.activate === true;
  const publishToWeb = activate && args.publishToWeb === true;

  // Idempotency: an open (non-archived, not yet sold) product with the same
  // name already covers this dictation — return it instead of minting a
  // duplicate. Keeps repeated voice commands / model retries from littering
  // the catalogue with twins.
  const existing = await ctx.db
    .select({ id: products.id, sku: products.sku, status: products.status })
    .from(products)
    .where(
      and(
        sql`lower(${products.name}) = lower(${name})`,
        inArray(products.status, ['DRAFT', 'AVAILABLE']),
        isNull(products.archivedAt),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const row = existing[0];
    ctx.logger.info({ productId: row.id, name }, 'mcp.create_product: idempotent hit (existing item)');
    return {
      content: [
        {
          type: 'text',
          text: `„${name}" besteht bereits (${row.sku}, Status ${row.status === 'DRAFT' ? 'Entwurf' : 'aktiv'}). Ich habe keinen zweiten Artikel angelegt.`,
        },
      ],
      data: { productId: row.id, sku: row.sku, name, status: row.status, created: false },
      affectedEntity: { table: 'products', id: row.id },
    };
  }

  // Resolve the dictated category against the real catalogue (nameDe or slug,
  // case-insensitive). Unresolved is NOT fatal — the item lands without a
  // category and the reply names the miss so the owner can fix it by voice.
  let categoryId: string | null = null;
  let categoryLabel: string | null = null;
  if (args.categoryName) {
    const wanted = args.categoryName.trim();
    const cat = await ctx.db
      .select({ id: categories.id, nameDe: categories.nameDe })
      .from(categories)
      .where(or(ilike(categories.nameDe, wanted), ilike(categories.slug, wanted)))
      .limit(1);
    if (cat[0]) {
      categoryId = cat[0].id;
      categoryLabel = cat[0].nameDe;
    }
  }

  const sku = generateDraftSku();
  const listPriceEur = args.listPriceEur;
  const acquisitionCostEur = args.acquisitionCostEur ?? '0.00';
  const condition = args.condition ?? 'USED_GOOD';
  const status = activate ? ('AVAILABLE' as const) : ('DRAFT' as const);

  const inserted = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(products)
      .values({
        sku,
        // SKU IS the barcode (design): the item is scannable/labelable from birth.
        barcode: sku,
        itemType: args.itemType,
        metal: args.metal ?? null,
        weightGrams: args.weightGrams ?? null,
        lengthCm: args.lengthCm ?? null,
        widthCm: args.widthCm ?? null,
        heightCm: args.heightCm ?? null,
        // Provisional + intake-locked: the owner verifies these.
        acquisitionCostEur,
        listPriceEur,
        taxTreatmentCode: 'MARGIN_25A',
        condition,
        isCommission: false,
        name,
        descriptionDe: args.descriptionDe ?? null,
        status,
        // DB check `products_non_draft_is_published`: a non-DRAFT row must
        // carry publishedAt — same stamp the PUT DRAFT→AVAILABLE flip writes.
        publishedAt: activate ? new Date() : null,
        isPublishedToWeb: publishToWeb,
      })
      .returning({ id: products.id, sku: products.sku });
    if (!row) throw new Error('create_product INSERT returned no row');

    if (categoryId) {
      await tx.insert(productCategories).values({
        productId: row.id,
        categoryId,
        isPrimary: true,
      });
    }

    await tx.insert(auditLog).values({
      eventType: 'product.created',
      actorUserId: ctx.actor.id,
      deviceId: null,
      ipAddress: null,
      userAgent: null,
      payload: {
        productId: row.id,
        sku: row.sku,
        name,
        itemType: args.itemType,
        listPriceEur,
        acquisitionCostEur,
        condition,
        weightGrams: args.weightGrams ?? null,
        lengthCm: args.lengthCm ?? null,
        widthCm: args.widthCm ?? null,
        heightCm: args.heightCm ?? null,
        categoryId,
        status,
        publishedToWeb: publishToWeb,
        // Provenance: this item came from the voice assistant, not the intake UI.
        source: 'assistant',
        via: 'jarvis',
      },
    });

    return row;
  });

  // Photo bridge: bind the newest inbox photos in a follow-up TX (the item
  // exists either way; a failed bind must not undo the dictated product).
  let photosBound = 0;
  if (args.attachInboxPhotos && args.attachInboxPhotos > 0) {
    try {
      const bound = await ctx.db.transaction(async (tx) => {
        const r = await assignInboxPhotos(tx, inserted.id, { latest: args.attachInboxPhotos });
        if (r.assigned > 0) {
          await tx.insert(auditLog).values({
            eventType: 'photo.assigned',
            actorUserId: ctx.actor.id,
            deviceId: null,
            ipAddress: null,
            userAgent: null,
            payload: {
              productId: inserted.id,
              sku: inserted.sku,
              photoIds: r.photoIds,
              primarySet: r.primarySet,
              source: 'assistant',
              via: 'jarvis',
            },
          });
        }
        return r.assigned;
      });
      photosBound = bound;
    } catch (err) {
      ctx.logger.warn({ err, productId: inserted.id }, 'mcp.create_product: photo bind failed (item kept)');
    }
  }

  ctx.logger.info(
    { productId: inserted.id, sku: inserted.sku, name, status, publishToWeb },
    'mcp.create_product: item created by assistant',
  );

  const photoNote =
    photosBound > 0 ? ` ${photosBound} Foto${photosBound === 1 ? '' : 's'} aus dem Eingang angehängt.` : '';
  const categoryNote = args.categoryName
    ? categoryLabel
      ? ` Kategorie: ${categoryLabel}.`
      : ` Hinweis: Die Kategorie „${args.categoryName}" gibt es nicht im Katalog — bitte kurz die richtige nennen.`
    : '';
  const statusNote = activate
    ? publishToWeb
      ? ' Der Artikel ist AKTIV, sofort verkäuflich und im Online-Shop sichtbar.'
      : ' Der Artikel ist AKTIV und sofort verkäuflich.'
    : ' Er liegt als Entwurf im Lager und muss dort veröffentlicht werden.';

  return {
    content: [
      {
        type: 'text',
        text:
          `Angelegt: „${name}" zu ${listPriceEur} € (${inserted.sku}).` +
          photoNote +
          categoryNote +
          statusNote +
          ` Einkaufspreis und Steuersatz sind vorläufig — bitte bei Gelegenheit prüfen.`,
      },
    ],
    data: {
      productId: inserted.id,
      sku: inserted.sku,
      name,
      listPriceEur,
      status,
      publishedToWeb: publishToWeb,
      created: true,
      photosAttached: photosBound,
      category: categoryLabel,
    },
    affectedEntity: { table: 'products', id: inserted.id },
  };
};

export const createProductTool = {
  manifest: {
    name: 'create_product',
    description:
      'Creates a new catalogue product from the owner\'s dictation with the FULL field set: name, ' +
      'type, price, metal, weight, dimensions (length/width/height in cm), catalogue category by ' +
      'name, condition, description, and photos from the inbox. With activate=true the item is ' +
      'created ACTIVE (immediately sellable); with publishToWeb=true it is additionally visible in ' +
      'the web shop. Repeated calls with the same name return the existing item (idempotent). Use ' +
      'ONLY after reading ALL details back to the owner and receiving an explicit spoken ' +
      'confirmation — especially before activate/publishToWeb. Buy-in cost and tax treatment are ' +
      'provisional and intake-locked — tell the owner to verify them.',
    inputSchema: CreateProductArgs,
    requiredRoles: ['ADMIN'] as const,
    isMutation: true,
    // A deliberate assistant write, gated by spoken confirmation + name
    // idempotency; activate/publishToWeb are explicit opt-ins per dictation.
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
