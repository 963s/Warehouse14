/**
 * mcp — Model Context Protocol client (Phase 2.A).
 *
 * Thin wrapper over `POST /api/mcp` that speaks JSON-RPC 2.0. The
 * dispatcher returns the JSON-RPC envelope unchanged in the HTTP body —
 * this client unwraps `.result` on success and throws a typed
 * `McpToolError` on the `.error` branch.
 *
 * V1 surface (matches `apps/api-cloud/src/mcp/server.ts`):
 *   • method `tools/list`    — enumerate tools
 *   • method `tools/call`    — invoke one tool
 *
 * Consumers will be:
 *   • Admin orchestrator (Phase 2.A.2) — auto-fill SEO descriptions
 *     across a batch of products.
 *   • Bewertung screen (Phase 2.B) — operator clicks "Schätzen" and
 *     this client calls `appraise_estate_item`.
 */

import type { ApiClient } from '../client.js';

// ────────────────────────────────────────────────────────────────────────
// JSON-RPC envelope shapes (subset)
// ────────────────────────────────────────────────────────────────────────

interface JsonRpcSuccess<T> {
  jsonrpc: '2.0';
  id: string;
  result: T;
}
interface JsonRpcErrorEnvelope {
  jsonrpc: '2.0';
  id: string;
  error: { code: number; message: string; data?: unknown };
}
type JsonRpcResponse<T> = JsonRpcSuccess<T> | JsonRpcErrorEnvelope;

// ────────────────────────────────────────────────────────────────────────
// Tool manifest + call shapes
// ────────────────────────────────────────────────────────────────────────

export interface McpToolManifest {
  name: string;
  description: string;
  /** JSON Schema — the orchestrator uses this to construct valid args. */
  inputSchema: unknown;
  isMutation: boolean;
}

export interface McpToolsListResult {
  tools: McpToolManifest[];
}

export interface McpToolContentBlock {
  type: 'text';
  text: string;
}

/**
 * The structured payload returned by a tool. `content` is the
 * "human-readable" view (suitable for showing in a chat-style UI).
 * `data` is the machine-readable result that callers should
 * `.data as <ExpectedShape>` against.
 */
export interface McpToolResult<TData = unknown> {
  content: McpToolContentBlock[];
  data: TData;
  affectedEntity?: { table: string; id: string };
  cost?: {
    tokensIn: number;
    tokensOut: number;
    costUsdMicros: string; // bigint over the wire is a string
  };
}

// ────────────────────────────────────────────────────────────────────────
// Tool-specific result shapes — typed surface for the two V1 tools.
// ────────────────────────────────────────────────────────────────────────

export interface GenerateSeoDescriptionArgs {
  productId: string;
  locale?: 'de' | 'en';
  tone?: 'auction-house' | 'collector' | 'investor';
  maxLength?: number;
}

export interface GenerateSeoDescriptionData {
  productId: string;
  locale: 'de' | 'en';
  description: string;
  wrote: boolean;
}

export interface AppraiseEstateItemArgs {
  itemDescription: string;
  itemType: 'COIN' | 'JEWELRY' | 'ANTIQUE_FURNITURE' | 'ART' | 'WATCH' | 'OTHER';
  metal?: 'GOLD' | 'SILVER' | 'PLATINUM' | 'PALLADIUM';
  weightGrams?: string;
  finenessDecimal?: string;
  yearMintedFrom?: number;
  yearMintedTo?: number;
  originCountry?: string;
  condition?: 'MINT' | 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  notes?: string;
}

export interface AppraiseEstateItemData {
  /** bigint cents on the wire as a string. Convert with BigInt(value). */
  estimatedValueCents: string;
  lowEndCents: string;
  highEndCents: string;
  confidence: 'low' | 'medium' | 'high';
  rationale: string;
  suggestedBuyOfferCents: string;
  factors: Array<{ name: string; contributionCents: string }>;
}

// ────────────────────────────────────────────────────────────────────────
// Error type
// ────────────────────────────────────────────────────────────────────────

/**
 * Thrown by `mcpApi.callTool` when the JSON-RPC envelope is `error`.
 * `code` follows the spec (negative integers); see `JsonRpcErrorCode`
 * in the server for the V1 set.
 */
export class McpToolError extends Error {
  public readonly code: number;
  public readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'McpToolError';
    this.code = code;
    this.data = data;
  }
}

// ────────────────────────────────────────────────────────────────────────
// API surface
// ────────────────────────────────────────────────────────────────────────

let _rpcIdCounter = 0;
function nextRpcId(): string {
  // Cryptographic id is not needed — request id is for log-correlation
  // only. A monotonic counter + boot-marker is sufficient.
  _rpcIdCounter += 1;
  return `mcp-${Date.now()}-${_rpcIdCounter}`;
}

async function callRpc<T>(
  client: ApiClient,
  method: 'tools/list' | 'tools/call',
  params: unknown,
): Promise<T> {
  const id = nextRpcId();
  const body = { jsonrpc: '2.0' as const, id, method, params };
  const res = await client.request<JsonRpcResponse<T>>('POST', '/api/mcp', body);
  if ('error' in res) {
    throw new McpToolError(res.error.code, res.error.message, res.error.data);
  }
  return res.result;
}

export const mcpApi = {
  /** Enumerate available tools — drives "AI actions" UI in the admin. */
  listTools(client: ApiClient): Promise<McpToolsListResult> {
    return callRpc<McpToolsListResult>(client, 'tools/list', {});
  },

  /**
   * Invoke a tool by name. The caller is responsible for casting `data`
   * to the appropriate per-tool shape (see the helpers below for typed
   * convenience methods).
   */
  callTool<TData = unknown>(
    client: ApiClient,
    name: string,
    args: unknown,
  ): Promise<McpToolResult<TData>> {
    return callRpc<McpToolResult<TData>>(client, 'tools/call', {
      name,
      arguments: args,
    });
  },

  /** Typed convenience — `generate_seo_description`. */
  generateSeoDescription(
    client: ApiClient,
    args: GenerateSeoDescriptionArgs,
  ): Promise<McpToolResult<GenerateSeoDescriptionData>> {
    return mcpApi.callTool<GenerateSeoDescriptionData>(
      client,
      'generate_seo_description',
      args,
    );
  },

  /** Typed convenience — `appraise_estate_item`. */
  appraiseEstateItem(
    client: ApiClient,
    args: AppraiseEstateItemArgs,
  ): Promise<McpToolResult<AppraiseEstateItemData>> {
    return mcpApi.callTool<AppraiseEstateItemData>(
      client,
      'appraise_estate_item',
      args,
    );
  },
};
