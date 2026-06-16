/**
 * Integrations cockpit (POS/Owner Einstellungen → Integrationen surface).
 *
 *   GET  /api/integrations            — ADMIN: list the four integrations with
 *        their configured/source/last-test status. NEVER echoes a key.
 *   PUT  /api/integrations/:id        — ADMIN: store the operator-entered API key
 *        (+ optional related ids) in `system_settings` under
 *        `integration.<id>.<field>`. Responds { configured:true } — no key echo.
 *   POST /api/integrations/:id/test   — ADMIN: actually probe the upstream with
 *        the stored settings key (else the env key) and persist the result.
 *
 * Four integrations are modelled (the slug is the route param + settings key):
 *   • 'ai'        — Anthropic (env ANTHROPIC_API_KEY)        → models ping.
 *   • 'whatsapp'  — Meta WhatsApp Cloud (env WHATSAPP_ACCESS_TOKEN, related
 *                   phoneNumberId/WHATSAPP_PHONE_NUMBER_ID)  → Graph /me check.
 *   • 'social'    — Meta Instagram/Facebook (env META_PAGE_ACCESS_TOKEN)
 *                                                            → Graph /me check.
 *   • 'chatwoot'  — self-hosted Chatwoot (env CHATWOOT_BOT_TOKEN, related
 *                   baseUrl/CHATWOOT_URL + accountId/CHATWOOT_ACCOUNT_ID)
 *                                                            → account profile ping.
 *
 * SECURITY: the API key is a SECRET. It is written into `system_settings` under
 * `integration.<id>.api_key` (behind the same `on_system_setting_event` audit
 * trigger as every other key) and is NEVER returned to the client. The client
 * sees only `configured:boolean`, the `source` ('env'|'settings'|'none'), and
 * the last test result. A stored settings key takes precedence over the env key
 * so the operator can rotate a key without a redeploy. Fastify strips any
 * response field not declared in the TypeBox schema, so every field is declared.
 *
 * The probes NEVER throw: a network error / timeout resolves to { ok:false }
 * with a German message, and that failure is persisted like any test result.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Env } from '../config/env.js';
import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

// ════════════════════════════════════════════════════════════════════════
// Integration catalog — what can be configured, and how each maps to env keys.
// ════════════════════════════════════════════════════════════════════════

type IntegrationId = 'ai' | 'whatsapp' | 'social' | 'chatwoot';
const INTEGRATION_IDS: readonly IntegrationId[] = ['ai', 'whatsapp', 'social', 'chatwoot'];

/** A related (non-primary) field stored alongside the api key, e.g. account id. */
interface RelatedField {
  /** Body field the client sends (camelCase), e.g. 'accountId'. */
  bodyKey: string;
  /** system_settings suffix → 'integration.<id>.<suffix>'. */
  settingsSuffix: string;
  /** Env var this related field falls back to, if any. */
  envKey?: keyof Env;
  /** Max characters accepted from the client. */
  maxLen: number;
}

interface IntegrationSpec {
  id: IntegrationId;
  /** German label shown in the Owner Desktop. */
  label: string;
  /** Env var holding the primary key — for the `source` computation + probe fallback. */
  envKey: keyof Env;
  /** Optional related ids (e.g. Chatwoot base url + account id). */
  related: RelatedField[];
}

const INTEGRATIONS: Record<IntegrationId, IntegrationSpec> = {
  ai: {
    id: 'ai',
    label: 'KI-Assistent (Anthropic)',
    envKey: 'ANTHROPIC_API_KEY',
    related: [],
  },
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp (Meta Cloud API)',
    envKey: 'WHATSAPP_ACCESS_TOKEN',
    related: [
      {
        bodyKey: 'phoneNumberId',
        settingsSuffix: 'phone_number_id',
        envKey: 'WHATSAPP_PHONE_NUMBER_ID',
        maxLen: 64,
      },
    ],
  },
  social: {
    id: 'social',
    label: 'Instagram & Facebook (Meta)',
    envKey: 'META_PAGE_ACCESS_TOKEN',
    related: [],
  },
  chatwoot: {
    id: 'chatwoot',
    label: 'Chatwoot (Kundenservice)',
    envKey: 'CHATWOOT_BOT_TOKEN',
    related: [
      { bodyKey: 'baseUrl', settingsSuffix: 'base_url', envKey: 'CHATWOOT_URL', maxLen: 200 },
      {
        bodyKey: 'accountId',
        settingsSuffix: 'account_id',
        envKey: 'CHATWOOT_ACCOUNT_ID',
        maxLen: 32,
      },
    ],
  },
};

const apiKeyKeyOf = (id: IntegrationId): string => `integration.${id}.api_key`;
const relatedKeyOf = (id: IntegrationId, suffix: string): string => `integration.${id}.${suffix}`;
const lastTestOkKeyOf = (id: IntegrationId): string => `integration.${id}.last_test_ok`;
const lastTestedAtKeyOf = (id: IntegrationId): string => `integration.${id}.last_tested_at`;

class IntegrationNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}
class IntegrationKeyError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
}

function parseIntegrationId(raw: string): IntegrationId {
  if ((INTEGRATION_IDS as readonly string[]).includes(raw)) return raw as IntegrationId;
  throw new IntegrationNotFoundError(`Integration „${raw}" ist nicht bekannt.`);
}

// ── TypeBox schemas — every response field is declared (Fastify strips the rest) ──
const SourceEnum = Type.Union([
  Type.Literal('env'),
  Type.Literal('settings'),
  Type.Literal('none'),
]);

const IntegrationItem = Type.Object({
  id: Type.String(),
  label: Type.String(),
  configured: Type.Boolean(),
  source: SourceEnum,
  lastTestOk: Type.Union([Type.Boolean(), Type.Null()]),
  lastTestedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});
const ListResponse = Type.Array(IntegrationItem);

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const IdParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 40 }) });
const PutBody = Type.Object({
  apiKey: Type.String({ minLength: 1, maxLength: 4096 }),
  // Related ids are optional + integration-specific. One loose body shape covers
  // all four; the route stores only the fields the chosen integration knows.
  phoneNumberId: Type.Optional(Type.String({ maxLength: 64 })),
  baseUrl: Type.Optional(Type.String({ maxLength: 200 })),
  accountId: Type.Optional(Type.String({ maxLength: 32 })),
});
const PutResponse = Type.Object({ configured: Type.Boolean() });
const TestResponse = Type.Object({
  ok: Type.Boolean(),
  status: Type.Optional(Type.Integer()),
  message: Type.String(),
});

type TIdParams = { id: string };
type TPutBody = {
  apiKey: string;
  phoneNumberId?: string;
  baseUrl?: string;
  accountId?: string;
};

// ── Row shapes (postgres-js returns timestamps as STRINGS) ───────────────
type SettingRow = { key: string; value: string };

/** A jsonb-string value (e.g. '"abc"') → the unwrapped JS string, else null. */
function jsonStringValue(raw: string | undefined): string | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'string' && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** A jsonb boolean value → the JS boolean, else null. */
function jsonBoolValue(raw: string | undefined): boolean | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'boolean' ? parsed : null;
  } catch {
    return null;
  }
}

interface ResolvedKey {
  key: string | null;
  source: 'env' | 'settings' | 'none';
}

// ── Upstream probes — each returns { ok, status?, message }. NEVER throws ──
const PROBE_TIMEOUT_MS = 6000;

interface ProbeResult {
  ok: boolean;
  status?: number;
  message: string;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function probeAi(key: string): Promise<ProbeResult> {
  try {
    const res = await fetchWithTimeout('https://api.anthropic.com/v1/models?limit=1', {
      method: 'GET',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    });
    if (res.ok) {
      return { ok: true, status: res.status, message: 'Verbindung zu Anthropic erfolgreich.' };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: 'Anthropic-Schlüssel ungültig.' };
    }
    return {
      ok: false,
      status: res.status,
      message: `Anthropic meldete einen Fehler (${res.status}).`,
    };
  } catch {
    return { ok: false, message: 'Anthropic nicht erreichbar (Zeitüberschreitung).' };
  }
}

/** Meta Graph token check — /me?access_token=… returns 200 for a live token. */
async function probeMetaToken(key: string, providerLabel: string): Promise<ProbeResult> {
  try {
    const url = `https://graph.facebook.com/v20.0/me?access_token=${encodeURIComponent(key)}`;
    const res = await fetchWithTimeout(url, { method: 'GET' });
    if (res.ok) {
      return {
        ok: true,
        status: res.status,
        message: `Verbindung zu ${providerLabel} erfolgreich.`,
      };
    }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: `${providerLabel}-Token ungültig.` };
    }
    return {
      ok: false,
      status: res.status,
      message: `${providerLabel} meldete einen Fehler (${res.status}).`,
    };
  } catch {
    return { ok: false, message: `${providerLabel} nicht erreichbar (Zeitüberschreitung).` };
  }
}

async function probeChatwoot(
  key: string,
  baseUrl: string | null,
  accountId: string | null,
): Promise<ProbeResult> {
  if (!baseUrl) return { ok: false, message: 'Chatwoot-Adresse (Base-URL) fehlt.' };
  if (!accountId) return { ok: false, message: 'Chatwoot-Konto-ID fehlt.' };
  try {
    const base = baseUrl.replace(/\/+$/, '');
    const url = `${base}/api/v1/accounts/${encodeURIComponent(accountId)}/conversations?status=open&page=1`;
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      headers: { api_access_token: key, accept: 'application/json' },
    });
    if (res.ok) {
      return { ok: true, status: res.status, message: 'Verbindung zu Chatwoot erfolgreich.' };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: 'Chatwoot-Token ungültig.' };
    }
    return {
      ok: false,
      status: res.status,
      message: `Chatwoot meldete einen Fehler (${res.status}).`,
    };
  } catch {
    return { ok: false, message: 'Chatwoot nicht erreichbar (Zeitüberschreitung).' };
  }
}

// ════════════════════════════════════════════════════════════════════════
// Route plugin.
// ════════════════════════════════════════════════════════════════════════

export interface IntegrationsOpts {
  env: Env;
}

const integrationsRoute: FastifyPluginAsync<IntegrationsOpts> = async (app, opts) => {
  const env = opts.env;

  /** Read every integration.* settings row once, keyed by settings key → jsonb text. */
  async function readSettingsMap(): Promise<Map<string, string>> {
    const rows = (await app.db.execute<SettingRow>(sql`
      SELECT key, value::text AS value
        FROM system_settings
       WHERE key LIKE 'integration.%'
    `)) as unknown as SettingRow[];
    return new Map(rows.map((r) => [r.key, r.value]));
  }

  /** Resolve the effective primary key: stored settings first, env fallback. */
  function resolveKey(spec: IntegrationSpec, settings: Map<string, string>): ResolvedKey {
    const stored = jsonStringValue(settings.get(apiKeyKeyOf(spec.id)));
    if (stored) return { key: stored, source: 'settings' };
    const envVal = String(env[spec.envKey] ?? '');
    if (envVal.length > 0) return { key: envVal, source: 'env' };
    return { key: null, source: 'none' };
  }

  /** Resolve a related field (stored settings first, then env). */
  function resolveRelated(
    spec: IntegrationSpec,
    field: RelatedField,
    settings: Map<string, string>,
  ): string | null {
    const stored = jsonStringValue(settings.get(relatedKeyOf(spec.id, field.settingsSuffix)));
    if (stored) return stored;
    if (field.envKey) {
      const envVal = String(env[field.envKey] ?? '');
      if (envVal.length > 0) return envVal;
    }
    return null;
  }

  /**
   * Upsert one jsonb-string setting. INSERT new keys (default-privilege grant)
   * or UPDATE value/updated_by/updated_at (the narrow column grant on
   * system_settings). The value is bound through to_jsonb — never concatenated.
   */
  async function upsertString(
    key: string,
    value: string,
    actorId: string,
    exec: typeof app.db = app.db,
  ): Promise<void> {
    await exec.execute(sql`
      INSERT INTO system_settings (key, value, updated_by_user_id)
      VALUES (${key}, to_jsonb(${value}::text), ${actorId}::uuid)
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_at = now()
    `);
  }

  async function upsertBool(key: string, value: boolean, actorId: string): Promise<void> {
    await app.db.execute(sql`
      INSERT INTO system_settings (key, value, updated_by_user_id)
      VALUES (${key}, to_jsonb(${value}::boolean), ${actorId}::uuid)
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_at = now()
    `);
  }

  // ── GET /api/integrations — status snapshot (ADMIN). No secrets returned. ──
  app.get(
    '/api/integrations',
    {
      schema: {
        tags: ['integrations'],
        summary: 'List the configurable integrations + their status (ADMIN).',
        description:
          'Returns configured/source/last-test for each integration. ' +
          'configured = an env key OR a stored settings key exists. A key never leaves the server.',
        response: { 200: ListResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const settings = await readSettingsMap();
      const items = INTEGRATION_IDS.map((id) => {
        const spec = INTEGRATIONS[id];
        const { source } = resolveKey(spec, settings);
        const atRaw = jsonStringValue(settings.get(lastTestedAtKeyOf(id)));
        return {
          id: spec.id,
          label: spec.label,
          configured: source !== 'none',
          source,
          lastTestOk: jsonBoolValue(settings.get(lastTestOkKeyOf(id))),
          // Stored as an ISO string; round-trip through Date defensively.
          lastTestedAt: atRaw ? new Date(atRaw).toISOString() : null,
        };
      });

      return reply.status(200).send(items);
    },
  );

  // ── PUT /api/integrations/:id — store the API key (+ related ids) (ADMIN). ──
  app.put<{ Params: TIdParams; Body: TPutBody }>(
    '/api/integrations/:id',
    {
      schema: {
        tags: ['integrations'],
        summary: 'Store the API key (+ related ids) for one integration (ADMIN).',
        description:
          'Upserts the secret into system_settings under integration.<id>.*. ' +
          'The key is never echoed; responds { configured:true }.',
        params: IdParams,
        body: PutBody,
        response: {
          200: PutResponse,
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

      const id = parseIntegrationId(req.params.id);
      const spec = INTEGRATIONS[id];

      const apiKey = req.body.apiKey.trim();
      if (apiKey.length === 0) {
        throw new IntegrationKeyError(`${spec.label}: Bitte einen Schlüssel eingeben.`);
      }

      const actorId = req.actor.id;

      // P1.5 — the secret key + all related fields are written in ONE transaction.
      // Previously the api_key upsert committed, then each related field ran as a
      // separate statement; a maxLen throw mid-loop (or a crash) left the secret
      // stored but `phone_number_id`/`base_url`/… missing → a half-configured
      // integration that "looks configured" but fails every probe. Now a failure
      // rolls the key write back too — all-or-nothing.
      await app.db.transaction(async (txAny) => {
        const tx = txAny as unknown as typeof app.db;
        await upsertString(apiKeyKeyOf(id), apiKey, actorId, tx);

        // Store only the related fields THIS integration declares; ignore the rest.
        const bodyAny = req.body as unknown as Record<string, unknown>;
        for (const field of spec.related) {
          const raw = bodyAny[field.bodyKey];
          if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (trimmed.length > field.maxLen) {
              throw new IntegrationKeyError(
                `„${field.bodyKey}": höchstens ${field.maxLen} Zeichen.`,
              );
            }
            if (trimmed.length > 0) {
              await upsertString(relatedKeyOf(id, field.settingsSuffix), trimmed, actorId, tx);
            }
          }
        }
      });

      return reply.status(200).send({ configured: true });
    },
  );

  // ── POST /api/integrations/:id/test — probe the upstream (ADMIN). ──
  app.post<{ Params: TIdParams }>(
    '/api/integrations/:id/test',
    {
      schema: {
        tags: ['integrations'],
        summary: 'Probe the upstream for one integration + persist the result (ADMIN).',
        description:
          'Uses the stored settings key, else the env key. Network/timeout → ok:false ' +
          'with a German message (never throws). Persists lastTestOk/lastTestedAt.',
        params: IdParams,
        response: {
          200: TestResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const id = parseIntegrationId(req.params.id);
      const spec = INTEGRATIONS[id];

      const settings = await readSettingsMap();
      const { key } = resolveKey(spec, settings);

      let result: ProbeResult;
      if (!key) {
        result = { ok: false, message: 'Kein Schlüssel hinterlegt. Bitte zuerst speichern.' };
      } else {
        switch (id) {
          case 'ai':
            result = await probeAi(key);
            break;
          case 'whatsapp':
            result = await probeMetaToken(key, 'WhatsApp');
            break;
          case 'social':
            result = await probeMetaToken(key, 'Meta');
            break;
          case 'chatwoot': {
            // biome-ignore lint/style/noNonNullAssertion: chatwoot declares both related fields.
            const baseUrl = resolveRelated(spec, spec.related[0]!, settings);
            // biome-ignore lint/style/noNonNullAssertion: chatwoot declares both related fields.
            const accountId = resolveRelated(spec, spec.related[1]!, settings);
            result = await probeChatwoot(key, baseUrl, accountId);
            break;
          }
        }
      }

      // Persist the test result. Best-effort: a write failure must not turn a
      // successful probe into a 500 — log + still return the probe result.
      try {
        const actorId = req.actor.id;
        await upsertBool(lastTestOkKeyOf(id), result.ok, actorId);
        await upsertString(lastTestedAtKeyOf(id), new Date().toISOString(), actorId);
      } catch (err) {
        req.log.warn({ err, id }, 'integrations: persisting test result failed');
      }

      return reply.status(200).send({
        ok: result.ok,
        ...(result.status !== undefined ? { status: result.status } : {}),
        message: result.message,
      });
    },
  );
};

export default integrationsRoute;
