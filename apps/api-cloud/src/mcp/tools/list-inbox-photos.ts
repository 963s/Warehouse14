/**
 * MCP tool: `list_inbox_photos` — the Fotoeingang, read side of the photo
 * bridge.
 *
 * The owner photographs shelf items with the phone (mobile "Fotoeingang"
 * surface uploads them WITHOUT a product), then asks Vierzehn at the register:
 * "Sind neue Fotos da?" — this tool answers with the unassigned local photos,
 * newest first, and the overlay paints them as a thumbnail tray so the owner
 * SEES what is about to be attached before dictating the product.
 */

import { type Static, Type } from '@sinclair/typebox';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { productPhotos } from '@warehouse14/db/schema';

import type { ToolHandler, ToolInvocationContext, ToolResult } from '../types.js';

export const ListInboxPhotosArgs = Type.Object({
  limit: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 24, description: 'Wie viele (neueste zuerst). Standard 12.' }),
  ),
});

type ArgsShape = Static<typeof ListInboxPhotosArgs>;

const handler: ToolHandler<ArgsShape> = async (
  ctx: ToolInvocationContext,
  args: ArgsShape,
): Promise<ToolResult> => {
  const limit = args.limit ?? 12;

  const rows = await ctx.db
    .select({
      id: productPhotos.id,
      createdAt: productPhotos.createdAt,
      sizeBytes: productPhotos.sizeBytes,
      width: productPhotos.width,
      height: productPhotos.height,
    })
    .from(productPhotos)
    .where(and(isNull(productPhotos.productId), eq(productPhotos.storageKind, 'local')))
    .orderBy(desc(productPhotos.createdAt))
    .limit(limit);

  const photos = rows.map((r) => ({
    id: r.id,
    // Relative on purpose — the desktop resolves against its own API base.
    thumbPath: `/api/photos/${r.id}/thumb`,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    width: r.width,
    height: r.height,
  }));

  const text =
    photos.length === 0
      ? 'Der Fotoeingang ist leer. Fotos kommen vom Telefon über „Fotoeingang" herein.'
      : `${photos.length} Foto${photos.length === 1 ? '' : 's'} im Eingang, das neueste von ${new Date(
          photos[0]!.createdAt,
        ).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr. ` +
        'Sage zum Beispiel: „Leg ein Produkt an und häng die letzten drei Fotos dran."';

  return {
    content: [{ type: 'text', text }],
    data: { count: photos.length, photos },
  };
};

export const listInboxPhotosTool = {
  manifest: {
    name: 'list_inbox_photos',
    description:
      'Lists the photo inbox (Fotoeingang): shelf photos the owner sent from the phone that are ' +
      'not yet attached to any product, newest first. Call it when the owner asks about new ' +
      'photos or before attaching photos, so the tray is visible on screen. Read-only.',
    inputSchema: ListInboxPhotosArgs,
    requiredRoles: ['ADMIN'] as const,
    isMutation: false,
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
