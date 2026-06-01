/**
 * anthropic-vision-client — the REAL intake VisionClient (Phase B), wired into
 * the worker when `ANTHROPIC_API_KEY` is set (else the deterministic mock).
 *
 * SDK-free: raw `fetch` against the Anthropic Messages API (mirrors
 * api-cloud's anthropic-llm-client). Images are fetched from R2 by key (the
 * processor passes r2Keys) and sent as base64 image blocks.
 *
 * What's REAL here (LLM-backed):
 *   • extractItemAttributes  — appraises the photos → structured attributes
 *   • detectHallmark         — reads punch-marks / fineness stamps
 *   • ocrScaleReading        — reads a scale display if one is photographed
 *   • composeGermanDescription — German listing copy + marketing angles
 *
 * What stays a NO-OP (Anthropic offers neither, by design — documented):
 *   • removeBackground — passthrough (use the original image); a real cut-out
 *     needs a dedicated service (Photoroom/sharp). Not faked.
 *   • embed — zero vector; semantic search needs a real embeddings provider.
 *
 * Every method throws on hard failure; the processor's Promise.allSettled
 * degrades gracefully (a failed extraction → NEEDS_MORE_INFO for the reviewer).
 */

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type {
  BackgroundRemovalResult,
  EmbeddingResult,
  ExtractAttributesResult,
  GermanDescriptionResult,
  HallmarkResult,
  ScaleReadingResult,
  TokenUsage,
  VisionClient,
  VisionImage,
} from '@warehouse14/ai-gateway';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 60_000;
const VISION_MODEL = 'claude-sonnet-4-6';
/** Cap images per call to keep latency + cost bounded. */
const MAX_IMAGES = 4;

// Approximate Sonnet pricing (EUR per token) — used only for the cost hint.
const PRICE_IN = 2.7 / 1_000_000;
const PRICE_OUT = 13.5 / 1_000_000;

export interface AnthropicVisionConfig {
  apiKey: string;
  r2: {
    accountId: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
  };
}

interface AnthropicImageSource {
  type: 'base64';
  media_type: string;
  data: string;
}
type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: AnthropicImageSource };

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function mediaTypeFor(key: string, fallback?: string): string {
  const k = key.toLowerCase();
  if (k.endsWith('.png')) return 'image/png';
  if (k.endsWith('.webp')) return 'image/webp';
  if (k.endsWith('.gif')) return 'image/gif';
  if (k.endsWith('.jpg') || k.endsWith('.jpeg')) return 'image/jpeg';
  return fallback ?? 'image/jpeg';
}

function usageOf(r: AnthropicResponse): { usage: TokenUsage; costEur: number } {
  const inputTokens = r.usage?.input_tokens ?? 0;
  const outputTokens = r.usage?.output_tokens ?? 0;
  return {
    usage: { inputTokens, outputTokens },
    costEur: inputTokens * PRICE_IN + outputTokens * PRICE_OUT,
  };
}

/** Pull the first JSON object out of a model reply (tolerates ``` fences). */
function extractJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('vision: no JSON object in model reply');
  }
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}

function firstText(r: AnthropicResponse): string {
  return (r.content ?? []).find((b) => b.type === 'text')?.text ?? '';
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v : null;
}
function asNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
}
function asStrArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function createAnthropicVisionClient(config: AnthropicVisionConfig): VisionClient {
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.r2.accessKeyId,
      secretAccessKey: config.r2.secretAccessKey,
    },
  });

  async function fetchImageBlock(img: VisionImage): Promise<ContentBlock | null> {
    let bytes = img.bytes;
    let mediaType = img.mimeType;
    if (!bytes && img.r2Key) {
      const obj = await s3.send(new GetObjectCommand({ Bucket: config.r2.bucket, Key: img.r2Key }));
      if (!obj.Body) return null;
      bytes = await obj.Body.transformToByteArray();
      mediaType = obj.ContentType ?? mediaTypeFor(img.r2Key, mediaType);
    }
    if (!bytes) return null;
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mediaType ?? 'image/jpeg',
        data: Buffer.from(bytes).toString('base64'),
      },
    };
  }

  async function imageBlocks(images: VisionImage[]): Promise<ContentBlock[]> {
    const picked = images.slice(0, MAX_IMAGES);
    const blocks = await Promise.all(picked.map((i) => fetchImageBlock(i)));
    return blocks.filter((b): b is ContentBlock => b !== null);
  }

  async function post(body: Record<string, unknown>): Promise<AnthropicResponse> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('anthropic timeout')),
      REQUEST_TIMEOUT_MS,
    );
    try {
      const res = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
          'x-api-key': config.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`anthropic vision ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      return (await res.json()) as AnthropicResponse;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async extractItemAttributes({ images }): Promise<ExtractAttributesResult> {
      const blocks = await imageBlocks(images);
      if (blocks.length === 0) throw new Error('vision: no images to analyse');
      const prompt =
        'Du bist Sachverständiger für Gold, Silber, Münzen und Antiquitäten in einem ' +
        'deutschen An- und Verkauf. Begutachte die Fotos und gib NUR JSON zurück mit den ' +
        'Schlüsseln: item_type (gold_jewelry|gold_coin|gold_bar|silver_jewelry|silver_coin|' +
        'silver_bar|platinum_jewelry|platinum_coin|platinum_bar|antique|watch|other), ' +
        'karat_visible (string|null, z. B. "585"), hallmarks_visible (string[]), ' +
        'estimated_age_band (modern|vintage|antique|null), condition (new|excellent|good|fair|poor), ' +
        'coin_hint (string|null), estimated_issue_year (number|null), ' +
        'estimated_fine_grams (number|null — beste Schätzung des reinen Edelmetallgewichts in Gramm), ' +
        'observed_market_price_eur (number|null — typischer Wiederverkaufspreis, falls erkennbar), ' +
        'mint_hint (string|null). Keine Erklärungen, nur JSON.';
      const r = await post({
        model: VISION_MODEL,
        max_tokens: 700,
        messages: [{ role: 'user', content: [...blocks, { type: 'text', text: prompt }] }],
      });
      const j = extractJson(firstText(r));
      const { usage, costEur } = usageOf(r);
      const ageBand = asStr(j.estimated_age_band);
      const cond = asStr(j.condition);
      return {
        item_type: asStr(j.item_type) ?? 'other',
        karat_visible: asStr(j.karat_visible),
        hallmarks_visible: asStrArray(j.hallmarks_visible),
        estimated_age_band:
          ageBand === 'modern' || ageBand === 'vintage' || ageBand === 'antique' ? ageBand : null,
        condition:
          cond === 'new' ||
          cond === 'excellent' ||
          cond === 'good' ||
          cond === 'fair' ||
          cond === 'poor'
            ? cond
            : 'good',
        coin_hint: asStr(j.coin_hint),
        estimated_issue_year: asNum(j.estimated_issue_year),
        estimated_fine_grams: asNum(j.estimated_fine_grams),
        observed_market_price_eur: asNum(j.observed_market_price_eur),
        mint_hint: asStr(j.mint_hint),
        usage,
        costEur,
      };
    },

    async detectHallmark({ images }): Promise<HallmarkResult> {
      const blocks = await imageBlocks(images);
      if (blocks.length === 0)
        return {
          hallmarks: [],
          confidence: 0,
          usage: { inputTokens: 0, outputTokens: 0 },
          costEur: 0,
        };
      const prompt =
        'Lies alle Punzen / Feingehaltsstempel / Meistermarken auf den Fotos. Gib NUR JSON ' +
        'zurück: {hallmarks: string[], confidence: number (0..1)}.';
      const r = await post({
        model: VISION_MODEL,
        max_tokens: 300,
        messages: [{ role: 'user', content: [...blocks, { type: 'text', text: prompt }] }],
      });
      const j = extractJson(firstText(r));
      const { usage, costEur } = usageOf(r);
      return {
        hallmarks: asStrArray(j.hallmarks),
        confidence: Math.max(0, Math.min(1, asNum(j.confidence) ?? 0)),
        usage,
        costEur,
      };
    },

    async ocrScaleReading({ images }): Promise<ScaleReadingResult> {
      const blocks = await imageBlocks(images);
      if (blocks.length === 0)
        return { grams: null, raw: null, usage: { inputTokens: 0, outputTokens: 0 }, costEur: 0 };
      const prompt =
        'Falls eines der Fotos eine Waage mit Gewichtsanzeige zeigt, lies den Wert in Gramm. ' +
        'Gib NUR JSON zurück: {grams: number|null, raw: string|null}.';
      const r = await post({
        model: VISION_MODEL,
        max_tokens: 200,
        messages: [{ role: 'user', content: [...blocks, { type: 'text', text: prompt }] }],
      });
      const j = extractJson(firstText(r));
      const { usage, costEur } = usageOf(r);
      return { grams: asNum(j.grams), raw: asStr(j.raw), usage, costEur };
    },

    // No-op: a real cut-out needs a dedicated image service. Pass the original
    // image through so downstream steps still have something to show.
    removeBackground({ image }): Promise<BackgroundRemovalResult> {
      return Promise.resolve({ r2Key: image.r2Key ?? '' });
    },

    async composeGermanDescription({
      attributes,
      taxExplanation,
    }): Promise<GermanDescriptionResult> {
      const prompt = `Erstelle eine ansprechende, sachliche deutsche Produktbeschreibung (2–3 Sätze) für dieses Stück und passende Marketing-Angles. Eigenschaften (JSON): ${JSON.stringify(attributes)}. Steuerhinweis: ${taxExplanation}. Gib NUR JSON zurück: {description: string, marketingAngles: [{angle: string, keywords: string[]}]}.`;
      const r = await post({
        model: VISION_MODEL,
        max_tokens: 500,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      });
      const j = extractJson(firstText(r));
      const { usage, costEur } = usageOf(r);
      const angles = Array.isArray(j.marketingAngles)
        ? (j.marketingAngles as unknown[])
            .map((a) => {
              const o = a as Record<string, unknown>;
              return { angle: asStr(o.angle) ?? '', keywords: asStrArray(o.keywords) };
            })
            .filter((a) => a.angle.length > 0)
        : [];
      return {
        description: asStr(j.description) ?? '',
        marketingAngles: angles,
        usage,
        costEur,
      };
    },

    // No-op: Anthropic has no embeddings endpoint. A real semantic-search vector
    // needs a dedicated embeddings provider (e.g. Voyage). Zero vector for now.
    embed(): Promise<EmbeddingResult> {
      return Promise.resolve({
        vector: Array.from({ length: 1536 }, () => 0),
        usage: { inputTokens: 0, outputTokens: 0 },
        costEur: 0,
      });
    },
  };
}
