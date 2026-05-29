/**
 * Intake webhook — pure parsing + planning layer (ADR-0015 §2-4).
 *
 * Kept free of DB/Fastify so the parsing and session-grouping decisions are
 * unit-testable in isolation. The route is a thin persister that switches on
 * the plan this module returns.
 */

import {
  type LanguageCode,
  type OverrideCommand,
  type SplitGroup,
  decideGroupingAction,
  parseOverrideCommand,
} from '@warehouse14/intake-pipeline';

export type IntakeMessageType = 'image' | 'text' | 'audio' | 'unknown';

export interface ParsedIntakeMessage {
  wamid: string;
  fromPhone: string;
  type: IntakeMessageType;
  textBody: string | null;
  /** Meta media id (image/audio), to be fetched + stored in R2 by the worker. */
  mediaId: string | null;
  receivedAt: Date;
}

interface RawMetaMessage {
  id?: string;
  from?: string;
  type?: string;
  timestamp?: string;
  text?: { body?: string };
  image?: { id?: string };
  audio?: { id?: string };
}

interface RawMetaEntry {
  changes?: Array<{ value?: { messages?: RawMetaMessage[] } }>;
}

function normalizeType(t: string | undefined): IntakeMessageType {
  if (t === 'image' || t === 'text' || t === 'audio') return t;
  return 'unknown';
}

/** Extract inbound intake messages from a Meta webhook payload. */
export function extractIntakeMessages(body: unknown): ParsedIntakeMessage[] {
  const parsed = body as { entry?: RawMetaEntry[] };
  const out: ParsedIntakeMessage[] = [];
  for (const entry of parsed.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        if (!msg.id || !msg.from) continue;
        const type = normalizeType(msg.type);
        const tsSec = msg.timestamp ? Number(msg.timestamp) : Number.NaN;
        const receivedAt = Number.isFinite(tsSec) ? new Date(tsSec * 1000) : new Date();
        out.push({
          wamid: msg.id,
          fromPhone: msg.from,
          type,
          textBody: typeof msg.text?.body === 'string' ? msg.text.body : null,
          mediaId: msg.image?.id ?? msg.audio?.id ?? null,
          receivedAt,
        });
      }
    }
  }
  return out;
}

/** E.164: leading '+' then 8-15 digits (Meta sends without '+', so accept both). */
const E164_RE = /^\+?[1-9]\d{7,14}$/;

export function isE164(phone: string): boolean {
  return E164_RE.test(phone.trim());
}

/** Normalize a Meta sender to canonical E.164 ('+' prefixed). */
export function toE164(phone: string): string {
  const trimmed = phone.trim();
  return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
}

export interface IntakePlanContext {
  /** True when the sender matches an active staff_phone_numbers row. */
  isActiveStaff: boolean;
  preferredLanguage: LanguageCode;
  now: Date;
  windowSeconds: number;
}

export type IntakePlan =
  | { kind: 'reject_unknown_sender' }
  | { kind: 'store_and_extend'; groupingClosesAt: Date }
  | { kind: 'close_session' }
  | { kind: 'start_new_session' }
  | { kind: 'cancel_session' }
  | { kind: 'send_help' }
  | { kind: 'split_session'; groups: SplitGroup[] };

/**
 * Decide what to do with one inbound intake message. Unknown senders are
 * rejected; text commands override the grouping window; everything else slides
 * the window forward.
 */
export function planIntakeMessage(msg: ParsedIntakeMessage, ctx: IntakePlanContext): IntakePlan {
  if (!ctx.isActiveStaff) return { kind: 'reject_unknown_sender' };

  const command: OverrideCommand | null =
    msg.type === 'text' && msg.textBody
      ? parseOverrideCommand(msg.textBody, ctx.preferredLanguage)
      : null;

  const action = decideGroupingAction(command, ctx.now, ctx.windowSeconds);
  switch (action.kind) {
    case 'extend':
      return { kind: 'store_and_extend', groupingClosesAt: action.groupingClosesAt };
    case 'close':
      return { kind: 'close_session' };
    case 'new_session':
      return { kind: 'start_new_session' };
    case 'cancel':
      return { kind: 'cancel_session' };
    case 'help':
      return { kind: 'send_help' };
    case 'split':
      return { kind: 'split_session', groups: action.groups };
    default:
      // 'noop' — decideGroupingAction never emits it for our inputs; treat as a
      // window slide so an unexpected event still keeps the session alive.
      return { kind: 'store_and_extend', groupingClosesAt: ctx.now };
  }
}
