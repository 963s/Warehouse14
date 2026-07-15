/**
 * MCP tool registry — single source of truth.
 *
 * `tools/list` returns the manifests in this array; `tools/call`
 * resolves `params.name` to a handler here. Adding a new tool is
 * one import + one array entry.
 *
 * Ordering doesn't matter — the dispatcher builds a Map by `name`.
 */

import type { ToolRegistration } from '../types.js';
import { agendaTool } from './agenda.js';
import { appraiseEstateItemTool } from './appraise-estate-item.js';
import { customerOverviewTool } from './customer-overview.js';
import { financeOverviewTool } from './finance-overview.js';
import { findCustomerTool } from './find-customer.js';
import { findProductTool } from './find-product.js';
import { generateSeoDescriptionTool } from './generate-seo-description.js';
import { inventoryOverviewTool } from './inventory-overview.js';
import { openDevTicketTool } from './open-dev-ticket.js';
import { salesReportTool } from './sales-report.js';
import { situationReportTool } from './situation-report.js';

export const MCP_TOOLS: ReadonlyArray<ToolRegistration> = [
  generateSeoDescriptionTool,
  appraiseEstateItemTool,
  // ── Jarvis read-only situation awareness ──────────────────────────
  situationReportTool,
  // ── Jarvis read-only shop access (customers, inventory, money, agenda) ──
  findCustomerTool,
  customerOverviewTool,
  findProductTool,
  inventoryOverviewTool,
  salesReportTool,
  financeOverviewTool,
  agendaTool,
  // ── Jarvis safe escape hatch: forward a request to the developer ──
  openDevTicketTool,
];

/** Build a name → registration lookup. Called once per process. */
export function buildToolMap(): ReadonlyMap<string, ToolRegistration> {
  const map = new Map<string, ToolRegistration>();
  for (const t of MCP_TOOLS) {
    map.set(t.manifest.name, t);
  }
  return map;
}
