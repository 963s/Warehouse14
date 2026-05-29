/**
 * Anthropic Messages API transport for @warehouse14/ai-gateway's `LlmClient`.
 *
 * Deliberately SDK-free — a raw `fetch` against /v1/messages, mirroring the
 * `sendToMeta` pattern in whatsapp-inbox.ts. Keeps the dependency surface
 * (and supply-chain risk) minimal and makes the wire format auditable.
 *
 * Implements both capabilities:
 *   • complete(...)          — single-turn text (classify + compose).
 *   • completeWithTools(...) — the tool-use loop (orchestrator routing).
 *
 * The API key is read once at construction; it is NEVER logged.
 */

import type {
  ClaudeModel,
  LlmClient,
  LlmCompleteRequest,
  LlmResponse,
  LlmToolRequest,
  LlmToolResponse,
  ToolUse,
} from '@warehouse14/ai-gateway';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Map the gateway's logical model names to concrete Anthropic API model ids.
 * Kept here (not in the pure gateway) so pricing/logical names stay stable
 * while the deployed snapshot id can be tuned without touching the gateway.
 */
const MODEL_ID: Record<ClaudeModel, string> = {
  'claude-haiku-4-5': 'claude-haiku-4-5',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
};

interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
}

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}
interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | { type: string };

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  usage?: AnthropicUsage;
}

class AnthropicApiError extends Error {
  public readonly status: number;
  public constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'AnthropicApiError';
  }
}

async function postMessages(
  apiKey: string,
  body: Record<string, unknown>,
): Promise<AnthropicResponse> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('anthropic timeout')),
    REQUEST_TIMEOUT_MS,
  );
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    // Surface only status + a short snippet — never echo the request (it holds
    // the customer message) or any auth material.
    throw new AnthropicApiError(`anthropic http ${res.status}: ${text.slice(0, 200)}`, res.status);
  }
  try {
    return JSON.parse(text) as AnthropicResponse;
  } catch {
    throw new AnthropicApiError('anthropic returned non-JSON', res.status);
  }
}

function usageOf(r: AnthropicResponse): { inputTokens: number; outputTokens: number } {
  return {
    inputTokens: r.usage?.input_tokens ?? 0,
    outputTokens: r.usage?.output_tokens ?? 0,
  };
}

function textOf(r: AnthropicResponse): string {
  return (r.content ?? [])
    .filter((b): b is AnthropicTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

function toolUsesOf(r: AnthropicResponse): ToolUse[] {
  return (r.content ?? [])
    .filter((b): b is AnthropicToolUseBlock => b.type === 'tool_use')
    .map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} }));
}

function mapStopReason(reason: string | undefined): LlmToolResponse['stopReason'] {
  if (reason === 'tool_use') return 'tool_use';
  if (reason === 'max_tokens') return 'max_tokens';
  return 'end_turn';
}

/** Translate our neutral message log into the Anthropic content-block shape. */
function toAnthropicMessages(req: LlmToolRequest): Array<Record<string, unknown>> {
  return req.messages.map((m) => {
    if (m.role === 'user') {
      return { role: 'user', content: m.content };
    }
    if (m.role === 'assistant') {
      const blocks: Array<Record<string, unknown>> = [];
      if (m.content.length > 0) blocks.push({ type: 'text', text: m.content });
      for (const tu of m.toolUses) {
        blocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input });
      }
      return { role: 'assistant', content: blocks };
    }
    // tool_results → a user turn carrying tool_result blocks.
    return {
      role: 'user',
      content: m.results.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.toolUseId,
        content: r.content,
      })),
    };
  });
}

/**
 * Build a production `LlmClient`. Returns `null` when no API key is set so the
 * caller can cleanly disable the bot in dev/test.
 */
export function createAnthropicLlmClient(apiKey: string): LlmClient | null {
  if (apiKey.length === 0) return null;

  return {
    async complete(req: LlmCompleteRequest): Promise<LlmResponse> {
      const body: Record<string, unknown> = {
        model: MODEL_ID[req.model],
        max_tokens: req.maxTokens ?? 1024,
        messages: [{ role: 'user', content: req.prompt }],
      };
      if (req.system !== undefined) body.system = req.system;
      if (req.temperature !== undefined) body.temperature = req.temperature;
      const r = await postMessages(apiKey, body);
      return { text: textOf(r), usage: usageOf(r) };
    },

    async completeWithTools(req: LlmToolRequest): Promise<LlmToolResponse> {
      const body: Record<string, unknown> = {
        model: MODEL_ID[req.model],
        max_tokens: req.maxTokens ?? 1024,
        messages: toAnthropicMessages(req),
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
      };
      if (req.system !== undefined) body.system = req.system;
      if (req.temperature !== undefined) body.temperature = req.temperature;
      const r = await postMessages(apiKey, body);
      return {
        text: textOf(r),
        toolUses: toolUsesOf(r),
        stopReason: mapStopReason(r.stop_reason),
        usage: usageOf(r),
      };
    },
  };
}
