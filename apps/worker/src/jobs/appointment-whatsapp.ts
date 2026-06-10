/**
 * Worker-side appointment WhatsApp sender (token-gated, eBay pattern).
 *
 * KEEP IN SYNC with the canonical api-cloud lib
 * `apps/api-cloud/src/lib/appointment-whatsapp.ts` — the worker is a separate
 * deploy unit and cannot import api-cloud sources, so the German message
 * builder + Meta Graph send are mirrored here (same templates, same gating).
 *
 * Fully wired but INERT until WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN
 * are set in the worker env: `sendAppointmentMessage` throws the typed
 * `WhatsAppNotConfiguredError`, which the notifications sweep catches and
 * logs, marking the row 'queued' instead of crashing the job.
 */

import { berlinLabel, berlinTimeHm } from '@warehouse14/appointments';

export const WHATSAPP_SEND_TIMEOUT_MS = 10_000;

// ────────────────────────────────────────────────────────────────────────
// Config gating
// ────────────────────────────────────────────────────────────────────────

export interface AppointmentWhatsAppConfig {
  phoneNumberId: string;
  accessToken: string;
}

/** Thrown when the WHATSAPP_* env keys are absent — the sweep queues, never crashes. */
export class WhatsAppNotConfiguredError extends Error {
  public readonly code = 'WHATSAPP_NOT_CONFIGURED' as const;
  public constructor() {
    super(
      'WhatsApp ist nicht konfiguriert (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN fehlen).',
    );
    this.name = 'WhatsAppNotConfiguredError';
  }
}

/** Provider rejected the send (HTTP error / no message id / timeout). */
export class WhatsAppSendError extends Error {
  public readonly providerCode: string | null;
  public constructor(message: string, providerCode: string | null) {
    super(message);
    this.name = 'WhatsAppSendError';
    this.providerCode = providerCode;
  }
}

export function isWhatsAppConfigured(cfg: AppointmentWhatsAppConfig): boolean {
  return cfg.phoneNumberId.length > 0 && cfg.accessToken.length > 0;
}

// ────────────────────────────────────────────────────────────────────────
// German message templates (pure — mirror of the api-cloud lib)
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
  'Schornbacher Weg 66',
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

/** Map an outbox notification_type to a sendable message kind (null = unsupported). */
export function toMessageKind(notificationType: string): AppointmentMessageKind | null {
  return notificationType === 'booking_confirmation' ||
    notificationType === 'reminder_24h' ||
    notificationType === 'reminder_2h'
    ? notificationType
    : null;
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

// ────────────────────────────────────────────────────────────────────────
// Meta Graph send (mirror of api-cloud `sendToMeta`, free-form text)
// ────────────────────────────────────────────────────────────────────────

/**
 * Send one appointment message via the Meta Graph API.
 * Throws `WhatsAppNotConfiguredError` when keys are absent (token-gated) and
 * `WhatsAppSendError` on provider failures.
 */
export async function sendAppointmentMessage(
  kind: AppointmentMessageKind,
  appointment: AppointmentMessageData,
  toPhone: string,
  cfg: AppointmentWhatsAppConfig,
): Promise<{ messageId: string }> {
  if (!isWhatsAppConfigured(cfg)) throw new WhatsAppNotConfiguredError();

  const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(cfg.phoneNumberId)}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: toPhone,
    type: 'text',
    text: { body: buildAppointmentMessage(kind, appointment) },
  };

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('whatsapp send timeout')),
    WHATSAPP_SEND_TIMEOUT_MS,
  );

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    throw new WhatsAppSendError(err instanceof Error ? err.message : 'meta fetch failed', null);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text.length === 0 ? {} : JSON.parse(text);
  } catch {
    parsed = { raw: text.slice(0, 500) };
  }

  if (!res.ok) {
    const envelope = parsed as { error?: { code?: number; message?: string } };
    const providerCode = envelope?.error?.code ? String(envelope.error.code) : String(res.status);
    throw new WhatsAppSendError(
      envelope?.error?.message ?? `meta http ${res.status}`,
      providerCode,
    );
  }

  const okEnvelope = parsed as { messages?: Array<{ id?: string }> };
  const id = okEnvelope.messages?.[0]?.id;
  if (!id) throw new WhatsAppSendError('meta returned no message id', null);
  return { messageId: id };
}
