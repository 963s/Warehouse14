/**
 * mcp_tool_invocations — append-only audit log for every Model Context
 * Protocol tool invocation (Phase 2.A, migration 0030).
 *
 * The mcp/ server writes EXACTLY ONE row per JSON-RPC call:
 *   1. INSERT with outcome = stub before invoking the LLM / tool body.
 *   2. UPDATE with result + latency + cost AFTER the body resolves.
 *
 * Reads happen from the Operator UI ("AI actions" panel — Phase 2.B)
 * and the daily-spend report (worker job — Phase 1.5).
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from '../auth/index.js';

/**
 * Terminal state of a single MCP tool invocation. Mirrors migration 0030.
 *   • SUCCESS   — handler ran, side-effect committed, result present.
 *   • FAILED    — handler threw (validation, model error, DB write race).
 *                  No partial side-effect — handlers MUST tx.rollback.
 *   • REJECTED  — gatekeeper refused (auth, role, rate-limit). Handler
 *                  body never ran.
 */
export const mcpInvocationOutcome = pgEnum('mcp_invocation_outcome', [
  'SUCCESS',
  'FAILED',
  'REJECTED',
]);

export const mcpToolInvocations = pgTable(
  'mcp_tool_invocations',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),

    toolName: text('tool_name').notNull(),
    /** JSON-RPC 2.0 request id (client-supplied UUID). Echoed in the response. */
    requestId: uuid('request_id').notNull(),
    /** NULL ⇒ unauthenticated test run (production blocks this at the gate). */
    actorUserId: uuid('actor_user_id').references(() => users.id),

    arguments: jsonb('arguments').notNull().default(sql`'{}'::jsonb`),
    result: jsonb('result'),

    outcome: mcpInvocationOutcome('outcome').notNull(),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),

    latencyMs: integer('latency_ms').notNull(),
    tokensIn: integer('tokens_in'),
    tokensOut: integer('tokens_out'),
    /**
     * Inference cost in μ-dollars (1 USD = 1_000_000 μ$). BIGINT keeps us
     * off floats. SUM grouped by day → running cost.
     */
    costUsdMicros: bigint('cost_usd_micros', { mode: 'bigint' }),

    /** Tool's side-effect — identifies the row mutated. NULL for read-only tools. */
    affectedEntityTable: text('affected_entity_table'),
    affectedEntityId: uuid('affected_entity_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    toolRecentIdx: index('mcp_tool_invocations_tool_recent_idx').on(
      table.toolName,
      table.createdAt.desc(),
    ),
    actorRecentIdx: index('mcp_tool_invocations_actor_recent_idx')
      .on(table.actorUserId, table.createdAt.desc())
      .where(sql`${table.actorUserId} IS NOT NULL`),
    dailyCostIdx: index('mcp_tool_invocations_daily_cost_idx')
      .on(table.createdAt)
      .where(sql`${table.costUsdMicros} IS NOT NULL`),

    // Mirror the migration's CHECK invariant: outcome ↔ result/error coherence.
    outcomeResultCheck: check(
      'mcp_tool_invocations_outcome_result_check',
      sql`
        (${table.outcome} = 'SUCCESS' AND ${table.result} IS NOT NULL AND ${table.errorCode} IS NULL)
        OR
        (${table.outcome} IN ('FAILED', 'REJECTED') AND ${table.errorCode} IS NOT NULL)
      `,
    ),
  }),
);

export type McpToolInvocation = typeof mcpToolInvocations.$inferSelect;
export type NewMcpToolInvocation = typeof mcpToolInvocations.$inferInsert;
