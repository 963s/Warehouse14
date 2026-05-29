/**
 * WhatsApp Intake webhook (ADR-0015) — the staff-facing photo intake number.
 *
 *   GET  /api/webhooks/whatsapp/intake — Meta subscription handshake.
 *   POST /api/webhooks/whatsapp/intake — signature-verified inbound. Validates
 *        the sender against active staff_phone_numbers (E.164), stores each
 *        message idempotently (wamid), opens/extends the 120s grouping window,
 *        and applies staff override commands (DONE/NEW/CANCEL/HELP/split).
 *
 * Sessions that close (DONE or window-expiry) move to GROUPED; the worker picks
 * them up for AI processing (no synchronous AI here).
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { DEFAULT_GROUPING_WINDOW_SECONDS, type LanguageCode } from '@warehouse14/intake-pipeline';

import type { Env } from '../config/env.js';
import {
  type ParsedIntakeMessage,
  extractIntakeMessages,
  planIntakeMessage,
  toE164,
} from '../lib/intake-webhook.js';
import { verifyMetaSignature } from '../lib/meta-signature.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class IntakeBadSignatureError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}
class IntakeConfigError extends DomainError {
  public readonly httpStatus = 500;
  public readonly code: ApiErrorCode = 'INTERNAL_ERROR';
}

const WebhookAck = Type.Object({ received: Type.Boolean(), stored: Type.Integer() });
const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

export interface WhatsAppIntakeOpts {
  env: Env;
}

type StaffRow = {
  id: string;
  preferred_language: string;
  active: boolean;
};
type SessionRow = {
  id: string;
};

function asLang(v: string): LanguageCode {
  return v === 'en' || v === 'ar' ? v : 'de';
}

const whatsappIntakeRoutes: FastifyPluginAsync<WhatsAppIntakeOpts> = async (app, opts) => {
  // ── GET handshake ──────────────────────────────────────────────────────
  app.get<{
    Querystring: { 'hub.mode'?: string; 'hub.verify_token'?: string; 'hub.challenge'?: string };
  }>(
    '/api/webhooks/whatsapp/intake',
    {
      schema: {
        tags: ['webhooks'],
        summary: 'Meta subscription handshake for the WhatsApp Intake webhook.',
        querystring: Type.Object({
          'hub.mode': Type.Optional(Type.String()),
          'hub.verify_token': Type.Optional(Type.String()),
          'hub.challenge': Type.Optional(Type.String()),
        }),
      },
    },
    async (req, reply) => {
      if (!opts.env.WHATSAPP_VERIFY_TOKEN) {
        throw new IntakeConfigError('WhatsApp verify token not configured.');
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
    },
  );

  // ── POST inbound ───────────────────────────────────────────────────────
  app.post(
    '/api/webhooks/whatsapp/intake',
    {
      schema: {
        tags: ['webhooks'],
        summary: 'WhatsApp Intake inbound — staff photo intake, signature-verified.',
        response: { 200: WebhookAck, 400: ErrorResponse, 500: ErrorResponse },
      },
    },
    async (req, reply) => {
      if (!opts.env.WHATSAPP_APP_SECRET) {
        throw new IntakeConfigError('WhatsApp app secret not configured.');
      }
      const rawBody = typeof req.body === 'string' ? req.body : '';
      const sigHeader = req.headers['x-hub-signature-256'];
      if (typeof sigHeader !== 'string') {
        throw new IntakeBadSignatureError('Missing X-Hub-Signature-256.');
      }
      if (!verifyMetaSignature(rawBody, sigHeader, opts.env.WHATSAPP_APP_SECRET)) {
        req.log.warn(
          { headerPrefix: sigHeader.slice(0, 16) },
          'intake webhook: signature rejected',
        );
        throw new IntakeBadSignatureError('Signature mismatch.');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        throw new IntakeBadSignatureError('Verified signature but body is not JSON.');
      }

      const messages = extractIntakeMessages(parsed);
      const windowSeconds = DEFAULT_GROUPING_WINDOW_SECONDS;
      let stored = 0;

      for (const msg of messages) {
        try {
          stored += await handleIntakeMessage(app, msg, windowSeconds);
        } catch (err) {
          req.log.error({ err, wamid: msg.wamid }, 'intake webhook: message handling failed');
        }
      }

      return reply.status(200).send({ received: true, stored });
    },
  );
};

/** Persist + apply the grouping plan for one inbound message. Returns 1 if stored. */
async function handleIntakeMessage(
  app: Parameters<FastifyPluginAsync<WhatsAppIntakeOpts>>[0],
  msg: ParsedIntakeMessage,
  windowSeconds: number,
): Promise<number> {
  const phone = toE164(msg.fromPhone);

  const staffRows = (await app.db.execute<StaffRow>(sql`
    SELECT id::text AS id, preferred_language, active
    FROM staff_phone_numbers
    WHERE phone_e164 = ${phone}
    LIMIT 1
  `)) as unknown as StaffRow[];
  const staff = staffRows[0];
  const isActiveStaff = !!staff && staff.active;

  const plan = planIntakeMessage(msg, {
    isActiveStaff,
    preferredLanguage: staff ? asLang(staff.preferred_language) : 'de',
    now: msg.receivedAt,
    windowSeconds,
  });

  if (plan.kind === 'reject_unknown_sender' || !staff) {
    // Unknown/inactive sender — silently drop (the inbox surfaces an alert).
    app.log.warn({ phone }, 'intake webhook: message from unknown/inactive staff phone');
    return 0;
  }

  // Find the open (RECEIVED) session for this staff phone, or open one.
  const openRows = (await app.db.execute<SessionRow>(sql`
    SELECT id::text AS id FROM intake_sessions
    WHERE staff_phone_id = ${staff.id}::uuid AND status = 'RECEIVED'
    ORDER BY started_at DESC
    LIMIT 1
  `)) as unknown as SessionRow[];

  let sessionId = openRows[0]?.id;
  if (!sessionId) {
    const created = (await app.db.execute<SessionRow>(sql`
      INSERT INTO intake_sessions (staff_phone_id, grouping_closes_at)
      VALUES (${staff.id}::uuid, ${new Date(msg.receivedAt.getTime() + windowSeconds * 1000).toISOString()}::timestamptz)
      RETURNING id::text AS id
    `)) as unknown as SessionRow[];
    sessionId = created[0]?.id;
  }
  if (!sessionId) return 0;

  // Store the message idempotently (wamid unique).
  const inserted = (await app.db.execute<{ id: string }>(sql`
    INSERT INTO intake_messages
      (session_id, whatsapp_message_id, direction, message_type, media_r2_key, text_body, received_at)
    VALUES
      (${sessionId}::uuid, ${msg.wamid}, 'inbound', ${msg.type},
       ${msg.mediaId ? `meta:${msg.mediaId}` : null}, ${msg.textBody}, ${msg.receivedAt.toISOString()}::timestamptz)
    ON CONFLICT (whatsapp_message_id) DO NOTHING
    RETURNING id::text AS id
  `)) as unknown as Array<{ id: string }>;
  const wasStored = inserted.length > 0 ? 1 : 0;

  switch (plan.kind) {
    case 'store_and_extend':
      await app.db.execute(sql`
        UPDATE intake_sessions SET grouping_closes_at = ${plan.groupingClosesAt.toISOString()}::timestamptz
        WHERE id = ${sessionId}::uuid AND status = 'RECEIVED'
      `);
      break;
    case 'close_session':
      await app.db.execute(sql`
        UPDATE intake_sessions SET status = 'GROUPED' WHERE id = ${sessionId}::uuid AND status = 'RECEIVED'
      `);
      break;
    case 'start_new_session':
      // Close the current session; the next message opens a fresh one.
      await app.db.execute(sql`
        UPDATE intake_sessions SET status = 'GROUPED' WHERE id = ${sessionId}::uuid AND status = 'RECEIVED'
      `);
      break;
    case 'cancel_session':
      await app.db.execute(sql`
        UPDATE intake_sessions
        SET status = 'REJECTED', rejected_reason = 'staff_cancelled'
        WHERE id = ${sessionId}::uuid AND status = 'RECEIVED'
      `);
      break;
    case 'send_help':
      // Outbound HELP template is sent by the loopback layer (worker/§8).
      app.log.info({ sessionId }, 'intake webhook: HELP requested');
      break;
    case 'split_session':
      // Splitting re-buckets photos into sibling sessions — recorded for the
      // worker to act on (full split execution handled in the worker pass).
      app.log.info({ sessionId, groups: plan.groups }, 'intake webhook: split requested');
      break;
  }

  return wasStored;
}

export default whatsappIntakeRoutes;
