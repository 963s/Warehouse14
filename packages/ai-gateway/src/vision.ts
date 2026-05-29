/**
 * Intake-pipeline vision tasks (ADR-0015 §5) — injectable `VisionClient` + a
 * deterministic mock. As with the chat gateway, the transport is INJECTED so
 * this package stays pure/testable and free of the OpenAI/Photoroom SDKs. The
 * worker wires a real client; dev/test use the mock.
 *
 * The Vision output is only a HINT — the deterministic tax classifier in
 * @warehouse14/intake-pipeline decides the tax treatment, never the model.
 */

import type { TokenUsage } from './index.js';

export interface VisionImage {
  /** Raw bytes, when the worker has fetched them from R2. */
  bytes?: Uint8Array;
  mimeType?: string;
  /** R2 object key, when passing by reference. */
  r2Key?: string;
}

/** Structural mirror of intake-pipeline's VisionClassification (no dep cycle). */
export interface ExtractAttributesResult {
  item_type: string;
  karat_visible: string | null;
  hallmarks_visible: string[];
  estimated_age_band: 'modern' | 'vintage' | 'antique' | null;
  condition: 'new' | 'excellent' | 'good' | 'fair' | 'poor';
  coin_hint: string | null;
  estimated_issue_year: number | null;
  estimated_fine_grams: number | null;
  observed_market_price_eur: number | null;
  mint_hint: string | null;
  usage: TokenUsage;
  costEur: number;
}

export interface HallmarkResult {
  hallmarks: string[];
  confidence: number;
  usage: TokenUsage;
  costEur: number;
}

export interface ScaleReadingResult {
  /** Grams read off a scale display, or null when no scale photo / unreadable. */
  grams: number | null;
  raw: string | null;
  usage: TokenUsage;
  costEur: number;
}

export interface BackgroundRemovalResult {
  /** R2 key of the background-removed image. */
  r2Key: string;
}

export interface MarketingAngle {
  angle: string;
  keywords: string[];
}

export interface GermanDescriptionResult {
  description: string;
  marketingAngles: MarketingAngle[];
  usage: TokenUsage;
  costEur: number;
}

export interface EmbeddingResult {
  vector: number[];
  usage: TokenUsage;
  costEur: number;
}

export interface VisionClient {
  extractItemAttributes(args: { images: VisionImage[] }): Promise<ExtractAttributesResult>;
  detectHallmark(args: { images: VisionImage[] }): Promise<HallmarkResult>;
  ocrScaleReading(args: { images: VisionImage[] }): Promise<ScaleReadingResult>;
  removeBackground(args: {
    image: VisionImage;
    idempotencyKey: string;
  }): Promise<BackgroundRemovalResult>;
  composeGermanDescription(args: {
    attributes: ExtractAttributesResult;
    taxExplanation: string;
  }): Promise<GermanDescriptionResult>;
  embed(args: { text: string }): Promise<EmbeddingResult>;
}

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

/** Deterministic mock for dev/test — keyword-routed, no external services. */
export function createMockVisionClient(): VisionClient {
  return {
    extractItemAttributes(): Promise<ExtractAttributesResult> {
      return Promise.resolve({
        item_type: 'gold_jewelry',
        karat_visible: '585',
        hallmarks_visible: ['585'],
        estimated_age_band: 'vintage',
        condition: 'good',
        coin_hint: null,
        estimated_issue_year: null,
        estimated_fine_grams: 3.2,
        observed_market_price_eur: null,
        mint_hint: null,
        usage: { inputTokens: 800, outputTokens: 120 },
        costEur: 0.001,
      });
    },
    detectHallmark(): Promise<HallmarkResult> {
      return Promise.resolve({
        hallmarks: ['585', 'maker-mark'],
        confidence: 0.8,
        usage: { inputTokens: 400, outputTokens: 40 },
        costEur: 0.0005,
      });
    },
    ocrScaleReading(): Promise<ScaleReadingResult> {
      return Promise.resolve({
        grams: null,
        raw: null,
        usage: ZERO_USAGE,
        costEur: 0,
      });
    },
    removeBackground(args): Promise<BackgroundRemovalResult> {
      return Promise.resolve({ r2Key: `bg-removed/${args.idempotencyKey}.png` });
    },
    composeGermanDescription(): Promise<GermanDescriptionResult> {
      return Promise.resolve({
        description: 'Schöner gebrauchter Goldring (585), zeitloser Klassiker.',
        marketingAngles: [{ angle: 'Vintage-Klassiker', keywords: ['Goldring', '585', 'Vintage'] }],
        usage: { inputTokens: 600, outputTokens: 200 },
        costEur: 0.003,
      });
    },
    embed(): Promise<EmbeddingResult> {
      return Promise.resolve({
        vector: Array.from({ length: 1536 }, () => 0),
        usage: { inputTokens: 50, outputTokens: 0 },
        costEur: 0.0001,
      });
    },
  };
}
