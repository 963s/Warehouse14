/**
 * product_translator — fills the per locale product text cache.
 *
 * THE POINT: the shop writes a product ONCE, in German. A Turkish or Arabic
 * customer should still understand what the piece is and why it is worth
 * having, WITHOUT anyone maintaining twelve copies of every product by hand.
 *
 * Shape of the work, every few minutes:
 *   1. Find (product, locale) pairs that are MISSING a translation, or whose
 *      cached row was made from German text that has since changed
 *      (source_fingerprint mismatch).
 *   2. Translate a bounded batch through the chat model.
 *   3. Upsert. Never delete the German original, never touch `products`.
 *
 * Deliberate properties:
 *   • DORMANT WITHOUT A KEY. No OPENAI_API_KEY means the job returns a clear
 *     "disabled" result instead of failing every tick. The storefront then
 *     serves German, which is honest and correct.
 *   • ONLY PUBLISHED, SELLABLE products are translated. Drafts and sold
 *     pieces would burn tokens on text no customer will read.
 *   • PER PAIR ISOLATION. One bad product cannot fail the sweep; it is logged
 *     and retried next tick. A whole batch is never lost to one refusal.
 *   • NO INVENTED FACTS. The prompt forbids adding claims (materials, dates,
 *     provenance) that are not in the German source. A shop that invents
 *     provenance in Arabic and not in German has a real legal problem, not a
 *     translation bug.
 *   • Nothing here is fiscal or personal, so this table is freely rebuildable.
 */

import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';

import type { JobContext, JobDefinition } from '../lib/job-runner.js';

/** Everything this job needs from the environment, injected by app.ts. */
export interface ProductTranslatorOptions {
  /** Empty string keeps the job dormant and the storefront on German. */
  apiKey: string;
  model: string;
  /** Comma separated target locales, German excluded. */
  locales: string;
  batchSize: number;
}

/** A product whose German text needs rendering into one locale. */
type PendingRow = {
  product_id: string;
  locale: string;
  name: string;
  description_de: string | null;
};

/**
 * Fingerprint of the German source. Any edit to name or description changes
 * it, which is exactly what marks a cached translation stale.
 */
export function fingerprint(name: string, description: string | null): string {
  return createHash('sha256')
    .update(`${name} ${description ?? ''}`)
    .digest('hex')
    .slice(0, 32);
}

/** Locales to translate into, minus German (the source) and junk entries. */
export function targetLocales(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => /^[a-z]{2}$/.test(s) && s !== 'de'),
    ),
  ];
}

const SYSTEM_PROMPT =
  'You translate product texts for a German shop that sells precious metals, coins, ' +
  'collectibles and antiques. You write for an ordinary shopper, not an expert. ' +
  'Rules, all mandatory: (1) Convey the MEANING and the appeal of the German source, ' +
  'never translate word by word. The result must read as if written natively by a ' +
  'warm, trustworthy neighbourhood shop. (2) Invent NOTHING. Do not add materials, ' +
  'dates, origins, conditions or claims that are not in the source. If the source is ' +
  'short, your translation stays short. (3) Keep proper nouns, catalog references and ' +
  'numbers exactly as they are. (4) No marketing hype, no exclamation marks, no empty ' +
  'superlatives. (5) Reply with STRICT JSON only: {"name": string, "description": string ' +
  'or null}. No markdown, no commentary.';

/** One translation call. Returns null when the model gives nothing usable. */
async function translateOne(
  row: PendingRow,
  opts: ProductTranslatorOptions,
  signal: AbortSignal,
): Promise<{ name: string; description: string | null } | null> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            targetLanguage: row.locale,
            name: row.name,
            description: row.description_de,
          }),
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new Error(`translate HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = body.choices?.[0]?.message?.content;
  if (!raw) return null;

  const parsed = JSON.parse(raw) as { name?: unknown; description?: unknown };
  const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
  const description =
    typeof parsed.description === 'string' && parsed.description.trim().length > 0
      ? parsed.description.trim()
      : null;

  // A row must carry text (DB CHECK). An empty name with no description is
  // not a translation, so treat it as a miss and retry next sweep.
  if (!name && !description) return null;
  return { name: name || row.name, description };
}

/**
 * How many translations are in flight at once. Sequential was costing real
 * time: 82 categories across 12 languages is 984 calls, and one at a time
 * that is most of a day before a Turkish shopper stops seeing German section
 * names. Four at a time drains the same backlog in about an hour while
 * staying far below any sane rate limit, and a sweep still finishes well
 * inside the job timeout.
 */
const CONCURRENCY = 4;

/**
 * Run `fn` over every item with at most `limit` in flight. Rejections are the
 * caller's to handle: fn here always resolves, because one bad pair must
 * never abort the sweep.
 */
async function runPool<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      const item = items[i];
      if (item === undefined) return;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export function productTranslatorJob(opts: ProductTranslatorOptions): JobDefinition {
  return {
  name: 'product_translator',
  schedule: '*/5 * * * *', // every 5 minutes
  timeoutMs: 120_000,
  run: async ({ db, log, signal }: JobContext) => {
    if (!opts.apiKey) {
      // Not an error: an unconfigured shop simply shows German everywhere.
      return { disabled: true, reason: 'OPENAI_API_KEY empty' };
    }

    const locales = targetLocales(opts.locales);
    if (locales.length === 0) return { disabled: true, reason: 'no target locales' };

    // Postgres array literal for the CROSS JOIN. A bound JS array arrives as a
    // ROW here, not a text[], which fails with "cannot cast type record to
    // text[]" (caught live on the first production tick). Inlining is safe
    // ONLY because targetLocales() has already rejected anything that is not
    // exactly two lowercase letters, so no caller controlled text reaches SQL.
    const localeArray = locales.map((l) => `'${l}'`).join(', ');

    // Missing OR stale pairs, oldest products first so a fresh catalog fills
    // in a predictable order. Only what a customer can actually open.
    const pending = (await db.execute(sql`
      SELECT p.id AS product_id, l.locale, p.name, p.description_de
        FROM products p
        CROSS JOIN unnest(ARRAY[${sql.raw(localeArray)}]::text[]) AS l(locale)
        LEFT JOIN product_translations t
               ON t.product_id = p.id AND t.locale = l.locale
       WHERE p.is_published_to_web = TRUE
         AND p.status = 'AVAILABLE'::product_status
         AND (
           t.product_id IS NULL
           -- Staleness is decided IN SQL, against the product's CURRENT German
           -- text. This expression must stay byte identical to fingerprint()
           -- above (sha256 of "name description", hex, first 32 chars) or the
           -- sweeper would retranslate everything on every single tick.
           OR t.source_fingerprint <> left(
                encode(digest(p.name || ' ' || coalesce(p.description_de, ''), 'sha256'), 'hex'),
                32
              )
         )
       ORDER BY p.created_at ASC
       LIMIT ${opts.batchSize}
    `)) as unknown as PendingRow[];

    // NO EARLY RETURN HERE. There used to be one, and it was a real outage in
    // miniature: the moment the product catalog was fully translated, the job
    // returned before ever reaching the category sweep, so categories froze at
    // 200 of 984 pairs and every tick reported success while doing nothing.
    // An empty product batch is simply a no op for the pool below; categories
    // are a SEPARATE backlog and must always get their turn.
    let translated = 0;
    let failed = 0;

    await runPool(pending, CONCURRENCY, async (row) => {
      if (signal.aborted) return;
      const fp = fingerprint(row.name, row.description_de);
      try {
        const out = await translateOne(row, opts, signal);
        if (!out) {
          failed++;
          return;
        }
        await db.execute(sql`
          INSERT INTO product_translations
            (product_id, locale, name, description, source_fingerprint, provider, updated_at)
          VALUES
            (${row.product_id}, ${row.locale}, ${out.name}, ${out.description},
             ${fp}, ${opts.model}, now())
          ON CONFLICT (product_id, locale) DO UPDATE
            SET name               = EXCLUDED.name,
                description        = EXCLUDED.description,
                source_fingerprint = EXCLUDED.source_fingerprint,
                provider           = EXCLUDED.provider,
                updated_at         = now()
        `);
        translated++;
      } catch (err) {
        // One product must never take down the sweep; it retries next tick.
        failed++;
        log.warn('product_translator: pair failed', {
          productId: row.product_id,
          locale: row.locale,
          err: (err as Error).message,
        });
      }
    });

    // ── Categories ────────────────────────────────────────────────────
    // The catalog SECTION a customer taps ("Uhren", "Münzen") is owner
    // created at runtime, so it cannot live in the app's locale files the
    // way the fixed facets (metal, Erhaltung) do. Same cache, same
    // fingerprint rule, same call. Hidden categories are skipped: nobody
    // can see them, so translating them is spend with no reader.
    const pendingCats = (await db.execute(sql`
      SELECT c.id AS category_id, l.locale, c.name_de AS name, c.description_de
        FROM categories c
        CROSS JOIN unnest(ARRAY[${sql.raw(localeArray)}]::text[]) AS l(locale)
        LEFT JOIN category_translations t
               ON t.category_id = c.id AND t.locale = l.locale
       WHERE c.hidden_from_storefront = FALSE
         AND (
           t.category_id IS NULL
           OR t.source_fingerprint <> left(
                encode(digest(c.name_de || ' ' || coalesce(c.description_de, ''), 'sha256'), 'hex'),
                32
              )
         )
       ORDER BY c.display_order ASC
       LIMIT ${opts.batchSize}
    `)) as unknown as { category_id: string; locale: string; name: string; description_de: string | null }[];

    let catsTranslated = 0;
    let catsFailed = 0;
    await runPool(pendingCats, CONCURRENCY, async (row) => {
      if (signal.aborted) return;
      const fp = fingerprint(row.name, row.description_de);
      try {
        const out = await translateOne(
          { product_id: row.category_id, locale: row.locale, name: row.name, description_de: row.description_de },
          opts,
          signal,
        );
        if (!out) {
          catsFailed++;
          return;
        }
        await db.execute(sql`
          INSERT INTO category_translations
            (category_id, locale, name, description, source_fingerprint, provider, updated_at)
          VALUES
            (${row.category_id}, ${row.locale}, ${out.name}, ${out.description},
             ${fp}, ${opts.model}, now())
          ON CONFLICT (category_id, locale) DO UPDATE
            SET name               = EXCLUDED.name,
                description        = EXCLUDED.description,
                source_fingerprint = EXCLUDED.source_fingerprint,
                provider           = EXCLUDED.provider,
                updated_at         = now()
        `);
        catsTranslated++;
      } catch (err) {
        catsFailed++;
        log.warn('product_translator: category pair failed', {
          categoryId: row.category_id,
          locale: row.locale,
          err: (err as Error).message,
        });
      }
    });

    if (translated > 0 || failed > 0 || catsTranslated > 0 || catsFailed > 0) {
      log.info('product_translator swept', {
        translated,
        failed,
        batch: pending.length,
        catsTranslated,
        catsFailed,
      });
    }
    return { translated, failed, batch: pending.length, catsTranslated, catsFailed };
  },
  };
}
