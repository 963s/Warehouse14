/**
 * Chatwoot Agent Bot edge (Decision #48). Pure event planner + a thin REST
 * reply helper + the human-takeover applier. No custom inbox/schema — Chatwoot
 * owns the dashboard; we only translate its webhook into bot actions and post
 * the bot's reply back through Chatwoot's API.
 */

import type { Env } from '../config/env.js';

export const CHATWOOT_TAKEOVER_COOLDOWN_HOURS = 12;

export type ChatwootAction =
  | { kind: 'run_bot'; conversationId: number; conversationKey: string; text: string }
  | { kind: 'human_takeover'; conversationId: number; conversationKey: string }
  | { kind: 'ignore'; reason: string };

interface RawContact {
  phone_number?: string;
  identifier?: string;
}
interface RawConversation {
  id?: number;
  status?: string;
  meta?: { sender?: RawContact };
}
interface RawChatwootPayload {
  event?: string;
  message_type?: string;
  content?: string;
  status?: string;
  id?: number;
  sender?: RawContact;
  meta?: { sender?: RawContact };
  conversation?: RawConversation;
}

/** Stable key for whatsapp_conversations.customer_phone_e164 (phone/identifier, else conv id). */
function conversationKeyOf(p: RawChatwootPayload, conversationId: number): string {
  const contact = p.sender ?? p.conversation?.meta?.sender ?? p.meta?.sender;
  const phone = contact?.phone_number?.trim();
  if (phone) return phone;
  const identifier = contact?.identifier?.trim();
  if (identifier) return `chatwoot:${identifier}`;
  return `chatwoot:conv:${conversationId}`;
}

/**
 * Translate a Chatwoot Agent Bot webhook payload into an action:
 *   • incoming message_created → run the AI bot,
 *   • conversation_status_changed → open → human takeover (pause AI),
 *   • everything else → ignore.
 */
export function planChatwootEvent(payload: unknown): ChatwootAction {
  const p = (payload ?? {}) as RawChatwootPayload;
  const event = p.event;

  if (event === 'message_created') {
    const messageType = p.message_type;
    const text = typeof p.content === 'string' ? p.content.trim() : '';
    const conversationId = p.conversation?.id ?? p.id;
    if (messageType !== 'incoming') return { kind: 'ignore', reason: 'not an incoming message' };
    if (text.length === 0) return { kind: 'ignore', reason: 'empty message body' };
    if (typeof conversationId !== 'number') return { kind: 'ignore', reason: 'no conversation id' };
    return {
      kind: 'run_bot',
      conversationId,
      conversationKey: conversationKeyOf(p, conversationId),
      text,
    };
  }

  if (event === 'conversation_status_changed') {
    const status = p.status ?? p.conversation?.status;
    const conversationId = p.conversation?.id ?? p.id;
    if (status !== 'open')
      return { kind: 'ignore', reason: `status ${status ?? 'unknown'} not open` };
    if (typeof conversationId !== 'number') return { kind: 'ignore', reason: 'no conversation id' };
    return {
      kind: 'human_takeover',
      conversationId,
      conversationKey: conversationKeyOf(p, conversationId),
    };
  }

  return { kind: 'ignore', reason: `unhandled event ${event ?? 'none'}` };
}

// ── Human takeover ─────────────────────────────────────────────────────────

/** Injected DB writer (the route wires the whatsapp_conversations UPSERT). */
export interface TakeoverExecutor {
  setTakeover(args: { conversationKey: string; cooldownUntil: Date }): Promise<void>;
}

export interface TakeoverResult {
  aiActive: false;
  cooldownUntil: Date;
}

/**
 * Pause the AI for a conversation: ai_active = false, cooldown_until = now + 12h.
 * Pure orchestration over an injected executor → unit-testable without a DB.
 */
export async function applyHumanTakeover(
  exec: TakeoverExecutor,
  conversationKey: string,
  now: Date = new Date(),
): Promise<TakeoverResult> {
  const cooldownUntil = new Date(now.getTime() + CHATWOOT_TAKEOVER_COOLDOWN_HOURS * 60 * 60 * 1000);
  await exec.setTakeover({ conversationKey, cooldownUntil });
  return { aiActive: false, cooldownUntil };
}

// ── Outbound reply via the Chatwoot REST API ────────────────────────────────

export const CHATWOOT_SEND_TIMEOUT_MS = 10_000;

/** POST the bot reply back into the Chatwoot conversation (message_type: outgoing). */
export async function postChatwootReply(
  env: Env,
  conversationId: number,
  body: string,
): Promise<{ ok: boolean }> {
  if (!env.CHATWOOT_URL || !env.CHATWOOT_ACCOUNT_ID || !env.CHATWOOT_BOT_TOKEN) {
    return { ok: false };
  }
  const base = env.CHATWOOT_URL.replace(/\/$/, '');
  const url = `${base}/api/v1/accounts/${env.CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('chatwoot send timeout')),
    CHATWOOT_SEND_TIMEOUT_MS,
  );
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        api_access_token: env.CHATWOOT_BOT_TOKEN,
      },
      body: JSON.stringify({ content: body, message_type: 'outgoing' }),
      signal: controller.signal,
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}
