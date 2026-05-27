/**
 * mcp/ — Model Context Protocol audit (Phase 2.A, migration 0030).
 *
 * Single table for now (`mcp_tool_invocations`). Future additions
 * (mcp_resources, mcp_capabilities) land alongside.
 */

export * from './mcpToolInvocations.js';
