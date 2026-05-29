/**
 * Real `BotTools` for the WhatsApp bot — DB-backed implementations of the 7
 * tools the orchestrator routes to. Read-only except `bookAppointment`
 * (inserts) and `escalateToHuman` (disables the bot + notifies the inbox).
 *
 * Raw parameterised `sql` (never string-interpolated) is used throughout, the
 * same choice as whatsapp-inbox.ts: it sidesteps the cross-realm Drizzle type
 * friction and every value remains a bound parameter.
 *
 * NOTE (search_inventory): semantic embedding-cosine search is the intended
 * production ranking, but generating a query embedding needs an embeddings
 * API that is not wired in this build. We fall back to a trigram-style ILIKE
 * over name/description — correct and runnable; ranking quality is the only
 * thing deferred.
 */

import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';

import type {
  AppointmentStatus,
  BookingResult,
  BotTools,
  BuybackEstimate,
  EscalationResult,
  InventoryHit,
  ItemDetails,
  OrderStatus,
} from '@warehouse14/ai-gateway';
import type { AppDb } from '@warehouse14/db/client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUYBACK_DISCLAIMER = 'vorbehaltlich der physischen Prüfung';
const DEFAULT_APPOINTMENT_MINUTES = 30;

export interface BotToolsContext {
  db: AppDb;
  /** The customer's E.164 phone — the conversation key. */
  customerPhoneE164: string;
  /** Linked customer UUID when the phone is known, else null. */
  customerId: string | null;
  log: FastifyBaseLogger;
}

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

export function createWhatsAppBotTools(ctx: BotToolsContext): BotTools {
  const { db } = ctx;

  return {
    async searchInventory({ query, limit }): Promise<InventoryHit[]> {
      const n = Math.min(10, Math.max(1, limit ?? 5));
      const pattern = `%${query}%`;
      const rows = (await db.execute<{
        id: string;
        name: string;
        list_price_eur: string;
        metal: string | null;
      }>(sql`
        SELECT id::text AS id, name, list_price_eur::text AS list_price_eur, metal
        FROM products
        WHERE status = 'AVAILABLE'
          AND listed_on_storefront = TRUE
          AND (name ILIKE ${pattern} OR description_de ILIKE ${pattern})
        ORDER BY created_at DESC
        LIMIT ${n}
      `)) as unknown as Array<{
        id: string;
        name: string;
        list_price_eur: string;
        metal: string | null;
      }>;
      return rows.map((r) => ({
        productId: r.id,
        name: r.name,
        listPriceEur: r.list_price_eur,
        metal: r.metal,
      }));
    },

    async getItemDetails({ productId }): Promise<ItemDetails | null> {
      if (!UUID_RE.test(productId)) return null;
      const rows = (await db.execute<{
        id: string;
        name: string;
        description_de: string | null;
        list_price_eur: string;
        metal: string | null;
        weight_grams: string | null;
      }>(sql`
        SELECT id::text AS id, name, description_de,
               list_price_eur::text AS list_price_eur, metal,
               weight_grams::text AS weight_grams
        FROM products
        WHERE id = ${productId}::uuid
        LIMIT 1
      `)) as unknown as Array<{
        id: string;
        name: string;
        description_de: string | null;
        list_price_eur: string;
        metal: string | null;
        weight_grams: string | null;
      }>;
      const r = rows[0];
      if (!r) return null;
      return {
        productId: r.id,
        name: r.name,
        descriptionDe: r.description_de,
        listPriceEur: r.list_price_eur,
        metal: r.metal,
        weightGrams: r.weight_grams,
      };
    },

    async estimateBuybackPrice({ metal, grams }): Promise<BuybackEstimate> {
      const rows = (await db.execute<{ avg: string | null }>(sql`
        SELECT metal_price_avg_eur_per_gram(${metal})::text AS avg
      `)) as unknown as Array<{ avg: string | null }>;
      const avgStr = rows[0]?.avg ?? null;
      const avg = avgStr !== null ? Number(avgStr) : null;

      let lowEur: string | null = null;
      let highEur: string | null = null;
      if (avg !== null && grams !== undefined && grams > 0) {
        const value = avg * grams;
        // Buyback band sits below spot — physical evaluation sets the final figure.
        lowEur = round2(value * 0.85);
        highEur = round2(value * 0.95);
      }
      return {
        metal,
        avgEurPerGram: avgStr,
        grams: grams ?? null,
        lowEur,
        highEur,
        disclaimer: BUYBACK_DISCLAIMER,
      };
    },

    async bookAppointment({
      appointmentType,
      startsAt,
      durationMinutes,
      customerNotes,
    }): Promise<BookingResult> {
      const start = new Date(startsAt);
      if (Number.isNaN(start.getTime()) || start.getTime() < Date.now()) {
        return { ok: false, reason: 'invalid_slot' };
      }
      const duration = Math.min(480, Math.max(1, durationMinutes ?? DEFAULT_APPOINTMENT_MINUTES));

      const staffRows = (await db.execute<{ id: string }>(sql`
        SELECT id::text AS id FROM users
        WHERE role = 'ADMIN' AND soft_deleted_at IS NULL
        ORDER BY created_at ASC
        LIMIT 1
      `)) as unknown as Array<{ id: string }>;
      const staffId = staffRows[0]?.id;
      if (!staffId) return { ok: false, reason: 'no_staff' };

      const endIso = new Date(start.getTime() + duration * 60_000).toISOString();
      const startIso = start.toISOString();

      // Slot conflict check against that staff member's active appointments.
      const clash = (await db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM appointments
        WHERE staff_user_id = ${staffId}::uuid
          AND status NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED')
          AND starts_at < ${endIso}::timestamptz
          AND ends_at   > ${startIso}::timestamptz
      `)) as unknown as Array<{ n: string }>;
      if (Number(clash[0]?.n ?? '0') > 0) return { ok: false, reason: 'slot_unavailable' };

      const inserted = (await db.execute<{ id: string; starts_at: string }>(sql`
        INSERT INTO appointments
          (appointment_type, starts_at, duration_minutes, customer_id,
           staff_user_id, booked_via, customer_notes)
        VALUES
          (${appointmentType}::appointment_type, ${startIso}::timestamptz, ${duration},
           ${ctx.customerId}::uuid, ${staffId}::uuid, 'whatsapp_bot', ${customerNotes ?? null})
        RETURNING id::text AS id, starts_at::text AS starts_at
      `)) as unknown as Array<{ id: string; starts_at: string }>;
      const row = inserted[0];
      if (!row) return { ok: false, reason: 'invalid_slot' };
      return { ok: true, appointmentId: row.id, startsAt: row.starts_at };
    },

    async checkOrderStatus({ receiptLocator, phone }): Promise<OrderStatus> {
      void phone; // phone→customer resolution uses the linked customerId below
      let rows: Array<{
        receipt_locator: string;
        shipping_status: string;
        tracking_number: string | null;
      }> = [];

      if (receiptLocator) {
        rows = (await db.execute(sql`
          SELECT receipt_locator, shipping_status::text AS shipping_status, tracking_number
          FROM transactions
          WHERE sales_channel = 'STOREFRONT' AND receipt_locator = ${receiptLocator}
          LIMIT 1
        `)) as unknown as typeof rows;
      } else if (ctx.customerId) {
        rows = (await db.execute(sql`
          SELECT receipt_locator, shipping_status::text AS shipping_status, tracking_number
          FROM transactions
          WHERE sales_channel = 'STOREFRONT' AND customer_id = ${ctx.customerId}::uuid
          ORDER BY finalized_at DESC
          LIMIT 1
        `)) as unknown as typeof rows;
      }

      const r = rows[0];
      if (!r) return { found: false };
      return {
        found: true,
        receiptLocator: r.receipt_locator,
        shippingStatus: r.shipping_status,
        trackingNumber: r.tracking_number,
      };
    },

    async getAppointmentStatus({ appointmentId }): Promise<AppointmentStatus> {
      let rows: Array<{ status: string; starts_at: string }> = [];
      if (appointmentId && UUID_RE.test(appointmentId)) {
        rows = (await db.execute(sql`
          SELECT status::text AS status, starts_at::text AS starts_at
          FROM appointments WHERE id = ${appointmentId}::uuid LIMIT 1
        `)) as unknown as typeof rows;
      } else if (ctx.customerId) {
        rows = (await db.execute(sql`
          SELECT status::text AS status, starts_at::text AS starts_at
          FROM appointments
          WHERE customer_id = ${ctx.customerId}::uuid
          ORDER BY starts_at DESC
          LIMIT 1
        `)) as unknown as typeof rows;
      }
      const r = rows[0];
      if (!r) return { found: false };
      return { found: true, status: r.status, startsAt: r.starts_at };
    },

    async escalateToHuman({ reason }): Promise<EscalationResult> {
      // Disable the bot for 12h and notify the operator inbox via NOTIFY.
      await db.execute(sql`
        INSERT INTO whatsapp_conversations (customer_phone_e164, ai_active, cooldown_until)
        VALUES (${ctx.customerPhoneE164}, FALSE, now() + interval '12 hours')
        ON CONFLICT (customer_phone_e164)
        DO UPDATE SET ai_active = FALSE, cooldown_until = now() + interval '12 hours'
      `);
      const payload = JSON.stringify({
        phone: ctx.customerPhoneE164,
        reason,
        severity: 'high',
        at: new Date().toISOString(),
      });
      try {
        await db.execute(sql`SELECT pg_notify('warehouse14_whatsapp_escalation', ${payload})`);
      } catch (err) {
        ctx.log.warn({ err }, 'whatsapp bot: escalation NOTIFY failed');
      }
      return { escalated: true };
    },
  };
}
