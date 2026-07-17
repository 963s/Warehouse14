/**
 * Schaufenster — who stands in front of the shop window.
 *
 * The live reach of warehouse14.de as Cloudflare sees it at the edge: visitors,
 * page views, where they come from, what they browse with, and whether the shop
 * answered them cleanly. This is a DIFFERENT lens from the till: a visitor is not
 * a customer, and this route never pretends otherwise.
 *
 * Two honesty rules baked in:
 *   • Unique visitors are NOT summed across days (the same person on Monday and
 *     Tuesday is one person, not two). We report the daily series, the average
 *     per day and the peak — never a fake grand total.
 *   • The zone carries both the shop and the app's API. Zone-wide request counts
 *     therefore mix the two, so we also return the per-host split and let the UI
 *     name the shop's own share instead of quietly inflating it.
 *
 * Env-gated + ADMIN + read-only. Any unreadable source yields a calm locked
 * state, never an invented figure.
 */

import type { FastifyPluginAsync } from 'fastify';

import type { Env } from '../config/env.js';
import { requireRole } from '../lib/auth-policy.js';
import {
  type CfDayRow,
  cfZoneQuery,
  dayGroupsQuery,
  HOST_SPLIT_QUERY,
  utcDay,
  utcSince,
} from '../lib/cloudflare-analytics.js';

const WINDOW_DAYS = 7;
/** The zone refuses an adaptive window wider than one day; stay just inside it. */
const HOST_WINDOW_HOURS = 23;

const storefrontTrafficRoutes: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.get(
    '/api/storefront/traffic',
    { schema: { tags: ['storefront'], summary: 'Schaufenster: live edge reach of the shop (env-gated).' } },
    async (req) => {
      requireRole(req, 'ADMIN');

      const token = opts.env.CLOUDFLARE_API_TOKEN;
      const zone = opts.env.CLOUDFLARE_ZONE_ID;
      if (!token || !zone) return { configured: false as const };

      const d1 = utcDay(-(WINDOW_DAYS - 1));
      const d2 = utcDay(0);

      const [days, hostSplit] = await Promise.all([
        cfZoneQuery<{ httpRequests1dGroups: CfDayRow[] }>(token, dayGroupsQuery(true), { zone, d1, d2 }),
        cfZoneQuery<{
          httpRequestsAdaptiveGroups: Array<{ count: number; dimensions: { clientRequestHTTPHost: string } }>;
        }>(token, HOST_SPLIT_QUERY, { zone, since: utcSince(HOST_WINDOW_HOURS) }),
      ]);

      if (!days || !Array.isArray(days.httpRequests1dGroups)) {
        req.log.warn('storefront.traffic: Cloudflare zone analytics unavailable');
        return { configured: true as const, available: false as const };
      }

      const countryMap = new Map<string, number>();
      const browserMap = new Map<string, number>();
      const statusMap = new Map<number, number>();
      let pageViews = 0;
      let requests = 0;
      let bytes = 0;
      let threats = 0;
      let peak = 0;
      let peakDate: string | null = null;

      const daily = days.httpRequests1dGroups.map((r) => {
        const uniques = Number(r.uniq?.uniques) || 0;
        const pv = Number(r.sum.pageViews) || 0;
        const rq = Number(r.sum.requests) || 0;
        const by = Number(r.sum.bytes) || 0;
        pageViews += pv;
        requests += rq;
        bytes += by;
        threats += Number(r.sum.threats) || 0;
        if (uniques > peak) {
          peak = uniques;
          peakDate = r.dimensions.date;
        }
        for (const c of r.sum.countryMap ?? []) {
          countryMap.set(c.clientCountryName, (countryMap.get(c.clientCountryName) ?? 0) + (Number(c.requests) || 0));
        }
        for (const b of r.sum.browserMap ?? []) {
          browserMap.set(b.uaBrowserFamily, (browserMap.get(b.uaBrowserFamily) ?? 0) + (Number(b.pageViews) || 0));
        }
        for (const s of r.sum.responseStatusMap ?? []) {
          statusMap.set(s.edgeResponseStatus, (statusMap.get(s.edgeResponseStatus) ?? 0) + (Number(s.requests) || 0));
        }
        return { date: r.dimensions.date, uniques, pageViews: pv, requests: rq, bytes: by };
      });

      const dayCount = daily.length || 1;
      const uniquesSeen = daily.reduce((s, d) => s + d.uniques, 0);

      // Error share: everything the edge answered with 5xx over the window.
      let serverErrors = 0;
      let clientErrors = 0;
      for (const [status, n] of statusMap) {
        if (status >= 500) serverErrors += n;
        else if (status >= 400) clientErrors += n;
      }

      const top = <T>(m: Map<T, number>, key: string, limit: number): Array<Record<string, unknown>> =>
        Array.from(m, ([k, v]) => ({ [key]: k, count: v }))
          .sort((a, b) => (b['count'] as number) - (a['count'] as number))
          .slice(0, limit);

      return {
        configured: true as const,
        available: true as const,
        windowDays: WINDOW_DAYS,
        since: d1,
        until: d2,
        // Summable totals only. `uniques` deliberately absent — see the header.
        totals: { pageViews, requests, bytes, threats, serverErrors, clientErrors },
        visitors: { avgPerDay: Math.round(uniquesSeen / dayCount), peak, peakDate },
        daily,
        topCountries: top(countryMap, 'country', 8),
        browsers: top(browserMap, 'browser', 6),
        statuses: top(statusMap, 'status', 6),
        hosts:
          hostSplit?.httpRequestsAdaptiveGroups?.map((h) => ({
            host: h.dimensions.clientRequestHTTPHost,
            requests: Number(h.count) || 0,
          })) ?? [],
        hostWindowHours: HOST_WINDOW_HOURS,
      };
    },
  );
};

export default storefrontTrafficRoutes;
