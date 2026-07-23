/**
 * Support tickets — the staff side of the customer conversation (0097).
 *
 *   GET  /api/support/tickets            — the queue, oldest waiting first.
 *   GET  /api/support/tickets/:id        — one conversation, both directions.
 *   POST /api/support/tickets/:id/reply  — answer it.
 *   POST /api/support/tickets/:id/status — open, waiting, closed.
 *
 * The reply goes out through `email_outbox`, the same queue the reservation
 * letters use, so it inherits the letterhead, the retry policy and the erasure
 * sweep without any of that being written twice. It is sent FROM the address
 * the customer originally wrote to, which is why `support_messages` stores the
 * recipient of every inbound message: answering a `bestellung@` question from
 * `info@` is the kind of small wrongness that makes a shop look automated.
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth } from '../lib/auth-policy.js';
import { composeSupportReply, enqueueEmail } from '@warehouse14/email';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class TicketNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

class TicketConflictError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const TicketStatus = Type.Union([
  Type.Literal('OFFEN'),
  Type.Literal('WARTET'),
  Type.Literal('GESCHLOSSEN'),
]);

const TicketSummary = Type.Object({
  id: Type.String(),
  ticketNumber: Type.String(),
  subject: Type.String(),
  status: Type.String(),
  priority: Type.String(),
  channel: Type.String(),
  customerId: Type.Union([Type.String(), Type.Null()]),
  customerName: Type.Union([Type.String(), Type.Null()]),
  customerNumber: Type.Union([Type.String(), Type.Null()]),
  messageCount: Type.Integer(),
  lastInboundAt: Type.Union([Type.String(), Type.Null()]),
  lastOutboundAt: Type.Union([Type.String(), Type.Null()]),
  /** True when the customer spoke last: the queue's real sort signal. */
  awaitingReply: Type.Boolean(),
  createdAt: Type.String(),
});

const TicketMessage = Type.Object({
  id: Type.String(),
  direction: Type.String(),
  from: Type.String(),
  to: Type.String(),
  body: Type.String(),
  authorUserId: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});

const TicketDetail = Type.Intersect([
  TicketSummary,
  Type.Object({ messages: Type.Array(TicketMessage) }),
]);

const ReplyBody = Type.Object({
  body: Type.String({ minLength: 1, maxLength: 10000 }),
});

const StatusBody = Type.Object({ status: TicketStatus });

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

const supportTicketRoutes: FastifyPluginAsync = async (app) => {
  // ── GET /api/support/tickets ─────────────────────────────────────────
  app.get<{ Querystring: { status?: string } }>(
    '/api/support/tickets',
    {
      schema: {
        tags: ['support'],
        summary: 'Support queue. Tickets awaiting a reply come first.',
        querystring: Type.Object({ status: Type.Optional(TicketStatus) }),
        response: { 200: Type.Array(TicketSummary), 401: ErrorResponse },
      },
    },
    async (req) => {
      requireAuth(req);
      const filter = req.query.status ?? null;

      return await app.withPii(async (tx) => {
        const rows = await tx.execute<Record<string, unknown>>(drizzleSql`
          SELECT t.id, t.ticket_number, t.subject, t.status, t.priority, t.channel,
                 t.customer_id,
                 c.customer_number,
                 decrypt_pii(c.full_name_encrypted) AS customer_name,
                 (SELECT count(*) FROM support_messages m WHERE m.ticket_id = t.id)::int AS message_count,
                 to_char(t.last_inbound_at  AT TIME ZONE 'UTC', ${drizzleSql.raw(ISO)}) AS last_inbound_at,
                 to_char(t.last_outbound_at AT TIME ZONE 'UTC', ${drizzleSql.raw(ISO)}) AS last_outbound_at,
                 to_char(t.created_at       AT TIME ZONE 'UTC', ${drizzleSql.raw(ISO)}) AS created_at,
                 (t.last_inbound_at IS NOT NULL
                  AND (t.last_outbound_at IS NULL OR t.last_outbound_at < t.last_inbound_at)) AS awaiting_reply
            FROM support_tickets t
            LEFT JOIN customers c ON c.id = t.customer_id
           WHERE (${filter}::text IS NULL AND t.status <> 'GESCHLOSSEN')
              OR (${filter}::text IS NOT NULL AND t.status = ${filter})
           ORDER BY awaiting_reply DESC,
                    COALESCE(t.last_inbound_at, t.created_at) ASC
           LIMIT 200`);

        return rows.map((r) => ({
          id: r.id as string,
          ticketNumber: r.ticket_number as string,
          subject: r.subject as string,
          status: r.status as string,
          priority: r.priority as string,
          channel: r.channel as string,
          customerId: (r.customer_id as string | null) ?? null,
          customerName: (r.customer_name as string | null) ?? null,
          customerNumber: (r.customer_number as string | null) ?? null,
          messageCount: r.message_count as number,
          lastInboundAt: (r.last_inbound_at as string | null) ?? null,
          lastOutboundAt: (r.last_outbound_at as string | null) ?? null,
          awaitingReply: Boolean(r.awaiting_reply),
          createdAt: r.created_at as string,
        }));
      });
    },
  );

  // ── GET /api/support/tickets/:id ─────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/api/support/tickets/:id',
    {
      schema: {
        tags: ['support'],
        summary: 'One ticket with the whole conversation.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        response: { 200: TicketDetail, 401: ErrorResponse, 404: ErrorResponse },
      },
    },
    async (req) => {
      requireAuth(req);

      return await app.withPii(async (tx) => {
        const head = await tx.execute<Record<string, unknown>>(drizzleSql`
          SELECT t.id, t.ticket_number, t.subject, t.status, t.priority, t.channel,
                 t.customer_id,
                 c.customer_number,
                 decrypt_pii(c.full_name_encrypted) AS customer_name,
                 to_char(t.last_inbound_at  AT TIME ZONE 'UTC', ${drizzleSql.raw(ISO)}) AS last_inbound_at,
                 to_char(t.last_outbound_at AT TIME ZONE 'UTC', ${drizzleSql.raw(ISO)}) AS last_outbound_at,
                 to_char(t.created_at       AT TIME ZONE 'UTC', ${drizzleSql.raw(ISO)}) AS created_at,
                 (t.last_inbound_at IS NOT NULL
                  AND (t.last_outbound_at IS NULL OR t.last_outbound_at < t.last_inbound_at)) AS awaiting_reply
            FROM support_tickets t
            LEFT JOIN customers c ON c.id = t.customer_id
           WHERE t.id = ${req.params.id}
           LIMIT 1`);
        const t = head[0];
        if (!t) throw new TicketNotFoundError('Ticket not found.');

        const msgs = await tx.execute<Record<string, unknown>>(drizzleSql`
          SELECT id, direction,
                 decrypt_pii(from_encrypted) AS from_addr,
                 decrypt_pii(to_encrypted)   AS to_addr,
                 decrypt_pii(body_encrypted) AS body,
                 author_user_id,
                 to_char(created_at AT TIME ZONE 'UTC', ${drizzleSql.raw(ISO)}) AS created_at
            FROM support_messages
           WHERE ticket_id = ${req.params.id}
           ORDER BY created_at ASC`);

        return {
          id: t.id as string,
          ticketNumber: t.ticket_number as string,
          subject: t.subject as string,
          status: t.status as string,
          priority: t.priority as string,
          channel: t.channel as string,
          customerId: (t.customer_id as string | null) ?? null,
          customerName: (t.customer_name as string | null) ?? null,
          customerNumber: (t.customer_number as string | null) ?? null,
          messageCount: msgs.length,
          lastInboundAt: (t.last_inbound_at as string | null) ?? null,
          lastOutboundAt: (t.last_outbound_at as string | null) ?? null,
          awaitingReply: Boolean(t.awaiting_reply),
          createdAt: t.created_at as string,
          messages: msgs.map((m) => ({
            id: m.id as string,
            direction: m.direction as string,
            from: (m.from_addr as string | null) ?? '',
            to: (m.to_addr as string | null) ?? '',
            body: (m.body as string | null) ?? '',
            authorUserId: (m.author_user_id as string | null) ?? null,
            createdAt: m.created_at as string,
          })),
        };
      });
    },
  );

  // ── POST /api/support/tickets/:id/reply ──────────────────────────────
  app.post<{ Params: { id: string }; Body: (typeof ReplyBody)['static'] }>(
    '/api/support/tickets/:id/reply',
    {
      schema: {
        tags: ['support'],
        summary: 'Answer a ticket. Queues the letter and appends to the thread.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: ReplyBody,
        response: {
          200: Type.Object({ ok: Type.Boolean(), ticketNumber: Type.String() }),
          401: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req) => {
      requireAuth(req);
      const body = req.body.body.trim();
      if (!body) throw new TicketConflictError('An empty reply cannot be sent.');

      return await app.withPii(async (tx) => {
        const rows = await tx.execute<Record<string, unknown>>(drizzleSql`
          SELECT t.id, t.ticket_number, t.subject, t.customer_id,
                 decrypt_pii(c.full_name_encrypted) AS customer_name,
                 s.preferred_language,
                 -- Reply to the address that wrote to us, and FROM the address
                 -- they wrote to. Both come from the newest inbound message.
                 (SELECT decrypt_pii(m.from_encrypted) FROM support_messages m
                   WHERE m.ticket_id = t.id AND m.direction = 'INBOUND'
                   ORDER BY m.created_at DESC LIMIT 1) AS reply_to,
                 (SELECT decrypt_pii(m.to_encrypted) FROM support_messages m
                   WHERE m.ticket_id = t.id AND m.direction = 'INBOUND'
                   ORDER BY m.created_at DESC LIMIT 1) AS reply_from
            FROM support_tickets t
            LEFT JOIN customers c ON c.id = t.customer_id
            LEFT JOIN shoppers  s ON s.customer_id = t.customer_id AND s.soft_deleted_at IS NULL
           WHERE t.id = ${req.params.id}
           LIMIT 1`);
        const t = rows[0];
        if (!t) throw new TicketNotFoundError('Ticket not found.');

        // A ticket with no inbound message has no one to answer. That happens
        // if the conversation was opened by hand and never received anything;
        // failing loudly beats sending a letter into the void.
        const rawTo = (t.reply_to as string | null) ?? '';
        const to = rawTo.match(/<([^>]+)>/)?.[1] ?? rawTo;
        if (!to.includes('@')) {
          throw new TicketConflictError('This ticket has no sender address to answer.');
        }

        const mail = composeSupportReply(
          (t.customer_name as string | null) ?? null,
          t.ticket_number as string,
          t.subject as string,
          body,
          (t.preferred_language as string | null) ?? null,
        );
        await enqueueEmail(tx, to, mail, (t.customer_id as string | null) ?? null);

        await tx.execute(drizzleSql`
          INSERT INTO support_messages
                 (ticket_id, direction, from_encrypted, to_encrypted, body_encrypted, author_user_id)
          VALUES (${t.id}, 'OUTBOUND',
                  encrypt_pii(${(t.reply_from as string | null) ?? 'bestellung@warehouse14.de'}),
                  encrypt_pii(${to}),
                  encrypt_pii(${body}),
                  ${req.actor.id})`);

        // WARTET, not GESCHLOSSEN: we have answered, the customer has not yet
        // told us whether that settled it. Closing here would flatter the
        // queue and lose the follow-up.
        await tx.execute(drizzleSql`
          UPDATE support_tickets
             SET status = 'WARTET', last_outbound_at = now(), updated_at = now()
           WHERE id = ${t.id}`);

        return { ok: true, ticketNumber: t.ticket_number as string };
      });
    },
  );

  // ── POST /api/support/tickets/:id/status ─────────────────────────────
  app.post<{ Params: { id: string }; Body: (typeof StatusBody)['static'] }>(
    '/api/support/tickets/:id/status',
    {
      schema: {
        tags: ['support'],
        summary: 'Move a ticket between open, waiting and closed.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        body: StatusBody,
        response: {
          200: Type.Object({ ok: Type.Boolean(), status: Type.String() }),
          401: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req) => {
      requireAuth(req);
      const rows = await app.db.execute<{ id: string }>(drizzleSql`
        UPDATE support_tickets
           SET status = ${req.body.status}, updated_at = now()
         WHERE id = ${req.params.id}
        RETURNING id`);
      if (!rows[0]) throw new TicketNotFoundError('Ticket not found.');
      return { ok: true, status: req.body.status };
    },
  );
};

export default supportTicketRoutes;
