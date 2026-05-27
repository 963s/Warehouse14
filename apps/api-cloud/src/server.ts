/**
 * Production / dev entrypoint.
 *
 * The script reads `.env`/`.env.local` (Node 20.6+ has --env-file flag; we
 * leave that to the launcher in package.json `start`/`dev`).
 *
 * `close-with-grace` listens on SIGTERM / SIGINT and gives in-flight requests
 * up to 10s to finish before the process exits. This is the difference
 * between "container restart loses one transaction mid-write" and "container
 * restart is invisible to the user".
 */

import closeWithGrace from 'close-with-grace';

import { buildApp } from './app.js';
import { assertAppRoleInDatabaseUrl, loadEnv } from './config/env.js';

async function main(): Promise<void> {
  const env = loadEnv();

  // Day 16 audit fix A-2: refuse to start if DATABASE_URL points at a role
  // other than warehouse14_app. Belt-and-braces against misconfiguration.
  assertAppRoleInDatabaseUrl(env);

  const app = await buildApp({ env });

  closeWithGrace({ delay: 10_000 }, async ({ signal, err }) => {
    if (err) {
      app.log.error({ err }, 'close-with-grace received error — shutting down');
    } else {
      app.log.info({ signal }, 'graceful shutdown initiated');
    }
    await app.close();
  });

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error({ err }, 'failed to start');
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  // The logger may not be alive yet — fall back to stderr.
  // eslint-disable-next-line no-console
  console.error('fatal boot error:', err);
  process.exit(1);
});
