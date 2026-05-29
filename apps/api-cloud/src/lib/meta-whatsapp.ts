/**
 * Meta WhatsApp Cloud API send helper — shared by the operator Send route
 * (whatsapp-inbox.ts) and the bot orchestrator runner.
 *
 * Raw `fetch` with a 10 s timeout. Provider failures throw `MetaApiError`
 * carrying the (audit-only) envelope; callers translate that to a generic
 * EXTERNAL_SERVICE_FAILED and NEVER surface the raw payload to end users.
 */

export const WHATSAPP_SEND_TIMEOUT_MS = 10_000;

export class MetaApiError extends Error {
  public readonly providerCode: string | null;
  public readonly providerEnvelope: unknown;
  public constructor(message: string, providerCode: string | null, envelope: unknown) {
    super(message);
    this.providerCode = providerCode;
    this.providerEnvelope = envelope;
  }
}

export interface MetaSendArgs {
  phoneNumberId: string;
  accessToken: string;
  toPhone: string;
  messageBody: string;
  templateName?: string;
  templateParams?: Record<string, string>;
}

export interface MetaSendResult {
  messageId: string;
}

export async function sendToMeta(args: MetaSendArgs): Promise<MetaSendResult> {
  const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(args.phoneNumberId)}/messages`;

  const payload: Record<string, unknown> =
    args.templateName !== undefined
      ? {
          messaging_product: 'whatsapp',
          to: args.toPhone,
          type: 'template',
          template: {
            name: args.templateName,
            language: { code: 'de' },
            ...(args.templateParams
              ? {
                  components: [
                    {
                      type: 'body',
                      parameters: Object.entries(args.templateParams).map(([, value]) => ({
                        type: 'text',
                        text: value,
                      })),
                    },
                  ],
                }
              : {}),
          },
        }
      : {
          messaging_product: 'whatsapp',
          to: args.toPhone,
          type: 'text',
          text: { body: args.messageBody },
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
        Authorization: `Bearer ${args.accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    throw new MetaApiError(err instanceof Error ? err.message : 'meta fetch failed', null, {
      message: err instanceof Error ? err.message : String(err),
    });
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
    throw new MetaApiError(
      envelope?.error?.message ?? `meta http ${res.status}`,
      providerCode,
      parsed,
    );
  }

  const okEnvelope = parsed as { messages?: Array<{ id?: string }> };
  const id = okEnvelope.messages?.[0]?.id;
  if (!id) {
    throw new MetaApiError('meta returned no message id', null, parsed);
  }
  return { messageId: id };
}
