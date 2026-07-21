/**
 * MCP tool: `analyze_inbox_photos` — Vierzehn's eyes on the photo inbox.
 *
 * The owner photographs an item with the phone (Fotoeingang), then asks
 * Vierzehn "schau dir die Fotos an". This tool loads the newest unassigned
 * inbox photos from local disk and asks the OpenAI vision model to identify
 * the item FOR A DEALER: a sellable name, the item type, metal, condition,
 * a catalogue-category guess, and a short sales-ready German description.
 *
 * The result is a SUGGESTION, never a write: the persona reads it back, the
 * owner corrects/confirms by voice, and only then does `create_product` run
 * (with `attachInboxPhotos` binding these same photos). Read-only by design —
 * `isMutation: false`, touches no rows.
 *
 * Cost/latency guardrails: thumbs only (small WebP renditions), at most 6 per
 * call, one vision request, 25s timeout, model pinned via OPENAI_VISION_MODEL.
 */

import { readFile } from 'node:fs/promises';
import { type Static, Type } from '@sinclair/typebox';
import { desc, isNull, sql } from 'drizzle-orm';

import { productPhotos } from '@warehouse14/db/schema';

import { loadEnv } from '../../config/env.js';
import { thumbPathFor } from '../../lib/photo-store.js';
import type { ToolHandler, ToolInvocationContext, ToolResult } from '../types.js';

export const AnalyzeInboxPhotosArgs = Type.Object({
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 6,
      description: 'Wie viele der neuesten Eingangsfotos analysiert werden (Standard 3).',
    }),
  ),
  hint: Type.Optional(
    Type.String({
      maxLength: 300,
      description:
        'Optionaler Hinweis des Inhabers zum Objekt, zum Beispiel „es ist eine Taschenuhr von Doxa".',
    }),
  ),
});

type ArgsShape = Static<typeof AnalyzeInboxPhotosArgs>;

/** The structured suggestion the vision model must return (JSON mode). */
interface VisionSuggestion {
  name?: string;
  itemType?: string;
  metal?: string | null;
  condition?: string;
  categoryName?: string | null;
  descriptionDe?: string;
  auffaelligkeiten?: string;
  unsicher?: string;
}

const VISION_SYSTEM_PROMPT =
  'Du bist der Katalog-Experte eines Handelshauses für Antiquitäten, Gold, Schmuck, Münzen und ' +
  'Briefmarken in Deutschland. Du siehst Fotos EINES Artikels (mehrere Ansichten desselben ' +
  'Objekts, sofern nicht offensichtlich verschieden). Antworte AUSSCHLIESSLICH als JSON-Objekt ' +
  'mit diesen Feldern: ' +
  '"name" (verkaufsfertige deutsche Bezeichnung, z.B. „Goldene Savonnette Taschenuhr, 585er Gold"), ' +
  '"itemType" (genau einer: gold_coin, gold_bar, gold_jewelry, silver_coin, silver_bar, ' +
  'silver_jewelry, platinum_coin, platinum_bar, platinum_jewelry, antique, watch, other), ' +
  '"metal" (gold, silver, platinum, palladium oder null), ' +
  '"condition" (NEW, USED_EXCELLENT, USED_GOOD, USED_FAIR, ANTIQUE_RESTORED, ANTIQUE_AS_FOUND), ' +
  '"categoryName" (kurzer Katalogname wie „Uhren", „Münzen", „Schmuck", „Antiquitäten" oder null), ' +
  '"descriptionDe" (2 bis 3 verkaufsfertige deutsche Sätze, ehrlich, ohne Übertreibung), ' +
  '"auffaelligkeiten" (Punzen, Gravuren, Beschädigungen, Besonderheiten, kurz), ' +
  '"unsicher" (was du NICHT sicher erkennen kannst und der Inhaber prüfen sollte, z.B. Gewicht, ' +
  'Feingehalt, Echtheit). ' +
  'Erfinde NIEMALS Gewichte, Feingehalte oder Jahreszahlen, die nicht sichtbar sind, nenne sie ' +
  'stattdessen unter "unsicher".';

const handler: ToolHandler<ArgsShape> = async (
  ctx: ToolInvocationContext,
  args: ArgsShape,
): Promise<ToolResult> => {
  const env = loadEnv();
  if (!env.OPENAI_API_KEY) {
    return {
      content: [
        { type: 'text', text: 'Die Bildanalyse ist nicht konfiguriert (kein OpenAI-Schlüssel).' },
      ],
      data: { analyzed: 0 },
    };
  }

  const limit = args.limit ?? 3;

  // Newest unassigned local inbox photos — same slice `list_inbox_photos` shows.
  const rows = await ctx.db
    .select({ id: productPhotos.id, createdAt: productPhotos.createdAt })
    .from(productPhotos)
    .where(sql`${isNull(productPhotos.productId)} AND ${productPhotos.storageKind} = 'local'`)
    .orderBy(desc(productPhotos.createdAt))
    .limit(limit);

  if (rows.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'Im Fotoeingang liegen keine neuen Fotos. Bitte zuerst Fotos vom Telefon senden.',
        },
      ],
      data: { analyzed: 0 },
    };
  }

  // Load the small thumb renditions from disk; skip files that are missing
  // (deleted between SELECT and read) instead of failing the whole analysis.
  const images: { id: string; b64: string }[] = [];
  for (const row of rows) {
    try {
      const buf = await readFile(thumbPathFor(env, row.id));
      images.push({ id: row.id, b64: buf.toString('base64') });
    } catch {
      ctx.logger.warn({ photoId: row.id }, 'mcp.analyze_inbox_photos: thumb missing, skipped');
    }
  }
  if (images.length === 0) {
    return {
      content: [{ type: 'text', text: 'Die Eingangsfotos konnten nicht gelesen werden.' }],
      data: { analyzed: 0 },
    };
  }

  const userContent: unknown[] = [
    {
      type: 'text',
      text:
        `Identifiziere den Artikel auf ${images.length} Foto${images.length === 1 ? '' : 's'}.` +
        (args.hint ? ` Hinweis des Inhabers: ${args.hint}` : ''),
    },
    ...images.map((img) => ({
      type: 'image_url',
      image_url: { url: `data:image/webp;base64,${img.b64}`, detail: 'low' },
    })),
  ];

  let suggestion: VisionSuggestion;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.OPENAI_VISION_MODEL,
        response_format: { type: 'json_object' },
        max_tokens: 500,
        messages: [
          { role: 'system', content: VISION_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      ctx.logger.error(
        { status: res.status, body: body.slice(0, 300) },
        'mcp.analyze_inbox_photos: vision request failed',
      );
      return {
        content: [
          {
            type: 'text',
            text: 'Die Bildanalyse ist gerade nicht erreichbar. Bitte gleich noch einmal versuchen.',
          },
        ],
        data: { analyzed: 0 },
      };
    }
    const payload = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    suggestion = JSON.parse(payload.choices?.[0]?.message?.content ?? '{}') as VisionSuggestion;
  } catch (err) {
    ctx.logger.error({ err }, 'mcp.analyze_inbox_photos: vision call errored');
    return {
      content: [
        {
          type: 'text',
          text: 'Die Bildanalyse hat nicht geantwortet. Bitte gleich noch einmal versuchen.',
        },
      ],
      data: { analyzed: 0 },
    };
  }

  // Compose the German read-back the persona speaks to the owner.
  const parts: string[] = [];
  if (suggestion.name) parts.push(`Ich sehe: ${suggestion.name}.`);
  if (suggestion.descriptionDe) parts.push(suggestion.descriptionDe);
  if (suggestion.auffaelligkeiten) parts.push(`Auffällig: ${suggestion.auffaelligkeiten}`);
  if (suggestion.unsicher) parts.push(`Bitte prüfen: ${suggestion.unsicher}`);
  parts.push(
    'Wenn das passt, nenne mir noch Preis und fehlende Angaben, dann lege ich den Artikel an.',
  );

  ctx.logger.info(
    { analyzed: images.length, itemType: suggestion.itemType },
    'mcp.analyze_inbox_photos: suggestion produced',
  );

  return {
    content: [{ type: 'text', text: parts.join(' ') }],
    data: {
      analyzed: images.length,
      photoIds: images.map((i) => i.id),
      suggestion: {
        name: suggestion.name ?? null,
        itemType: suggestion.itemType ?? null,
        metal: suggestion.metal ?? null,
        condition: suggestion.condition ?? null,
        categoryName: suggestion.categoryName ?? null,
        descriptionDe: suggestion.descriptionDe ?? null,
        auffaelligkeiten: suggestion.auffaelligkeiten ?? null,
        unsicher: suggestion.unsicher ?? null,
      },
    },
  };
};

export const analyzeInboxPhotosTool = {
  manifest: {
    name: 'analyze_inbox_photos',
    description:
      'Looks at the newest photos in the photo inbox (sent from the owner\'s phone) with the ' +
      'vision model and returns a dealer-grade suggestion: sellable German name, item type, metal, ' +
      'condition, catalogue category, a short sales description, notable marks, and what remains ' +
      'uncertain. Read-only, it changes nothing. Use it when the owner says photos have arrived ' +
      'or asks what the item is; read the suggestion back, let the owner correct it, then create ' +
      'the product with create_product (attachInboxPhotos binds the same photos).',
    inputSchema: AnalyzeInboxPhotosArgs,
    requiredRoles: ['ADMIN'] as const,
    isMutation: false,
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
