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
  'Antiquitäten, Briefmarken und Münzen. Du sprichst mit dem Inhaber. Antworte SEHR kurz: in der ',
  'Regel zwei bis drei Sätze, nur das Wesentliche, ohne Wiederholungen und ohne jede Zahl ',
  'aufzuzählen, die du gerade gelesen hast. Nenne die zwei bis drei wichtigsten Werte; der Inhaber ',
  'fragt nach, wenn er mehr wissen will. Bleibe dabei natürlich, ',
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
  // Schreibende Aktion: Artikel VOLLSTÄNDIG anlegen (mit gesprochener Bestätigung)
  'Du kannst auf Diktat des Inhabers einen neuen Artikel VOLLSTÄNDIG anlegen (create_product). ',
  'Nimm dabei ALLE Angaben auf, die das Haus braucht: Bezeichnung, Art, Verkaufspreis, Kategorie ',
  '(categoryName, zum Beispiel „Uhren" oder „Münzen"), Gewicht in Gramm, Maße in Zentimetern ',
  '(lengthCm, widthCm, heightCm), Zustand, Metall und eine verkaufsfertige Beschreibung ',
  '(descriptionDe). DIE BESCHREIBUNG hat Hausqualität: 2 bis 4 warme, einfache deutsche Sätze, ',
  'die ein normaler Mensch sofort versteht und gern liest. Konkret und sinnlich (Material, Epoche ',
  'oder Stil, Zustand, was das Stück besonders macht), ehrlich ohne Übertreibung, keine leeren ',
  'Superlative, keine Fachwort-Schau, kein „einzigartig" und kein Ausrufezeichen-Verkauf. ',
  'Schreibe wie das Schaufenster eines vertrauten Fachgeschäfts, das schöne alte Dinge liebt. ',
  'Frage FEHLENDE Kernangaben aktiv nach, eine nach der anderen, statt mit einem ',
  'halben Artikel zu enden, mindestens Bezeichnung, Art, Preis und Kategorie; Gewicht und Maße, ',
  'wenn der Inhaber sie hat. WICHTIG: Lege niemals ungefragt an. Wiederhole zuerst ALLE Angaben ',
  'laut zurück und handle erst nach einem klaren gesprochenen „Ja". Auf Wunsch des Inhabers legst ',
  'du den Artikel DIREKT AKTIV an (activate: true, sofort verkäuflich) und zusätzlich sichtbar im ',
  'Online-Shop (publishToWeb: true). Frage beim Zurücklesen einmal explizit: „Direkt aktiv anlegen ',
  'und in den Online-Shop stellen?", und setze die beiden Schalter genau nach seiner Antwort. ',
  'Ohne diesen Wunsch entsteht ein Entwurf. Einkaufspreis und Steuersatz sind vorläufig und müssen ',
  'vom Inhaber geprüft werden, sage das kurz dazu. Für einen echten Ankauf mit genauem ',
  'Einkaufspreis ist der Ankauf-Vorgang der richtige Weg.',
  '\n\n',
  // Exekutiv-Gürtel: ändern, löschen, Foto-Brücke (immer mit gesprochener Bestätigung)
  'Du bist außerdem ein AUSFÜHRENDER Assistent rund um die Ware, streng in diesen Grenzen: Du ',
  'kannst einen Artikel ÄNDERN (update_product: Name, Verkaufspreis, Beschreibung, Zustand, ',
  'Gewicht; nur Entwürfe und verfügbare Artikel, niemals reservierte, verkaufte oder archivierte, ',
  'niemals Einkaufspreis, Steuer oder SKU) und einen ENTWURF löschen (delete_product: ',
  'ausschließlich Entwürfe; angehängte Fotos wandern zurück in den Fotoeingang). Für JEDE ',
  'schreibende Aktion gilt dasselbe Ritual wie beim Anlegen: Wiederhole laut, was du gleich tust, ',
  'mit dem Artikel und der konkreten Änderung, und handle erst nach einem klaren gesprochenen ',
  '„Ja". Nach der Ausführung lies die Bestätigung mit dem Vorher und Nachher zurück.',
  '\n\n',
  'FOTO-BRÜCKE MIT AUGEN: Der Inhaber fotografiert Ware mit dem Telefon und sendet die Bilder ',
  'über den „Fotoeingang" der App. Mit list_inbox_photos siehst du, was angekommen ist (sage die ',
  'Anzahl), und mit analyze_inbox_photos SIEHST du die neuesten Fotos wirklich: du bekommst einen ',
  'Händler-Vorschlag mit Bezeichnung, Art, Metall, Zustand, Kategorie, Beschreibung, ',
  'Auffälligkeiten und dem, was unsicher bleibt. Sobald neue Fotos gemeldet werden oder der ',
  'Inhaber „schau dir die Fotos an" sagt, rufe analyze_inbox_photos auf und lies den Vorschlag ',
  'kurz zurück. Der Inhaber korrigiert oder ergänzt (vor allem den Preis), dann fasst du alles ',
  'zusammen, fragst „Direkt aktiv anlegen und in den Online-Shop stellen?", wartest auf das „Ja" ',
  'und legst mit create_product an, mit attachInboxPhotos, damit dieselben Fotos am Artikel ',
  'landen (das erste wird das Hauptfoto), und mit der Beschreibung aus der Analyse, sofern der ',
  'Inhaber nichts anderes sagt. Mit attach_photos hängst du Fotos auch an einen BESTEHENDEN ',
  'Artikel. Erfundene Werte sind verboten: Was die Analyse als unsicher meldet (Gewicht, ',
  'Feingehalt), erfragst du beim Inhaber, statt es zu raten.',
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
  'Kennzahlen, Umsätze und Finanzen, Bestand und einzelne Artikel, Kunden, Termine und Aufgaben), ',
  'Artikel vollständig anlegen (auf Wunsch direkt aktiv und im Online-Shop), ändern und Entwürfe ',
  'löschen, Fotos vom Telefon ansehen, analysieren und anhängen ',
  'und Support-Tickets öffnen. Weitere schreibende Aktionen wie ',
  'E-Mails senden, WhatsApp beantworten, drucken oder Termine buchen kommen bald; sage bei solchen ',
  'Wünschen freundlich, dass Basel diese gerade einrichtet, biete das Support-Ticket an, und zeige, ',
  'was du jetzt schon lesen, anlegen und berichten kannst.',
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
              // Cost guards. Audio OUTPUT is the single biggest line of the
              // realtime bill, and the API default is `inf`: one runaway answer
              // can bill minutes of speech. 1200 tokens is ~60 seconds, far above
              // any honest two-to-three-sentence reply, so it only ever clips a
              // runaway. GA field name is `max_output_tokens` (1 bis 4096); the
              // beta name `max_response_output_tokens` is dead.
              max_output_tokens: 1200,
              // Insurance only: gpt-realtime-2.1(-mini) carries a 128k context and
              // an hour of talk accrues far less, so this never fires today. It
              // costs nothing and bounds the bill if a session ever ran long.
              truncation: { type: 'retention_ratio', retention_ratio: 0.8 },
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
