/**
 * Social bot runner — the I/O shell that feeds Instagram/Messenger DMs into the
 * SAME pure orchestrator the WhatsApp bot uses (`runBotTurn` in
 * @warehouse14/ai-gateway). Zero duplicate AI logic: only the conversation key
 * (channel:senderId) and the reply transport (sendSocialReply) differ.
 *
 * Fire-and-forget: a failure can never reject into the webhook's detached
 * promise — the inbound is already acknowledged with 200.
 */

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { type AiCallRecord, type ConversationState, runBotTurn } from '@warehouse14/ai-gateway';

import type { Env } from '../config/env.js';
import { createAnthropicLlmClient } from './anthropic-llm-client.js';
import { withPiiKey } from './pii.js';
import {
  SocialSendError,
  type UnifiedInboundMessage,
  sendSocialReply,
  socialConversationKey,
} from './social-adapter.js';
import { createWhatsAppBotTools } from './whatsapp-bot-tools.js';

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
  toKey: string,
  body: string,
  status: 'sent' | 'queued' | 'failed',
  providerMessageId: string | null,
): Promise<void> {
  const providerErrorJson =
    status === 'failed' ? JSON.stringify({ source: 'social_bot_send' }) : null;
  // Explicit PII key (Phase-2 P1.1) — runs detached, after the request scope
  // unwound, so it must NOT read the key from AsyncLocalStorage.
  await withPiiKey(app.db, piiKey, async (tx) => {
    await tx.execute(sql`
      INSERT INTO whatsapp_outbound_messages
        (to_phone, body, body_encrypted, status, provider_message_id, provider_error)
      VALUES (${toKey}, ${body}, encrypt_pii(${body}), ${status}, ${providerMessageId},
              ${providerErrorJson}::jsonb)
    `);
  });
}

/** Run one social DM turn through the shared bot orchestrator. */
export async function runSocialBot(
  app: FastifyInstance,
  env: Env,
  inbound: UnifiedInboundMessage,
  piiKey: string,
): Promise<void> {
  try {
    const llm = createAnthropicLlmClient(env.ANTHROPIC_API_KEY);
    if (!llm) return; // bot disabled (no key) — message acknowledged, no auto-reply.
    const text = inbound.text?.trim() ?? '';
    if (text.length === 0) return; // image/sticker only — nothing to answer.

    const convKey = socialConversationKey(inbound.channel, inbound.senderId);

    const rows = (await app.db.execute<ConversationRow>(sql`
      INSERT INTO whatsapp_conversations (customer_phone_e164, last_inbound_at)
      VALUES (${convKey}, now())
      ON CONFLICT (customer_phone_e164)
      DO UPDATE SET last_inbound_at = now()
      RETURNING id::text AS id, ai_active, cooldown_until::text AS cooldown_until,
                customer_id::text AS customer_id
    `)) as unknown as ConversationRow[];
    const conv = rows[0];
    if (!conv) return;

    const state: ConversationState = {
      aiActive: conv.ai_active,
      cooldownUntil: conv.cooldown_until ? new Date(conv.cooldown_until) : null,
    };

    const spendRows = (await app.db.execute<{ spent: string }>(sql`
      SELECT COALESCE(SUM(cost_eur), 0)::text AS spent
      FROM ai_calls
      WHERE conversation_id = ${conv.id}::uuid AND created_at >= date_trunc('day', now())
    `)) as unknown as Array<{ spent: string }>;
    const spentTodayEur = Number(spendRows[0]?.spent ?? '0');

    const tools = createWhatsAppBotTools({
      db: app.db,
      customerPhoneE164: convKey,
      customerId: conv.customer_id,
      log: app.log,
    });

    const result = await runBotTurn({ llm, tools, state, customerMessage: text, spentTodayEur });
    if (result.kind === 'skipped') return;
    await persistAiCalls(app, conv.id, result.calls);

    if (result.kind === 'escalated') {
      app.log.info(
        { channel: inbound.channel, sender: inbound.senderId, reason: result.reason },
        'social bot: escalated',
      );
      return;
    }

    if (result.reactivated) {
      await app.db.execute(sql`
        UPDATE whatsapp_conversations SET ai_active = TRUE WHERE id = ${conv.id}::uuid
      `);
    }

    if (env.META_PAGE_ACCESS_TOKEN.length === 0) {
      await storeOutbound(app, piiKey, convKey, result.reply, 'queued', null);
      return;
    }

    try {
      const sent = await sendSocialReply({
        pageAccessToken: env.META_PAGE_ACCESS_TOKEN,
        recipientId: inbound.senderId,
        text: result.reply,
      });
      await storeOutbound(app, piiKey, convKey, result.reply, 'sent', sent.messageId || null);
    } catch (err) {
      const providerCode = err instanceof SocialSendError ? err.providerCode : null;
      app.log.warn(
        { providerCode, channel: inbound.channel, sender: inbound.senderId },
        'social bot: reply send rejected by provider',
      );
      await storeOutbound(app, piiKey, convKey, result.reply, 'failed', null);
    }
  } catch (err) {
    app.log.error(
      { err, channel: inbound.channel, sender: inbound.senderId },
      'social bot: orchestrator run failed',
    );
  }
}
