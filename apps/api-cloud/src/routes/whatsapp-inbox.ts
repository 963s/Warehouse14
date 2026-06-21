/**
 * WhatsApp Inbox routes (Phase 2 Day 9) — operator-facing layer over
 * the Day-21 webhook receiver.
 *
 *   GET   /api/whatsapp/threads               — list conversations (grouped by phone)
 *   GET   /api/whatsapp/threads/:phone        — interleaved inbound + outbound timeline
 *   POST  /api/whatsapp/send                  — send (or queue) an outbound reply
 *   PATCH /api/whatsapp/messages/:id/handled         — mark inbound as triaged
 *   PATCH /api/whatsapp/messages/:id/link-customer   — attach a known customer
 *
 * All routes are ADMIN-only. CASHIER does not need WhatsApp surface in V1.
 *
 * The Send route hits Meta Cloud API
 *   POST https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages
 * with a 10-second timeout. On any failure (HTTP non-2xx, abort, network),
 * the operator sees `EXTERNAL_SERVICE_FAILED` ("WhatsApp-Anbieter hat
 * abgelehnt") — NEVER the raw provider_error payload (audit-log only).
 *
 * IMPLEMENTATION NOTE
 * ───────────────────
 * This file uses raw `sql` parameterised queries rather than the
 * Drizzle query-builder for the read paths. The mix of bigserial PKs +
 * uuid PKs + custom WITH clauses tripped the cross-realm drizzle type
 * checker; raw SQL is type-safe (every value is a bound parameter, never
 * string-interpolated) and far easier to audit.
 */

import { type Static, Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Env } from '../config/env.js';

/**
 * Mirror of `WHATSAPP_OUTBOUND_STATUSES` from `@warehouse14/db/schema`.
 *
 * Re-declared here on purpose — importing the table symbols from the db
 * package transitively pulls in the dist `drizzle-orm/pg-core` types from
 * a different pnpm realm than the api-cloud's own drizzle-orm install,
 * which trips `SQL<unknown>` vs `SQLWrapper` cross-realm errors on every
 * `app.db.execute(sql\`...\`)` call in this file. The DB CHECK constraint
 * remains the source of truth; this local list must stay in sync.
 */
const WHATSAPP_OUTBOUND_STATUSES = ['queued', 'sent', 'delivered', 'read', 'failed'] as const;
type WhatsAppOutboundStatus = (typeof WHATSAPP_OUTBOUND_STATUSES)[number];
import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { MetaApiError, type MetaSendArgs, sendToMeta } from '../lib/meta-whatsapp.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

/**
 * Canonical thread key for a phone number: DIGITS ONLY, no leading '+'.
 *
 * This MUST match the form the inbound webhook stores. Meta delivers the
 * sender's wa_id WITHOUT a '+' (e.g. '491701234567'), and `webhooks-whatsapp.ts`
 * writes `from_phone = msg.from` verbatim — so the entire inbound corpus, the
 * `whatsapp_conversations.customer_phone_e164` rows, the bot-runner replies and
 * the booking auto-replies are all keyed on the no-'+' form. The thread-list SQL
 * groups by that key. If the operator's "Neue Nachricht" composer (or any other
 * caller) sends a '+'-prefixed number, storing it verbatim splits the same
 * contact into two threads ('491701234567' vs '+491701234567'). Stripping the
 * '+' on the send path canonicalizes outbound to the SAME key as inbound, so the
 * two halves merge back into one conversation. The provider call still uses the
 * '+'-prefixed E.164 form (see `toMetaE164`) — Meta accepts both, but '+' is the
 * documented wire form.
 */
function canonicalThreadPhone(raw: string): string {
  return raw.replace(/\D+/g, '');
}

/** Provider wire form: canonical digits with a leading '+' (E.164). */
function toMetaE164(raw: string): string {
  const digits = canonicalThreadPhone(raw);
  return digits.length > 0 ? `+${digits}` : raw.trim();
}

// ════════════════════════════════════════════════════════════════════════
// Typed errors
// ════════════════════════════════════════════════════════════════════════

class MessageNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class CustomerNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class WhatsAppProviderError extends DomainError {
  public readonly httpStatus = 502;
  public readonly code: ApiErrorCode = 'EXTERNAL_SERVICE_FAILED';
  public readonly providerCode: string | null;
  public constructor(message: string, providerCode: string | null) {
    super(message);
    this.providerCode = providerCode;
  }
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

// ════════════════════════════════════════════════════════════════════════
// TypeBox shapes
// ════════════════════════════════════════════════════════════════════════

const PhoneParams = Type.Object({
  phone: Type.String({ minLength: 1, maxLength: 32 }),
});
type TPhoneParams = Static<typeof PhoneParams>;

const InboundMessageIdParams = Type.Object({
  // Inbound IDs are bigserial; accept as decimal string so we don't lose precision.
  id: Type.String({ pattern: '^[0-9]+$' }),
});
type TInboundMessageIdParams = Static<typeof InboundMessageIdParams>;

const ThreadListItem = Type.Object({
  phone: Type.String(),
  linkedCustomerId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  linkedCustomerName: Type.Union([Type.String(), Type.Null()]),
  lastMessagePreview: Type.String(),
  lastMessageAt: Type.String(),
  lastMessageDirection: Type.Union([Type.Literal('inbound'), Type.Literal('outbound')]),
  unreadCount: Type.Integer({ minimum: 0 }),
});

const ThreadListResponse = Type.Object({
  items: Type.Array(ThreadListItem),
});

const OutboundStatusSchema = Type.Union(WHATSAPP_OUTBOUND_STATUSES.map((s) => Type.Literal(s)));

const ThreadMessage = Type.Object({
  id: Type.String(),
  direction: Type.Union([Type.Literal('inbound'), Type.Literal('outbound')]),
  body: Type.String(),
  timestamp: Type.String(),
  status: Type.Union([Type.Null(), OutboundStatusSchema]),
  handledAt: Type.Union([Type.String(), Type.Null()]),
});

const ThreadDetailResponse = Type.Object({
  phone: Type.String(),
  linkedCustomerId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
  linkedCustomerName: Type.Union([Type.String(), Type.Null()]),
  aiActive: Type.Boolean(),
  cooldownUntil: Type.Union([Type.String(), Type.Null()]),
  messages: Type.Array(ThreadMessage),
});

const AiStatusBody = Type.Object({
  aiActive: Type.Boolean(),
});
type TAiStatusBody = Static<typeof AiStatusBody>;

const AiStatusResponse = Type.Object({
  phone: Type.String(),
  aiActive: Type.Boolean(),
  cooldownUntil: Type.Union([Type.String(), Type.Null()]),
});

const SendBody = Type.Object({
  toPhone: Type.String({ minLength: 4, maxLength: 32 }),
  body: Type.String({ minLength: 1, maxLength: 4096 }),
  templateName: Type.Optional(Type.String({ maxLength: 200 })),
  templateParams: Type.Optional(Type.Record(Type.String(), Type.String({ maxLength: 1000 }))),
});
type TSendBody = Static<typeof SendBody>;

const SendResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  toPhone: Type.String(),
  body: Type.String(),
  status: OutboundStatusSchema,
  providerMessageId: Type.Union([Type.String(), Type.Null()]),
  sentAt: Type.String(),
});

const MarkHandledResponse = Type.Object({
  id: Type.String(),
  handledAt: Type.String(),
  handledByUserId: Type.String({ format: 'uuid' }),
});

const LinkCustomerBody = Type.Object({
  customerId: Type.String({ format: 'uuid' }),
});
type TLinkCustomerBody = Static<typeof LinkCustomerBody>;

const LinkCustomerResponse = Type.Object({
  id: Type.String(),
  linkedCustomerId: Type.String({ format: 'uuid' }),
});

// ════════════════════════════════════════════════════════════════════════
// Plugin
// ════════════════════════════════════════════════════════════════════════

export interface WhatsAppInboxOpts {
  env: Env;
}

const whatsappInboxRoutes: FastifyPluginAsync<WhatsAppInboxOpts> = async (app, opts) => {
  // ──────────────────────────────────────────────────────────────────────
  // GET /api/whatsapp/threads
  // ──────────────────────────────────────────────────────────────────────
  app.get(
    '/api/whatsapp/threads',
    {
      schema: {
        tags: ['whatsapp'],
        summary: 'List WhatsApp conversations grouped by phone (most recent first).',
        response: { 200: ThreadListResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      // Single SQL: combine inbound + outbound, group by phone, take the
      // most-recent message per phone via window function, surface the
      // resolved customer name through the request-scoped PII key.
      const rows = await app.withPii(async (txAny) => {
        const tx = txAny as unknown as typeof app.db;
        const result = await tx.execute<{
          phone: string;
          linked_customer_id: string | null;
          linked_customer_full_name: string | null;
          last_message_preview: string;
          last_message_at: string;
          last_message_direction: 'inbound' | 'outbound';
          unread_count: string;
        }>(sql`
        WITH all_messages AS (
          SELECT
            from_phone AS phone,
            received_at AS ts,
            LEFT(COALESCE(decrypt_pii(body_encrypted), raw_payload->'text'->>'body', '[' || message_type || ']'), 160) AS preview,
            'inbound'::text AS direction,
            linked_customer_id,
            (handled_at IS NULL)::int AS is_unread
          FROM whatsapp_inbound_messages
          UNION ALL
          SELECT
            to_phone AS phone,
            sent_at AS ts,
            LEFT(COALESCE(decrypt_pii(body_encrypted), body), 160) AS preview,
            'outbound'::text AS direction,
            NULL::uuid AS linked_customer_id,
            0 AS is_unread
          FROM whatsapp_outbound_messages
        ),
        ranked AS (
          SELECT
            phone, ts, preview, direction, is_unread,
            ROW_NUMBER() OVER (PARTITION BY phone ORDER BY ts DESC) AS rn,
            SUM(is_unread) OVER (PARTITION BY phone) AS unread_count,
            -- PG 17 has no max(uuid). Cast through text to pick any non-null id
            -- per phone — every inbound row from the same phone is supposed to
            -- carry the same linked_customer_id anyway (it's a phone-level fact).
            MAX(linked_customer_id::text) OVER (PARTITION BY phone)::uuid AS resolved_customer_id
          FROM all_messages
        )
        SELECT
          r.phone,
          r.resolved_customer_id AS linked_customer_id,
          decrypt_pii(c.full_name_encrypted) AS linked_customer_full_name,
          r.preview AS last_message_preview,
          r.ts::text AS last_message_at,
          r.direction AS last_message_direction,
          r.unread_count::text AS unread_count
        FROM ranked r
        LEFT JOIN customers c ON c.id = r.resolved_customer_id
        WHERE r.rn = 1
        ORDER BY r.ts DESC
        LIMIT 200
      `);
        // postgres-js returns the underlying RowList; cast to plain array.
        return result as unknown as Array<{
          phone: string;
          linked_customer_id: string | null;
          linked_customer_full_name: string | null;
          last_message_preview: string;
          last_message_at: string;
          last_message_direction: 'inbound' | 'outbound';
          unread_count: string;
        }>;
      });

      const items = rows.map((r) => ({
        phone: r.phone,
        linkedCustomerId: r.linked_customer_id,
        linkedCustomerName: r.linked_customer_full_name,
        lastMessagePreview: r.last_message_preview,
        lastMessageAt: r.last_message_at,
        lastMessageDirection: r.last_message_direction,
        unreadCount: Number(r.unread_count ?? 0),
      }));

      return reply.status(200).send({ items });
    },
  );

  // ──────────────────────────────────────────────────────────────────────
  // GET /api/whatsapp/threads/:phone
  // ──────────────────────────────────────────────────────────────────────
  app.get<{ Params: TPhoneParams }>(
    '/api/whatsapp/threads/:phone',
    {
      schema: {
        tags: ['whatsapp'],
        summary: 'Interleaved timeline (inbound + outbound) for one phone.',
        params: PhoneParams,
        response: {
          200: ThreadDetailResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const phone = req.params.phone;

      const detail = await app.withPii(async (txAny) => {
        const tx = txAny as unknown as typeof app.db;
        const messageRows = (await tx.execute<{
          id: string;
          direction: 'inbound' | 'outbound';
          body: string;
          ts: string;
          status: WhatsAppOutboundStatus | null;
          handled_at: string | null;
          linked_customer_id: string | null;
        }>(sql`
        SELECT
          id::text AS id,
          'inbound'::text AS direction,
          COALESCE(decrypt_pii(body_encrypted), raw_payload->'text'->>'body', '[' || message_type || ']') AS body,
          received_at::text AS ts,
          NULL::text AS status,
          handled_at::text AS handled_at,
          linked_customer_id::text AS linked_customer_id
        FROM whatsapp_inbound_messages
        WHERE from_phone = ${phone}
        UNION ALL
        SELECT
          id::text AS id,
          'outbound'::text AS direction,
          COALESCE(decrypt_pii(body_encrypted), body) AS body,
          sent_at::text AS ts,
          status::text AS status,
          NULL::text AS handled_at,
          NULL::text AS linked_customer_id
        FROM whatsapp_outbound_messages
        WHERE to_phone = ${phone}
        ORDER BY ts ASC
        LIMIT 1000
      `)) as unknown as Array<{
          id: string;
          direction: 'inbound' | 'outbound';
          body: string;
          ts: string;
          status: WhatsAppOutboundStatus | null;
          handled_at: string | null;
          linked_customer_id: string | null;
        }>;

        // Resolve linked customer name (first non-null link wins; this is a
        // single-operator app, so the operator's intent is unambiguous).
        let linkedCustomerId: string | null = null;
        for (const m of messageRows) {
          if (m.linked_customer_id) {
            linkedCustomerId = m.linked_customer_id;
            break;
          }
        }

        let linkedCustomerName: string | null = null;
        if (linkedCustomerId) {
          const nameRows = (await tx.execute<{ full_name: string | null }>(sql`
          SELECT decrypt_pii(full_name_encrypted) AS full_name
          FROM customers
          WHERE id = ${linkedCustomerId}::uuid
          LIMIT 1
        `)) as unknown as Array<{ full_name: string | null }>;
          linkedCustomerName = nameRows[0]?.full_name ?? null;
        }

        return { messageRows, linkedCustomerId, linkedCustomerName };
      });

      const messages = detail.messageRows.map((r) => ({
        id: r.id,
        direction: r.direction,
        body: r.body ?? '',
        timestamp: r.ts,
        status: r.status,
        handledAt: r.handled_at,
      }));

      // AI-assistant status for this thread. Default to active / no cooldown
      // when no conversation row exists yet (the bot is on by default).
      const convRows = (await app.db.execute<{
        ai_active: boolean;
        cooldown_until: string | null;
      }>(sql`
        SELECT ai_active, cooldown_until::text AS cooldown_until
        FROM whatsapp_conversations
        WHERE customer_phone_e164 = ${phone}
        LIMIT 1
      `)) as unknown as Array<{ ai_active: boolean; cooldown_until: string | null }>;
      const conv = convRows[0];

      return reply.status(200).send({
        phone,
        linkedCustomerId: detail.linkedCustomerId,
        linkedCustomerName: detail.linkedCustomerName,
        aiActive: conv ? conv.ai_active : true,
        cooldownUntil: conv ? conv.cooldown_until : null,
        messages,
      });
    },
  );

  // ──────────────────────────────────────────────────────────────────────
  // PATCH /api/whatsapp/threads/:phone/ai-status — operator takeover toggle
  //
  // Pause (aiActive=false) or resume (aiActive=true) the AI assistant for a
  // thread. Either way clears any takeover cooldown so the operator's explicit
  // choice wins over the implicit 12h silence. Audited for compliance.
  // ──────────────────────────────────────────────────────────────────────
  app.patch<{ Params: TPhoneParams; Body: TAiStatusBody }>(
    '/api/whatsapp/threads/:phone/ai-status',
    {
      schema: {
        tags: ['whatsapp'],
        summary: 'Toggle the AI assistant for a thread (operator takeover).',
        params: PhoneParams,
        body: AiStatusBody,
        response: {
          200: AiStatusResponse,
          401: ErrorResponse,
          403: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const phone = req.params.phone;
      const aiActive = req.body.aiActive;
      const actorId = req.actor.id;
      const ip = req.ip || null;

      const rows = (await app.db.execute<{
        ai_active: boolean;
        cooldown_until: string | null;
      }>(sql`
        INSERT INTO whatsapp_conversations (customer_phone_e164, ai_active, cooldown_until)
        VALUES (${phone}, ${aiActive}, NULL)
        ON CONFLICT (customer_phone_e164)
        DO UPDATE SET ai_active = ${aiActive}, cooldown_until = NULL
        RETURNING ai_active, cooldown_until::text AS cooldown_until
      `)) as unknown as Array<{ ai_active: boolean; cooldown_until: string | null }>;

      const row = rows[0];
      if (!row) throw new Error('whatsapp_conversations upsert returned no row');

      // Forensic audit — who flipped the bot on/off for which thread, when.
      await app.db.execute(sql`
        INSERT INTO audit_log (event_type, actor_user_id, ip_address, payload)
        VALUES (
          'whatsapp.ai_status.updated',
          ${actorId}::uuid,
          ${ip}::inet,
          ${JSON.stringify({ phone, aiActive })}::jsonb
        )
      `);

      return reply.status(200).send({
        phone,
        aiActive: row.ai_active,
        cooldownUntil: row.cooldown_until,
      });
    },
  );

  // ──────────────────────────────────────────────────────────────────────
  // POST /api/whatsapp/send
  // ──────────────────────────────────────────────────────────────────────
  app.post<{ Body: TSendBody }>(
    '/api/whatsapp/send',
    {
      schema: {
        tags: ['whatsapp'],
        summary: 'Send an outbound WhatsApp reply (or queue if env not configured).',
        description:
          'If WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN are set, POSTs ' +
          'to Meta Cloud API v20.0 with a 10 s timeout. Stores the row ' +
          'either way. Provider errors are translated to a generic ' +
          'EXTERNAL_SERVICE_FAILED — never surfaced raw.',
        body: SendBody,
        response: {
          200: SendResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          502: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const body = req.body;
      const actorId = req.actor.id;
      const liveSendEnabled =
        opts.env.WHATSAPP_PHONE_NUMBER_ID.length > 0 && opts.env.WHATSAPP_ACCESS_TOKEN.length > 0;

      // Canonicalize the destination to the no-'+' thread key BEFORE any write,
      // so a '+'-typed number from the "Neue Nachricht" composer lands on the
      // same thread as the inbound (no-'+') corpus instead of forking a second
      // conversation. The stored `to_phone` and the cooldown key both use this;
      // the Meta call uses the '+'-prefixed E.164 form below.
      const toPhone = canonicalThreadPhone(body.toPhone);
      const metaToPhone = toMetaE164(body.toPhone);

      let status: WhatsAppOutboundStatus = 'queued';
      let providerMessageId: string | null = null;
      let providerError: unknown = null;
      let providerErrorCode: string | null = null;

      // P1.5 — record-intent → send → settle. Previously the Meta call ran FIRST
      // and the row was inserted only AFTER it returned; a crash between the two
      // left a REAL outbound message with NO `whatsapp_outbound_messages` row —
      // invisible in the thread, no provider_message_id to correlate a delivery
      // webhook. You cannot roll back a delivered message, so we do NOT wrap the
      // send in a tx; instead each step is its own atomic write.
      //
      // Step A — durably record the INTENT as 'queued' (provider fields NULL),
      // before any external call. encrypt_pii stamps body_encrypted (Epic E).
      const templateParamsJson: string | null = body.templateParams
        ? JSON.stringify(body.templateParams)
        : null;

      const insertedRows = await app.withPii(async (txAny) => {
        const tx = txAny as unknown as typeof app.db;
        return (await tx.execute<{
          id: string;
          to_phone: string;
          body: string;
          status: WhatsAppOutboundStatus;
          provider_message_id: string | null;
          sent_at: string;
        }>(sql`
      INSERT INTO whatsapp_outbound_messages
        (to_phone, body, body_encrypted, template_name, template_params, status, sent_by_user_id)
      VALUES
        (${toPhone},
         ${body.body},
         encrypt_pii(${body.body}),
         ${body.templateName ?? null},
         ${templateParamsJson}::jsonb,
         'queued',
         ${actorId}::uuid)
      RETURNING id::text AS id, to_phone, body, status::text AS status,
                provider_message_id, sent_at::text AS sent_at
    `)) as unknown as Array<{
          id: string;
          to_phone: string;
          body: string;
          status: WhatsAppOutboundStatus;
          provider_message_id: string | null;
          sent_at: string;
        }>;
      });

      const row = insertedRows[0];
      if (!row) throw new Error('whatsapp_outbound_messages INSERT returned no row');

      // Step B — the external send (outside any DB transaction).
      if (liveSendEnabled) {
        try {
          const sendArgs: MetaSendArgs = {
            phoneNumberId: opts.env.WHATSAPP_PHONE_NUMBER_ID,
            accessToken: opts.env.WHATSAPP_ACCESS_TOKEN,
            toPhone: metaToPhone,
            messageBody: body.body,
          };
          if (body.templateName !== undefined) sendArgs.templateName = body.templateName;
          if (body.templateParams !== undefined) sendArgs.templateParams = body.templateParams;
          const result = await sendToMeta(sendArgs);
          status = 'sent';
          providerMessageId = result.messageId;
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err);
          const providerCode = err instanceof MetaApiError ? err.providerCode : null;
          providerError = err instanceof MetaApiError ? err.providerEnvelope : { message: detail };
          providerErrorCode = providerCode;
          status = 'failed';
          req.log.warn(
            { err, providerCode, toPhone },
            'whatsapp send: provider rejected',
          );
        }

        // Step C — settle the row by id (status + provider fields). A crash
        // between B and C leaves the row as 'queued' — a known, reconcilable
        // state, never a phantom sent-but-unrecorded message.
        const providerErrorJson: string | null =
          status === 'failed' ? JSON.stringify(providerError) : null;
        await app.db.execute(sql`
          UPDATE whatsapp_outbound_messages
             SET status = ${status},
                 provider_message_id = ${providerMessageId},
                 provider_error = ${providerErrorJson}::jsonb
           WHERE id = ${row.id}::uuid
        `);
        row.status = status;
        row.provider_message_id = providerMessageId;
      }

      // Human takeover (Epic E): a manual cashier reply silences the bot for
      // 12h. Best-effort — a cooldown write failure must not fail the send.
      try {
        await app.db.execute(sql`
          INSERT INTO whatsapp_conversations (customer_phone_e164, ai_active, cooldown_until)
          VALUES (${toPhone}, FALSE, now() + interval '12 hours')
          ON CONFLICT (customer_phone_e164)
          DO UPDATE SET ai_active = FALSE, cooldown_until = now() + interval '12 hours'
        `);
      } catch (err) {
        req.log.warn({ err, toPhone }, 'whatsapp send: cooldown upsert failed');
      }

      if (status === 'failed') {
        throw new WhatsAppProviderError('WhatsApp-Anbieter hat abgelehnt.', providerErrorCode);
      }

      return reply.status(200).send({
        id: row.id,
        toPhone: row.to_phone,
        body: row.body,
        status: row.status,
        providerMessageId: row.provider_message_id,
        sentAt: row.sent_at,
      });
    },
  );

  // ──────────────────────────────────────────────────────────────────────
  // PATCH /api/whatsapp/messages/:id/handled
  // ──────────────────────────────────────────────────────────────────────
  app.patch<{ Params: TInboundMessageIdParams }>(
    '/api/whatsapp/messages/:id/handled',
    {
      schema: {
        tags: ['whatsapp'],
        summary: 'Mark an inbound WhatsApp message as handled (operator triage).',
        params: InboundMessageIdParams,
        response: {
          200: MarkHandledResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const actorId = req.actor.id;
      const id = req.params.id;

      const rows = (await app.db.execute<{
        id: string;
        handled_at: string;
        handled_by_user_id: string;
      }>(sql`
        UPDATE whatsapp_inbound_messages
        SET handled_at = now(),
            handled_by_user_id = ${actorId}::uuid
        WHERE id = ${id}::bigint
        RETURNING id::text AS id, handled_at::text AS handled_at,
                  handled_by_user_id::text AS handled_by_user_id
      `)) as unknown as Array<{
        id: string;
        handled_at: string;
        handled_by_user_id: string;
      }>;

      const row = rows[0];
      if (!row) throw new MessageNotFoundError(`Inbound message ${id} not found`);

      return reply.status(200).send({
        id: row.id,
        handledAt: row.handled_at,
        handledByUserId: row.handled_by_user_id,
      });
    },
  );

  // ──────────────────────────────────────────────────────────────────────
  // PATCH /api/whatsapp/messages/:id/link-customer
  // ──────────────────────────────────────────────────────────────────────
  app.patch<{ Params: TInboundMessageIdParams; Body: TLinkCustomerBody }>(
    '/api/whatsapp/messages/:id/link-customer',
    {
      schema: {
        tags: ['whatsapp'],
        summary: 'Attach a customer record to an inbound WhatsApp message.',
        params: InboundMessageIdParams,
        body: LinkCustomerBody,
        response: {
          200: LinkCustomerResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const id = req.params.id;
      const customerId = req.body.customerId;

      // Verify customer exists for a clean 404 rather than an FK 409.
      const customerCheck = (await app.db.execute<{ id: string }>(sql`
        SELECT id::text AS id FROM customers WHERE id = ${customerId}::uuid LIMIT 1
      `)) as unknown as Array<{ id: string }>;
      if (!customerCheck[0]) {
        throw new CustomerNotFoundError(`Customer ${customerId} not found`);
      }

      const rows = (await app.db.execute<{
        id: string;
        linked_customer_id: string;
      }>(sql`
        UPDATE whatsapp_inbound_messages
        SET linked_customer_id = ${customerId}::uuid
        WHERE id = ${id}::bigint
        RETURNING id::text AS id, linked_customer_id::text AS linked_customer_id
      `)) as unknown as Array<{ id: string; linked_customer_id: string }>;

      const row = rows[0];
      if (!row) throw new MessageNotFoundError(`Inbound message ${id} not found`);

      return reply.status(200).send({
        id: row.id,
        linkedCustomerId: row.linked_customer_id,
      });
    },
  );
};

export default whatsappInboxRoutes;
