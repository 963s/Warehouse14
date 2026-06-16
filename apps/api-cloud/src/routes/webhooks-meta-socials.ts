/**
 * Meta socials webhook (Decision #48) — Instagram DMs + Facebook Messenger.
 *
 *   GET  /api/webhooks/meta-socials — Meta subscription handshake.
 *   POST /api/webhooks/meta-socials — signature-verified inbound. Maps each
 *        event to a UnifiedInboundMessage and fires the shared bot orchestrator
 *        (runSocialBot) fire-and-forget, then acks Meta with 200.
 *
 * Same Meta App as WhatsApp → the App Secret is shared (META_APP_SECRET, or
 * WHATSAPP_APP_SECRET as fallback). We register a string content-type parser in
 * THIS plugin scope so the HMAC is verified against the exact raw bytes.
 */

import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import type { Env } from '../config/env.js';
import { verifyMetaSignature } from '../lib/meta-signature.js';
import { currentPiiKey } from '../lib/request-context.js';
import { extractSocialMessages } from '../lib/social-adapter.js';
import { runSocialBot } from '../lib/social-bot-runner.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class SocialsBadSignatureError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}
class SocialsConfigError extends DomainError {
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
const WebhookAck = Type.Object({ received: Type.Boolean(), accepted: Type.Integer() });

export interface MetaSocialsOpts {
  env: Env;
}

const metaSocialsRoutes: FastifyPluginAsync<MetaSocialsOpts> = async (app, opts) => {
  const appSecret = opts.env.META_APP_SECRET || opts.env.WHATSAPP_APP_SECRET;
  const verifyToken = opts.env.META_SOCIALS_VERIFY_TOKEN || opts.env.WHATSAPP_VERIFY_TOKEN;

  // Raw string body for this plugin scope → exact bytes for HMAC verification.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    function rawJsonParser(_req, body, done) {
      done(null, body);
    },
  );

  // ── GET handshake ────────────────────────────────────────────────────────
  app.get<{
    Querystring: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string };
  }>(
    '/api/webhooks/meta-socials',
    {
      schema: {
        tags: ['webhooks'],
        summary: 'Meta subscription handshake for the Instagram/Messenger webhook.',
        querystring: Type.Object({
          'hub.mode': Type.Optional(Type.String()),
          'hub.verify_token': Type.Optional(Type.String()),
          'hub.challenge': Type.Optional(Type.String()),
        }),
      },
    },
    async (req, reply) => {
      if (!verifyToken) throw new SocialsConfigError('Meta socials verify token not configured.');
      const q = req.query;
      if (
        q['hub.mode'] === 'subscribe' &&
        q['hub.verify_token'] === verifyToken &&
        typeof q['hub.challenge'] === 'string'
      ) {
        reply.type('text/plain');
        return reply.send(q['hub.challenge']);
      }
      return reply.status(403).send({
        error: { code: 'FORBIDDEN', message: 'verify token mismatch', requestId: req.id },
      });
    },
  );

  // ── POST inbound ───────────────────────────────────────────────────────
  app.post(
    '/api/webhooks/meta-socials',
    {
      schema: {
        tags: ['webhooks'],
        summary: 'Instagram/Messenger inbound — signature-verified, routes to the shared bot.',
        response: { 200: WebhookAck, 400: ErrorResponse, 500: ErrorResponse },
      },
    },
    async (req, reply) => {
      if (!appSecret) throw new SocialsConfigError('Meta app secret not configured.');
      const rawBody = typeof req.body === 'string' ? req.body : '';
      const sigHeader = req.headers['x-hub-signature-256'];
      if (typeof sigHeader !== 'string') {
        throw new SocialsBadSignatureError('Missing X-Hub-Signature-256.');
      }
      if (!verifyMetaSignature(rawBody, sigHeader, appSecret)) {
        req.log.warn(
          { headerPrefix: sigHeader.slice(0, 16) },
          'meta-socials webhook: signature rejected',
        );
        throw new SocialsBadSignatureError('Signature mismatch.');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        throw new SocialsBadSignatureError('Verified signature but body is not JSON.');
      }

      const messages = extractSocialMessages(parsed);
      // Dispatch the shared bot orchestrator per inbound through the bounded
      // gate (Phase-2 P1.1): concurrency-capped + a guaranteed top-level catch
      // (this path had NONE before). The PII key is captured in-scope and
      // passed explicitly into the detached runner.
      const piiKey = currentPiiKey();
      for (const msg of messages) {
        app.botDispatch.run(() => runSocialBot(app, opts.env, msg, piiKey));
      }

      return reply.status(200).send({ received: true, accepted: messages.length });
    },
  );
};

export default metaSocialsRoutes;
