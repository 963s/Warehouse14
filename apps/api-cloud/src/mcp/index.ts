/**
 * apps/api-cloud/src/mcp/ — Model Context Protocol surface.
 *
 * Phase 2.A scaffolding (memory.md §20.4). The Fastify route plugin
 * exported here is registered in `app.ts` alongside the storefront
 * catalog router — both land at the same phase, both stay isolated
 * from the admin POS surface.
 */

export { default as mcpServer } from './server.js';
export { MCP_TOOLS, buildToolMap } from './tools/index.js';
export type {
  JsonRpcRequest,
  JsonRpcSuccess,
  JsonRpcError,
  JsonRpcErrorCode,
  ToolHandler,
  ToolInvocationContext,
  ToolManifest,
  ToolRegistration,
  ToolResult,
} from './types.js';
