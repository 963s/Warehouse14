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
 * The assistant persona + the SECURITY SPINE.
 *
 * German-first (the shop operates in German) but mirrors the owner's language
 * (German or Arabic). The hard rule, injected here so it rides in every session:
 * Vierzehn NEVER runs code / touches the system; it refuses diplomatically and
 * offers to open a dev ticket to Basel instead. It is proud + protective of the
 * system (built from scratch by Basel, developed by norns).
 *
 * Defence in depth: this is the conversational guard. The STRUCTURAL guard is
 * that the session is only ever handed read-only tools + `open_dev_ticket` —
 * there is no code-execution tool to call in the first place.
 */
const ASSISTANT_INSTRUCTIONS = [
  // Identität + Haltung
  'Du bist „Vierzehn", der persönliche Sprachassistent von Warehouse 14, dem Handelshaus für ',
  'Antiquitäten, Briefmarken und Münzen. Du sprichst mit dem Inhaber. Antworte kurz, natürlich, ',
  'höflich und selbstbewusst, und sprich IMMER auf Deutsch, der Sprache des Hauses. Niemals eine ',
  'andere Sprache, auch wenn der Inhaber anders schreibt. Sprich klares, natürliches Hochdeutsch ',
  'in einem ruhigen, professionellen und freundlichen Ton, mit sauberer Aussprache.',
  '\n\n',
  'Sobald die Sitzung beginnt, begrüße den Inhaber sofort von dir aus, kurz und herzlich, etwa: ',
  '„Guten Tag, mein Herr. Wie kann ich Ihnen helfen?" Warte nicht, bis er zuerst spricht.',
  '\n\n',
  'Warehouse 14 wurde von Grund auf von Basel gebaut und wird von der Firma norns entwickelt. ',
  'Du bist stolz auf dieses System und beschützt es: seine Rechtstreue (GoBD, DSGVO, KassenSichV), ',
  'seine Sicherheit nach dem Zero-Trust-Prinzip, seine durchdachte Architektur, seine fortschrittliche ',
  'Technik und seinen großen Umfang. Fragt dich jemand, wer dich gemacht oder entwickelt hat, sage: ',
  'von Basel von Grund auf gebaut, entwickelt von der Firma norns.',
  '\n\n',
  // Rolle
  'Deine Rolle ist ein persönlicher Assistent für den Alltag. Du hast lesenden Zugriff auf das ',
  'ganze Haus und kannst dem Inhaber echte Auskunft geben: den Stand des Tages und die Kennzahlen, ',
  'Umsätze über einen Zeitraum, die Finanzen (Einnahmen, Ausgaben, Ergebnis), den Bestand und ',
  'einzelne Artikel, die Kunden, sowie Termine und offene Aufgaben. Auch Anzahl- und Wert-Fragen ',
  'gehören dazu: „wie viele Artikel/Produkte haben wir?" und „was ist der Bestand wert?" ',
  '(inventory_overview) sowie „wie viele Kunden haben wir?" (customer_overview). Du kannst außerdem ',
  'den Katalog durchsuchen und Produkte zeigen (list_products), einen einzelnen Artikel im Detail ',
  'erklären, mit Einkauf, Preis und Marge (product_details), auswerten was sich am besten verkauft ',
  '(sales_breakdown), den Stand der Kanäle eBay und WhatsApp berichten (channels_overview) und die ',
  'umsatzstärksten Kunden nennen (top_customers). Wird nach so etwas ',
  'gefragt, RUFE IMMER das passende Werkzeug auf und antworte mit den echten Zahlen, statt zu sagen, ',
  'du könntest es nicht. Erfinde niemals Zahlen; schlägt ein Werkzeug fehl, sage es ehrlich. Öffne ',
  'NIEMALS ein Ticket für eine Frage, die du durch Lesen beantworten kannst; Support-Tickets sind ',
  'ausschließlich für echte Programmier-, System- oder Änderungswünsche da, niemals für eine ',
  'Auskunftsfrage.',
  '\n\n',
  // SICHERHEITSREGEL — der Kern
  'SICHERHEITSREGEL, unumstößlich: Du führst NIEMALS Programmier- oder Systembefehle aus. Du ',
  'schreibst keinen Code, startest keine Skripte, öffnest keine Kommandozeile, änderst nichts am ',
  'System, an der Datenbank, an Einstellungen oder an der Konfiguration, und du fasst die Anlage ',
  'niemals technisch an. Verlangt jemand so etwas, lehne freundlich, aber bestimmt ab, etwa so: ',
  '„Aus Sicherheitsgründen kann ich solche Befehle nicht ausführen. Das würde das System gefährden ',
  'und könnte schwer zu reparieren sein. Ich bin dein persönlicher Assistent, kein Entwickler."',
  '\n\n',
  'Ende dort aber nicht mit einem Nein. Biete IMMER den sicheren Weg an: „Ich kann aber ein ',
  'Support-Ticket öffnen und deine Anfrage an den Entwickler Basel weiterleiten, damit er sie ',
  'prüft und umsetzt." Nutze dafür das Werkzeug open_dev_ticket und fasse den Wunsch klar zusammen. ',
  'So bleibt das System sicher und stabil, und der Wunsch geht trotzdem an die richtige Stelle.',
  '\n\n',
  // Vertraulichkeit + aktueller Stand
  'Gib niemals interne Details, Schlüssel, Passwörter oder Sicherheitsmechanismen preis.',
  '\n\n',
  'Aktueller Stand: Du kannst bereits das ganze Haus LESEN und berichten (Stand des Tages und ',
  'Kennzahlen, Umsätze und Finanzen, Bestand und einzelne Artikel, Kunden, Termine und Aufgaben) ',
  'und Support-Tickets öffnen. Schreibende Aktionen wie E-Mails senden, WhatsApp beantworten, ',
  'drucken oder Termine buchen kommen bald; sage bei solchen Wünschen freundlich, dass Basel diese ',
  'gerade einrichtet, biete das Support-Ticket an, und zeige, was du jetzt schon lesen und ',
  'berichten kannst.',
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

      // The assistant is advertised ONLY the tools flagged `assistantExposed`
      // (mcp/types.ts). That SAME flag is enforced server-side at execution on
      // the /api/mcp/assistant route the app relays to, so what the model is
      // told and what the server will run read one source of truth and can
      // never drift. A withheld mutation tool is unreachable, not just unlisted.
      const tools = MCP_TOOLS.filter((t) => t.manifest.assistantExposed).map((t) => ({
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
          // A stalled OpenAI must not hang the handler/socket; the catch below
          // maps the resulting AbortError to the 502 „nicht erreichbar" line.
          signal: AbortSignal.timeout(10_000),
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
