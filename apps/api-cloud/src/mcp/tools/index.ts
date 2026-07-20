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
import { analyzeInboxPhotosTool } from './analyze-inbox-photos.js';
import { attachPhotosTool } from './attach-photos.js';
import { appraiseEstateItemTool } from './appraise-estate-item.js';
import { channelsOverviewTool } from './channels-overview.js';
import { createProductTool } from './create-product.js';
import { customerOverviewTool } from './customer-overview.js';
import { deleteProductTool } from './delete-product.js';
import { financeOverviewTool } from './finance-overview.js';
import { findCustomerTool } from './find-customer.js';
import { findProductTool } from './find-product.js';
import { generateSeoDescriptionTool } from './generate-seo-description.js';
import { inventoryOverviewTool } from './inventory-overview.js';
import { listInboxPhotosTool } from './list-inbox-photos.js';
import { listProductsTool } from './list-products.js';
import { openDevTicketTool } from './open-dev-ticket.js';
import { productDetailsTool } from './product-details.js';
import { salesBreakdownTool } from './sales-breakdown.js';
import { salesReportTool } from './sales-report.js';
import { situationReportTool } from './situation-report.js';
import { topCustomersTool } from './top-customers.js';
import { updateProductTool } from './update-product.js';

export const MCP_TOOLS: ReadonlyArray<ToolRegistration> = [
  generateSeoDescriptionTool,
  appraiseEstateItemTool,
  // ── Jarvis read-only situation awareness ──────────────────────────
  situationReportTool,
  // ── Jarvis read-only shop access (customers, inventory, money, agenda) ──
  findCustomerTool,
  customerOverviewTool,
  topCustomersTool,
  findProductTool,
  listProductsTool,
  productDetailsTool,
  inventoryOverviewTool,
  salesReportTool,
  salesBreakdownTool,
  financeOverviewTool,
  channelsOverviewTool,
  agendaTool,
  // ── Jarvis deliberate writes (safe by construction) ──────────────
  // create_product makes a DRAFT by default; activate/publishToWeb are explicit
  // opt-ins gated on spoken confirmation (never fiscal either way).
  // open_dev_ticket only records an internal task. All guarded + audited.
  createProductTool,
  openDevTicketTool,
  // ── Jarvis executive belt (the agent, still safe by construction) ──
  // update: safe presentation fields on DRAFT/AVAILABLE only, full diff audit.
  // delete: DRAFT only, photos return to the inbox. attach/list: the photo
  // bridge from the phone's Fotoeingang. Every write mandates spoken confirm.
  updateProductTool,
  deleteProductTool,
  listInboxPhotosTool,
  attachPhotosTool,
  // Vision: dealer-grade identification of inbox photos (read-only suggestion
  // the owner confirms by voice before create_product writes anything).
  analyzeInboxPhotosTool,
];

/** Build a name → registration lookup. Called once per process. */
export function buildToolMap(): ReadonlyMap<string, ToolRegistration> {
  const map = new Map<string, ToolRegistration>();
  for (const t of MCP_TOOLS) {
    map.set(t.manifest.name, t);
  }
  return map;
}
