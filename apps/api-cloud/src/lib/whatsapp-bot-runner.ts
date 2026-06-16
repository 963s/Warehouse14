/**
 * WhatsApp bot runner — the glue between the webhook and the pure orchestrator
 * in @warehouse14/ai-gateway. Triggered fire-and-forget AFTER an inbound
 * message is stored.
 *
 * Responsibilities (the orchestrator stays pure; this is the I/O shell):
 *   • upsert the conversation row (+ bump last_inbound_at) and read its
 *     takeover state;
 *   • compute today's AI spend for the per-conversation budget;
 *   • run the turn, then persist ai_calls, reactivate the bot if a cooldown
 *     lapsed, and send + store the reply.
 *
 * The whole thing is wrapped so a failure can never reject into the webhook's
 * detached promise — the inbound message is already safely stored.
 */

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { type AiCallRecord, type ConversationState, runBotTurn } from '@warehouse14/ai-gateway';

import type { Env } from '../config/env.js';
import { createAnthropicLlmClient } from './anthropic-llm-client.js';
import { MetaApiError, sendToMeta } from './meta-whatsapp.js';
import { withPiiKey } from './pii.js';
import { createWhatsAppBotTools } from './whatsapp-bot-tools.js';

export interface InboundForBot {
  fromPhone: string;
  /** Plain-text body extracted from the inbound payload (empty for non-text). */
  body: string;
}

type ConversationRow = {
  id: string;
  ai_active: boolean;
  cooldown_until: string | null;
  customer_id: string | null;
};

async function persistAiCalls(
  app: FastifyInstance,
  conversationId: string,
  calls: AiCallRecord[],
): Promise<void> {
  for (const c of calls) {
    await app.db.execute(sql`
      INSERT INTO ai_calls (conversation_id, kind, model, input_tokens, output_tokens, cost_eur)
      VALUES (${conversationId}::uuid, ${c.kind}, ${c.model},
              ${c.usage.inputTokens}, ${c.usage.outputTokens}, ${c.costEur})
    `);
  }
}

async function storeOutbound(
  app: FastifyInstance,
  piiKey: string,
  toPhone: string,
  body: string,
  status: 'sent' | 'queued' | 'failed',
  providerMessageId: string | null,
): Promise<void> {
  // The table CHECK requires provider_error NOT NULL exactly when failed.
  const providerErrorJson = status === 'failed' ? JSON.stringify({ source: 'bot_send' }) : null;
  // body_encrypted at rest via encrypt_pii (Epic E). The key is passed
  // EXPLICITLY (Phase-2 P1.1) — this runs detached, after the request scope
  // unwound, so it must NOT read the key from AsyncLocalStorage.
  await withPiiKey(app.db, piiKey, async (tx) => {
    await tx.execute(sql`
      INSERT INTO whatsapp_outbound_messages
        (to_phone, body, body_encrypted, status, provider_message_id, provider_error)
      VALUES (${toPhone}, ${body}, encrypt_pii(${body}), ${status}, ${providerMessageId},
              ${providerErrorJson}::jsonb)
    `);
  });
}

export async function runWhatsAppBot(
  app: FastifyInstance,
  env: Env,
  inbound: InboundForBot,
  piiKey: string,
): Promise<string | null> {
  try {
    const llm = createAnthropicLlmClient(env.ANTHROPIC_API_KEY);
    if (!llm) return null; // bot disabled (no API key) — message already stored for triage.
    if (inbound.body.trim().length === 0) return null; // nothing to answer (sticker, image, …)

    // Upsert the conversation + bump last_inbound_at; RETURNING gives the
    // current takeover state atomically.
    const rows = (await app.db.execute<ConversationRow>(sql`
      INSERT INTO whatsapp_conversations (customer_phone_e164, last_inbound_at)
      VALUES (${inbound.fromPhone}, now())
      ON CONFLICT (customer_phone_e164)
      DO UPDATE SET last_inbound_at = now()
      RETURNING id::text AS id, ai_active, cooldown_until::text AS cooldown_until,
                customer_id::text AS customer_id
    `)) as unknown as ConversationRow[];
    const conv = rows[0];
    if (!conv) return null;

    const state: ConversationState = {
      aiActive: conv.ai_active,
      cooldownUntil: conv.cooldown_until ? new Date(conv.cooldown_until) : null,
    };

    // Today's spend for this conversation (per-conversation daily cap).
    const spendRows = (await app.db.execute<{ spent: string }>(sql`
      SELECT COALESCE(SUM(cost_eur), 0)::text AS spent
      FROM ai_calls
      WHERE conversation_id = ${conv.id}::uuid
        AND created_at >= date_trunc('day', now())
    `)) as unknown as Array<{ spent: string }>;
    const spentTodayEur = Number(spendRows[0]?.spent ?? '0');

    const tools = createWhatsAppBotTools({
      db: app.db,
      customerPhoneE164: inbound.fromPhone,
      customerId: conv.customer_id,
      log: app.log,
    });

    const result = await runBotTurn({
      llm,
      tools,
      state,
      customerMessage: inbound.body,
      spentTodayEur,
    });

    if (result.kind === 'skipped') return null;

    await persistAiCalls(app, conv.id, result.calls);

    if (result.kind === 'escalated') {
      // escalateToHuman already disabled the bot + queued the inbox alert.
      app.log.info({ phone: inbound.fromPhone, reason: result.reason }, 'whatsapp bot: escalated');
      return null;
    }

    // result.kind === 'replied'
    if (result.reactivated) {
      await app.db.execute(sql`
        UPDATE whatsapp_conversations SET ai_active = TRUE WHERE id = ${conv.id}::uuid
      `);
    }

    const liveSend =
      env.WHATSAPP_PHONE_NUMBER_ID.length > 0 && env.WHATSAPP_ACCESS_TOKEN.length > 0;
    if (!liveSend) {
      await storeOutbound(app, piiKey, inbound.fromPhone, result.reply, 'queued', null);
      return result.reply;
    }

    try {
      const sent = await sendToMeta({
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
        accessToken: env.WHATSAPP_ACCESS_TOKEN,
        toPhone: inbound.fromPhone,
        messageBody: result.reply,
      });
      await storeOutbound(app, piiKey, inbound.fromPhone, result.reply, 'sent', sent.messageId);
    } catch (err) {
      const providerCode = err instanceof MetaApiError ? err.providerCode : null;
      app.log.warn(
        { providerCode, phone: inbound.fromPhone },
        'whatsapp bot: reply send rejected by provider',
      );
      await storeOutbound(app, piiKey, inbound.fromPhone, result.reply, 'failed', null);
    }
    // Return the reply so non-WhatsApp transports (e.g. Chatwoot) can forward it.
    return result.reply;
  } catch (err) {
    app.log.error({ err, phone: inbound.fromPhone }, 'whatsapp bot: orchestrator run failed');
    return null;
  }
}
