import { describe, expect, it } from 'vitest';

import {
  DEFAULT_BOT_SIGNATURE,
  DEFAULT_CONVERSATION_DAILY_CAP_EUR,
  checkConversationBudget,
  classifyCustomerIntent,
  composeBotReply,
  createMockLlmClient,
  estimateCostEur,
  parseClassification,
} from '../src/index.js';

describe('estimateCostEur', () => {
  it('computes EUR from per-1M pricing for each model', () => {
    // Haiku: 1M in @0.8 + 1M out @4.0 = 4.8 EUR.
    expect(
      estimateCostEur('claude-haiku-4-5', { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBe(4.8);
    // Sonnet: 0.5M in @2.7 + 0.1M out @13.5 = 1.35 + 1.35 = 2.7 EUR.
    expect(
      estimateCostEur('claude-sonnet-4-6', { inputTokens: 500_000, outputTokens: 100_000 }),
    ).toBe(2.7);
  });
});

describe('checkConversationBudget', () => {
  it('allows below the cap and denies at/over it', () => {
    expect(checkConversationBudget(0).allowed).toBe(true);
    expect(checkConversationBudget(0.49).allowed).toBe(true);
    expect(checkConversationBudget(DEFAULT_CONVERSATION_DAILY_CAP_EUR).allowed).toBe(false);
    expect(checkConversationBudget(0.9).allowed).toBe(false);
  });

  it('reports remaining budget (never negative)', () => {
    expect(checkConversationBudget(0.2).remainingEur).toBeCloseTo(0.3, 6);
    expect(checkConversationBudget(0.7).remainingEur).toBe(0);
  });
});

describe('parseClassification', () => {
  it('parses valid JSON and clamps confidence', () => {
    expect(
      parseClassification('{"intent":"APPOINTMENT","sentiment":"POSITIVE","confidence":1.4}'),
    ).toEqual({
      intent: 'APPOINTMENT',
      sentiment: 'POSITIVE',
      confidence: 1,
    });
  });
  it('falls back safely on garbage', () => {
    expect(parseClassification('not json')).toEqual({
      intent: 'OTHER',
      sentiment: 'NEUTRAL',
      confidence: 0,
    });
  });
  it('coerces unknown enum values to safe defaults', () => {
    expect(parseClassification('{"intent":"HACK","sentiment":"???","confidence":"x"}')).toEqual({
      intent: 'OTHER',
      sentiment: 'NEUTRAL',
      confidence: 0,
    });
  });
});

describe('classifyCustomerIntent (mock)', () => {
  const client = createMockLlmClient();

  it('routes a buyback question with high confidence + cost', async () => {
    const r = await classifyCustomerIntent(client, 'Was zahlen Sie für 10 Gramm Gold?');
    expect(r.intent).toBe('BUYBACK_QUOTE');
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
    expect(r.model).toBe('claude-haiku-4-5');
    expect(r.costEur).toBeGreaterThan(0);
  });

  it('flags a complaint as NEGATIVE', async () => {
    const r = await classifyCustomerIntent(client, 'Ich bin sehr enttäuscht, schlechter Service!');
    expect(r.sentiment).toBe('NEGATIVE');
  });
});

describe('composeBotReply (mock)', () => {
  it('appends the signature and reports Sonnet cost', async () => {
    const r = await composeBotReply(createMockLlmClient(), {
      customerMessage: 'Haben Sie Goldringe?',
      toolContext: '3 Treffer im Lager',
    });
    expect(r.reply.endsWith(DEFAULT_BOT_SIGNATURE)).toBe(true);
    expect(r.model).toBe('claude-sonnet-4-6');
    expect(r.costEur).toBeGreaterThan(0);
  });
});
