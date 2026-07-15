/**
 * MCP server — Phase 2.A scaffolding (memory.md §20.4).
 *
 *   POST /api/mcp     — JSON-RPC 2.0 endpoint
 *
 * Surface:
 *   • method `tools/list` → enumerate registered tools.
 *   • method `tools/call` → invoke ONE tool by name with arguments.
 *
 * DESIGN
 * ══════
 * 1. **ADMIN-only** at the HTTP gate. Per-tool `requiredRoles` is enforced
 *    INSIDE `tools/call` against the manifest — that way READONLY tools
 *    can later be opened to dashboards without changing the route.
 *
 * 2. **Every call audits.** Successful AND failed invocations write a row
 *    to `mcp_tool_invocations`. The audit row is written even when the
 *    handler throws — the dispatcher wraps the handler in try/finally
 *    so the catch path always records.
 *
 * 3. **TypeBox-validated arguments.** The dispatcher calls
 *    `Value.Check(tool.manifest.inputSchema, args)` BEFORE invoking the
 *    handler. Malformed args become `JsonRpcErrorCode.INVALID_PARAMS`
 *    with field-level detail.
 *
 * 4. **Cost-aware.** `tokens_in / tokens_out / cost_usd_micros` come
 *    from the handler's `ToolResult.cost` field (when present); otherwise
 *    the audit row stores NULL. A daily worker job sums these by day.
 *
 * 5. **NO HTTP transport coupling.** Tool handlers receive a
 *    `ToolInvocationContext` (db, logger, actor, requestId). They do NOT
 *    touch `req` / `reply`. This lets us add a stdio MCP transport
 *    later (real MCP servers speak both HTTP and stdio).
 */

import { Value } from '@sinclair/typebox/value';
import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

import type { AppDb } from '@warehouse14/db/client';
import { mcpToolInvocations } from '@warehouse14/db/schema';

import type { Actor } from '../lib/actor.js';
import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

import { buildToolMap } from './tools/index.js';
import {
  type JsonRpcError,
  JsonRpcErrorCode,
  type JsonRpcRequest,
  type JsonRpcSuccess,
  type ToolHandler,
  type ToolInvocationContext,
  type ToolManifest,
  type ToolResult,
} from './types.js';

// ────────────────────────────────────────────────────────────────────────
// HTTP-layer domain errors (the `requireAuth` / `requireRole` path).
// JSON-RPC body errors are NOT thrown — they're serialised as the
// `error` envelope of the 200 response per JSON-RPC spec.
// ────────────────────────────────────────────────────────────────────────

class UnauthorizedError extends DomainError {
  public readonly httpStatus = 401;
  public readonly code: ApiErrorCode = 'UNAUTHORIZED';
}

class ForbiddenError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'FORBIDDEN';
}

const TOOL_MAP = buildToolMap();

// ────────────────────────────────────────────────────────────────────────
// Audit helpers — every invocation goes through these.
// ────────────────────────────────────────────────────────────────────────

interface AuditOpenInput {
  db: AppDb;
  toolName: string;
  requestId: string;
  actorUserId: string | null;
  args: unknown;
}

interface AuditCloseSuccessInput {
  db: AppDb;
  invocationId: string;
  result: ToolResult;
  latencyMs: number;
}

interface AuditCloseFailureInput {
  db: AppDb;
  invocationId: string;
  outcome: 'FAILED' | 'REJECTED';
  errorCode: string;
  errorMessage: string;
  latencyMs: number;
}

/**
 * INSERT a stub row before handler runs. Returns the new row id which
 * the success / failure closer uses to UPDATE in place.
 *
 * The stub deliberately uses outcome='FAILED' with error_code='IN_FLIGHT'
 * so that a process crash mid-handler leaves a clearly diagnosable row —
 * the audit row constraint (outcome + error/result coherence) is
 * satisfied without lying about what happened.
 */
async function auditOpen(input: AuditOpenInput): Promise<string> {
  const inserted = await input.db
    .insert(mcpToolInvocations)
    .values({
      toolName: input.toolName,
      requestId: input.requestId,
      actorUserId: input.actorUserId,
      arguments: input.args as object,
      outcome: 'FAILED',
      errorCode: 'IN_FLIGHT',
      errorMessage: 'Audit row created; handler did not return.',
      latencyMs: 0,
    })
    .returning({ id: mcpToolInvocations.id });
  if (!inserted[0]) {
    throw new Error('audit_open: INSERT returned no row');
  }
  return inserted[0].id;
}

async function auditCloseSuccess(input: AuditCloseSuccessInput): Promise<void> {
  await input.db.execute(sql`
    UPDATE mcp_tool_invocations
       SET outcome             = 'SUCCESS',
           result              = ${JSON.stringify(input.result.data)}::jsonb,
           error_code          = NULL,
           error_message       = NULL,
           latency_ms          = ${input.latencyMs},
           tokens_in           = ${input.result.cost?.tokensIn ?? null},
           tokens_out          = ${input.result.cost?.tokensOut ?? null},
           cost_usd_micros     = ${input.result.cost?.costUsdMicros ?? null},
           affected_entity_table = ${input.result.affectedEntity?.table ?? null},
           affected_entity_id    = ${input.result.affectedEntity?.id ?? null}
     WHERE id = ${input.invocationId}::uuid
  `);
}

async function auditCloseFailure(input: AuditCloseFailureInput): Promise<void> {
  await input.db.execute(sql`
    UPDATE mcp_tool_invocations
       SET outcome       = ${input.outcome},
           result        = NULL,
           error_code    = ${input.errorCode},
           error_message = ${input.errorMessage},
           latency_ms    = ${input.latencyMs}
     WHERE id = ${input.invocationId}::uuid
  `);
}

// ────────────────────────────────────────────────────────────────────────
// JSON-RPC method handlers
// ────────────────────────────────────────────────────────────────────────

type PublicManifest = Omit<ToolManifest, 'requiredRoles' | 'assistantExposed'>;

function listTools(assistantScoped: boolean): { tools: PublicManifest[] } {
  const manifests: PublicManifest[] = [];
  for (const t of TOOL_MAP.values()) {
    // On the assistant path, only advertise tools the assistant may run.
    if (assistantScoped && !t.manifest.assistantExposed) continue;
    manifests.push({
      name: t.manifest.name,
      description: t.manifest.description,
      inputSchema: t.manifest.inputSchema,
      isMutation: t.manifest.isMutation,
    });
  }
  return { tools: manifests };
}

interface CallParams {
  name: string;
  arguments?: unknown;
}

async function callTool(
  db: AppDb,
  logger: FastifyBaseLogger,
  actor: Actor,
  requestId: string,
  params: CallParams,
  assistantScoped: boolean,
): Promise<ToolResult> {
  const reg = TOOL_MAP.get(params.name);
  if (!reg) {
    throw new ToolDispatchError(JsonRpcErrorCode.TOOL_NOT_FOUND, `Unknown tool: ${params.name}`);
  }

  // 0. Assistant-scope gate. The Vierzehn voice relay forwards an UNTRUSTED
  //    model's tool names; on that path only tools explicitly flagged
  //    `assistantExposed` may run — INDEPENDENT of the actor's role. This is
  //    the real structural boundary; the advertised manifest is only advisory.
  //    A hallucinating or injected model naming a withheld mutation tool
  //    (e.g. generate_seo_description) is rejected here, not executed.
  if (assistantScoped && !reg.manifest.assistantExposed) {
    throw new ToolDispatchError(
      JsonRpcErrorCode.TOOL_REJECTED,
      `Tool ${params.name} is not available to the assistant.`,
    );
  }

  // 1. Role gate per tool manifest.
  if (!reg.manifest.requiredRoles.includes(actor.role)) {
    throw new ToolDispatchError(
      JsonRpcErrorCode.TOOL_REJECTED,
      `Tool ${params.name} requires one of: ${reg.manifest.requiredRoles.join(', ')}. Actor has: ${actor.role}.`,
    );
  }

  // 2. TypeBox validation.
  const args = params.arguments ?? {};
  if (!Value.Check(reg.manifest.inputSchema, args)) {
    const errors = Array.from(Value.Errors(reg.manifest.inputSchema, args))
      .slice(0, 5)
      .map((e) => `${e.path || '(root)'}: ${e.message}`);
    throw new ToolDispatchError(
      JsonRpcErrorCode.INVALID_PARAMS,
      `Invalid arguments for ${params.name}: ${errors.join('; ')}`,
    );
  }

  // 3. Audit row first — guarantees a paper trail even on crash.
  const invocationId = await auditOpen({
    db,
    toolName: reg.manifest.name,
    requestId,
    actorUserId: actor.id,
    args,
  });

  // 4. Run the handler with timing.
  const ctx: ToolInvocationContext = { db, logger, actor, requestId };
  const startedAt = Date.now();
  try {
    const handler = reg.handler as ToolHandler;
    const result = await handler(ctx, args);
    const latencyMs = Date.now() - startedAt;
    await auditCloseSuccess({ db, invocationId, result, latencyMs });
    return result;
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const code =
      typeof (err as { code?: unknown }).code === 'string'
        ? String((err as { code?: unknown }).code)
        : 'TOOL_EXCEPTION';
    const message = err instanceof Error ? err.message : String(err);
    await auditCloseFailure({
      db,
      invocationId,
      outcome: 'FAILED',
      errorCode: code,
      errorMessage: message,
      latencyMs,
    });
    throw new ToolDispatchError(JsonRpcErrorCode.TOOL_FAILED, message);
  }
}

class ToolDispatchError extends Error {
  public readonly jsonRpcCode: JsonRpcErrorCode;
  constructor(code: JsonRpcErrorCode, message: string) {
    super(message);
    this.jsonRpcCode = code;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Fastify plugin
// ────────────────────────────────────────────────────────────────────────

const mcpServer: FastifyPluginAsync = async (app) => {
  /**
   * One handler, two mount points. `assistantScoped` is bound per ROUTE, never
   * read from the request — a client cannot widen its own scope by flipping a
   * flag. `/api/mcp` is the general ADMIN endpoint; `/api/mcp/assistant` is the
   * only path the Vierzehn voice relay uses and hard-denies any tool that is
   * not `assistantExposed`, regardless of the actor's role.
   */
  const makeHandler =
    (assistantScoped: boolean) =>
    async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const body = req.body as JsonRpcRequest;

      // Envelope sanity checks. Anything malformed → return a JSON-RPC
      // error envelope with HTTP 200; that's what JSON-RPC clients expect.
      if (
        !body ||
        typeof body !== 'object' ||
        body.jsonrpc !== '2.0' ||
        typeof body.id !== 'string' ||
        typeof body.method !== 'string'
      ) {
        const err: JsonRpcError = {
          jsonrpc: '2.0',
          id: body && typeof body.id === 'string' ? body.id : 'unknown',
          error: {
            code: JsonRpcErrorCode.INVALID_REQUEST,
            message:
              'Malformed JSON-RPC 2.0 envelope. Expected { jsonrpc:"2.0", id, method, params? }',
          },
        };
        return reply.status(200).send(err);
      }

      try {
        switch (body.method) {
          case 'tools/list': {
            const ok: JsonRpcSuccess<ReturnType<typeof listTools>> = {
              jsonrpc: '2.0',
              id: body.id,
              result: listTools(assistantScoped),
            };
            return reply.status(200).send(ok);
          }
          case 'tools/call': {
            const params = (body.params ?? {}) as CallParams;
            if (typeof params.name !== 'string') {
              const err: JsonRpcError = {
                jsonrpc: '2.0',
                id: body.id,
                error: {
                  code: JsonRpcErrorCode.INVALID_PARAMS,
                  message: 'tools/call requires params.name (string)',
                },
              };
              return reply.status(200).send(err);
            }
            // Audit request_id is a UUID column, so pass the HTTP request id
            // (genReqId = crypto.randomUUID), NOT the JSON-RPC body.id — the
            // latter is a client-chosen string (the OpenAI "call_…" id for the
            // Jarvis relay), which is not a UUID and made every tool call crash
            // the audit INSERT. The JSON-RPC response still echoes body.id below.
            const result = await callTool(app.db, req.log, req.actor!, req.id, params, assistantScoped);
            const ok: JsonRpcSuccess<ToolResult> = {
              jsonrpc: '2.0',
              id: body.id,
              result,
            };
            return reply.status(200).send(ok);
          }
          default: {
            const err: JsonRpcError = {
              jsonrpc: '2.0',
              id: body.id,
              error: {
                code: JsonRpcErrorCode.METHOD_NOT_FOUND,
                message: `Unknown method: ${body.method as string}. Supported: tools/list, tools/call.`,
              },
            };
            return reply.status(200).send(err);
          }
        }
      } catch (err) {
        if (err instanceof ToolDispatchError) {
          const out: JsonRpcError = {
            jsonrpc: '2.0',
            id: body.id,
            error: { code: err.jsonRpcCode, message: err.message },
          };
          return reply.status(200).send(out);
        }
        // Unexpected — wrap as INTERNAL_ERROR but DO NOT leak the stack.
        req.log.error({ err }, 'mcp dispatcher: unhandled error');
        const out: JsonRpcError = {
          jsonrpc: '2.0',
          id: body.id,
          error: {
            code: JsonRpcErrorCode.INTERNAL_ERROR,
            message: 'Internal MCP server error.',
          },
        };
        return reply.status(200).send(out);
      }
    };

  // Body shape is JSON-RPC — we don't TypeBox-validate the envelope because we
  // need to surface JSON-RPC error codes for malformed input, which a Fastify
  // 400 wouldn't.
  app.post(
    '/api/mcp',
    {
      schema: {
        tags: ['mcp'],
        summary:
          'Model Context Protocol JSON-RPC 2.0 endpoint. Supports tools/list and tools/call. ADMIN-only.',
      },
    },
    makeHandler(false),
  );

  app.post(
    '/api/mcp/assistant',
    {
      schema: {
        tags: ['mcp'],
        summary:
          'Assistant-scoped MCP endpoint for the Vierzehn voice relay. ADMIN-only, and additionally ' +
          'refuses any tool not flagged assistantExposed regardless of role.',
      },
    },
    makeHandler(true),
  );
};

export default mcpServer;

// Re-export the role-gate errors so tests can assert on the type.
export { UnauthorizedError as McpUnauthorizedError };
export { ForbiddenError as McpForbiddenError };
