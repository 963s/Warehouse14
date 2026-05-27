/**
 * `apps/worker` entrypoint.
 *
 * Boot sequence:
 *   1. loadEnv() + assertWorkerRoleInDatabaseUrl (refuses non-worker URLs).
 *   2. buildWorker() — opens DB pool, registers all jobs.
 *   3. httpServer.listen on METRICS_PORT (bound to 127.0.0.1 only).
 *   4. runner.startSchedules() — cron jobs begin firing.
 *   5. close-with-grace: on SIGTERM/SIGINT, runner.close() → graceful drain.
 */

import closeWithGrace from 'close-with-grace';

import { buildWorker } from './app.js';
import { assertWorkerRoleInDatabaseUrl, loadEnv } from './config/env.js';

async function main(): Promise<void> {
  const env = loadEnv();
  assertWorkerRoleInDatabaseUrl(env);

  const worker = await buildWorker({ env });

  closeWithGrace({ delay: 30_000 }, async ({ signal, err }) => {
    if (err) {
      worker.httpServer.log.error({ err }, 'close-with-grace received error');
    } else {
      worker.httpServer.log.info({ signal }, 'graceful shutdown initiated');
    }
    await worker.close();
  });

  // Bind to localhost only — Prometheus scrape happens from within the VM.
  await worker.httpServer.listen({ port: env.METRICS_PORT, host: '127.0.0.1' });
  worker.httpServer.log.info({ port: env.METRICS_PORT }, 'worker metrics HTTP server listening');

  await worker.runner.startSchedules();
  worker.httpServer.log.info('worker cron schedules started');
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('fatal worker boot error:', err);
  process.exit(1);
});
