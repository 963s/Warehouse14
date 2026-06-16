/**
 * Settings endpoints (Owner Control Desktop — Einstellungen surface).
 *
 *   GET   /api/settings       — ADMIN: read snapshot of tunables + device fleet.
 *   PATCH /api/settings/:key  — ADMIN + step-up: change one operator-tunable.
 *
 * `system_settings` holds the operator-tunable knobs (anomaly Z-score, AI
 * budget caps, smurfing/KYC thresholds, cash-drawer variance, …) and the
 * paired `devices` fleet (POS terminals, control desktops, workers) with cert
 * headroom. The PATCH path guards every change behind a curated allow-list with
 * per-key range validation — an unknown or non-editable key is refused (no
 * arbitrary writes) — and records the actor to audit_log. Device revocation
 * (mTLS cert) stays out of scope here: it is a security-sensitive operation
 * without an endpoint yet, so the fleet remains read-only.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { auditLog } from '@warehouse14/db/schema';

import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

/**
 * The curated set of operator-tunable settings the Owner Desktop may write.
 * Anything outside this map is refused — `system_settings` also stores
 * worker-populated rows (lbma.latest_fix) and shapes we must not clobber.
 *
 * `kind` mirrors the stored jsonb shape so we round-trip it faithfully:
 *   • 'number' → a bare JSON number  ('3.0'::jsonb)
 *   • 'money'  → a JSON string with 2 decimals  ('"5.00"'::jsonb)
 *   • 'text'   → a free JSON string  ('"WAREHOUSE 14"'::jsonb), max `maxLen`
 */
type EditableKind = 'number' | 'money' | 'text';
interface EditableSetting {
  kind: EditableKind;
  /** number/money: numeric bounds. text: ignored. */
  min: number;
  max: number;
  /** text only: max characters (default 200). */
  maxLen?: number;
  /** German one-liner shown if the value is invalid. */
  label: string;
}
const EDITABLE_SETTINGS: Record<string, EditableSetting> = {
  'anomaly.sigma_threshold': {
    kind: 'number',
    min: 2.0,
    max: 4.0,
    label: 'Z-Wert-Schwelle (2,0–4,0)',
  },
  'ai_budget.daily_eur.total': { kind: 'money', min: 0, max: 100_000, label: 'KI-Tagesbudget' },
  'ai_budget.alert_threshold_pct': {
    kind: 'number',
    min: 1,
    max: 100,
    label: 'KI-Warnschwelle (%)',
  },
  'ai_budget.hard_stop_threshold_pct': {
    kind: 'number',
    min: 50,
    max: 300,
    label: 'KI-Stoppschwelle (%)',
  },
  'appointment.no_show_grace_minutes': {
    kind: 'number',
    min: 0,
    max: 240,
    label: 'Kulanz bis No-Show (Min.)',
  },
  'smurfing.ankauf_count_window_days': {
    kind: 'number',
    min: 1,
    max: 90,
    label: 'Smurfing-Fenster (Tage)',
  },
  'smurfing.ankauf_count_threshold': {
    kind: 'number',
    min: 1,
    max: 20,
    label: 'Smurfing-Anzahl-Schwelle',
  },
  'cash_drawer.variance_alert_threshold_eur': {
    kind: 'money',
    min: 0,
    max: 1_000,
    label: 'Kassendifferenz-Schwelle',
  },
  // Shop identity printed on the receipt header (migration 0044).
  'shop.name': { kind: 'text', min: 0, max: 0, maxLen: 80, label: 'Geschäftsname' },
  'shop.tagline': { kind: 'text', min: 0, max: 0, maxLen: 80, label: 'Slogan' },
  'shop.address_line1': { kind: 'text', min: 0, max: 0, maxLen: 100, label: 'Adresse Zeile 1' },
  'shop.address_line2': { kind: 'text', min: 0, max: 0, maxLen: 100, label: 'Adresse Zeile 2' },
  'shop.vat_id': { kind: 'text', min: 0, max: 0, maxLen: 20, label: 'USt-IdNr.' },
  'shop.phone': { kind: 'text', min: 0, max: 0, maxLen: 32, label: 'Telefon' },
};

class SettingNotEditableError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}
class SettingRangeError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}
class SettingNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

const SettingItem = Type.Object({
  key: Type.String(),
  value: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.String({ format: 'date-time' }),
});

const DeviceItem = Type.Object({
  id: Type.String({ format: 'uuid' }),
  deviceClass: Type.String(),
  status: Type.String(),
  certExpiresAt: Type.String({ format: 'date-time' }),
  lastSeenAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

const SettingsResponse = Type.Object({
  settings: Type.Array(SettingItem),
  devices: Type.Array(DeviceItem),
});

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const UpdateSettingParams = Type.Object({ key: Type.String({ minLength: 1, maxLength: 120 }) });
const UpdateSettingBody = Type.Object({
  /** New value. Number/money keys take a number; text keys take a string. */
  value: Type.Union([Type.Number(), Type.String({ maxLength: 200 })]),
});
const UpdateSettingResponse = Type.Object({
  key: Type.String(),
  value: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  updatedAt: Type.String({ format: 'date-time' }),
});
type TUpdateSettingParams = { key: string };
type TUpdateSettingBody = { value: number | string };

type SettingRow = { key: string; value: string; description: string | null; updated_at: Date };
type DeviceRow = {
  id: string;
  device_class: string;
  status: string;
  cert_expires_at: Date;
  last_seen_at: Date | null;
};

const settingsRoute: FastifyPluginAsync = async (app) => {
  app.get(
    '/api/settings',
    {
      schema: {
        tags: ['settings'],
        summary: 'Read system settings + paired device fleet (ADMIN).',
        description: 'Read-only snapshot of system_settings tunables and the devices table.',
        response: { 200: SettingsResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const settingRows = (await app.db.execute<SettingRow>(sql`
        SELECT key, value::text AS value, description, updated_at
          FROM system_settings
         ORDER BY key ASC
      `)) as unknown as SettingRow[];

      const deviceRows = (await app.db.execute<DeviceRow>(sql`
        SELECT id::text AS id, device_class::text AS device_class, status::text AS status,
               cert_expires_at, last_seen_at
          FROM devices
         ORDER BY paired_at DESC
      `)) as unknown as DeviceRow[];

      return reply.status(200).send({
        settings: settingRows.map((r) => ({
          key: r.key,
          value: r.value,
          description: r.description,
          updatedAt: new Date(r.updated_at).toISOString(),
        })),
        devices: deviceRows.map((r) => ({
          id: r.id,
          deviceClass: r.device_class,
          status: r.status,
          certExpiresAt: new Date(r.cert_expires_at).toISOString(),
          lastSeenAt: r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null,
        })),
      });
    },
  );

  // ────────────────────────────────────────────────────────────────────
  // PATCH /api/settings/:key — change one operator-tunable (ADMIN + step-up).
  // ────────────────────────────────────────────────────────────────────
  app.patch<{ Params: TUpdateSettingParams; Body: TUpdateSettingBody }>(
    '/api/settings/:key',
    {
      schema: {
        tags: ['settings'],
        summary: 'Change one operator-tunable setting (ADMIN + step-up).',
        description:
          'Writes one allow-listed key in system_settings after range validation. ' +
          'Records the actor to audit_log. Unknown / non-editable keys are refused.',
        params: UpdateSettingParams,
        body: UpdateSettingBody,
        response: {
          200: UpdateSettingResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      requireStepUp(req);

      const { key } = req.params;
      const spec = EDITABLE_SETTINGS[key];
      if (!spec) {
        throw new SettingNotEditableError(
          `Setting "${key}" is not editable from the Owner Desktop.`,
        );
      }

      const { value } = req.body;

      // Round-trip the stored jsonb shape from a BOUND parameter (never
      // string-concatenated jsonb): number → bare JSON number, money →
      // 2-decimal JSON string, text → free JSON string.
      let jsonbValue: ReturnType<typeof sql>;
      if (spec.kind === 'text') {
        if (typeof value !== 'string') {
          throw new SettingRangeError(`${spec.label}: Text erforderlich.`);
        }
        const maxLen = spec.maxLen ?? 200;
        if (value.length > maxLen) {
          throw new SettingRangeError(`${spec.label}: höchstens ${maxLen} Zeichen.`);
        }
        jsonbValue = sql`to_jsonb(${value}::text)`;
      } else {
        if (
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          value < spec.min ||
          value > spec.max
        ) {
          throw new SettingRangeError(
            `${spec.label}: Wert muss zwischen ${spec.min} und ${spec.max} liegen.`,
          );
        }
        jsonbValue =
          spec.kind === 'money'
            ? sql`to_jsonb(${value.toFixed(2)}::text)`
            : sql`to_jsonb(${value}::numeric)`;
      }

      // P1.5 — the value change + the rich-context audit row commit together in
      // ONE transaction. Previously the UPDATE committed, then the audit insert
      // ran as a separate statement; a crash or transient pool error between
      // them left the tunable changed with NO device/IP/user-agent audit row.
      // (The DB trigger's minimal audit row already commits with the UPDATE; this
      // makes the route's richer row equally atomic.)
      const row = await app.db.transaction(async (txAny) => {
        const tx = txAny as unknown as typeof app.db;
        // Capture the prior value in the SAME statement as the write (a CTE over
        // the pre-UPDATE row) so the audit delta is atomic — no read-then-write
        // race. `old_value` is the jsonb text BEFORE this UPDATE applied.
        const updated = (await tx.execute<SettingRow & { old_value: string | null }>(sql`
          WITH prev AS (
            SELECT key, value::text AS old_value FROM system_settings WHERE key = ${key}
          )
          UPDATE system_settings AS s
             SET value = ${jsonbValue}, updated_at = now()
            FROM prev
           WHERE s.key = prev.key
          RETURNING s.key, s.value::text AS value, prev.old_value, s.description, s.updated_at
        `)) as unknown as (SettingRow & { old_value: string | null })[];

        const r = updated[0];
        if (!r) throw new SettingNotFoundError(`Setting "${key}" not found.`);

        await tx.insert(auditLog).values({
          eventType: 'system_setting.changed',
          actorUserId: req.actor.id,
          deviceId: req.deviceId ?? null,
          ipAddress: req.ip ?? null,
          userAgent: req.headers['user-agent'] ?? null,
          // Record the full delta so a GwG/GoBD auditor sees what changed.
          payload: { key, oldValue: r.old_value, newValue: r.value },
        });
        return r;
      });

      return reply.status(200).send({
        key: row.key,
        value: row.value,
        description: row.description,
        updatedAt: new Date(row.updated_at).toISOString(),
      });
    },
  );
};

export default settingsRoute;
