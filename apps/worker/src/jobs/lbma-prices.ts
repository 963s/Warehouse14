/**
 * lbma_prices — daily Edelmetallkurs ingestion.
 *
 * Pluggable endpoint via env `LBMA_PRICES_URL`. The expected JSON shape is:
 *
 *   { goldEur: "62.30", silverEur: "0.75", platinumEur: "28.15",
 *     palladiumEur?: "40.00",           // optional
 *     fetchedAt: "2026-05-25T14:00:00Z", source: "metalpriceapi" }
 *
 * If the env is empty, the job is a no-op (returns { skipped: true }).
 *
 * Persistence (migration 0021):
 *   • For each metal whose price has *changed* (vs current row), open a
 *     transaction, close the existing CURRENT row (`SET valid_to = now()`)
 *     and INSERT a fresh CURRENT row. The partial UNIQUE on
 *     (metal) WHERE valid_to IS NULL serialises any concurrent attempt.
 *   • Unchanged metals: no-op. worker_job_runs already records that we
 *     fetched successfully — there is no need to clutter metal_prices.
 *   • The new row carries `fetched_by_job_run_id` so forensics can pivot
 *     from a price back to the exact attempt that produced it.
 *
 * `system_settings.lbma.latest_fix` is also refreshed so the operator
 * console can read "last fetch" without scanning the history.
 */

import type { JobDefinition } from '../lib/job-runner.js';

const METAL_KEYS = ['gold', 'silver', 'platinum', 'palladium'] as const;
type MetalKey = (typeof METAL_KEYS)[number];

interface LbmaResponse {
  goldEur?: string;
  silverEur?: string;
  platinumEur?: string;
  palladiumEur?: string;
  fetchedAt?: string;
  source?: string;
}

/** Per-fetch, per-metal outcome — included in the job's RUN payload. */
interface PerMetalOutcome {
  metal: MetalKey;
  action: 'INSERTED' | 'UPDATED' | 'UNCHANGED';
  pricePerGramEur: string;
}

function pickPrice(body: LbmaResponse, metal: MetalKey): string | undefined {
  switch (metal) {
    case 'gold':      return body.goldEur;
    case 'silver':    return body.silverEur;
    case 'platinum':  return body.platinumEur;
    case 'palladium': return body.palladiumEur;
  }
}

export function lbmaPricesJob(opts: { url: string }): JobDefinition {
  return {
    name: 'lbma_prices',
    schedule: '*/15 * * * *', // every 15 minutes
    timeoutMs: 30_000,
    async run({ sql: dbSql, jobRunId, signal, log }) {
      if (!opts.url) {
        log.debug('LBMA_PRICES_URL not configured — skipping fetch');
        return { skipped: true, reason: 'no_url_configured' };
      }

      const res = await fetch(opts.url, { signal });
      if (!res.ok) {
        throw new Error(`LBMA fetch HTTP ${res.status}`);
      }
      const body = (await res.json()) as LbmaResponse;

      // Required: at least gold/silver/platinum must be present.
      if (
        typeof body.goldEur !== 'string' ||
        typeof body.silverEur !== 'string' ||
        typeof body.platinumEur !== 'string'
      ) {
        throw new Error('LBMA response missing required fields {goldEur, silverEur, platinumEur}');
      }

      const fetchedAt = body.fetchedAt ?? new Date().toISOString();
      const source = body.source ?? 'unknown';
      const outcomes: PerMetalOutcome[] = [];

      for (const metal of METAL_KEYS) {
        const priceStr = pickPrice(body, metal);
        if (!priceStr) continue; // metal not provided this fetch

        const newPrice = Number(priceStr);
        if (!Number.isFinite(newPrice) || newPrice <= 0) {
          throw new Error(`LBMA ${metal}: non-positive or non-numeric price '${priceStr}'`);
        }

        // Read current price for this metal (no lock — the partial UNIQUE
        // ensures the close-out + insert is the only way to mutate).
        const currentRows = await dbSql<{ id: string; price_per_gram_eur: string }[]>`
          SELECT id, price_per_gram_eur FROM metal_prices
           WHERE metal = ${metal} AND valid_to IS NULL
           LIMIT 1`;
        const current = currentRows[0];

        if (current && Number(current.price_per_gram_eur) === newPrice) {
          outcomes.push({ metal, action: 'UNCHANGED', pricePerGramEur: priceStr });
          continue;
        }

        const sourceEnum = current ? 'XAUEUR_VENDOR' : 'LBMA';
        const payload = JSON.stringify({ fetchedAt, source, raw: priceStr });

        await dbSql.begin(async (tx) => {
          if (current) {
            await tx`UPDATE metal_prices SET valid_to = now() WHERE id = ${current.id}`;
          }
          await tx`
            INSERT INTO metal_prices
              (metal, price_per_gram_eur, source, source_payload, fetched_by_job_run_id)
            VALUES
              (${metal}, ${priceStr}, ${sourceEnum}::metal_price_source,
               ${payload}::jsonb, ${jobRunId.toString()})`;
        });

        outcomes.push({
          metal,
          action: current ? 'UPDATED' : 'INSERTED',
          pricePerGramEur: priceStr,
        });
      }

      // Keep system_settings.lbma.latest_fix as a fast "last fetch" snapshot.
      const snapshot = {
        goldEur: body.goldEur,
        silverEur: body.silverEur,
        platinumEur: body.platinumEur,
        ...(body.palladiumEur ? { palladiumEur: body.palladiumEur } : {}),
        fetchedAt,
        source,
      };
      await dbSql`
        UPDATE system_settings
           SET value = ${JSON.stringify(snapshot)}::jsonb,
               updated_at = now()
         WHERE key = 'lbma.latest_fix'`;

      log.info('lbma fetch complete', { outcomes });
      return { outcomes, fetchedAt, source };
    },
  };
}
