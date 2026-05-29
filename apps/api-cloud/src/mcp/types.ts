/**
 * MCP type contracts — Phase 2.A scaffolding (memory.md §20.4).
 *
 * Mirrors the subset of the Model Context Protocol JSON-RPC 2.0 surface
 * we ship in V1:
 *
 *   • Method `tools/list`  → enumerate available tools + JSON Schemas.
 *   • Method `tools/call`  → invoke a single tool, return its result.
 *
 * The protocol is intentionally tiny — we don't ship `resources/*` or
 * `prompts/*` until a real LLM consumer asks for them. Adding either
 * later is a pure-addition: the JSON-RPC dispatcher in `server.ts`
 * keys on `method`, so a new branch slots in without touching the
 * existing tool surface.
 *
 * KEY INVARIANTS
 * ──────────────
 * 1. Every tool's argument schema is a `TSchema` (TypeBox). The
 *    dispatcher validates `params.arguments` against it BEFORE invoking
 *    the handler — no tool body ever sees malformed JSON.
 *
 * 2. Every handler returns a `ToolResult` that the dispatcher serializes
 *    into the JSON-RPC `result` envelope. Handlers do NOT touch the
 *    HTTP layer — they're pure(-ish) functions of (db, args, ctx).
 *
 * 3. Every handler is wrapped by `recordInvocation()` in `server.ts`
 *    so an `mcp_tool_invocations` row exists for every call. Skipping
 *    this is a CI smell — Phase 1.5 #I-30 adds a lint rule.
 */

import type { TSchema } from '@sinclair/typebox';
import type { FastifyBaseLogger } from 'fastify';

import type { AppDb } from '@warehouse14/db/client';

import type { Actor } from '../lib/actor.js';

// ────────────────────────────────────────────────────────────────────────
// JSON-RPC 2.0 envelope — subset we use.
// ────────────────────────────────────────────────────────────────────────

/** Inbound JSON-RPC 2.0 request. `id` is required (we don't accept notifications). */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: 'tools/list' | 'tools/call';
  params?: unknown;
}

/** Outbound success envelope. */
export interface JsonRpcSuccess<T> {
  jsonrpc: '2.0';
  id: string;
  result: T;
}

/** Outbound failure envelope. `code` follows the JSON-RPC convention. */
export interface JsonRpcError {
  jsonrpc: '2.0';
  id: string;
  error: {
    code: JsonRpcErrorCode;
    message: string;
    data?: unknown;
  };
}

/**
 * Standard JSON-RPC error codes — extended for MCP. We use the
 * application-range (-32099..-32000) for our own error semantics so
 * an LLM client can distinguish "tool failed" from "protocol error".
 */
export const JsonRpcErrorCode = {
  // Standard JSON-RPC 2.0
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // MCP / Warehouse14 extensions
  TOOL_NOT_FOUND: -32001,
  TOOL_REJECTED: -32002, // gatekeeper said no (auth / role / rate)
  TOOL_FAILED: -32003, // handler body threw
} as const;
export type JsonRpcErrorCode = (typeof JsonRpcErrorCode)[keyof typeof JsonRpcErrorCode];

// ────────────────────────────────────────────────────────────────────────
// MCP tool shapes.
// ────────────────────────────────────────────────────────────────────────

/**
 * Public description of one tool — what `tools/list` returns.
 *
 * `inputSchema` is exposed as a JSON Schema so the consuming LLM /
 * orchestrator knows how to construct valid arguments.
 */
export interface ToolManifest {
  name: string;
  description: string;
  inputSchema: TSchema;
  /** Roles allowed to invoke. ADMIN-only for write tools. */
  requiredRoles: ReadonlyArray<'ADMIN' | 'CASHIER' | 'READONLY'>;
  /** True ⇒ this tool mutates DB state. Surfaces in the audit row. */
  isMutation: boolean;
}

/**
 * Inputs to a single tool invocation passed to the handler. The
 * dispatcher provides everything the handler needs WITHOUT exposing
 * the Fastify request directly — handlers stay HTTP-transport-agnostic
 * (we can swap to STDIN/STDOUT-MCP later without rewriting them).
 */
export interface ToolInvocationContext {
  db: AppDb;
  logger: FastifyBaseLogger;
  /** Always present — handlers run AFTER the auth gate. */
  actor: Actor;
  /** JSON-RPC `id` — used as the audit `request_id`. */
  requestId: string;
}

/**
 * Successful tool result — handler returns this; dispatcher wraps it
 * in the JSON-RPC `result` envelope and writes an `mcp_tool_invocations`
 * row with `outcome = 'SUCCESS'`.
 *
 * `content` follows MCP's "structured content blocks" — for V1 we only
 * emit `text` blocks; future tools may emit `image` / `resource` blocks.
 *
 * `affectedEntity` is optional. Mutating tools MUST set it so the audit
 * row can link to the touched row.
 *
 * `cost` is optional — populate when a real LLM call lands; the
 * scaffold stubs return `cost = null`.
 */
export interface ToolResult {
  content: ReadonlyArray<{ type: 'text'; text: string }>;
  /** Structured data — what the orchestrator actually consumes. */
  data: unknown;
  affectedEntity?: { table: string; id: string };
  cost?: {
    tokensIn: number;
    tokensOut: number;
    costUsdMicros: bigint;
  };
}

/** Handler signature — pure async function of (ctx, args) → ToolResult. */
export type ToolHandler<Args = unknown> = (
  ctx: ToolInvocationContext,
  args: Args,
) => Promise<ToolResult>;

/**
 * Tool registration — manifest + handler in one bundle. The registry
 * (`tools/index.ts`) exports an array of these; `server.ts` resolves
 * the `name` to a handler at dispatch time.
 */
export interface ToolRegistration<Args = unknown> {
  manifest: ToolManifest;
  handler: ToolHandler<Args>;
}
