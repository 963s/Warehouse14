import { describe, expect, it } from 'vitest';

import {
  type IntakePlanContext,
  type ParsedIntakeMessage,
  extractIntakeMessages,
  isE164,
  planIntakeMessage,
  toE164,
} from '../../src/lib/intake-webhook.js';

const NOW = new Date('2026-05-29T12:00:00Z');

function metaPayload(messages: unknown[]): string {
  return JSON.stringify({
    entry: [{ changes: [{ value: { messages } }] }],
  });
}

describe('extractIntakeMessages', () => {
  it('parses image + text messages with timestamps', () => {
    const body = JSON.parse(
      metaPayload([
        {
          id: 'wamid.1',
          from: '491701234567',
          type: 'image',
          timestamp: '1748520000',
          image: { id: 'media-1' },
        },
        {
          id: 'wamid.2',
          from: '491701234567',
          type: 'text',
          timestamp: '1748520030',
          text: { body: 'fertig' },
        },
      ]),
    );
    const msgs = extractIntakeMessages(body);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({
      wamid: 'wamid.1',
      fromPhone: '491701234567',
      type: 'image',
      mediaId: 'media-1',
      textBody: null,
    });
    expect(msgs[0]?.receivedAt.getTime()).toBe(1748520000 * 1000);
    expect(msgs[1]).toMatchObject({ wamid: 'wamid.2', type: 'text', textBody: 'fertig' });
  });

  it('skips messages without id/from and tolerates empty payloads', () => {
    expect(extractIntakeMessages({})).toEqual([]);
    const body = JSON.parse(metaPayload([{ type: 'image' }, { id: 'x' }]));
    expect(extractIntakeMessages(body)).toEqual([]);
  });
});

describe('E.164 helpers', () => {
  it('accepts +-prefixed and bare numbers; normalizes to +', () => {
    expect(isE164('+491701234567')).toBe(true);
    expect(isE164('491701234567')).toBe(true);
    expect(isE164('abc')).toBe(false);
    expect(toE164('491701234567')).toBe('+491701234567');
    expect(toE164('+491701234567')).toBe('+491701234567');
  });
});

function imageMsg(ts: Date): ParsedIntakeMessage {
  return {
    wamid: `w-${ts.getTime()}`,
    fromPhone: '491701234567',
    type: 'image',
    textBody: null,
    mediaId: 'm',
    receivedAt: ts,
  };
}
function textMsg(body: string, ts: Date = NOW): ParsedIntakeMessage {
  return {
    wamid: `w-${body}`,
    fromPhone: '491701234567',
    type: 'text',
    textBody: body,
    mediaId: null,
    receivedAt: ts,
  };
}

const staffCtx = (now: Date): IntakePlanContext => ({
  isActiveStaff: true,
  preferredLanguage: 'de',
  now,
  windowSeconds: 120,
});

describe('planIntakeMessage — session grouping scenarios', () => {
  it('rejects an unknown / inactive sender', () => {
    const plan = planIntakeMessage(imageMsg(NOW), { ...staffCtx(NOW), isActiveStaff: false });
    expect(plan.kind).toBe('reject_unknown_sender');
  });

  it('an image slides the window to now + 120s', () => {
    const plan = planIntakeMessage(imageMsg(NOW), staffCtx(NOW));
    expect(plan.kind).toBe('store_and_extend');
    if (plan.kind === 'store_and_extend') {
      expect(plan.groupingClosesAt.getTime() - NOW.getTime()).toBe(120_000);
    }
  });

  it('a later image slides the window further forward', () => {
    const first = planIntakeMessage(imageMsg(NOW), staffCtx(NOW));
    const later = new Date(NOW.getTime() + 30_000);
    const second = planIntakeMessage(imageMsg(later), staffCtx(later));
    if (first.kind === 'store_and_extend' && second.kind === 'store_and_extend') {
      expect(second.groupingClosesAt.getTime()).toBeGreaterThan(first.groupingClosesAt.getTime());
    } else {
      throw new Error('expected both to extend');
    }
  });

  it('DONE closes the session', () => {
    expect(planIntakeMessage(textMsg('fertig'), staffCtx(NOW)).kind).toBe('close_session');
    expect(
      planIntakeMessage(textMsg('done'), { ...staffCtx(NOW), preferredLanguage: 'en' }).kind,
    ).toBe('close_session');
  });

  it('NEW / CANCEL / HELP map to their plans', () => {
    expect(planIntakeMessage(textMsg('neu'), staffCtx(NOW)).kind).toBe('start_new_session');
    expect(planIntakeMessage(textMsg('abbrechen'), staffCtx(NOW)).kind).toBe('cancel_session');
    expect(planIntakeMessage(textMsg('hilfe'), staffCtx(NOW)).kind).toBe('send_help');
  });

  it('a layout split returns labeled photo groups', () => {
    const plan = planIntakeMessage(textMsg('1-3=A, 4=B'), staffCtx(NOW));
    expect(plan.kind).toBe('split_session');
    if (plan.kind === 'split_session') {
      expect(plan.groups).toEqual([
        { label: 'A', photoIndices: [1, 2, 3] },
        { label: 'B', photoIndices: [4] },
      ]);
    }
  });

  it('a non-command caption just slides the window (not a command)', () => {
    expect(planIntakeMessage(textMsg('schöner Ring mit Stempel'), staffCtx(NOW)).kind).toBe(
      'store_and_extend',
    );
  });
});
