/**
 * ebay_sync — eBay inventory reconciler (Epic D, #36).
 *
 * Prevents double-selling a unique item: when a product is sold at the retail
 * counter (`products.status` → SOLD) while its eBay listing is still live
 * (`ebay_state = 'ONLINE'`), this job ends the eBay listing and transitions the
 * product to `BEENDET`, appending a WORKER-sourced audit row.
 *
 * Each product is reconciled in its own transaction with a guarded UPDATE
 * (`WHERE ebay_state = 'ONLINE'`) so a concurrent OWNER flip can't be clobbered
 * and a re-run is idempotent. A failed EndItem call leaves the row for the next
 * tick rather than marking it ended.
 *
 * NOTE: products carry no eBay ItemID column yet, so the SKU is sent as the
 * EndItem reference. Wiring the real ItemID is a follow-up.
 */

import { EbayNotConfiguredError, type EbayFetch, endEbayListing } from '../lib/ebay-client.js';
import type { JobDefinition } from '../lib/job-runner.js';

interface SoldOnlineRow {
  id: string;
  sku: string;
}

export interface EbaySyncJobOptions {
  /** eBay Trading API token. Leer → der Abgleich lehnt ab und wartet. */
  token: string;
  /**
   * Nur für Tests: ein eBay-Doppelgänger. Damit lässt sich der Erfolgsweg
   * prüfen, ohne dafür „ohne Zugang gilt als beendet" erlauben zu müssen.
   */
  fetchImpl?: EbayFetch;
}

export function ebaySyncJob(opts: EbaySyncJobOptions): JobDefinition {
  return {
    name: 'ebay_sync',
    schedule: '*/5 * * * *', // every 5 minutes
    timeoutMs: 60_000,
    async run({ sql, log }) {
      const rows = await sql<SoldOnlineRow[]>`
        SELECT id, sku FROM products
         WHERE status = 'SOLD' AND ebay_state = 'ONLINE'`;

      if (rows.length === 0) {
        return { scanned: 0, ended: 0 };
      }

      let ended = 0;
      let failed = 0;
      let notConfigured = 0;
      for (const product of rows) {
        try {
          const result = await endEbayListing(
            opts.token,
            product.sku,
            opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {},
          );
          await sql.begin(async (tx) => {
            // Guarded: only flip if still ONLINE (don't clobber a concurrent flip).
            const updated = await tx`
              UPDATE products
                 SET ebay_state = 'BEENDET', ebay_state_changed_at = now()
               WHERE id = ${product.id} AND ebay_state = 'ONLINE'
              RETURNING id`;
            if (updated.length === 0) return; // someone else moved it; skip the event
            await tx`
              INSERT INTO product_ebay_listing_events
                (product_id, from_state, to_state, changed_by_source, notes, payload)
              VALUES
                (${product.id}, 'ONLINE', 'BEENDET', 'WORKER',
                 'sold at retail counter; eBay listing ended',
                 ${JSON.stringify({ mock: result.mock, detail: result.detail })}::jsonb)`;
          });
          ended++;
        } catch (err) {
          // „Kein Zugang hinterlegt" ist kein Ausfall und darf auch nicht als
          // einer GEZÄHLT werden: es wartet auf den Inhaber, nicht auf eBay.
          // Beide Fälle lassen die Zeile stehen, denn das Inserat ist in
          // beiden noch online.
          if (err instanceof EbayNotConfiguredError) {
            notConfigured++;
          } else {
            failed++;
            log.warn('ebay_sync: EndItem failed, leaving row for retry', {
              productId: product.id,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      // Einmal pro Lauf statt einmal pro Artikel: sonst wiederholt derselbe
      // fehlende Zugang dieselbe Zeile alle fünf Minuten so oft, wie Stücke
      // warten, und das eigentliche Signal geht darin unter.
      if (notConfigured > 0) {
        log.warn(
          'ebay_sync: kein eBay-Zugang hinterlegt — diese Inserate stehen weiterhin online, ' +
            'obwohl die Stücke am Tresen verkauft sind',
          { wartend: notConfigured },
        );
      }

      log.info('ebay_sync reconcile complete', {
        scanned: rows.length,
        ended,
        failed,
        notConfigured,
      });
      return { scanned: rows.length, ended, failed, notConfigured };
    },
  };
}
