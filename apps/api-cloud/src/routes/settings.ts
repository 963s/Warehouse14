/**
 * Settings read endpoint (Owner Control Desktop — Einstellungen surface).
 *
 *   GET /api/settings  — ADMIN only.
 *
 * A read-only snapshot of `system_settings` (tunables: step-up threshold,
 * anomaly sigma, eBay/duress config, …) and the paired `devices` fleet
 * (POS terminals, control desktops, workers) with cert headroom. Mutations
 * (changing a tunable, revoking a device) are a follow-up — this surface starts
 * as the owner's read-only "what's configured + what's paired" glance.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole } from '../lib/auth-policy.js';

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
  }),
});

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
};

export default settingsRoute;
