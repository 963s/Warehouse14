/**
 * Bot orchestrator — the decision flow for one inbound WhatsApp message.
 *
 *   1. Cooldown gate: a human takeover (ai_active=false) silences the bot
 *      until cooldown_until lapses; then the bot re-activates itself.
 *   2. Classify intent + sentiment (Haiku, cheap).
 *   3. Escalate to a human on NEGATIVE sentiment or low confidence.
 *   4. Otherwise run the Sonnet tool-use loop to gather verified context,
 *      then compose the final reply (signature appended).
 *
 * Pure + injectable: takes an `LlmClient` and `BotTools`, returns a decision.
 * The host persists ai_calls rows, sends the reply, and flips ai_active.
 */

import {
  type ClaudeModel,
  type IntentResult,
  type LlmClient,
  type LlmMessage,
  type TokenUsage,
  checkConversationBudget,
  classifyCustomerIntent,
  composeBotReply,
  estimateCostEur,
} from './index.js';
import { BOT_TOOL_DEFINITIONS, type BotTools, ESCALATE_TOOL_NAME, dispatchTool } from './tools.js';

/** Below this classifier confidence, hand off to a human. */
export const ESCALATION_CONFIDENCE_THRESHOLD = 0.7;

/** Hard cap on tool-use iterations so a misbehaving model can't loop forever. */
export const MAX_TOOL_ITERATIONS = 4;

const COMPOSE_MODEL: ClaudeModel = 'claude-sonnet-4-6';

const ORCHESTRATOR_SYSTEM =
  'You are the assistant for a German gold/antiques shop in Schorndorf. Use the ' +
  'provided tools to fetch VERIFIED data (inventory, prices, orders, appointments) ' +
  'before answering — never invent prices or stock. Call escalate_to_human for ' +
  'complaints, disputes, or anything the tools cannot answer. Keep tool calls minimal.';

/** A single Claude call worth recording in `ai_calls`. */
export interface AiCallRecord {
  kind: 'classify' | 'compose' | 'tool';
  model: ClaudeModel;
  usage: TokenUsage;
  costEur: number;
}

export interface ConversationState {
  aiActive: boolean;
  cooldownUntil: Date | null;
}

export type CooldownDecision =
  | { action: 'skip'; reason: 'in_cooldown' }
  | { action: 'reactivate' }
  | { action: 'proceed' };

/**
 * Decide whether the bot may answer given the conversation's takeover state.
 *   • active                       → proceed
 *   • inactive, cooldown in future → skip (human still in control)
 *   • inactive, cooldown lapsed    → reactivate (and proceed)
 */
export function decideCooldown(state: ConversationState, now: Date = new Date()): CooldownDecision {
  if (state.aiActive) return { action: 'proceed' };
  if (state.cooldownUntil && state.cooldownUntil.getTime() > now.getTime()) {
    return { action: 'skip', reason: 'in_cooldown' };
  }
  return { action: 'reactivate' };
}

export interface BotTurnDeps {
  llm: LlmClient;
  tools: BotTools;
  state: ConversationState;
  customerMessage: string;
  /** EUR already spent on this conversation today (for the daily cap). */
  spentTodayEur: number;
  capEur?: number;
  signature?: string;
  now?: Date;
}

export type BotTurnResult =
  | { kind: 'skipped'; reason: 'in_cooldown' | 'budget_exhausted' }
  | {
      kind: 'escalated';
      reason: string;
      reactivated: boolean;
      classification?: IntentResult;
      calls: AiCallRecord[];
    }
  | {
      kind: 'replied';
      reply: string;
      reactivated: boolean;
      classification: IntentResult;
      toolCalls: string[];
      calls: AiCallRecord[];
    };

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}

interface ToolLoopOutput {
  toolContext: string;
  toolCalls: string[];
  escalated: boolean;
  escalationReason: string | null;
  calls: AiCallRecord[];
}

/**
 * Drive the tool-use loop: let the model call tools to gather grounding data,
 * accumulate the results as context, and short-circuit if it escalates.
 */
async function runToolLoop(
  llm: LlmClient,
  tools: BotTools,
  customerMessage: string,
): Promise<ToolLoopOutput> {
  const calls: AiCallRecord[] = [];
  const toolCalls: string[] = [];
  const contextParts: string[] = [];

  if (!llm.completeWithTools) {
    return { toolContext: '', toolCalls, escalated: false, escalationReason: null, calls };
  }

  const messages: LlmMessage[] = [{ role: 'user', content: customerMessage }];

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const res = await llm.completeWithTools({
      model: COMPOSE_MODEL,
      system: ORCHESTRATOR_SYSTEM,
      messages,
      tools: BOT_TOOL_DEFINITIONS,
      maxTokens: 800,
      temperature: 0,
    });
    calls.push({
      kind: 'tool',
      model: COMPOSE_MODEL,
      usage: res.usage,
      costEur: estimateCostEur(COMPOSE_MODEL, res.usage),
    });

    if (res.stopReason !== 'tool_use' || res.toolUses.length === 0) break;

    messages.push({ role: 'assistant', content: res.text, toolUses: res.toolUses });

    const results: Array<{ toolUseId: string; content: string }> = [];
    for (const tu of res.toolUses) {
      toolCalls.push(tu.name);
      if (tu.name === ESCALATE_TOOL_NAME) {
        const reason =
          typeof tu.input.reason === 'string' ? tu.input.reason : 'model requested escalation';
        await dispatchTool(tools, tu.name, tu.input);
        return {
          toolContext: contextParts.join('\n'),
          toolCalls,
          escalated: true,
          escalationReason: reason,
          calls,
        };
      }
      const out = await dispatchTool(tools, tu.name, tu.input);
      const serialized = JSON.stringify(out);
      contextParts.push(`${tu.name} → ${serialized}`);
      results.push({ toolUseId: tu.id, content: serialized });
    }
    messages.push({ role: 'tool_results', results });
  }

  return {
    toolContext: contextParts.join('\n'),
    toolCalls,
    escalated: false,
    escalationReason: null,
    calls,
  };
}

/**
 * Run one bot turn for an inbound message. The caller is responsible for
 * persisting `calls` into `ai_calls`, sending `reply` to Meta, and applying
 * the `reactivated` flag (ai_active=true) / escalation (ai_active=false).
 */
export async function runBotTurn(deps: BotTurnDeps): Promise<BotTurnResult> {
  const now = deps.now ?? new Date();
  const cooldown = decideCooldown(deps.state, now);
  if (cooldown.action === 'skip') {
    return { kind: 'skipped', reason: 'in_cooldown' };
  }
  const reactivated = cooldown.action === 'reactivate';

  // Daily per-conversation budget gate. If exhausted, hand to a human rather
  // than answering — the customer still gets attention.
  const budget = checkConversationBudget(deps.spentTodayEur, deps.capEur);
  if (!budget.allowed) {
    await deps.tools.escalateToHuman({ reason: 'daily_budget_exhausted' });
    return { kind: 'escalated', reason: 'budget_exhausted', reactivated, calls: [] };
  }

  const calls: AiCallRecord[] = [];

  const classification = await classifyCustomerIntent(deps.llm, deps.customerMessage);
  calls.push({
    kind: 'classify',
    model: classification.model,
    usage: classification.usage,
    costEur: classification.costEur,
  });

  if (
    classification.sentiment === 'NEGATIVE' ||
    classification.confidence < ESCALATION_CONFIDENCE_THRESHOLD
  ) {
    const reason =
      classification.sentiment === 'NEGATIVE' ? 'negative_sentiment' : 'low_confidence';
    await deps.tools.escalateToHuman({ reason });
    return { kind: 'escalated', reason, reactivated, classification, calls };
  }

  const loop = await runToolLoop(deps.llm, deps.tools, deps.customerMessage);
  calls.push(...loop.calls);

  if (loop.escalated) {
    return {
      kind: 'escalated',
      reason: loop.escalationReason ?? 'model_escalation',
      reactivated,
      classification,
      calls,
    };
  }

  const composeArgs: Parameters<typeof composeBotReply>[1] = {
    customerMessage: deps.customerMessage,
  };
  if (loop.toolContext.length > 0) composeArgs.toolContext = loop.toolContext;
  if (deps.signature !== undefined) composeArgs.signature = deps.signature;

  const composed = await composeBotReply(deps.llm, composeArgs);
  calls.push({
    kind: 'compose',
    model: composed.model,
    usage: composed.usage,
    costEur: composed.costEur,
  });

  return {
    kind: 'replied',
    reply: composed.reply,
    reactivated,
    classification,
    toolCalls: loop.toolCalls,
    calls,
  };
}

/** Total EUR across a set of recorded calls — convenience for the caller. */
export function sumCallCost(calls: AiCallRecord[]): number {
  const total = calls.reduce((acc, c) => acc + c.costEur, 0);
  return Math.round(total * 1_000_000) / 1_000_000;
}

export { addUsage };
