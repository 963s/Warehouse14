/**
 * WhatsApp Cloud API webhook receiver (Day 21).
 *
 *   GET /api/webhooks/whatsapp  — Meta subscription handshake.
 *     Meta sends `hub.mode=subscribe`, `hub.verify_token=<our token>`,
 *     `hub.challenge=<random>`. We echo `hub.challenge` if the token matches.
 *
 *   POST /api/webhooks/whatsapp — Meta delivers inbound messages.
 *     Verifies `X-Hub-Signature-256: sha256=<hex>` against the raw request
 *     body using `WHATSAPP_APP_SECRET`. Inserts one row per `messages[*].id`
 *     into `whatsapp_inbound_messages` for the AI Intake worker to consume.
 *
 * V1 just stores. Phase-1.5 worker reads + dispatches to ai-gateway.
 */

import { Type } from '@sinclair/typebox';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { whatsappInboundMessages } from '@warehouse14/db/schema';

import type { Env } from '../config/env.js';
import { DomainError, type ApiErrorCode } from '../plugins/error-handler.js';

class WhatsAppBadSignatureError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}
class WhatsAppConfigError extends DomainError {
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

const WebhookAck = Type.Object({ received: Type.Boolean(), stored: Type.Integer() });

interface WhatsAppEntry {
  changes?: Array<{
    value?: {
      messages?: Array<{
        id?: string;
        from?: string;
        type?: string;
      }>;
    };
  }>;
}

export interface WhatsAppWebhookOpts {
  env: Env;
}

/** Constant-time verify the Meta X-Hub-Signature-256 header. */
function verifySignature(rawBody: string, header: string, secret: string): boolean {
  // Header format: `sha256=<hex>`.
  if (!header.startsWith('sha256=')) return false;
  const candidate = header.slice('sha256='.length).trim();
  if (!/^[0-9a-f]+$/i.test(candidate)) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  if (expected.length !== candidate.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(candidate, 'hex'));
  } catch {
    return false;
  }
}

const whatsappWebhookRoutes: FastifyPluginAsync<WhatsAppWebhookOpts> = async (app, opts) => {
  /**
   * Per-route raw-body parser. We already register a global raw-body parser
   * for the Stripe webhook on `application/json`; that parser returns the
   * raw string, which is what WhatsApp needs too. No additional registration
   * required here — both webhook paths benefit from the same parser.
   */

  // ════════════════════════════════════════════════════════════════════
  // GET — Meta subscription handshake
  // ════════════════════════════════════════════════════════════════════

  app.get<{
    Querystring: {
      'hub.mode'?: string;
      'hub.verify_token'?: string;
      'hub.challenge'?: string;
    };
  }>('/api/webhooks/whatsapp', {
    schema: {
      tags: ['webhooks'],
      summary: 'Meta subscription handshake for the WhatsApp webhook.',
      querystring: Type.Object({
        'hub.mode': Type.Optional(Type.String()),
        'hub.verify_token': Type.Optional(Type.String()),
        'hub.challenge': Type.Optional(Type.String()),
      }),
    },
  }, async (req, reply) => {
    if (!opts.env.WHATSAPP_VERIFY_TOKEN) {
      throw new WhatsAppConfigError('WhatsApp verify token not configured.');
    }
    const q = req.query;
    if (
      q['hub.mode'] === 'subscribe' &&
      q['hub.verify_token'] === opts.env.WHATSAPP_VERIFY_TOKEN &&
      typeof q['hub.challenge'] === 'string'
    ) {
      reply.type('text/plain');
      return reply.send(q['hub.challenge']);
    }
    return reply.status(403).send({
      error: { code: 'FORBIDDEN', message: 'verify token mismatch', requestId: req.id },
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // POST — message delivery
  // ════════════════════════════════════════════════════════════════════

  app.post('/api/webhooks/whatsapp', {
    schema: {
      tags: ['webhooks'],
      summary: 'WhatsApp Cloud API inbound — signature-verified + idempotent.',
      response: { 200: WebhookAck, 400: ErrorResponse, 500: ErrorResponse },
    },
  }, async (req, reply) => {
    if (!opts.env.WHATSAPP_APP_SECRET) {
      throw new WhatsAppConfigError('WhatsApp app secret not configured.');
    }

    const rawBody = typeof req.body === 'string' ? req.body : '';
    const sigHeader = req.headers['x-hub-signature-256'];
    if (typeof sigHeader !== 'string') {
      throw new WhatsAppBadSignatureError('Missing X-Hub-Signature-256.');
    }
    if (!verifySignature(rawBody, sigHeader, opts.env.WHATSAPP_APP_SECRET)) {
      req.log.warn({ headerPrefix: sigHeader.slice(0, 16) }, 'whatsapp webhook: signature rejected');
      throw new WhatsAppBadSignatureError('Signature mismatch.');
    }

    let parsed: { entry?: WhatsAppEntry[] };
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new WhatsAppBadSignatureError('Verified signature but body is not JSON.');
    }

    let stored = 0;
    const entries = parsed.entry ?? [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.messages) continue;
        for (const msg of value.messages) {
          if (!msg.id) continue;
          try {
            await app.db.insert(whatsappInboundMessages).values({
              metaMessageId: msg.id,
              fromPhone: msg.from ?? '',
              messageType: msg.type ?? 'unknown',
              rawPayload: msg as unknown,
              signatureVerified: true,
            });
            stored++;
          } catch (err) {
            // UNIQUE on meta_message_id means Meta retried this delivery.
            // Idempotent: no-op, count as not stored.
            const msgText = (err as Error).message ?? '';
            if (!msgText.includes('whatsapp_inbound_meta_id_uq')) {
              req.log.error({ err }, 'whatsapp webhook: insert failed');
              throw err;
            }
          }
        }
      }
    }

    // Mark the rows we just stored as not-yet-processed (workers will pick up).
    // The worker reads `WHERE processed_at IS NULL`.
    void drizzleSql; // keep import used in case of future raw SQL needs

    return reply.status(200).send({ received: true, stored });
  });
};

export default whatsappWebhookRoutes;
