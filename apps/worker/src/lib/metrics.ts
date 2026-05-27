/**
 * Worker Prometheus metrics — process-level Registry that the
 * Fastify `/metrics` route serves. The `fastify-metrics` plugin used by
 * the API exposes its own Registry; the worker maintains its OWN registry
 * so the worker process can be scraped independently from the API.
 *
 * Pino logs carry the same labels (jobName, runId) for log↔metric correlation.
 */

import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export interface WorkerMetrics {
  registry: Registry;
  runsTotal: Counter<'job' | 'status'>;
  durationSeconds: Histogram<'job'>;
  consecutiveFailures: Gauge<'job'>;
  dlqDepth: Gauge<'job'>;
  workerUp: Gauge;
}

export function createMetrics(): WorkerMetrics {
  const registry = new Registry();
  registry.setDefaultLabels({ app: 'warehouse14_worker' });

  // Node.js process metrics (event-loop lag, heap, GC pauses, etc.).
  collectDefaultMetrics({ register: registry });

  const runsTotal = new Counter({
    name: 'worker_job_runs_total',
    help: 'Total number of job attempts by terminal status.',
    labelNames: ['job', 'status'],
    registers: [registry],
  });

  const durationSeconds = new Histogram({
    name: 'worker_job_duration_seconds',
    help: 'Wall-clock duration of completed job attempts.',
    labelNames: ['job'],
    // 50 ms → 10 min, dense around 1–60 s where most jobs land.
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300, 600],
    registers: [registry],
  });

  const consecutiveFailures = new Gauge({
    name: 'worker_job_failures_consecutive',
    help: 'Current consecutive-failure count per job (resets to 0 on success).',
    labelNames: ['job'],
    registers: [registry],
  });

  const dlqDepth = new Gauge({
    name: 'worker_job_dlq_depth',
    help: 'Unacked rows in worker_job_dlq, refreshed periodically.',
    labelNames: ['job'],
    registers: [registry],
  });

  const workerUp = new Gauge({
    name: 'worker_up',
    help: 'Liveness signal — 1 while runner accepts ticks, 0 during graceful shutdown.',
    registers: [registry],
  });
  workerUp.set(1);

  return { registry, runsTotal, durationSeconds, consecutiveFailures, dlqDepth, workerUp };
}
