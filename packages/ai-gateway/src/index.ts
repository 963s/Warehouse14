/**
 * @warehouse14/ai-gateway — task-level Claude abstractions for the WhatsApp bot
 * (Epic E). Two tasks: `classifyCustomerIntent` (cheap, Haiku) and
 * `composeBotReply` (Sonnet). Cost is estimated per call so callers can record
 * `ai_calls` rows and enforce a per-conversation daily budget (€0.50).
 *
 * The LLM transport is INJECTED (`LlmClient`) — this package has no Anthropic
 * SDK dependency and stays pure/testable. A deterministic `createMockLlmClient`
 * ships for dev/test; the production Anthropic-backed client implements the
 * same interface (see the orchestrator wiring, deferred).
 */

// ════════════════════════════════════════════════════════════════════════
// LLM transport (injected)
// ════════════════════════════════════════════════════════════════════════

export type ClaudeModel = 'claude-haiku-4-5' | 'claude-sonnet-4-6';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmCompleteRequest {
  model: ClaudeModel;
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LlmResponse {
  text: string;
  usage: TokenUsage;
}

// ── Tool-calling transport (optional capability) ─────────────────────────
// The Anthropic Messages API tool-use loop, abstracted. A client that
// supports tool calling implements `completeWithTools`; the orchestrator
// degrades gracefully (compose-only) when it is absent.

/** A tool the model may call — name + human description + JSON-schema input. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** One tool invocation the model requested this turn. */
export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** A turn in the tool-use conversation. `tool_results` feeds outputs back. */
export type LlmMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolUses: ToolUse[] }
  | { role: 'tool_results'; results: Array<{ toolUseId: string; content: string }> };

export interface LlmToolRequest {
  model: ClaudeModel;
  system?: string;
  messages: LlmMessage[];
  tools: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
}

export interface LlmToolResponse {
  /** Assistant prose for this turn (may be empty when only tool calls). */
  text: string;
  /** Tool calls the model wants executed before it continues. */
  toolUses: ToolUse[];
  stopReason: 'tool_use' | 'end_turn' | 'max_tokens';
  usage: TokenUsage;
}

export interface LlmClient {
  complete(req: LlmCompleteRequest): Promise<LlmResponse>;
  /** Optional — present only on tool-calling-capable transports. */
  completeWithTools?(req: LlmToolRequest): Promise<LlmToolResponse>;
}

// ════════════════════════════════════════════════════════════════════════
// Cost + budget
// ════════════════════════════════════════════════════════════════════════

/** EUR per 1,000,000 tokens. Config — update as Anthropic pricing changes. */
const PRICING_EUR_PER_1M: Record<ClaudeModel, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 0.8, output: 4.0 },
  'claude-sonnet-4-6': { input: 2.7, output: 13.5 },
};

/** Estimated EUR cost of a call, rounded to 6 dp. */
export function estimateCostEur(model: ClaudeModel, usage: TokenUsage): number {
  const p = PRICING_EUR_PER_1M[model];
  const eur =
    (usage.inputTokens / 1_000_000) * p.input + (usage.outputTokens / 1_000_000) * p.output;
  return Math.round(eur * 1_000_000) / 1_000_000;
}

/** Default per-conversation daily AI budget cap (Epic E). */
export const DEFAULT_CONVERSATION_DAILY_CAP_EUR = 0.5;

export interface BudgetDecision {
  allowed: boolean;
  spentEur: number;
  capEur: number;
  remainingEur: number;
}

/** Decide whether another AI call is within the conversation's daily cap. */
export function checkConversationBudget(
  spentEur: number,
  capEur: number = DEFAULT_CONVERSATION_DAILY_CAP_EUR,
): BudgetDecision {
  return {
    allowed: spentEur < capEur,
    spentEur,
    capEur,
    remainingEur: Math.max(0, capEur - spentEur),
  };
}

// ════════════════════════════════════════════════════════════════════════
// Task 1 — intent + sentiment classification (Haiku)
// ════════════════════════════════════════════════════════════════════════

export const CUSTOMER_INTENTS = [
  'PRODUCT_INQUIRY',
  'BUYBACK_QUOTE',
  'APPOINTMENT',
  'ORDER_STATUS',
  'COMPLAINT',
  'OTHER',
] as const;
export type CustomerIntent = (typeof CUSTOMER_INTENTS)[number];

export const SENTIMENTS = ['POSITIVE', 'NEUTRAL', 'NEGATIVE'] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export interface IntentClassification {
  intent: CustomerIntent;
  sentiment: Sentiment;
  /** Model confidence in [0, 1]. */
  confidence: number;
}

export interface IntentResult extends IntentClassification {
  usage: TokenUsage;
  costEur: number;
  model: ClaudeModel;
}

const CLASSIFY_MODEL: ClaudeModel = 'claude-haiku-4-5';
const COMPOSE_MODEL: ClaudeModel = 'claude-sonnet-4-6';

const CLASSIFY_SYSTEM = `You classify a customer WhatsApp message for a German gold/antiques shop. Reply with ONLY compact JSON: {"intent": one of ${CUSTOMER_INTENTS.join('|')}, "sentiment": POSITIVE|NEUTRAL|NEGATIVE, "confidence": 0..1}.`;

function isIntent(v: unknown): v is CustomerIntent {
  return typeof v === 'string' && (CUSTOMER_INTENTS as readonly string[]).includes(v);
}
function isSentiment(v: unknown): v is Sentiment {
  return typeof v === 'string' && (SENTIMENTS as readonly string[]).includes(v);
}

/** Parse the classifier's JSON defensively — never throw on a bad model reply. */
export function parseClassification(text: string): IntentClassification {
  try {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      return { intent: 'OTHER', sentiment: 'NEUTRAL', confidence: 0 };
    }
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const intent = isIntent(obj.intent) ? obj.intent : 'OTHER';
    const sentiment = isSentiment(obj.sentiment) ? obj.sentiment : 'NEUTRAL';
    const rawConf = typeof obj.confidence === 'number' ? obj.confidence : 0;
    const confidence = Math.min(1, Math.max(0, Number.isFinite(rawConf) ? rawConf : 0));
    return { intent, sentiment, confidence };
  } catch {
    return { intent: 'OTHER', sentiment: 'NEUTRAL', confidence: 0 };
  }
}

export async function classifyCustomerIntent(
  client: LlmClient,
  message: string,
): Promise<IntentResult> {
  const res = await client.complete({
    model: CLASSIFY_MODEL,
    system: CLASSIFY_SYSTEM,
    prompt: message,
    maxTokens: 200,
    temperature: 0,
  });
  return {
    ...parseClassification(res.text),
    usage: res.usage,
    costEur: estimateCostEur(CLASSIFY_MODEL, res.usage),
    model: CLASSIFY_MODEL,
  };
}

// ════════════════════════════════════════════════════════════════════════
// Task 2 — reply composition (Sonnet)
// ════════════════════════════════════════════════════════════════════════

export const DEFAULT_BOT_SIGNATURE = '— Automatische Antwort · Warehouse14';

const COMPOSE_SYSTEM =
  'You are the assistant for a German gold/antiques shop in Weil am Rhein. ' +
  'Answer the customer in their language (default German), concise and friendly. ' +
  'Use ONLY the provided context; never invent prices or stock. When a buyback ' +
  'price is mentioned, state it is "vorbehaltlich der physischen Prüfung".';

export interface ComposeContext {
  /** The customer's latest message. */
  customerMessage: string;
  /** Tool/router results to ground the reply (inventory hits, price band, …). */
  toolContext?: string;
  /** Signature appended to the reply. */
  signature?: string;
}

export interface ComposeResult {
  reply: string;
  usage: TokenUsage;
  costEur: number;
  model: ClaudeModel;
}

function buildComposePrompt(ctx: ComposeContext): string {
  const parts = [`Kundennachricht: ${ctx.customerMessage}`];
  if (ctx.toolContext && ctx.toolContext.length > 0) {
    parts.push(`Kontext (verifizierte Daten):\n${ctx.toolContext}`);
  }
  return parts.join('\n\n');
}

export async function composeBotReply(
  client: LlmClient,
  ctx: ComposeContext,
): Promise<ComposeResult> {
  const res = await client.complete({
    model: COMPOSE_MODEL,
    system: COMPOSE_SYSTEM,
    prompt: buildComposePrompt(ctx),
    maxTokens: 600,
    temperature: 0.3,
  });
  const signature = ctx.signature ?? DEFAULT_BOT_SIGNATURE;
  return {
    reply: `${res.text.trim()}\n\n${signature}`,
    usage: res.usage,
    costEur: estimateCostEur(COMPOSE_MODEL, res.usage),
    model: COMPOSE_MODEL,
  };
}

// ════════════════════════════════════════════════════════════════════════
// Deterministic mock transport (dev / test — no Anthropic SDK / API key)
// ════════════════════════════════════════════════════════════════════════

export interface MockLlmOptions {
  /** Fixed token usage so cost assertions are deterministic. */
  usage?: TokenUsage;
}

/** A keyword-routed mock so the bot flow runs end-to-end without a real model. */
export function createMockLlmClient(opts: MockLlmOptions = {}): LlmClient {
  const usage = opts.usage ?? { inputTokens: 120, outputTokens: 60 };
  return {
    complete(req: LlmCompleteRequest): Promise<LlmResponse> {
      if (req.model === CLASSIFY_MODEL) {
        const m = req.prompt.toLowerCase();
        let intent: CustomerIntent = 'OTHER';
        if (/(preis|ankauf|verkauf|gramm|gold|silber)/.test(m)) intent = 'BUYBACK_QUOTE';
        else if (/(termin|appointment|wann)/.test(m)) intent = 'APPOINTMENT';
        else if (/(bestellung|order|sendung|tracking)/.test(m)) intent = 'ORDER_STATUS';
        else if (/(ring|kette|uhr|verfügbar|haben sie)/.test(m)) intent = 'PRODUCT_INQUIRY';
        else if (/(beschwerde|schlecht|ärger|enttäuscht)/.test(m)) intent = 'COMPLAINT';
        const sentiment: Sentiment = intent === 'COMPLAINT' ? 'NEGATIVE' : 'NEUTRAL';
        const confidence = intent === 'OTHER' ? 0.4 : 0.85;
        return Promise.resolve({
          text: JSON.stringify({ intent, sentiment, confidence }),
          usage,
        });
      }
      // Compose path.
      return Promise.resolve({
        text: 'Vielen Dank für Ihre Nachricht. Gerne helfe ich Ihnen weiter.',
        usage,
      });
    },
    completeWithTools(req: LlmToolRequest): Promise<LlmToolResponse> {
      // Once a tool result is in the transcript, the mock "reads" it and ends.
      const sawToolResults = req.messages.some((m) => m.role === 'tool_results');
      const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
      const text = lastUser && lastUser.role === 'user' ? lastUser.content.toLowerCase() : '';
      const has = (name: string) => req.tools.some((t) => t.name === name);

      if (sawToolResults || req.tools.length === 0) {
        return Promise.resolve({ text: '', toolUses: [], stopReason: 'end_turn', usage });
      }

      // Pick exactly one tool by keyword so a single loop iteration grounds the reply.
      let toolUse: ToolUse | null = null;
      if (/(beschwerde|schlecht|ärger|enttäuscht)/.test(text) && has('escalate_to_human')) {
        toolUse = { id: 'mock-1', name: 'escalate_to_human', input: { reason: 'complaint' } };
      } else if (/(preis|ankauf|gramm|gold|silber)/.test(text) && has('estimate_buyback_price')) {
        toolUse = {
          id: 'mock-1',
          name: 'estimate_buyback_price',
          input: { metal: 'gold', grams: 10 },
        };
      } else if (/(bestellung|order|sendung|tracking)/.test(text) && has('check_order_status')) {
        toolUse = { id: 'mock-1', name: 'check_order_status', input: {} };
      } else if (/(termin|appointment)/.test(text) && has('get_appointment_status')) {
        toolUse = { id: 'mock-1', name: 'get_appointment_status', input: {} };
      } else if (/(ring|kette|uhr|verfügbar|haben sie)/.test(text) && has('search_inventory')) {
        toolUse = { id: 'mock-1', name: 'search_inventory', input: { query: text } };
      }

      if (!toolUse) {
        return Promise.resolve({ text: '', toolUses: [], stopReason: 'end_turn', usage });
      }
      return Promise.resolve({ text: '', toolUses: [toolUse], stopReason: 'tool_use', usage });
    },
  };
}

// Re-export the tool + orchestrator surface so consumers import from one entry.
export * from './tools.js';
export * from './orchestrator.js';
export * from './vision.js';
