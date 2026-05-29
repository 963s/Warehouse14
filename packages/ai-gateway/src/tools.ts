/**
 * The 7 bot tools — definitions (for the LLM tool-use API) + the `BotTools`
 * interface the host app implements with real DB queries, plus a dispatcher
 * that maps a model-issued tool call onto the right method.
 *
 * This module is pure: it knows the *shape* of each tool, never how to query
 * Postgres. The api-cloud worker injects a concrete `BotTools`.
 */

import type { ToolDefinition } from './index.js';

// ── Result/argument types ────────────────────────────────────────────────

export interface InventoryHit {
  productId: string;
  name: string;
  listPriceEur: string;
  metal: string | null;
}

export interface ItemDetails {
  productId: string;
  name: string;
  descriptionDe: string | null;
  listPriceEur: string;
  metal: string | null;
  weightGrams: string | null;
}

/** Buyback price band — ALWAYS carries the physical-evaluation disclaimer. */
export interface BuybackEstimate {
  metal: string;
  avgEurPerGram: string | null;
  grams: number | null;
  lowEur: string | null;
  highEur: string | null;
  disclaimer: string;
}

export interface BookingResult {
  ok: boolean;
  appointmentId?: string;
  startsAt?: string;
  /** Set when ok=false: 'slot_unavailable' | 'no_staff' | 'invalid_slot'. */
  reason?: string;
}

export interface OrderStatus {
  found: boolean;
  receiptLocator?: string;
  shippingStatus?: string;
  trackingNumber?: string | null;
}

export interface AppointmentStatus {
  found: boolean;
  status?: string;
  startsAt?: string;
}

export interface EscalationResult {
  escalated: boolean;
}

/**
 * The host-implemented data layer. Every method is read-only EXCEPT
 * `bookAppointment` (creates a row) and `escalateToHuman` (disables the bot).
 */
export interface BotTools {
  searchInventory(args: { query: string; limit?: number }): Promise<InventoryHit[]>;
  getItemDetails(args: { productId: string }): Promise<ItemDetails | null>;
  estimateBuybackPrice(args: { metal: string; grams?: number }): Promise<BuybackEstimate>;
  bookAppointment(args: {
    appointmentType: string;
    startsAt: string;
    durationMinutes?: number;
    customerNotes?: string;
  }): Promise<BookingResult>;
  checkOrderStatus(args: { receiptLocator?: string; phone?: string }): Promise<OrderStatus>;
  getAppointmentStatus(args: {
    appointmentId?: string;
    phone?: string;
  }): Promise<AppointmentStatus>;
  escalateToHuman(args: { reason: string }): Promise<EscalationResult>;
}

// ── Tool names (single source — the loop short-circuits on this one) ──────

export const ESCALATE_TOOL_NAME = 'escalate_to_human';

// ── Tool definitions for the model ────────────────────────────────────────

export const BOT_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'search_inventory',
    description:
      'Search available storefront products by free-text query (name/description). ' +
      'Only returns items that are in stock and listed on the storefront.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Customer search terms, e.g. "Goldring 750"' },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_item_details',
    description: 'Fetch full details for one product by its UUID.',
    inputSchema: {
      type: 'object',
      properties: { productId: { type: 'string', description: 'Product UUID' } },
      required: ['productId'],
    },
  },
  {
    name: 'estimate_buyback_price',
    description:
      'Estimate a buyback price band for a precious metal using the time-weighted ' +
      'market average. ALWAYS subject to physical evaluation. Provide grams for a band.',
    inputSchema: {
      type: 'object',
      properties: {
        metal: { type: 'string', enum: ['gold', 'silver', 'platinum', 'palladium'] },
        grams: { type: 'number', minimum: 0 },
      },
      required: ['metal'],
    },
  },
  {
    name: 'book_appointment',
    description:
      'Create an appointment. startsAt is an ISO-8601 timestamp. Validates the ' +
      'slot is free before booking; returns ok=false with a reason otherwise.',
    inputSchema: {
      type: 'object',
      properties: {
        appointmentType: {
          type: 'string',
          enum: ['VIEWING', 'BUYBACK_EVAL', 'CONSULTATION', 'PICKUP'],
        },
        startsAt: { type: 'string', description: 'ISO-8601 start time' },
        durationMinutes: { type: 'integer', minimum: 1, maximum: 480 },
        customerNotes: { type: 'string' },
      },
      required: ['appointmentType', 'startsAt'],
    },
  },
  {
    name: 'check_order_status',
    description:
      'Look up a STOREFRONT order by receipt locator or the customer phone. ' +
      'Returns shipping status + tracking number when available.',
    inputSchema: {
      type: 'object',
      properties: {
        receiptLocator: { type: 'string' },
        phone: { type: 'string' },
      },
    },
  },
  {
    name: 'get_appointment_status',
    description: 'Read-only appointment lookup by appointment UUID or customer phone.',
    inputSchema: {
      type: 'object',
      properties: {
        appointmentId: { type: 'string' },
        phone: { type: 'string' },
      },
    },
  },
  {
    name: ESCALATE_TOOL_NAME,
    description:
      'Hand the conversation to a human. Call this for complaints, negative ' +
      'sentiment, legal/price disputes, or anything you cannot answer from the ' +
      'other tools. Disables the bot for this customer.',
    inputSchema: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    },
  },
];

// ── Dispatcher ─────────────────────────────────────────────────────────────

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * Execute a model-issued tool call against the injected `BotTools`. Always
 * resolves to a JSON-serializable value — never throws — so the loop can feed
 * the result straight back to the model as a `tool_result`.
 */
export async function dispatchTool(
  tools: BotTools,
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  try {
    switch (name) {
      case 'search_inventory': {
        const query = asString(input.query) ?? '';
        const limit = asNumber(input.limit);
        return await tools.searchInventory(limit !== undefined ? { query, limit } : { query });
      }
      case 'get_item_details': {
        const productId = asString(input.productId);
        if (!productId) return { error: 'productId required' };
        return (await tools.getItemDetails({ productId })) ?? { found: false };
      }
      case 'estimate_buyback_price': {
        const metal = asString(input.metal);
        if (!metal) return { error: 'metal required' };
        const grams = asNumber(input.grams);
        return await tools.estimateBuybackPrice(grams !== undefined ? { metal, grams } : { metal });
      }
      case 'book_appointment': {
        const appointmentType = asString(input.appointmentType);
        const startsAt = asString(input.startsAt);
        if (!appointmentType || !startsAt) return { ok: false, reason: 'invalid_slot' };
        const args: Parameters<BotTools['bookAppointment']>[0] = { appointmentType, startsAt };
        const durationMinutes = asNumber(input.durationMinutes);
        if (durationMinutes !== undefined) args.durationMinutes = durationMinutes;
        const customerNotes = asString(input.customerNotes);
        if (customerNotes !== undefined) args.customerNotes = customerNotes;
        return await tools.bookAppointment(args);
      }
      case 'check_order_status': {
        const args: Parameters<BotTools['checkOrderStatus']>[0] = {};
        const receiptLocator = asString(input.receiptLocator);
        if (receiptLocator !== undefined) args.receiptLocator = receiptLocator;
        const phone = asString(input.phone);
        if (phone !== undefined) args.phone = phone;
        return await tools.checkOrderStatus(args);
      }
      case 'get_appointment_status': {
        const args: Parameters<BotTools['getAppointmentStatus']>[0] = {};
        const appointmentId = asString(input.appointmentId);
        if (appointmentId !== undefined) args.appointmentId = appointmentId;
        const phone = asString(input.phone);
        if (phone !== undefined) args.phone = phone;
        return await tools.getAppointmentStatus(args);
      }
      case ESCALATE_TOOL_NAME: {
        const reason = asString(input.reason) ?? 'unspecified';
        return await tools.escalateToHuman({ reason });
      }
      default:
        return { error: `unknown tool: ${name}` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'tool failed' };
  }
}
