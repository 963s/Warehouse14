/**
 * Chatwoot Agent Bot webhook (Decision #48) — the omnichannel edge.
 *
 *   POST /api/webhooks/chatwoot — signature-verified Chatwoot events. Routes:
 *     • message_created (incoming) → run the shared bot orchestrator
 *       (runWhatsAppBot) and POST the reply back into Chatwoot;
 *     • conversation_status_changed → open → human takeover: pause the AI
 *       (whatsapp_conversations.ai_active = false, cooldown_until = now()+12h).
 *
 * No custom inbox/schema: Chatwoot owns the dashboard; this is only the wire.
 * A string content-type parser is registered in THIS plugin scope so the HMAC
 * is verified against the exact raw bytes (via the shared verifyMetaSignature).
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Env } from '../config/env.js';
import {
  type TakeoverExecutor,
  applyHumanTakeover,
  planChatwootEvent,
  postChatwootReply,
} from '../lib/chatwoot.js';
import { verifyMetaSignature } from '../lib/meta-signature.js';
import { runWhatsAppBot } from '../lib/whatsapp-bot-runner.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class ChatwootBadSignatureError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}
class ChatwootConfigError extends DomainError {
  public readonly httpStatus = 500;
  public readonly code: ApiErrorCode = 'INTERNAL_ERROR';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});
const WebhookAck = Type.Object({ received: Type.Boolean(), action: Type.String() });

export interface ChatwootWebhookOpts {
  env: Env;
}

const chatwootWebhookRoutes: FastifyPluginAsync<ChatwootWebhookOpts> = async (app, opts) => {
  // Raw string body for this plugin scope → exact bytes for HMAC verification.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    function rawJsonParser(_req, body, done) {
      done(null, body);
    },
  );

  // The real whatsapp_conversations UPSERT behind the takeover applier.
  const takeoverExec: TakeoverExecutor = {
    setTakeover: async ({ conversationKey, cooldownUntil }) => {
      await app.db.execute(sql`
        INSERT INTO whatsapp_conversations (customer_phone_e164, ai_active, cooldown_until)
        VALUES (${conversationKey}, FALSE, ${cooldownUntil.toISOString()}::timestamptz)
        ON CONFLICT (customer_phone_e164)
        DO UPDATE SET ai_active = FALSE, cooldown_until = ${cooldownUntil.toISOString()}::timestamptz
      `);
    },
  };

  app.post(
    '/api/webhooks/chatwoot',
    {
      schema: {
        tags: ['webhooks'],
        summary: 'Chatwoot Agent Bot inbound — signature-verified; bot reply + human takeover.',
        response: { 200: WebhookAck, 400: ErrorResponse, 500: ErrorResponse },
      },
    },
    async (req, reply) => {
      if (!opts.env.CHATWOOT_WEBHOOK_SECRET) {
        throw new ChatwootConfigError('Chatwoot webhook secret not configured.');
      }
      const rawBody = typeof req.body === 'string' ? req.body : '';
      const sigHeader = req.headers['x-hub-signature-256'];
      if (typeof sigHeader !== 'string') {
        throw new ChatwootBadSignatureError('Missing X-Hub-Signature-256.');
      }
      if (!verifyMetaSignature(rawBody, sigHeader, opts.env.CHATWOOT_WEBHOOK_SECRET)) {
        req.log.warn(
          { headerPrefix: sigHeader.slice(0, 16) },
          'chatwoot webhook: signature rejected',
        );
        throw new ChatwootBadSignatureError('Signature mismatch.');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        throw new ChatwootBadSignatureError('Verified signature but body is not JSON.');
      }

      const action = planChatwootEvent(parsed);

      if (action.kind === 'run_bot') {
        // Detached: ack Chatwoot fast, then run the shared orchestrator and post
        // the reply back into the conversation. Started inside the request scope
        // so the bot's withPii() calls inherit the PII key.
        void (async () => {
          try {
            const replyText = await runWhatsAppBot(app, opts.env, {
              fromPhone: action.conversationKey,
              body: action.text,
            });
            if (replyText) {
              await postChatwootReply(opts.env, action.conversationId, replyText);
            }
          } catch (err) {
            req.log.error(
              { err, conversationId: action.conversationId },
              'chatwoot bot run failed',
            );
          }
        })();
      } else if (action.kind === 'human_takeover') {
        await applyHumanTakeover(takeoverExec, action.conversationKey);
        req.log.info(
          { conversationId: action.conversationId },
          'chatwoot: human takeover — AI paused 12h',
        );
      }

      return reply.status(200).send({ received: true, action: action.kind });
    },
  );
};

export default chatwootWebhookRoutes;
