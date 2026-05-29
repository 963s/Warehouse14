import { describe, expect, it } from 'vitest';

import {
  type BotTools,
  type ConversationState,
  DEFAULT_BOT_SIGNATURE,
  ESCALATION_CONFIDENCE_THRESHOLD,
  createMockLlmClient,
  decideCooldown,
  runBotTurn,
  sumCallCost,
} from '../src/index.js';

function makeMockTools() {
  const calls: Array<{ method: string; args: unknown }> = [];
  const tools: BotTools = {
    searchInventory(args) {
      calls.push({ method: 'searchInventory', args });
      return Promise.resolve([
        { productId: 'p1', name: 'Goldring 750', listPriceEur: '199.00', metal: 'gold' },
      ]);
    },
    getItemDetails(args) {
      calls.push({ method: 'getItemDetails', args });
      return Promise.resolve(null);
    },
    estimateBuybackPrice(args) {
      calls.push({ method: 'estimateBuybackPrice', args });
      return Promise.resolve({
        metal: args.metal,
        avgEurPerGram: '60.0000',
        grams: args.grams ?? null,
        lowEur: '540.00',
        highEur: '600.00',
        disclaimer: 'vorbehaltlich der physischen Prüfung',
      });
    },
    bookAppointment(args) {
      calls.push({ method: 'bookAppointment', args });
      return Promise.resolve({ ok: true, appointmentId: 'a1', startsAt: args.startsAt });
    },
    checkOrderStatus(args) {
      calls.push({ method: 'checkOrderStatus', args });
      return Promise.resolve({ found: false });
    },
    getAppointmentStatus(args) {
      calls.push({ method: 'getAppointmentStatus', args });
      return Promise.resolve({ found: false });
    },
    escalateToHuman(args) {
      calls.push({ method: 'escalateToHuman', args });
      return Promise.resolve({ escalated: true });
    },
  };
  return { tools, calls };
}

const active: ConversationState = { aiActive: true, cooldownUntil: null };

describe('decideCooldown', () => {
  const now = new Date('2026-05-29T12:00:00Z');
  it('proceeds when the bot is active', () => {
    expect(decideCooldown({ aiActive: true, cooldownUntil: null }, now).action).toBe('proceed');
  });
  it('skips while a human takeover cooldown is still in the future', () => {
    const future = new Date(now.getTime() + 3_600_000);
    expect(decideCooldown({ aiActive: false, cooldownUntil: future }, now)).toEqual({
      action: 'skip',
      reason: 'in_cooldown',
    });
  });
  it('reactivates once the cooldown has lapsed', () => {
    const past = new Date(now.getTime() - 1_000);
    expect(decideCooldown({ aiActive: false, cooldownUntil: past }, now).action).toBe('reactivate');
  });
});

describe('runBotTurn', () => {
  it('skips when still in cooldown', async () => {
    const { tools, calls } = makeMockTools();
    const future = new Date(Date.now() + 3_600_000);
    const r = await runBotTurn({
      llm: createMockLlmClient(),
      tools,
      state: { aiActive: false, cooldownUntil: future },
      customerMessage: 'Haben Sie einen Ring?',
      spentTodayEur: 0,
    });
    expect(r.kind).toBe('skipped');
    expect(calls).toHaveLength(0);
  });

  it('escalates on negative sentiment (complaint) without composing a reply', async () => {
    const { tools, calls } = makeMockTools();
    const r = await runBotTurn({
      llm: createMockLlmClient(),
      tools,
      state: active,
      customerMessage: 'Ich bin sehr enttäuscht, schlechter Service!',
      spentTodayEur: 0,
    });
    expect(r.kind).toBe('escalated');
    if (r.kind === 'escalated') expect(r.reason).toBe('negative_sentiment');
    expect(calls.some((c) => c.method === 'escalateToHuman')).toBe(true);
  });

  it('escalates on low classifier confidence', async () => {
    const { tools, calls } = makeMockTools();
    const r = await runBotTurn({
      llm: createMockLlmClient(),
      tools,
      state: active,
      customerMessage: 'Hallo',
      spentTodayEur: 0,
    });
    expect(r.kind).toBe('escalated');
    if (r.kind === 'escalated') {
      expect(r.reason).toBe('low_confidence');
      expect(r.classification?.confidence).toBeLessThan(ESCALATION_CONFIDENCE_THRESHOLD);
    }
    expect(calls.some((c) => c.method === 'escalateToHuman')).toBe(true);
  });

  it('routes a product inquiry through search_inventory then composes a signed reply', async () => {
    const { tools, calls } = makeMockTools();
    const r = await runBotTurn({
      llm: createMockLlmClient(),
      tools,
      state: active,
      customerMessage: 'Haben Sie einen Ring verfügbar?',
      spentTodayEur: 0,
    });
    expect(r.kind).toBe('replied');
    if (r.kind === 'replied') {
      expect(r.toolCalls).toContain('search_inventory');
      expect(r.reply.endsWith(DEFAULT_BOT_SIGNATURE)).toBe(true);
      // classify + at least one tool-loop call + compose all recorded.
      expect(r.calls.some((c) => c.kind === 'classify')).toBe(true);
      expect(r.calls.some((c) => c.kind === 'compose')).toBe(true);
      expect(sumCallCost(r.calls)).toBeGreaterThan(0);
    }
    expect(calls.some((c) => c.method === 'searchInventory')).toBe(true);
  });

  it('grounds a buyback question via estimate_buyback_price', async () => {
    const { calls } = makeMockTools();
    const tools = makeMockTools();
    const r = await runBotTurn({
      llm: createMockLlmClient(),
      tools: tools.tools,
      state: active,
      customerMessage: 'Was zahlen Sie für 10 Gramm Gold?',
      spentTodayEur: 0,
    });
    expect(r.kind).toBe('replied');
    if (r.kind === 'replied') expect(r.toolCalls).toContain('estimate_buyback_price');
    expect(tools.calls.some((c) => c.method === 'estimateBuybackPrice')).toBe(true);
    expect(calls).toHaveLength(0); // sanity: the unused tracker stayed empty
  });

  it('hands off to a human when the daily budget is exhausted', async () => {
    const { tools, calls } = makeMockTools();
    const r = await runBotTurn({
      llm: createMockLlmClient(),
      tools,
      state: active,
      customerMessage: 'Haben Sie einen Ring verfügbar?',
      spentTodayEur: 0.5, // == cap → denied
    });
    expect(r.kind).toBe('escalated');
    if (r.kind === 'escalated') expect(r.reason).toBe('budget_exhausted');
    expect(calls).toEqual([
      { method: 'escalateToHuman', args: { reason: 'daily_budget_exhausted' } },
    ]);
  });

  it('flags reactivation when answering after a lapsed cooldown', async () => {
    const { tools } = makeMockTools();
    const past = new Date(Date.now() - 1_000);
    const r = await runBotTurn({
      llm: createMockLlmClient(),
      tools,
      state: { aiActive: false, cooldownUntil: past },
      customerMessage: 'Haben Sie einen Ring verfügbar?',
      spentTodayEur: 0,
    });
    expect(r.kind === 'replied' || r.kind === 'escalated').toBe(true);
    if (r.kind === 'replied' || r.kind === 'escalated') expect(r.reactivated).toBe(true);
  });
});
