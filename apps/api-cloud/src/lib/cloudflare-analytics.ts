/**
 * Cloudflare zone-analytics reader (GraphQL) — the one place we talk to the edge.
 *
 * Plan reality, verified live against the warehouse14.de zone on 2026-07-17:
 *   • `httpRequests1dGroups`      → WORKS. Daily rollup: requests, pageViews,
 *     uniques, bytes, threats, plus country/browser/status maps.
 *   • `httpRequestsAdaptiveGroups`→ WORKS, but the zone refuses any window wider
 *     than 1 day. We ask for 23 h to stay inside it. Gives per-host splits.
 *   • `firewallEventsAdaptiveGroups` → REFUSED ("zone does not have access to the
 *     path"). That is a PLAN limit, not a token limit — a stronger token cannot
 *     unlock it. So the threat figures come from `sum.threats` above instead.
 *
 * Everything is read-only and needs one token permission: Zone · Analytics · Read.
 * Any failure returns null so the caller can render an honest locked state rather
 * than invent a number.
 */

const CF_GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';

/** POST a zone-scoped query and return `viewer.zones[0]`, or null on any failure. */
export async function cfZoneQuery<T>(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T | null> {
  try {
    const res = await fetch(CF_GRAPHQL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as {
      data?: { viewer?: { zones?: T[] } };
      errors?: unknown[] | null;
    } | null;
    if (!json || (Array.isArray(json.errors) && json.errors.length > 0)) return null;
    return json.data?.viewer?.zones?.[0] ?? null;
  } catch {
    return null;
  }
}

/** A UTC calendar day (YYYY-MM-DD), `offsetDays` from today (negative = past). */
export function utcDay(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** An ISO instant `hours` ago — used for the adaptive dataset's 1-day ceiling. */
export function utcSince(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

// ── shared row shapes ────────────────────────────────────────────────────────

export interface CfCountry {
  clientCountryName: string;
  requests: number;
  threats: number;
}
export interface CfDayRow {
  dimensions: { date: string };
  uniq?: { uniques: number };
  sum: {
    requests: number;
    pageViews: number;
    bytes: number;
    threats: number;
    countryMap?: CfCountry[];
    browserMap?: Array<{ uaBrowserFamily: string; pageViews: number }>;
    responseStatusMap?: Array<{ edgeResponseStatus: number; requests: number }>;
  };
}

/** The daily rollup query. `maps` adds the country/browser/status breakdowns. */
export function dayGroupsQuery(maps: boolean): string {
  const mapFields = maps
    ? ' countryMap { clientCountryName requests threats } browserMap { uaBrowserFamily pageViews } responseStatusMap { edgeResponseStatus requests }'
    : '';
  return `query($zone: String!, $d1: Date!, $d2: Date!) {
    viewer { zones(filter: { zoneTag: $zone }) {
      httpRequests1dGroups(filter: { date_geq: $d1, date_leq: $d2 }, limit: 31, orderBy: [date_ASC]) {
        dimensions { date }
        uniq { uniques }
        sum { requests pageViews bytes threats${mapFields} }
      }
    } }
  }`;
}

/** Per-host request split. The zone caps the adaptive window at one day. */
export const HOST_SPLIT_QUERY = `query($zone: String!, $since: Time!) {
  viewer { zones(filter: { zoneTag: $zone }) {
    httpRequestsAdaptiveGroups(filter: { datetime_geq: $since }, limit: 10, orderBy: [count_DESC]) {
      count
      dimensions { clientRequestHTTPHost }
    }
  } }
}`;
