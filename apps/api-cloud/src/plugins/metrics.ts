/**
 * Prometheus metrics — added to Day 11 per Basel's directive.
 *
 * `fastify-metrics` (community-maintained, official-blessed) wraps
 * `prom-client`. Out of the box we get:
 *   • HTTP request duration histogram (`http_request_duration_seconds`)
 *   • HTTP request counter (`http_request_summary_seconds`)
 *   • Node.js process metrics (event-loop lag, heap, GC pauses)
 *
 * Exposed at `/metrics` as `text/plain; version=0.0.4` (Prom default scrape
 * format). The endpoint is intentionally NOT under `/api` — Prometheus scrape
 * paths conventionally live at the root.
 *
 * Future custom counters (ledger events emitted, sanctions blocks fired, etc.)
 * will live here as `app.metrics.client.Counter` registrations.
 */

import type { FastifyPluginAsync } from 'fastify';
import fastifyMetrics from 'fastify-metrics';
import fastifyPlugin from 'fastify-plugin';

const metricsPlugin: FastifyPluginAsync = async (app) => {
  await app.register(fastifyMetrics, {
    endpoint: '/metrics',
    routeMetrics: {
      enabled: true,
      registeredRoutesOnly: true, // do not blow cardinality on 404s
      groupStatusCodes: false, // keep 200/201/204 distinct from 4xx/5xx
    },
    defaultMetrics: { enabled: true },
  });
};

export default fastifyPlugin(metricsPlugin, {
  name: 'warehouse14-metrics',
  fastify: '4.x',
});
