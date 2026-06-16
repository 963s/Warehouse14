/**
 * Bot-dispatch plugin — decorates the Fastify instance with `botDispatch`, the
 * bounded concurrency gate that the webhook entrypoints push detached bot turns
 * onto (Phase-2 P1.1). See `../lib/bot-dispatch.ts` for the rationale.
 *
 * Registered AFTER the pii plugin (it needs nothing from request context) and
 * BEFORE the routes that use it. The server's graceful-shutdown hook should
 * `await app.botDispatch.drain()` so in-flight bot turns finish on SIGTERM.
 */

import type { FastifyPluginAsync } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import type { Env } from '../config/env.js';
import { BoundedDispatcher } from '../lib/bot-dispatch.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Bounded in-process dispatcher for detached bot-orchestrator turns. */
    botDispatch: BoundedDispatcher;
  }
}

interface BotDispatchOptions {
  env: Env;
}

const botDispatchPlugin: FastifyPluginAsync<BotDispatchOptions> = async (app, opts) => {
  const dispatcher = new BoundedDispatcher(opts.env.BOT_MAX_CONCURRENT, {
    warn: (obj, msg) => app.log.warn(obj, msg),
    error: (obj, msg) => app.log.error(obj, msg),
  });
  app.decorate('botDispatch', dispatcher);

  // Drain in-flight bot turns on shutdown so a deploy doesn't drop them.
  app.addHook('onClose', async () => {
    await dispatcher.drain();
  });
};

export default fastifyPlugin(botDispatchPlugin, {
  name: 'warehouse14-bot-dispatch',
  fastify: '4.x',
  dependencies: ['warehouse14-pii'],
});
