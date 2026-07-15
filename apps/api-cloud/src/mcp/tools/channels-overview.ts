/**
 * MCP tool: `channels_overview` — the Jarvis assistant's read-only CROSS-CHANNEL
 * operations snapshot.
 *
 * READ-ONLY, PII-FREE (integer counts + eBay state labels only). One round-trip
 * returns the eBay pipeline by live state (plus online / to-ship / problem
 * rollups), the WhatsApp inbox load (unhandled conversations + messages, bot-
 * paused conversations), the archived-documents count, pending appraisals, and
 * open storefront pickup orders / carts in checkout. Answers "wie stehen die
 * Kanäle", "wie viele offene WhatsApp", "wie viele eBay-Artikel online". eBay
 * "online" uses the true live predicate ebay_state = 'ONLINE'.
 *
 * Note: the WhatsApp counts group by phone number and the documents count spans
 * all categories (including AUSWEIS id-scans), but only COUNTS ever leave the DB
 * — no phone number, filename, byte, or linked customer is exposed.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';

import type { ToolHandler, ToolInvocationContext, ToolRegistration, ToolResult } from '../types.js';
import { EBAY_STATE_DE, labelDe } from './labels-de.js';

export const ChannelsOverviewArgs = Type.Object({});

interface EbayState {
  state: string;
  count: number;
}
type Row = {
  ebay_by_state: EbayState[];
  ebay_online: number;
  ebay_to_ship: number;
  ebay_problem: number;
  wa_unhandled_threads: number;
  wa_unhandled_messages: number;
  wa_bot_paused: number;
  documents_total: number;
  pending_appraisals: number;
  open_storefront_orders: number;
  checkout_in_progress: number;
}

const handler: ToolHandler<Record<string, never>> = async (
  ctx: ToolInvocationContext,
): Promise<ToolResult> => {
  const result = await ctx.db.execute<Row>(sql`
    SELECT
      (SELECT COALESCE(json_agg(json_build_object('state', state, 'count', n) ORDER BY state), '[]'::json)
         FROM (SELECT ebay_state::text AS state, COUNT(*)::int AS n
                 FROM products WHERE archived_at IS NULL AND ebay_state IS NOT NULL
                GROUP BY ebay_state) e)                                                     AS ebay_by_state,
      (SELECT COUNT(*)::int FROM products WHERE archived_at IS NULL AND ebay_state = 'ONLINE') AS ebay_online,
      (SELECT COUNT(*)::int FROM products WHERE archived_at IS NULL AND ebay_state IN ('VERKAUFT','BEZAHLT','VERPACKT')) AS ebay_to_ship,
      (SELECT COUNT(*)::int FROM products WHERE archived_at IS NULL AND ebay_state IN ('REKLAMIERT','RETOURNIERT')) AS ebay_problem,
      (SELECT COUNT(DISTINCT from_phone)::int FROM whatsapp_inbound_messages WHERE handled_at IS NULL) AS wa_unhandled_threads,
      (SELECT COUNT(*)::int FROM whatsapp_inbound_messages WHERE handled_at IS NULL)            AS wa_unhandled_messages,
      (SELECT COUNT(*)::int FROM whatsapp_conversations WHERE ai_active = FALSE)                AS wa_bot_paused,
      (SELECT COUNT(*)::int FROM document_attachments WHERE archived_at IS NULL)               AS documents_total,
      (SELECT COUNT(*)::int FROM appraisals WHERE status IN ('DRAFT','COMPLETED'))             AS pending_appraisals,
      (SELECT COUNT(*)::int FROM carts WHERE status = 'RESERVED')                              AS open_storefront_orders,
      (SELECT COUNT(*)::int FROM carts WHERE status = 'CHECKOUT')                              AS checkout_in_progress
  `);

  const rows = result as unknown as Row[];
  const r = rows[0] ?? ({} as Partial<Row>);
  const ebayByState = ((r.ebay_by_state as EbayState[]) ?? []).map((e) => ({
    state: e.state,
    stateDe: labelDe(EBAY_STATE_DE, e.state),
    count: Number(e.count ?? 0),
  }));
  const data = {
    ebayByState,
    ebayOnline: Number(r.ebay_online ?? 0),
    ebayToShip: Number(r.ebay_to_ship ?? 0),
    ebayProblem: Number(r.ebay_problem ?? 0),
    whatsappUnhandledThreads: Number(r.wa_unhandled_threads ?? 0),
    whatsappUnhandledMessages: Number(r.wa_unhandled_messages ?? 0),
    whatsappBotPaused: Number(r.wa_bot_paused ?? 0),
    documentsTotal: Number(r.documents_total ?? 0),
    pendingAppraisals: Number(r.pending_appraisals ?? 0),
    openStorefrontOrders: Number(r.open_storefront_orders ?? 0),
    checkoutInProgress: Number(r.checkout_in_progress ?? 0),
    asOf: new Date().toISOString(),
  };

  const summary =
    `Überblick der Kanäle. eBay: ${data.ebayOnline} Artikel online, ${data.ebayToShip} zu versenden, ` +
    `${data.ebayProblem} mit Reklamation oder Retoure. WhatsApp: ${data.whatsappUnhandledThreads} offene ` +
    `Gespräche mit ${data.whatsappUnhandledMessages} unbeantworteten Nachrichten, ${data.whatsappBotPaused} ` +
    `vom Assistenten pausiert. Dokumente im Archiv: ${data.documentsTotal}. Offene Bewertungen: ` +
    `${data.pendingAppraisals}. Webshop: ${data.openStorefrontOrders} offene Abholaufträge, ` +
    `${data.checkoutInProgress} im Bezahlvorgang.`;

  return { content: [{ type: 'text', text: summary }], data };
};

export const channelsOverviewTool: ToolRegistration = {
  manifest: {
    name: 'channels_overview',
    description:
      'READ-ONLY. A cross-channel operations snapshot: eBay pipeline by live state plus online / ' +
      'to-ship / problem rollups, WhatsApp inbox load (unhandled conversations + messages, ' +
      'bot-paused), archived documents count, pending appraisals, and open storefront pickup orders ' +
      '/ checkouts in progress. No arguments, counts only, no personal data. Use for "wie stehen die ' +
      'Kanäle", "wie viele offene WhatsApp", "wie viele eBay-Artikel sind online".',
    inputSchema: ChannelsOverviewArgs,
    requiredRoles: ['ADMIN', 'CASHIER'],
    isMutation: false,
    // Read-only cross-channel counts, no personal data leaves the DB — safe for the assistant.
    assistantExposed: true,
  },
  handler: handler as ToolHandler<unknown>,
};
