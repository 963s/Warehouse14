/**
 * AI compose — text assistant for the A4 Dokumente designer (contracts,
 * letters, correspondence). Two modes:
 *   • improve  — polish the operator's draft (spelling, grammar, tone)
 *   • generate — write a passage from a short instruction ("schreibe eine
 *                Mahnung für 250 €")
 *
 * Gated on ANTHROPIC_API_KEY: when it is empty (current prod default) the
 * endpoint returns 503 AI_NOT_CONFIGURED so the POS can show "KI nicht
 * konfiguriert" without erroring. Setting the key later activates it with NO
 * app update. Output is always German business prose, nothing else.
 */

import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

import type { Env } from '../config/env.js';
import { requireAuth, requireRole } from '../lib/auth-policy.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

const ComposeBody = Type.Object({
  mode: Type.Union([Type.Literal('improve'), Type.Literal('generate')]),
  /** improve: the draft to polish. generate: the instruction. */
  text: Type.String({ minLength: 1, maxLength: 8000 }),
  /** Optional tone hint, e.g. "förmlich", "freundlich", "bestimmt". */
  tone: Type.Optional(Type.String({ maxLength: 60 })),
  /** Optional document kind for context, e.g. "Ankaufvertrag", "Brief". */
  docKind: Type.Optional(Type.String({ maxLength: 60 })),
});
type TComposeBody = {
  mode: 'improve' | 'generate';
  text: string;
  tone?: string;
  docKind?: string;
};

const ComposeResponse = Type.Object({ text: Type.String() });
const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

class AiNotConfiguredError extends DomainError {
  public readonly httpStatus = 503;
  public readonly code: ApiErrorCode = 'EXTERNAL_SERVICE_FAILED';
}
class AiUpstreamError extends DomainError {
  public readonly httpStatus = 502;
  public readonly code: ApiErrorCode = 'EXTERNAL_SERVICE_FAILED';
}

const SYSTEM_PROMPT =
  'Du bist ein Schreibassistent für einen deutschen Edelmetall-, Münz- und ' +
  'Antiquitätenhändler. Antworte ausschließlich auf Deutsch in professionellem, ' +
  'höflichem Geschäftston. Gib NUR den fertigen Dokumenttext zurück — ohne ' +
  'Erklärungen, ohne Vorrede, ohne Anführungszeichen, ohne Markdown.';

const aiComposeRoute: FastifyPluginAsync<{ env: Env }> = async (app, opts) => {
  app.post<{ Body: TComposeBody }>(
    '/api/ai/compose',
    {
      schema: {
        tags: ['ai'],
        summary: 'Compose or improve German document text (A4 Dokumente).',
        description:
          'Gated on ANTHROPIC_API_KEY. Empty key → 503 AI_NOT_CONFIGURED. ' +
          'ADMIN + CASHIER. Returns the finished German text only.',
        body: ComposeBody,
        response: {
          200: ComposeResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          502: ErrorResponse,
          503: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      const key = opts.env.ANTHROPIC_API_KEY;
      if (!key || key.length === 0) {
        throw new AiNotConfiguredError(
          'KI ist noch nicht konfiguriert. Bitte den Anthropic-Schlüssel hinterlegen.',
        );
      }

      const { mode, text, tone, docKind } = req.body;
      const toneHint = tone ? `, gewünschter Ton: ${tone}` : '';
      const kindHint = docKind ? ` für das Dokument „${docKind}"` : '';
      const userPrompt =
        mode === 'improve'
          ? `Verbessere und glätte den folgenden Text${kindHint} (Rechtschreibung, ` +
            `Grammatik, Stil)${toneHint}. Behalte Bedeutung und alle Zahlen/Namen exakt:` +
            `\n\n${text}`
          : `Schreibe einen passenden, vollständigen Text${kindHint} basierend auf dieser ` +
            `Beschreibung${toneHint}:\n\n${text}`;

      let res: Response;
      try {
        res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-3-5-haiku-latest',
            max_tokens: 1200,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
          }),
        });
      } catch (_err) {
        throw new AiUpstreamError('KI-Dienst nicht erreichbar. Bitte erneut versuchen.');
      }

      if (!res.ok) {
        throw new AiUpstreamError(`KI-Dienst meldete einen Fehler (${res.status}).`);
      }

      const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const out =
        data.content
          ?.filter((b) => b.type === 'text')
          .map((b) => b.text ?? '')
          .join('')
          .trim() ?? '';

      return reply.status(200).send({ text: out });
    },
  );
};

export default aiComposeRoute;
