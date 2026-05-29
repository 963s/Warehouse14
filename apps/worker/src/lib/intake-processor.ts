/**
 * Intake session processor (ADR-0015 §5-7). For one GROUPED session:
 *   1. parallel AI: background removal + attribute extraction + hallmark +
 *      scale OCR (Promise.allSettled — partial failures degrade, never block);
 *   2. deterministic enrichment: classifyTaxTreatment (NEVER an LLM) using a
 *      cached LBMA snapshot;
 *   3. sequential AI: German description, then embedding;
 *   4. assemble + persist intake_drafts, move the session to READY_FOR_REVIEW.
 *
 * NOTE: BullMQ is specified in the epic, but this repo's worker is a PG-native
 * advisory-locked cron runner (no Redis). The grouping/processing SWEEP job
 * drives this function on the existing runner — same at-most-once guarantee via
 * the per-job advisory lock. Swapping in BullMQ later only changes the trigger.
 */

import { sql as drizzleSql } from 'drizzle-orm';

import type { ExtractAttributesResult, VisionClient, VisionImage } from '@warehouse14/ai-gateway';
import type { WorkerDb } from '@warehouse14/db/client';
import {
  type ItemType,
  type LbmaSnapshot,
  type VisionClassification,
  classifyTaxTreatment,
} from '@warehouse14/intake-pipeline';

const ITEM_TYPES: ReadonlySet<string> = new Set([
  'gold_bar',
  'gold_coin',
  'silver_coin',
  'gold_jewelry',
  'silver_jewelry',
  'watch',
  'antique',
  'other',
]);

function coerceItemType(v: string): ItemType {
  return (ITEM_TYPES.has(v) ? v : 'other') as ItemType;
}

function toVisionClassification(attrs: ExtractAttributesResult): VisionClassification {
  return {
    item_type: coerceItemType(attrs.item_type),
    karat_visible: attrs.karat_visible,
    hallmarks_visible: attrs.hallmarks_visible,
    estimated_age_band: attrs.estimated_age_band,
    condition: attrs.condition,
    coin_hint: attrs.coin_hint,
    estimated_issue_year: attrs.estimated_issue_year,
    estimated_fine_grams: attrs.estimated_fine_grams,
    observed_market_price_eur: attrs.observed_market_price_eur,
    mint_hint: attrs.mint_hint,
  };
}

type MsgRow = {
  media_r2_key: string | null;
};

async function loadLbmaSnapshot(db: WorkerDb): Promise<LbmaSnapshot> {
  const rows = (await db.execute<{ gold: string | null; silver: string | null }>(drizzleSql`
    SELECT metal_price_avg_eur_per_gram('gold')::text AS gold,
           metal_price_avg_eur_per_gram('silver')::text AS silver
  `)) as unknown as Array<{ gold: string | null; silver: string | null }>;
  const r = rows[0];
  return {
    goldEurPerGram: r?.gold != null ? Number(r.gold) : null,
    silverEurPerGram: r?.silver != null ? Number(r.silver) : null,
    asOf: new Date().toISOString(),
  };
}

interface ProcLog {
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
  error: (msg: string, extra?: Record<string, unknown>) => void;
}

/** Process one GROUPED intake session end-to-end. Never throws — records FAILED. */
export async function processIntakeSession(
  db: WorkerDb,
  vision: VisionClient,
  sessionId: string,
  log: ProcLog,
): Promise<void> {
  try {
    await db.execute(drizzleSql`
      UPDATE intake_sessions
      SET status = 'PROCESSING', processing_started_at = now()
      WHERE id = ${sessionId}::uuid AND status = 'GROUPED'
    `);

    const msgRows = (await db.execute<MsgRow>(drizzleSql`
      SELECT media_r2_key FROM intake_messages
      WHERE session_id = ${sessionId}::uuid AND direction = 'inbound' AND message_type = 'image'
      ORDER BY received_at ASC
    `)) as unknown as MsgRow[];
    const images: VisionImage[] = msgRows
      .filter((m): m is { media_r2_key: string } => m.media_r2_key !== null)
      .map((m) => ({ r2Key: m.media_r2_key }));

    // ── Parallel AI (partial failures degrade, never block) ────────────────
    const [bgResults, attrsResult, hallmarkResult, scaleResult] = await Promise.allSettled([
      Promise.all(
        images.map((img, i) =>
          vision.removeBackground({ image: img, idempotencyKey: `${sessionId}-${i}` }),
        ),
      ),
      vision.extractItemAttributes({ images }),
      vision.detectHallmark({ images }),
      vision.ocrScaleReading({ images }),
    ]);

    const pipelineErrors: Record<string, string> = {};
    if (bgResults.status === 'rejected') pipelineErrors.removeBackground = String(bgResults.reason);
    if (hallmarkResult.status === 'rejected')
      pipelineErrors.detectHallmark = String(hallmarkResult.reason);
    if (scaleResult.status === 'rejected')
      pipelineErrors.ocrScaleReading = String(scaleResult.reason);

    const bgKeys = bgResults.status === 'fulfilled' ? bgResults.value.map((b) => b.r2Key) : [];

    if (attrsResult.status === 'rejected') {
      // Main classification failed → reviewer fills in manually (ADR §9).
      pipelineErrors.extractItemAttributes = String(attrsResult.reason);
      await upsertDraft(db, sessionId, {
        bgKeys,
        visionClassification: null,
        hallmark: hallmarkResult.status === 'fulfilled' ? hallmarkResult.value : null,
        scale: scaleResult.status === 'fulfilled' ? scaleResult.value : null,
        taxCode: null,
        taxExplanation: null,
        germanDescription: null,
        marketingAngles: null,
        embedding: null,
        lbmaGold: null,
        pipelineErrors,
      });
      await db.execute(drizzleSql`
        UPDATE intake_sessions SET status = 'NEEDS_MORE_INFO', processing_completed_at = now()
        WHERE id = ${sessionId}::uuid
      `);
      log.warn('intake: attribute extraction failed → NEEDS_MORE_INFO', { sessionId });
      return;
    }

    const attrs = attrsResult.value;
    const visionClassification = toVisionClassification(attrs);

    // ── Deterministic enrichment (NO AI) ───────────────────────────────────
    const lbma = await loadLbmaSnapshot(db);
    const tax = classifyTaxTreatment(visionClassification, lbma);

    // ── Sequential AI: description, then embedding ─────────────────────────
    const description = await vision.composeGermanDescription({
      attributes: attrs,
      taxExplanation: tax.explanation,
    });
    const embedding = await vision.embed({ text: description.description });

    await upsertDraft(db, sessionId, {
      bgKeys,
      visionClassification,
      hallmark: hallmarkResult.status === 'fulfilled' ? hallmarkResult.value : null,
      scale: scaleResult.status === 'fulfilled' ? scaleResult.value : null,
      taxCode: tax.code,
      taxExplanation: tax.explanation,
      germanDescription: description.description,
      marketingAngles: description.marketingAngles,
      embedding: embedding.vector,
      lbmaGold: lbma.goldEurPerGram,
      pipelineErrors,
    });

    await db.execute(drizzleSql`
      UPDATE intake_sessions SET status = 'READY_FOR_REVIEW', processing_completed_at = now()
      WHERE id = ${sessionId}::uuid
    `);
    log.info('intake: session ready for review', { sessionId, taxCode: tax.code });
  } catch (err) {
    log.error('intake: processing failed', { sessionId, err: String(err) });
    await db
      .execute(drizzleSql`
        UPDATE intake_sessions SET status = 'FAILED', processing_completed_at = now()
        WHERE id = ${sessionId}::uuid
      `)
      .catch(() => undefined);
  }
}

interface DraftFields {
  bgKeys: string[];
  visionClassification: VisionClassification | null;
  hallmark: unknown;
  scale: unknown;
  taxCode: string | null;
  taxExplanation: string | null;
  germanDescription: string | null;
  marketingAngles: unknown;
  embedding: number[] | null;
  lbmaGold: number | null;
  pipelineErrors: Record<string, string>;
}

async function upsertDraft(db: WorkerDb, sessionId: string, f: DraftFields): Promise<void> {
  const visionJson = f.visionClassification ? JSON.stringify(f.visionClassification) : null;
  const hallmarkJson = f.hallmark ? JSON.stringify(f.hallmark) : null;
  const scaleJson = f.scale ? JSON.stringify(f.scale) : null;
  const anglesJson = f.marketingAngles ? JSON.stringify(f.marketingAngles) : null;
  const errorsJson =
    Object.keys(f.pipelineErrors).length > 0 ? JSON.stringify(f.pipelineErrors) : null;
  const embeddingLiteral = f.embedding ? `[${f.embedding.join(',')}]` : null;

  await db.execute(drizzleSql`
    INSERT INTO intake_drafts
      (session_id, bg_removed_photo_keys, vision_classification, vision_hallmark_detection,
       vision_scale_reading, lbma_price_snapshot_eur_per_g, tax_treatment_code,
       classifier_explanation, german_description, marketing_angles, embedding, pipeline_errors)
    VALUES
      (${sessionId}::uuid, ${f.bgKeys}, ${visionJson}::jsonb, ${hallmarkJson}::jsonb,
       ${scaleJson}::jsonb, ${f.lbmaGold}, ${f.taxCode},
       ${f.taxExplanation}, ${f.germanDescription}, ${anglesJson}::jsonb,
       ${embeddingLiteral}::vector, ${errorsJson}::jsonb)
    ON CONFLICT (session_id) DO UPDATE SET
      bg_removed_photo_keys         = EXCLUDED.bg_removed_photo_keys,
      vision_classification         = EXCLUDED.vision_classification,
      vision_hallmark_detection     = EXCLUDED.vision_hallmark_detection,
      vision_scale_reading          = EXCLUDED.vision_scale_reading,
      lbma_price_snapshot_eur_per_g = EXCLUDED.lbma_price_snapshot_eur_per_g,
      tax_treatment_code            = EXCLUDED.tax_treatment_code,
      classifier_explanation        = EXCLUDED.classifier_explanation,
      german_description            = EXCLUDED.german_description,
      marketing_angles              = EXCLUDED.marketing_angles,
      embedding                     = EXCLUDED.embedding,
      pipeline_errors               = EXCLUDED.pipeline_errors,
      updated_at                    = now()
  `);
}
