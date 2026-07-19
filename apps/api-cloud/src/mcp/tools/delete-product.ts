/**
 * MCP tool: `delete_product` — the assistant's narrowest write: discard a DRAFT.
 *
 * "Lösch den Entwurf Taschenuhr" — resolves the reference and deletes ONLY a
 * DRAFT. Everything else is refused: AVAILABLE items belong to the shop window
 * (deleting them is a Lager decision with step-up), RESERVED/SOLD are
 * money-adjacent, archived stays archived. Deliberately STRICTER than the HTTP
 * route (which also allows AVAILABLE) because the MCP context has no step-up.
 *
 * Photos attached to the draft are NOT destroyed — they return to the
 * Fotoeingang (productId = NULL) so the owner's shelf photos survive a
 * discarded dictation.
 */

import { type Static, Type } from '@sinclair/typebox';
import { eq } from 'drizzle-orm';

import { auditLog, productPhotos, products } from '@warehouse14/db/schema';

import type { ToolHandler, ToolInvocationContext, ToolResult } from '../types.js';
import { resolveProduct } from './_product-lookup.js';

export const DeleteProductArgs = Type.Object({
  productRef: Type.String({
    minLength: 1,
    maxLength: 200,
    description: 'Der Entwurf: SKU (zum Beispiel „JV-3F2A81C04B") oder der exakte Name.',
  }),
});

type ArgsShape = Static<typeof DeleteProductArgs>;

const handler: ToolHandler<ArgsShape> = async (
  ctx: ToolInvocationContext,
  args: ArgsShape,
): Promise<ToolResult> => {
  const { product, ambiguous } = await resolveProduct(ctx.db, args.productRef);
  if (ambiguous) {
    return {
      content: [
        { type: 'text', text: `Es gibt mehrere Artikel namens „${args.productRef.trim()}". Bitte die SKU nennen.` },
      ],
      data: { deleted: false, reason: 'ambiguous' },
    };
  }
  if (!product) {
    return {
      content: [{ type: 'text', text: `Ich finde keinen Artikel zu „${args.productRef.trim()}".` }],
      data: { deleted: false, reason: 'not_found' },
    };
  }
  if (product.status !== 'DRAFT' || product.archivedAt != null) {
    const why =
      product.archivedAt != null
        ? 'archiviert'
        : product.status === 'SOLD'
          ? 'verkauft'
          : product.status === 'RESERVED'
            ? 'reserviert'
            : 'veröffentlicht';
    return {
      content: [
        {
          type: 'text',
          text:
            `„${product.name}" (${product.sku}) ist ${why} — ich lösche nur Entwürfe. ` +
            `Bitte im Lager entscheiden, was damit geschehen soll.`,
        },
      ],
      data: { deleted: false, reason: 'not_a_draft', status: product.status },
    };
  }

  let freedPhotos = 0;
  await ctx.db.transaction(async (tx: any) => {
    // Shelf photos survive the discarded dictation — back to the Fotoeingang.
    const freed = await tx
      .update(productPhotos)
      .set({ productId: null, isPrimary: false, workflowState: 'FOTOGRAFIERT', displayOrder: 0 })
      .where(eq(productPhotos.productId, product.id))
      .returning({ id: productPhotos.id });
    freedPhotos = freed.length;

    await tx.delete(products).where(eq(products.id, product.id));

    await tx.insert(auditLog).values({
      eventType: 'product.deleted',
      actorUserId: ctx.actor.id,
      deviceId: null,
      ipAddress: null,
      userAgent: null,
      payload: {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        status: 'DRAFT',
        photosReturnedToInbox: freedPhotos,
        source: 'assistant',
        via: 'jarvis',
      },
    });
  });

  ctx.logger.info({ productId: product.id, sku: product.sku, freedPhotos }, 'mcp.delete_product: draft removed');

  return {
    content: [
      {
        type: 'text',
        text:
          `Entwurf „${product.name}" (${product.sku}) gelöscht.` +
          (freedPhotos > 0 ? ` ${freedPhotos} Foto${freedPhotos === 1 ? '' : 's'} liegen wieder im Fotoeingang.` : ''),
      },
    ],
    data: { deleted: true, productId: product.id, sku: product.sku, name: product.name, photosReturnedToInbox: freedPhotos },
    affectedEntity: { table: 'products', id: product.id },
  };
};

export const deleteProductTool = {
  manifest: {
    name: 'delete_product',
    description:
      'Deletes a DRAFT product the owner names (by SKU or exact name). ONLY drafts — published, ' +
      'reserved, sold or archived items are always refused (those decisions belong in the Lager ' +
      'with step-up). Photos attached to the draft return to the photo inbox, never destroyed. ' +
      'Use ONLY after naming the exact draft back to the owner and receiving a spoken confirmation.',
    inputSchema: DeleteProductArgs,
    requiredRoles: ['ADMIN'] as const,
    isMutation: true,
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
