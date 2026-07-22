/**
 * Appointment ↔ WhatsApp glue (token-gated, eBay pattern).
 *
 * Fully wired but INERT until the Meta keys are set:
 *   WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN (api-cloud env, both
 *   default '' → `sendAppointmentMessage` throws the typed
 *   `WhatsAppNotConfiguredError` and callers queue instead of send).
 *
 * Two responsibilities:
 *   1. `sendAppointmentMessage(kind, appointment, toPhone)` — German
 *      confirmation/reminder text (date/time/type + shop address) via the
 *      Meta Graph send-message API (`sendToMeta`).
 *   2. Inbound booking-intent auto-reply: `detectBookingIntent` +
 *      `runBookingAutoReply` — ONE German message with the public booking
 *      link (system_settings 'storefront.public_base_url', IP fallback)
 *      and the opening hours ('appointments.business_hours').
 *
 * KEEP IN SYNC: the worker mirrors the message builder + sender in
 * `apps/worker/src/jobs/appointment-whatsapp.ts` (separate deploy unit —
 * the worker cannot import api-cloud sources).
 */

import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { berlinLabel, berlinTimeHm } from '@warehouse14/appointments';

import { MetaApiError, sendToMeta } from './meta-whatsapp.js';
import { withPiiKey } from './pii.js';

// ────────────────────────────────────────────────────────────────────────
// Config gating (eBay pattern: empty env → typed NotConfigured error)
// ────────────────────────────────────────────────────────────────────────

export interface AppointmentWhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
}

/** Thrown when the WHATSAPP_* env keys are absent — callers queue, never crash. */
export class WhatsAppNotConfiguredError extends Error {
  public readonly code = 'WHATSAPP_NOT_CONFIGURED' as const;
  public constructor() {
    super(
      'WhatsApp ist nicht konfiguriert (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN fehlen).',
    );
    this.name = 'WhatsAppNotConfiguredError';
  }
}

function configFromProcessEnv(): AppointmentWhatsAppConfig {
  return {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? '',
  };
}

export function isWhatsAppConfigured(cfg: AppointmentWhatsAppConfig): boolean {
  return cfg.phoneNumberId.length > 0 && cfg.accessToken.length > 0;
}

// ────────────────────────────────────────────────────────────────────────
// German message templates (pure)
// ────────────────────────────────────────────────────────────────────────

export type AppointmentMessageKind = 'booking_confirmation' | 'reminder_24h' | 'reminder_2h';

export interface AppointmentMessageData {
  /** Native enum value (VIEWING | BUYBACK_EVAL | CONSULTATION | PICKUP). */
  appointmentType: string;
  startsAt: Date;
}

/** Shop address on every appointment message (Schorndorf — system_settings 0044 seed). */
export const SHOP_ADDRESS_LINES = [
  'Warehouse 14',
  'Rosenstraße 40',
  '73614 Schorndorf',
] as const;

const TYPE_LABELS_DE: Record<string, string> = {
  VIEWING: 'Besichtigung',
  BUYBACK_EVAL: 'Ankauf-Bewertung',
  CONSULTATION: 'Beratung',
  PICKUP: 'Abholung',
};

export function appointmentTypeLabelDe(appointmentType: string): string {
  return TYPE_LABELS_DE[appointmentType] ?? 'Termin';
}

/** Build the German WhatsApp text for one appointment message kind. Pure. */
export function buildAppointmentMessage(
  kind: AppointmentMessageKind,
  appointment: AppointmentMessageData,
): string {
  const typeLabel = appointmentTypeLabelDe(appointment.appointmentType);
  const when = berlinLabel(appointment.startsAt); // e.g. "Fr., 29.05.2026, 14:00"
  const address = SHOP_ADDRESS_LINES.join(', ');

  switch (kind) {
    case 'booking_confirmation':
      return `Ihr Termin bei Warehouse 14 ist bestätigt.\n\nTermin: ${typeLabel}\nWann: ${when} Uhr\nWo: ${address}\n\nWir freuen uns auf Ihren Besuch. Falls Sie den Termin nicht wahrnehmen können, geben Sie uns bitte kurz Bescheid.`;
    case 'reminder_24h':
      return `Erinnerung: Ihr Termin (${typeLabel}) bei Warehouse 14 ist morgen.\n\nWann: ${when} Uhr\nWo: ${address}\n\nBis morgen!`;
    case 'reminder_2h':
      return `Ihr Termin (${typeLabel}) bei Warehouse 14 beginnt bald: heute um ${berlinTimeHm(appointment.startsAt)} Uhr.\n\nWo: ${address}\n\nBis gleich!`;
  }
}

/**
 * Send one appointment message via the Meta Graph API.
 * Throws `WhatsAppNotConfiguredError` when the env keys are absent (token-gated).
 * Provider failures propagate as `MetaApiError` from `sendToMeta`.
 */
export async function sendAppointmentMessage(
  kind: AppointmentMessageKind,
  appointment: AppointmentMessageData,
  toPhone: string,
  cfg: AppointmentWhatsAppConfig = configFromProcessEnv(),
): Promise<{ messageId: string }> {
  if (!isWhatsAppConfigured(cfg)) throw new WhatsAppNotConfiguredError();
  const sent = await sendToMeta({
    phoneNumberId: cfg.phoneNumberId,
    accessToken: cfg.accessToken,
    toPhone,
    messageBody: buildAppointmentMessage(kind, appointment),
  });
  return { messageId: sent.messageId };
}

// ────────────────────────────────────────────────────────────────────────
// Inbound booking-intent auto-reply
// ────────────────────────────────────────────────────────────────────────

/** Booking-intent keywords (case-insensitive substring match, per spec). */
const BOOKING_INTENT_REGEX = /termin|appointment|buchen|besuch|uhrzeit|wann/i;

export function detectBookingIntent(text: string): boolean {
  return BOOKING_INTENT_REGEX.test(text);
}

/** Fallback when system_settings has no 'storefront.public_base_url'. */
export const DEFAULT_PUBLIC_BASE_URL = 'http://79.76.116.239';

/** Default per the shared contract key 'appointments.business_hours'. */
const DEFAULT_BUSINESS_HOURS: Record<string, [string, string] | null> = {
  'mo-fr': ['10:00', '18:00'],
  sa: ['10:00', '14:00'],
  so: null,
};

const HOURS_DAY_LABELS: Record<string, string> = {
  'mo-fr': 'Mo.–Fr.',
  mo: 'Mo.',
  di: 'Di.',
  mi: 'Mi.',
  do: 'Do.',
  fr: 'Fr.',
  sa: 'Sa.',
  so: 'So.',
};

/** "Mo.–Fr. 10:00–18:00 Uhr · Sa. 10:00–14:00 Uhr · So. geschlossen". Pure. */
export function formatBusinessHoursDe(raw: unknown): string {
  const hours =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : DEFAULT_BUSINESS_HOURS;
  const parts: string[] = [];
  for (const [day, span] of Object.entries(hours)) {
    const label = HOURS_DAY_LABELS[day] ?? day;
    if (span === null) {
      parts.push(`${label} geschlossen`);
    } else if (Array.isArray(span) && span.length === 2) {
      parts.push(`${label} ${span[0]}–${span[1]} Uhr`);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : formatBusinessHoursDe(DEFAULT_BUSINESS_HOURS);
}

/** The ONE German auto-reply with booking link + opening hours. Pure. */
export function buildBookingLinkReply(bookingUrl: string, hoursLine: string): string {
  return `Vielen Dank für Ihre Nachricht! Einen Termin können Sie ganz bequem online buchen:\n${bookingUrl}\n\nUnsere Öffnungszeiten: ${hoursLine}\n\n${SHOP_ADDRESS_LINES.join(' · ')}`;
}

type SettingRow = { value: unknown };

/** Read one system_settings value (jsonb — postgres-js returns it parsed). */
async function readSetting(app: FastifyInstance, key: string): Promise<unknown> {
  const rows = (await app.db.execute<SettingRow>(sql`
    SELECT value FROM system_settings WHERE key = ${key} LIMIT 1
  `)) as unknown as SettingRow[];
  return rows[0]?.value;
}

async function storeOutbound(
  app: FastifyInstance,
  piiKey: string,
  toPhone: string,
  body: string,
  status: 'sent' | 'queued' | 'failed',
  providerMessageId: string | null,
): Promise<void> {
  // The table CHECK requires provider_error NOT NULL exactly when failed.
  const providerErrorJson =
    status === 'failed' ? JSON.stringify({ source: 'booking_auto_reply' }) : null;
  // Explicit PII key (Phase-2 P1.1) — detached path, no request scope to read
  // the key from.
  await withPiiKey(app.db, piiKey, async (tx) => {
    await tx.execute(sql`
      INSERT INTO whatsapp_outbound_messages
        (to_phone, body, body_encrypted, status, provider_message_id, provider_error)
      VALUES (${toPhone}, ${body}, encrypt_pii(${body}), ${status}, ${providerMessageId},
              ${providerErrorJson}::jsonb)
    `);
  });
}

export interface BookingAutoReplyEnv {
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_ACCESS_TOKEN: string;
}

/**
 * Fire-and-forget booking-link auto-reply for one inbound WhatsApp message.
 *
 * Idempotency/no-loop guarantees live at the call site: the webhook only
 * triggers this for messages whose `meta_message_id` INSERT succeeded (the
 * UNIQUE constraint dedupes Meta retries), and Meta never re-delivers our
 * own outbound sends as inbound `messages[*]` — so this can never loop.
 *
 * Never throws — every failure is logged; without WHATSAPP_* keys the reply
 * is recorded as 'queued' in whatsapp_outbound_messages (inert, visible).
 */
export async function runBookingAutoReply(
  app: FastifyInstance,
  env: BookingAutoReplyEnv,
  toPhone: string,
  piiKey: string,
): Promise<void> {
  try {
    // Keep the 24h-window bookkeeping honest even though we skip the AI bot.
    await app.db.execute(sql`
      INSERT INTO whatsapp_conversations (customer_phone_e164, last_inbound_at)
      VALUES (${toPhone}, now())
      ON CONFLICT (customer_phone_e164) DO UPDATE SET last_inbound_at = now()
    `);

    const baseRaw = await readSetting(app, 'storefront.public_base_url');
    const base =
      typeof baseRaw === 'string' && baseRaw.trim().length > 0
        ? baseRaw.trim()
        : DEFAULT_PUBLIC_BASE_URL;
    const bookingUrl = `${base.replace(/\/+$/, '')}/termin`;

    const hoursRaw = await readSetting(app, 'appointments.business_hours');
    const reply = buildBookingLinkReply(bookingUrl, formatBusinessHoursDe(hoursRaw));

    const cfg: AppointmentWhatsAppConfig = {
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
    };
    if (!isWhatsAppConfigured(cfg)) {
      // Token-gated: fully wired but inert until the Meta keys are set.
      app.log.info({ toPhone }, 'booking auto-reply: whatsapp not configured — queued');
      await storeOutbound(app, piiKey, toPhone, reply, 'queued', null);
      return;
    }

    try {
      const sent = await sendToMeta({
        phoneNumberId: cfg.phoneNumberId,
        accessToken: cfg.accessToken,
        toPhone,
        messageBody: reply,
      });
      await storeOutbound(app, piiKey, toPhone, reply, 'sent', sent.messageId);
    } catch (err) {
      const providerCode = err instanceof MetaApiError ? err.providerCode : null;
      app.log.warn({ providerCode, toPhone }, 'booking auto-reply: send rejected by provider');
      await storeOutbound(app, piiKey, toPhone, reply, 'failed', null);
    }
  } catch (err) {
    app.log.error({ err, toPhone }, 'booking auto-reply failed');
  }
}
