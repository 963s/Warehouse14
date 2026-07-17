/**
 * MCP tool: `create_product` — the assistant's second deliberate write.
 *
 * Lets the owner dictate a new catalogue item to Vierzehn ("leg ein Produkt an:
 * goldene Taschenuhr, 480 Euro"). It creates a **DRAFT** product and nothing
 * more. A DRAFT is never part of the fiscal record: it cannot be sold until the
 * owner reviews it in the Lager, sets the real price/tax, and publishes it
 * (DRAFT → AVAILABLE). So this write is safe by construction — like
 * `open_dev_ticket`, it touches no fiscal, ledger, or system state.
 *
 * GUARDRAILS (step-up is unreachable from the MCP context, so these stand in):
 *   • DRAFT status only — the item is a stub for the owner to finish, not a
 *     sellable, fiscally-committed product.
 *   • Name idempotency — a repeated dictation (model retry, owner repeats
 *     themselves) returns the existing open draft instead of a duplicate.
 *   • Voice confirmation — the persona (realtime-session.ts) instructs Vierzehn
 *     to read the details back and get a spoken "ja" BEFORE calling this.
 *   • Provisional locked fields — Einkaufspreis + Steuersatz are intake-locked
 *     (§25a integrity) and default to placeholder values; the response tells the
 *     owner to verify them, and precise buy-ins still belong in the Ankauf flow.
 */

import { randomUUID } from 'node:crypto';
import { type Static, Type } from '@sinclair/typebox';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { auditLog, products } from '@warehouse14/db/schema';

import { ItemType, Metal, ProductCondition } from '../../schemas/product.js';
import type { ToolHandler, ToolInvocationContext, ToolResult } from '../types.js';

/** Decimal-EUR string, e.g. "480" or "480.00" — matches the products surface (NOT cents). */
const MoneyString = Type.String({
  pattern: '^[0-9]+(\\.[0-9]{1,2})?$',
  description: 'Betrag in Euro als Dezimalzahl, zum Beispiel „480" oder „480.00" (keine Cent-Zahl).',
});

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
    ...MoneyString,
    description: 'Gewicht in Gramm als Dezimalzahl, falls bekannt.',
  }),
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
    Type.String({ maxLength: 2000, description: 'Kurze Beschreibung des Artikels, optional.' }),
  ),
});

type ArgsShape = Static<typeof CreateProductArgs>;

/** A short, human-readable, unique SKU for an assistant-created draft. */
function generateDraftSku(): string {
  return `JV-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

const handler: ToolHandler<ArgsShape> = async (
  ctx: ToolInvocationContext,
  args: ArgsShape,
): Promise<ToolResult> => {
  const name = args.name.trim();

  // Idempotency: an open (non-archived) DRAFT with the same name already covers
  // this dictation — return it instead of minting a duplicate. Keeps repeated
  // voice commands / model retries from littering the catalogue.
  const existing = await ctx.db
    .select({ id: products.id, sku: products.sku })
    .from(products)
    .where(
      and(
        sql`lower(${products.name}) = lower(${name})`,
        eq(products.status, 'DRAFT'),
        isNull(products.archivedAt),
      ),
    )
    .limit(1);

  if (existing[0]) {
    const row = existing[0];
    ctx.logger.info({ productId: row.id, name }, 'mcp.create_product: idempotent hit (existing draft)');
    return {
      content: [
        {
          type: 'text',
          text: `Ein Entwurf „${name}" besteht bereits (${row.sku}). Ich habe keinen zweiten angelegt.`,
        },
      ],
      data: { productId: row.id, sku: row.sku, name, status: 'DRAFT', created: false },
      affectedEntity: { table: 'products', id: row.id },
    };
  }

  const sku = generateDraftSku();
  const listPriceEur = args.listPriceEur;
  const acquisitionCostEur = args.acquisitionCostEur ?? '0.00';
  const condition = args.condition ?? 'USED_GOOD';

  const inserted = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(products)
      .values({
        sku,
        // SKU IS the barcode (design): a draft is scannable/labelable from birth.
        barcode: sku,
        itemType: args.itemType,
        metal: args.metal ?? null,
        weightGrams: args.weightGrams ?? null,
        // Provisional + intake-locked: the owner verifies these before publish.
        acquisitionCostEur,
        listPriceEur,
        taxTreatmentCode: 'MARGIN_25A',
        condition,
        isCommission: false,
        name,
        descriptionDe: args.descriptionDe ?? null,
        status: 'DRAFT',
      })
      .returning({ id: products.id, sku: products.sku });
    if (!row) throw new Error('create_product INSERT returned no row');

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
        status: 'DRAFT',
        // Provenance: this draft came from the voice assistant, not the intake UI.
        source: 'assistant',
        via: 'jarvis',
      },
    });

    return row;
  });

  ctx.logger.info(
    { productId: inserted.id, sku: inserted.sku, name },
    'mcp.create_product: draft created by assistant',
  );

  return {
    content: [
      {
        type: 'text',
        text:
          `Entwurf angelegt: „${name}" zu ${listPriceEur} € (${inserted.sku}). Er liegt jetzt als ` +
          `Entwurf im Lager. Bitte dort Einkaufspreis und Steuersatz prüfen und den Artikel ` +
          `veröffentlichen, bevor er verkauft wird.`,
      },
    ],
    data: {
      productId: inserted.id,
      sku: inserted.sku,
      name,
      listPriceEur,
      status: 'DRAFT',
      created: true,
    },
    affectedEntity: { table: 'products', id: inserted.id },
  };
};

export const createProductTool = {
  manifest: {
    name: 'create_product',
    description:
      'Creates a new catalogue product as a DRAFT from the owner\'s dictation (name, type, price, ' +
      'optional metal/weight/condition/description). The item is only a draft: it is NOT sellable ' +
      'and touches no fiscal state until the owner reviews it in the inventory and publishes it. ' +
      'Repeated calls with the same name return the existing draft (idempotent). Use ONLY after ' +
      'reading the details back to the owner and receiving a spoken confirmation. Buy-in cost and ' +
      'tax treatment are provisional and intake-locked — tell the owner to verify them.',
    inputSchema: CreateProductArgs,
    requiredRoles: ['ADMIN'] as const,
    isMutation: true,
    // The second deliberate assistant write: a DRAFT catalogue stub, never a
    // fiscal commitment. Guarded by DRAFT-only + name idempotency + voice confirm.
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
