/**
 * Risk overview (Track E / B2) — the analytical read layer the risk surface needs.
 *
 * The detectors already fire (anomaly z-score, smurfing/structuring, cash-drawer
 * variance, sanctions/PEP, trust changes) but only ever emit `alert.*` ledger
 * events; there was no way to roll them up. This route aggregates:
 *   • alert counts by type over a trailing window + a recent-alert feed,
 *   • the customer watchlist (SUSPICIOUS / BANNED / sanctions / PEP).
 *
 * ADMIN-only, read-only. All figures are live from `ledger_events` + `customers`.
 */

import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Env } from '../config/env.js';
import { requireRole } from '../lib/auth-policy.js';
import { type CfDayRow, cfZoneQuery, dayGroupsQuery, utcDay } from '../lib/cloudflare-analytics.js';

const WINDOW_DAYS = 30;

/** Trailing window for the edge-threat rollup (the daily dataset keeps ~30 d). */
const EDGE_WINDOW_DAYS = 7;

const riskRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.get(
    '/api/risk/overview',
    { schema: { tags: ['risk'], summary: 'Risk overview: alert rollup + customer watchlist.' } },
    async (req) => {
      requireRole(req, 'ADMIN');

      // Alert counts by type over the trailing window.
      const counts = await app.db.execute<{ event_type: string; n: number }>(drizzleSql`
        SELECT event_type, COUNT(*)::int AS n
          FROM ledger_events
         WHERE event_type LIKE 'alert.%'
           AND created_at >= now() - (${WINDOW_DAYS} || ' days')::interval
         GROUP BY event_type
         ORDER BY n DESC`);

      // Most-recent alerts (newest first).
      const recent = await app.db.execute<{
        id: string;
        event_type: string;
        created_at: Date | string;
      }>(drizzleSql`
        SELECT id, event_type, created_at
          FROM ledger_events
         WHERE event_type LIKE 'alert.%'
         ORDER BY id DESC
         LIMIT 20`);

      // Customer watchlist snapshot.
      const watchRows = await app.db.execute<{
        suspicious: number;
        banned: number;
        sanctions: number;
        pep: number;
      }>(drizzleSql`
        SELECT
          COUNT(*) FILTER (WHERE trust_level = 'SUSPICIOUS')::int AS suspicious,
          COUNT(*) FILTER (WHERE trust_level = 'BANNED')::int     AS banned,
          COUNT(*) FILTER (WHERE sanctions_match)::int            AS sanctions,
          COUNT(*) FILTER (WHERE pep_match)::int                  AS pep
        FROM customers
        WHERE soft_deleted_at IS NULL`);

      const alertCounts: Record<string, number> = {};
      let totalAlerts = 0;
      for (const r of counts) {
        alertCounts[r.event_type] = r.n;
        totalAlerts += r.n;
      }
      const w = watchRows[0] ?? { suspicious: 0, banned: 0, sanctions: 0, pep: 0 };

      return {
        windowDays: WINDOW_DAYS,
        totalAlerts,
        alertCounts,
        recentAlerts: recent.map((r) => ({
          id: r.id,
          eventType: r.event_type,
          createdAt:
            r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        })),
        watchlist: {
          suspicious: w.suspicious,
          banned: w.banned,
          sanctions: w.sanctions,
          pep: w.pep,
        },
      };
    },
  );

  // ── Edge protection (Cloudflare) — threats stopped at the edge, by day and by
  //    country of origin. Env-gated: with no token/zone it returns
  //    `configured: false` so the UI shows a calm "nicht konfiguriert" state,
  //    never a fabricated figure. ADMIN, read-only.
  //
  //    Source note: the per-action firewall breakdown (block vs. challenge) lives
  //    in `firewallEventsAdaptiveGroups`, which this zone's plan refuses. The
  //    threat COUNT is available in the daily rollup, so that is what we report —
  //    a real number without the action split, rather than nothing.
  app.get(
    '/api/risk/edge',
    { schema: { tags: ['risk'], summary: 'Edge protection: Cloudflare threat rollup (env-gated).' } },
    async (req) => {
      requireRole(req, 'ADMIN');

      const token = opts.env.CLOUDFLARE_API_TOKEN;
      const zone = opts.env.CLOUDFLARE_ZONE_ID;
      if (!token || !zone) return { configured: false as const };

      const windowDays = EDGE_WINDOW_DAYS;
      const d1 = utcDay(-(windowDays - 1));
      const d2 = utcDay(0);

      const rows = await cfZoneQuery<{ httpRequests1dGroups: CfDayRow[] }>(token, dayGroupsQuery(true), {
        zone,
        d1,
        d2,
      });
      if (!rows || !Array.isArray(rows.httpRequests1dGroups)) {
        req.log.warn('risk.edge: Cloudflare zone analytics unavailable');
        return { configured: true as const, available: false as const };
      }

      const byCountryMap = new Map<string, number>();
      let totalThreats = 0;
      let totalRequests = 0;
      const daily = rows.httpRequests1dGroups.map((r) => {
        const threats = Number(r.sum.threats) || 0;
        const requests = Number(r.sum.requests) || 0;
        totalThreats += threats;
        totalRequests += requests;
        for (const c of r.sum.countryMap ?? []) {
          const t = Number(c.threats) || 0;
          if (t > 0) byCountryMap.set(c.clientCountryName, (byCountryMap.get(c.clientCountryName) ?? 0) + t);
        }
        return { date: r.dimensions.date, threats, requests };
      });

      const byCountry = Array.from(byCountryMap, ([country, threats]) => ({ country, threats })).sort(
        (a, b) => b.threats - a.threats,
      );

      return {
        configured: true as const,
        available: true as const,
        windowDays,
        since: d1,
        totalThreats,
        totalRequests,
        daily,
        byCountry,
      };
    },
  );
};

export default riskRoutes;
