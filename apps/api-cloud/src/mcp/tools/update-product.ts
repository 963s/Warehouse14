/**
 * MCP tool: `update_product` — the assistant's deliberate product EDIT.
 *
 * "Ändere den Preis der Taschenuhr auf 450" — resolves the spoken reference
 * (SKU or exact name), patches ONLY the safe presentation fields, and echoes a
 * before→after diff so Vierzehn reads the change back.
 *
 * GUARDRAILS (step-up is unreachable from the MCP context, so these stand in):
 *   • Safe fields only: name, price, description, condition, weight. The
 *     intake-locked set (SKU, buy-in cost, tax treatment, classification) and
 *     ALL status/channel switches are structurally absent from the schema.
 *   • DRAFT + AVAILABLE only — a RESERVED/SOLD/archived item is money-adjacent
 *     and refused with an honest German line.
 *   • Voice confirmation — the persona instructs Vierzehn to read the intended
 *     change back and get a spoken "ja" BEFORE calling this.
 *   • Full audit diff, tagged source:assistant.
 */

import { type Static, Type } from '@sinclair/typebox';
import { eq } from 'drizzle-orm';

import { auditLog, products } from '@warehouse14/db/schema';

import { ProductCondition } from '../../schemas/product.js';
import type { ToolHandler, ToolInvocationContext, ToolResult } from '../types.js';
import { resolveProduct } from './_product-lookup.js';

const MoneyString = Type.String({
  pattern: '^[0-9]+(\\.[0-9]{1,2})?$',
  description: 'Betrag in Euro als Dezimalzahl, zum Beispiel „450" oder „450.00".',
});

export const UpdateProductArgs = Type.Object({
  productRef: Type.String({
    minLength: 1,
    maxLength: 200,
    description:
      'Der Artikel: SKU (zum Beispiel „JV-3F2A81C04B") oder der exakte Name. Bei zwei Artikeln ' +
      'mit demselben Namen wird um die SKU gebeten.',
  }),
  name: Type.Optional(
    Type.String({ minLength: 1, maxLength: 200, description: 'Neuer Name, falls umbenennen.' }),
  ),
  listPriceEur: Type.Optional({ ...MoneyString, description: 'Neuer Verkaufspreis in Euro.' }),
  descriptionDe: Type.Optional(
    Type.String({ maxLength: 2000, description: 'Neue Kurzbeschreibung.' }),
  ),
  condition: Type.Optional(
    Type.Unsafe<Static<typeof ProductCondition>>({
      ...ProductCondition,
      description: 'Neuer Zustand: NEW, USED_EXCELLENT, USED_GOOD, USED_FAIR, ANTIQUE_RESTORED, ANTIQUE_AS_FOUND.',
    }),
  ),
  weightGrams: Type.Optional({
    ...MoneyString,
    description: 'Neues Gewicht in Gramm als Dezimalzahl.',
  }),
});

type ArgsShape = Static<typeof UpdateProductArgs>;

const handler: ToolHandler<ArgsShape> = async (
  ctx: ToolInvocationContext,
  args: ArgsShape,
): Promise<ToolResult> => {
  const { product, ambiguous } = await resolveProduct(ctx.db, args.productRef);
  if (ambiguous) {
    return {
      content: [
        {
          type: 'text',
          text: `Es gibt mehrere Artikel namens „${args.productRef.trim()}". Bitte die SKU nennen.`,
        },
      ],
      data: { updated: false, reason: 'ambiguous' },
    };
  }
  if (!product) {
    return {
      content: [
        { type: 'text', text: `Ich finde keinen Artikel zu „${args.productRef.trim()}".` },
      ],
      data: { updated: false, reason: 'not_found' },
    };
  }
  if (product.archivedAt != null || product.status === 'RESERVED' || product.status === 'SOLD') {
    return {
      content: [
        {
          type: 'text',
          text:
            `„${product.name}" (${product.sku}) ist ${product.archivedAt ? 'archiviert' : product.status === 'SOLD' ? 'verkauft' : 'reserviert'} ` +
            `und wird von mir nicht verändert. Solche Artikel bitte direkt im Lager bearbeiten.`,
        },
      ],
      data: { updated: false, reason: 'immutable_status', status: product.status },
    };
  }

  // Build the diff — only fields that actually change.
  const patch: Record<string, unknown> = {};
  const diff: Record<string, { alt: unknown; neu: unknown }> = {};
  const consider = (
    key: 'name' | 'listPriceEur' | 'descriptionDe' | 'condition' | 'weightGrams',
    next: unknown,
    current: unknown,
  ) => {
    if (next === undefined) return;
    if (String(next) === String(current ?? '')) return;
    patch[key] = next;
    diff[key] = { alt: current ?? null, neu: next };
  };
  consider('name', args.name?.trim(), product.name);
  consider('listPriceEur', args.listPriceEur, product.listPriceEur);
  consider('descriptionDe', args.descriptionDe, product.descriptionDe);
  consider('condition', args.condition, product.condition);
  consider('weightGrams', args.weightGrams, product.weightGrams);

  if (Object.keys(patch).length === 0) {
    return {
      content: [
        { type: 'text', text: `„${product.name}" (${product.sku}) steht bereits genau so — nichts geändert.` },
      ],
      data: { updated: false, reason: 'no_change', productId: product.id, sku: product.sku },
    };
  }

  await ctx.db.transaction(async (tx: any) => {
    await tx.update(products).set(patch).where(eq(products.id, product.id));
    await tx.insert(auditLog).values({
      eventType: 'product.updated',
      actorUserId: ctx.actor.id,
      deviceId: null,
      ipAddress: null,
      userAgent: null,
      payload: {
        productId: product.id,
        sku: product.sku,
        changedFields: Object.keys(patch),
        diff,
        source: 'assistant',
        via: 'jarvis',
      },
    });
  });

  const spoken = Object.entries(diff)
    .map(([k, v]) => {
      const label =
        k === 'listPriceEur' ? 'Preis' : k === 'descriptionDe' ? 'Beschreibung' : k === 'weightGrams' ? 'Gewicht' : k === 'condition' ? 'Zustand' : 'Name';
      return `${label}: ${String(v.alt ?? 'leer')} → ${String(v.neu)}`;
    })
    .join('; ');

  ctx.logger.info({ productId: product.id, changed: Object.keys(patch) }, 'mcp.update_product: patched');

  return {
    content: [
      { type: 'text', text: `Geändert an „${args.name?.trim() ?? product.name}" (${product.sku}): ${spoken}.` },
    ],
    data: {
      updated: true,
      productId: product.id,
      sku: product.sku,
      name: args.name?.trim() ?? product.name,
      changedFields: Object.keys(patch),
      diff,
      status: product.status,
    },
    affectedEntity: { table: 'products', id: product.id },
  };
};

export const updateProductTool = {
  manifest: {
    name: 'update_product',
    description:
      'Edits a product the owner names (by SKU or exact name): name, list price, description, ' +
      'condition, weight — nothing else. DRAFT and AVAILABLE items only; reserved, sold or ' +
      'archived items are refused. Intake-locked fields (buy-in cost, tax, SKU) and publish ' +
      'switches are NOT reachable here. Use ONLY after reading the intended change back to the ' +
      'owner and receiving a spoken confirmation. The result contains the before/after diff — ' +
      'read it back.',
    inputSchema: UpdateProductArgs,
    requiredRoles: ['ADMIN'] as const,
    isMutation: true,
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
