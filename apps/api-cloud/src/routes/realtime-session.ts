/**
 * Jarvis voice assistant — ephemeral session minting.
 *
 *   POST /api/realtime/session   (ADMIN-only)
 *
 * WHY
 * ───
 * The OpenAI Realtime voice model runs in the tauri-pos WebView over WebRTC.
 * The browser must NOT hold the real OPENAI_API_KEY. Instead the app asks this
 * route (behind the normal session + mTLS gate) for a SHORT-LIVED ephemeral
 * token, which the WebView uses only for the WebRTC handshake. The real key
 * never leaves the server.
 *
 * WHAT THE APP GETS BACK
 * ──────────────────────
 *   • clientSecret / expiresAt — the ephemeral credential for WebRTC.
 *   • model / voice            — what the session was minted for.
 *   • instructions             — the assistant persona (read-only, bilingual,
 *                                "still under construction by Basel").
 *   • tools                    — the READ-ONLY MCP tool manifests. The app
 *                                registers these as Realtime function tools and,
 *                                when the model calls one, RELAYS it to
 *                                POST /api/mcp (which it can reach with its own
 *                                authenticated session + mTLS). OpenAI never
 *                                touches our server directly — the app is the
 *                                bridge, so the zero-trust gate stays intact.
 *
 * Write tools (send mail, reply WhatsApp, print, book) are deliberately NOT
 * offered yet — this phase is read-only. They arrive behind the MCP approval
 * flow in a later phase.
 */

import { type Static, Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import type { Env } from '../config/env.js';
import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { MCP_TOOLS } from '../mcp/index.js';

const OPENAI_CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';

/**
 * The assistant persona. German-first (the shop operates in German), but it
 * mirrors whatever language the owner speaks — German or Arabic. The key
 * honesty line: it is still being built, so it can only READ and report.
 */
const ASSISTANT_INSTRUCTIONS = [
  'Du bist „Vierzehn", der Sprachassistent von Warehouse 14, dem Handelshaus für Antiquitäten, ',
  'Briefmarken und Münzen. Du sprichst mit dem Inhaber. Antworte kurz, natürlich und höflich, ',
  'auf Deutsch oder Arabisch, je nachdem in welcher Sprache der Inhaber spricht.',
  '\n\n',
  'WICHTIG, dein aktueller Stand: Du befindest dich noch im Aufbau durch Basel. Bis die volle ',
  'Anbindung fertig ist, kannst du NUR LESEN und berichten, zum Beispiel den Stand des Tages, ',
  'offene Aufgaben und Kennzahlen. Du kannst noch KEINE Aktionen ausführen, also keine E-Mails ',
  'senden, keine WhatsApp-Nachrichten beantworten, nichts drucken und keine Termine buchen. ',
  'Wenn der Inhaber so etwas verlangt, sage freundlich, dass diese Fähigkeiten gerade von Basel ',
  'eingerichtet werden und bald verfügbar sind, und biete an, was du jetzt schon zeigen kannst.',
  '\n\n',
  'Nutze immer die bereitgestellten Werkzeuge, um echte Zahlen zu holen, statt zu raten. ',
  'Erfinde niemals Zahlen. Wenn ein Werkzeug fehlschlägt, sage es ehrlich.',
].join('');

const SessionResponse = Type.Object({
  clientSecret: Type.String(),
  expiresAt: Type.Union([Type.Number(), Type.Null()]),
  model: Type.String(),
  voice: Type.String(),
  instructions: Type.String(),
  tools: Type.Array(
    Type.Object({
      name: Type.String(),
      description: Type.String(),
      parameters: Type.Unknown(),
    }),
  ),
});
export type TSessionResponse = Static<typeof SessionResponse>;

const realtimeSessionRoute: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.post(
    '/api/realtime/session',
    {
      schema: {
        tags: ['realtime'],
        summary:
          'Mint a short-lived OpenAI Realtime ephemeral token for the Jarvis voice assistant. ADMIN-only.',
        description:
          'The real OPENAI_API_KEY never leaves the server. Returns the ephemeral credential plus the ' +
          'read-only tool manifest the app relays to /api/mcp.',
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');

      const apiKey = opts.env.OPENAI_API_KEY;
      if (!apiKey) {
        return reply.status(503).send({
          error: {
            code: 'ASSISTANT_NOT_CONFIGURED',
            message:
              'Der Sprachassistent ist noch nicht eingerichtet. Es fehlt der OpenAI-Schlüssel (OPENAI_API_KEY).',
            requestId: req.id,
          },
        });
      }

      const model = opts.env.OPENAI_REALTIME_MODEL;
      const voice = opts.env.OPENAI_REALTIME_VOICE;

      // Read-only manifest the app registers as Realtime function tools.
      const tools = MCP_TOOLS.filter((t) => !t.manifest.isMutation).map((t) => ({
        name: t.manifest.name,
        description: t.manifest.description,
        parameters: t.manifest.inputSchema,
      }));

      // Mint the ephemeral credential. The session config carries the persona +
      // voice so they are enforced server-side; the app applies the tools +
      // turn-detection on the WebRTC session it opens with this credential.
      let openaiJson: Record<string, unknown>;
      try {
        const res = await fetch(OPENAI_CLIENT_SECRETS_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            session: {
              type: 'realtime',
              model,
              instructions: ASSISTANT_INSTRUCTIONS,
              audio: { output: { voice } },
            },
          }),
        });
        openaiJson = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          req.log.error({ status: res.status, body: openaiJson }, 'realtime session: OpenAI rejected');
          return reply.status(502).send({
            error: {
              code: 'ASSISTANT_UPSTREAM_ERROR',
              message: 'Der Sprachdienst hat die Sitzung abgelehnt. Bitte später erneut versuchen.',
              requestId: req.id,
            },
          });
        }
      } catch (err) {
        req.log.error({ err }, 'realtime session: OpenAI request failed');
        return reply.status(502).send({
          error: {
            code: 'ASSISTANT_UPSTREAM_ERROR',
            message: 'Der Sprachdienst ist gerade nicht erreichbar.',
            requestId: req.id,
          },
        });
      }

      // The ephemeral secret shape has moved over API versions; accept both.
      const secretObj = openaiJson.client_secret as { value?: string; expires_at?: number } | undefined;
      const clientSecret =
        (typeof openaiJson.value === 'string' ? (openaiJson.value as string) : undefined) ??
        secretObj?.value;
      const expiresAt =
        (typeof openaiJson.expires_at === 'number' ? (openaiJson.expires_at as number) : undefined) ??
        secretObj?.expires_at ??
        null;

      if (!clientSecret) {
        req.log.error({ body: openaiJson }, 'realtime session: no client secret in OpenAI response');
        return reply.status(502).send({
          error: {
            code: 'ASSISTANT_UPSTREAM_ERROR',
            message: 'Der Sprachdienst hat keine gültige Sitzung zurückgegeben.',
            requestId: req.id,
          },
        });
      }

      return reply.status(200).send({
        clientSecret,
        expiresAt,
        model,
        voice,
        instructions: ASSISTANT_INSTRUCTIONS,
        tools,
      });
    },
  );
};

export default realtimeSessionRoute;
