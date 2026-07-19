/**
 * MCP tool: `attach_photos` — write side of the photo bridge.
 *
 * "Häng die letzten drei Fotos an die Taschenuhr" — binds inbox photos (sent
 * from the phone, not yet on any product) to a product the owner names.
 * Voice-friendly picking: `latest: N` takes the N newest inbox photos; exact
 * `photoIds` remain available for tool-chaining after list_inbox_photos.
 *
 * Guards: photos must be unassigned+local (the inbox definition), the product
 * must exist and not be archived/sold. First bound photo becomes primary when
 * the product has none — a dictated draft becomes shop-window-ready.
 */

import { type Static, Type } from '@sinclair/typebox';

import { auditLog } from '@warehouse14/db/schema';

import type { ToolHandler, ToolInvocationContext, ToolResult } from '../types.js';
import { assignInboxPhotos, resolveProduct } from './_product-lookup.js';

export const AttachPhotosArgs = Type.Object({
  productRef: Type.String({
    minLength: 1,
    maxLength: 200,
    description: 'Der Artikel: SKU oder exakter Name.',
  }),
  latest: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 12,
      description: 'Die N neuesten Fotos aus dem Eingang anhängen (einfachster Weg).',
    }),
  ),
  photoIds: Type.Optional(
    Type.Array(Type.String({ format: 'uuid' }), {
      minItems: 1,
      maxItems: 12,
      description: 'Exakte Foto-IDs aus list_inbox_photos (Alternative zu latest).',
    }),
  ),
});

type ArgsShape = Static<typeof AttachPhotosArgs>;

const handler: ToolHandler<ArgsShape> = async (
  ctx: ToolInvocationContext,
  args: ArgsShape,
): Promise<ToolResult> => {
  if (!args.latest && (!args.photoIds || args.photoIds.length === 0)) {
    return {
      content: [{ type: 'text', text: 'Bitte sagen, wie viele der neuesten Fotos angehängt werden sollen.' }],
      data: { attached: 0, reason: 'no_pick' },
    };
  }

  const { product, ambiguous } = await resolveProduct(ctx.db, args.productRef);
  if (ambiguous) {
    return {
      content: [
        { type: 'text', text: `Es gibt mehrere Artikel namens „${args.productRef.trim()}". Bitte die SKU nennen.` },
      ],
      data: { attached: 0, reason: 'ambiguous' },
    };
  }
  if (!product) {
    return {
      content: [{ type: 'text', text: `Ich finde keinen Artikel zu „${args.productRef.trim()}".` }],
      data: { attached: 0, reason: 'not_found' },
    };
  }
  if (product.archivedAt != null || product.status === 'SOLD') {
    return {
      content: [
        {
          type: 'text',
          text: `„${product.name}" (${product.sku}) ist ${product.archivedAt ? 'archiviert' : 'verkauft'} — daran hänge ich nichts mehr an.`,
        },
      ],
      data: { attached: 0, reason: 'immutable_status', status: product.status },
    };
  }

  const result = await ctx.db.transaction(async (tx: any) => {
    const r = await assignInboxPhotos(tx, product.id, {
      photoIds: args.photoIds,
      latest: args.latest,
    });
    if (r.assigned > 0) {
      await tx.insert(auditLog).values({
        eventType: 'photo.assigned',
        actorUserId: ctx.actor.id,
        deviceId: null,
        ipAddress: null,
        userAgent: null,
        payload: {
          productId: product.id,
          sku: product.sku,
          photoIds: r.photoIds,
          primarySet: r.primarySet,
          source: 'assistant',
          via: 'jarvis',
        },
      });
    }
    return r;
  });

  if (result.assigned === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'Im Fotoeingang liegt nichts Passendes — entweder ist er leer oder die Fotos sind schon vergeben.',
        },
      ],
      data: { attached: 0, reason: 'inbox_empty' },
    };
  }

  ctx.logger.info(
    { productId: product.id, attached: result.assigned, primarySet: result.primarySet },
    'mcp.attach_photos: inbox photos bound',
  );

  return {
    content: [
      {
        type: 'text',
        text:
          `${result.assigned} Foto${result.assigned === 1 ? '' : 's'} an „${product.name}" (${product.sku}) angehängt.` +
          (result.primarySet ? ' Das erste ist jetzt das Hauptfoto.' : ''),
      },
    ],
    data: {
      attached: result.assigned,
      productId: product.id,
      sku: product.sku,
      name: product.name,
      photoIds: result.photoIds,
      primarySet: result.primarySet,
    },
    affectedEntity: { table: 'products', id: product.id },
  };
};

export const attachPhotosTool = {
  manifest: {
    name: 'attach_photos',
    description:
      'Attaches photos from the photo inbox (sent from the owner\'s phone) to a product named by ' +
      'SKU or exact name. Prefer `latest: N` ("die letzten drei Fotos"). First photo becomes the ' +
      'primary image when the product has none. Archived and sold items are refused. Confirm the ' +
      'product and the count with the owner before calling.',
    inputSchema: AttachPhotosArgs,
    requiredRoles: ['ADMIN'] as const,
    isMutation: true,
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
