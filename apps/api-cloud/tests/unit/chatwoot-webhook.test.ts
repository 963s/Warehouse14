import { describe, expect, it } from 'vitest';

import {
  CHATWOOT_TAKEOVER_COOLDOWN_HOURS,
  type TakeoverExecutor,
  applyHumanTakeover,
  planChatwootEvent,
} from '../../src/lib/chatwoot.js';

describe('planChatwootEvent', () => {
  it('triggers the bot on an incoming message_created', () => {
    const action = planChatwootEvent({
      event: 'message_created',
      message_type: 'incoming',
      content: 'Habt ihr Goldringe?',
      conversation: { id: 42 },
      sender: { phone_number: '+491701234567' },
    });
    expect(action.kind).toBe('run_bot');
    if (action.kind === 'run_bot') {
      expect(action.conversationId).toBe(42);
      expect(action.conversationKey).toBe('+491701234567');
      expect(action.text).toBe('Habt ihr Goldringe?');
    }
  });

  it('ignores outgoing/agent messages and empty bodies', () => {
    expect(
      planChatwootEvent({
        event: 'message_created',
        message_type: 'outgoing',
        content: 'agent reply',
        conversation: { id: 1 },
      }).kind,
    ).toBe('ignore');
    expect(
      planChatwootEvent({
        event: 'message_created',
        message_type: 'incoming',
        content: '   ',
        conversation: { id: 1 },
      }).kind,
    ).toBe('ignore');
  });

  it('falls back to a chatwoot key when no phone/identifier is present', () => {
    const action = planChatwootEvent({
      event: 'message_created',
      message_type: 'incoming',
      content: 'hi',
      conversation: { id: 7 },
    });
    expect(action.kind).toBe('run_bot');
    if (action.kind === 'run_bot') expect(action.conversationKey).toBe('chatwoot:conv:7');
  });

  it('requests human takeover when a conversation goes to "open"', () => {
    const action = planChatwootEvent({
      event: 'conversation_status_changed',
      status: 'open',
      id: 99,
      meta: { sender: { phone_number: '+491700000000' } },
    });
    expect(action.kind).toBe('human_takeover');
    if (action.kind === 'human_takeover') {
      expect(action.conversationId).toBe(99);
      expect(action.conversationKey).toBe('+491700000000');
    }
  });

  it('ignores non-open status changes and unknown events', () => {
    expect(
      planChatwootEvent({ event: 'conversation_status_changed', status: 'resolved', id: 1 }).kind,
    ).toBe('ignore');
    expect(planChatwootEvent({ event: 'webwidget_triggered' }).kind).toBe('ignore');
    expect(planChatwootEvent({}).kind).toBe('ignore');
  });
});

describe('applyHumanTakeover', () => {
  it('pauses AI (ai_active=false) and sets a 12h cooldown', async () => {
    const calls: Array<{ conversationKey: string; cooldownUntil: Date }> = [];
    const exec: TakeoverExecutor = {
      setTakeover: (args) => {
        calls.push(args);
        return Promise.resolve();
      },
    };
    const now = new Date('2026-05-29T12:00:00Z');

    const result = await applyHumanTakeover(exec, '+491701234567', now);

    expect(result.aiActive).toBe(false);
    expect(result.cooldownUntil.getTime()).toBe(
      now.getTime() + CHATWOOT_TAKEOVER_COOLDOWN_HOURS * 60 * 60 * 1000,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.conversationKey).toBe('+491701234567');
    // now (12:00Z) + 12h = next day 00:00Z.
    expect(calls[0]?.cooldownUntil.toISOString()).toBe('2026-05-30T00:00:00.000Z');
  });
});
