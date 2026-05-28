/**
 * lbma_prices — Edelmetallkurs ingestion (Epic A). Fetching is delegated to a
 * pluggable `MetalPriceProvider` (mock / metalpriceapi / goldapi / json_url),
 * selected from env in `app.ts`. This job owns ONLY persistence.
 *
 * Persistence (migration 0021), unchanged from the original URL-based job:
 *   • For each metal whose price has *changed* (vs the current row), open a
 *     transaction, close the existing CURRENT row (`SET valid_to = now()`) and
 *     INSERT a fresh CURRENT row. The partial UNIQUE on (metal) WHERE
 *     valid_to IS NULL serialises any concurrent attempt.
 *   • Unchanged metals: no-op.
 *   • The new row carries `fetched_by_job_run_id` for forensics, and
 *     `source_payload` records which provider produced it.
 *
 * `system_settings.lbma.latest_fix` is refreshed as a fast "last fetch"
 * snapshot for the operator console.
 *
 * A `null` provider (disabled / under-configured) makes the job a safe no-op.
 */

import type { JobDefinition } from '../lib/job-runner.js';
import type { MetalPriceProvider } from './providers/index.js';

/** Per-fetch, per-metal outcome — included in the job's RUN payload. */
interface PerMetalOutcome {
  metal: string;
  action: 'INSERTED' | 'UPDATED' | 'UNCHANGED';
  pricePerGramEur: string;
}

export interface LbmaPricesJobOptions {
  /** Configured provider, or `null` to disable the job. */
  provider: MetalPriceProvider | null;
  /** Worker NODE_ENV — used to warn when the mock provider runs in production. */
  nodeEnv?: string;
}

export function lbmaPricesJob(opts: LbmaPricesJobOptions): JobDefinition {
  return {
    name: 'lbma_prices',
    schedule: '*/15 * * * *', // every 15 minutes
    timeoutMs: 30_000,
    async run({ sql: dbSql, jobRunId, signal, log }) {
      const { provider } = opts;
      if (!provider) {
        log.debug('metal-price provider disabled — skipping fetch');
        return { skipped: true, reason: 'provider_disabled' };
      }
      if (provider.name === 'mock' && opts.nodeEnv === 'production') {
        log.warn('MOCK metal prices in production — set METAL_PRICE_PROVIDER to a real vendor');
      }

      const prices = await provider.fetch({ signal });
      if (prices.length === 0) {
        return { skipped: true, reason: 'no_prices_returned' };
      }

      const outcomes: PerMetalOutcome[] = [];

      for (const price of prices) {
        const newPrice = Number(price.pricePerGramEur);
        if (!Number.isFinite(newPrice) || newPrice <= 0) {
          throw new Error(
            `${provider.name} ${price.metal}: non-positive price '${price.pricePerGramEur}'`,
          );
        }

        // Read current price (no lock — the partial UNIQUE makes close-out +
        // insert the only way to mutate).
        const currentRows = await dbSql<{ id: string; price_per_gram_eur: string }[]>`
          SELECT id, price_per_gram_eur FROM metal_prices
           WHERE metal = ${price.metal} AND valid_to IS NULL
           LIMIT 1`;
        const current = currentRows[0];

        if (current && Number(current.price_per_gram_eur) === newPrice) {
          outcomes.push({
            metal: price.metal,
            action: 'UNCHANGED',
            pricePerGramEur: price.pricePerGramEur,
          });
          continue;
        }

        const sourceEnum = current ? 'XAUEUR_VENDOR' : 'LBMA';
        const payload = JSON.stringify({
          provider: provider.name,
          source: price.source,
          fetchedAt: price.fetchedAt,
          raw: price.pricePerGramEur,
        });

        await dbSql.begin(async (tx) => {
          if (current) {
            await tx`UPDATE metal_prices SET valid_to = now() WHERE id = ${current.id}`;
          }
          await tx`
            INSERT INTO metal_prices
              (metal, price_per_gram_eur, source, source_payload, fetched_by_job_run_id)
            VALUES
              (${price.metal}, ${price.pricePerGramEur}, ${sourceEnum}::metal_price_source,
               ${payload}::jsonb, ${jobRunId.toString()})`;
        });

        outcomes.push({
          metal: price.metal,
          action: current ? 'UPDATED' : 'INSERTED',
          pricePerGramEur: price.pricePerGramEur,
        });
      }

      // Refresh the fast "last fetch" snapshot for the operator console.
      const snapshot: Record<string, unknown> = {
        provider: provider.name,
        fetchedAt: prices[0]?.fetchedAt,
        source: prices[0]?.source,
      };
      for (const price of prices) {
        snapshot[`${price.metal}Eur`] = price.pricePerGramEur;
      }
      await dbSql`
        UPDATE system_settings
           SET value = ${JSON.stringify(snapshot)}::jsonb,
               updated_at = now()
         WHERE key = 'lbma.latest_fix'`;

      log.info('metal price fetch complete', { provider: provider.name, outcomes });
      return { provider: provider.name, outcomes };
    },
  };
}
