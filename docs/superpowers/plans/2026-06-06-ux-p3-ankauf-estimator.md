# UX P3 — Ankauf guided Estimator + Schmelzwert Implementation Plan

> **For agentic workers:** implement task-by-task; commit per task. Steps use `- [ ]`.

**Goal:** Turn the silent customer-locked Ankauf pane into a 3-step guide, and complete the
Schmelzwert estimator so each precious-metal item shows the **gross melt** + an **editable suggested
buy price** (one-tap accept) derived from the SAME live rate the ticker uses.

**Architecture:** Frontend-only. The valuation core (`intake-math.ts: computeSchmelzwertEur`,
bigint-cents) already exists but is **untested** and **rejects the German comma**. P3 = TDD it +
comma-tolerance + pure helpers (`metalFromItemType`, fineness presets, `suggestedBuyEur` with the
buy-rate decision), then wire IntakeList (metal-from-itemType, gross + suggestion display, accept
prefill, hide for non-metal) and replace the lock with a 3-step guide.

**Tech Stack:** React 18, TanStack Query, vitest, `@warehouse14/ui-kit`.

---

## What already exists (do NOT rebuild)
- `intake-math.ts` — `computeSchmelzwertEur({metal, weightGrams, finenessDecimal, pricePerGramEur})`
  → bigint-cents, HALF_EVEN, `null` on any missing input. (Untested; comma-intolerant.)
- IntakeList add-item form — metal select, karatCode + finenessDecimal + weightGrams, the rates query
  (`['metal-prices','rates']`), `ankaufRateForSelectedMetal` (= `ankaufRatePerGramEur`), a passive
  `<SchmelzwertHint>`, and the `negotiatedPriceEur`/`listPriceEur` EuroInputs.
- `ankauf-kyc-gate.ts` (`evaluateKycGate`, GwG §10 ≥ €2000) + 6 tests + the `KycEarlyBanner`. **Reuse
  verbatim — do NOT weaken.** The Bezahlen → create-products → label → KYC flow is untouched.

## Buy-rate decision (requirement 2)
`MetalRate` carries **`ankaufRatePerGramEur`** = `avg10d × (1 − safetyMarginPct)` — the margin is
already baked in. **USE IT** for the suggested buy price (basis `'ankauf'`). Fall back to
`currentPricePerGramEur × (1 − safetyMarginPct)` only when the ankauf rate is null (basis `'margin'`,
the margin surfaced in the UI). Gross **melt** uses `currentPricePerGramEur`. No new fetch — reuse the
existing rates query.

---

## Tasks (commit per task)

### Task 1 — TDD the valuation math + helpers (`intake-math.ts`)
**Files:** Create `apps/tauri-pos/src/lib/intake-math.test.ts`; modify `intake-math.ts`.
- [ ] **Step 1 — failing tests** (the contract):
```ts
import { describe, expect, it } from 'vitest';
import {
  computeSchmelzwertEur, metalFromItemType, finenessDecimalForPerMille, suggestedBuyEur,
} from './intake-math.js';

describe('computeSchmelzwertEur', () => {
  it('gold 10 g × 585/1000 × 60 €/g = 351,00 €', () => {
    expect(computeSchmelzwertEur({ metal: 'gold', weightGrams: '10', finenessDecimal: '0.585', pricePerGramEur: '60.00' })).toBe('351.00');
  });
  it('tolerates the German comma in weight + fineness', () => {
    expect(computeSchmelzwertEur({ metal: 'gold', weightGrams: '10,0', finenessDecimal: '0,585', pricePerGramEur: '60.00' })).toBe('351.00');
  });
  it('missing rate / metal / weight → null (no NaN, no fake 0)', () => {
    expect(computeSchmelzwertEur({ metal: 'gold', weightGrams: '10', finenessDecimal: '0.585', pricePerGramEur: null })).toBeNull();
    expect(computeSchmelzwertEur({ metal: null, weightGrams: '10', finenessDecimal: '0.585', pricePerGramEur: '60' })).toBeNull();
    expect(computeSchmelzwertEur({ metal: 'gold', weightGrams: '', finenessDecimal: '0.585', pricePerGramEur: '60' })).toBeNull();
  });
});
describe('metalFromItemType', () => {
  it('infers the metal from the prefix; non-metal → null', () => {
    expect(metalFromItemType('gold_coin')).toBe('gold');
    expect(metalFromItemType('silver_jewelry')).toBe('silver');
    expect(metalFromItemType('platinum_bar')).toBe('platinum');
    expect(metalFromItemType('watch')).toBeNull();
    expect(metalFromItemType('antique')).toBeNull();
    expect(metalFromItemType('other')).toBeNull();
  });
});
describe('finenessDecimalForPerMille', () => {
  it('585 → "0.585", 999 → "0.999"', () => {
    expect(finenessDecimalForPerMille(585)).toBe('0.585');
    expect(finenessDecimalForPerMille(999)).toBe('0.999');
  });
});
describe('suggestedBuyEur (buy-rate decision)', () => {
  const base = { metal: 'gold' as const, weightGrams: '10', finenessDecimal: '0.585' };
  it('uses the ankauf rate when present (basis ankauf)', () => {
    const r = suggestedBuyEur({ ...base, ankaufRatePerGramEur: '54.00', currentRatePerGramEur: '60.00', safetyMarginPct: 0.1 });
    expect(r.basis).toBe('ankauf');
    expect(r.value).toBe('315.90'); // 10 × .585 × 54
  });
  it('falls back to current × (1 − margin) when no ankauf rate (basis margin)', () => {
    const r = suggestedBuyEur({ ...base, ankaufRatePerGramEur: null, currentRatePerGramEur: '60.00', safetyMarginPct: 0.1 });
    expect(r.basis).toBe('margin'); // 10 × .585 × 54 = 315,90
    expect(r.value).toBe('315.90');
  });
  it('no rate at all → none / null', () => {
    const r = suggestedBuyEur({ ...base, ankaufRatePerGramEur: null, currentRatePerGramEur: null, safetyMarginPct: 0.1 });
    expect(r.basis).toBe('none');
    expect(r.value).toBeNull();
  });
});
```
- [ ] **Step 2** — run → FAIL. **Step 3** — implement: `normalizeDecimal` the inputs inside `parseScaled`
  (comma-tolerance); add `metalFromItemType`, `finenessDecimalForPerMille`, `COMMON_FINENESS_PER_MILLE`,
  and `suggestedBuyEur` (ankauf-rate else current×(1−margin) via the bigint core). **Step 4** — PASS
  (+ existing tauri-pos tests stay green). **Step 5** — commit.

### Task 2 — wire the estimator into IntakeList
**Files:** `apps/tauri-pos/src/screens/ankauf/IntakeList.tsx`.
- Auto-set `metal` from `itemType` via `metalFromItemType` (operator may still override via the select).
- Show, for a metal item with rate + fineness + weight: **"Schmelzwert: Y € · Vorschlag: Z €"** —
  gross melt (current rate) AND the suggestion (ankauf rate), via the two `computeSchmelzwertEur`
  calls / `suggestedBuyEur`. Non-metal itemType → no estimator (manual price only).
- A **"Vorschlag übernehmen"** button (≥48px) that sets `negotiatedPriceEur` to the suggestion
  (editable); also prefill it once when the price is still empty. NEVER auto-commit. Commit.

### Task 3 — the 3-step guide (replace the silent lock)
**Files:** `IntakeList.tsx` (replace `CustomerRequiredLock`), maybe a small `AnkaufGuide` strip.
- A quiet, always-visible strip on the right pane: **"1 · Kunde wählen → 2 · Stücke bewerten →
  3 · Auszahlen"**, with the current step highlighted. Before a customer is selected, step 1 is the
  active next-action with a one-line **"Kunde links wählen, um Stücke zu erfassen"** — not a dead
  disabled void. Commit.

### Task 4 — verify
`pnpm typecheck`; `lint:all` net-0-new; ui-kit + tauri-pos tests green (incl. the 6 KYC-gate tests +
existing Ankauf); vite build; run app (MOCK_HARDWARE=1) — estimator suggests from live rates, the
3-step guide shows. Commit fixups.

---

## Self-review
- Spec: 3-step guide (T3, A) ✓; live Schmelzwert + suggestion (T1/T2, B) ✓; pure valuation TDD incl.
  fineness mapping + missing-rate→null + German-comma + decimal-safe (T1) ✓; buy-rate decision stated
  (ankauf rate, margin fallback) ✓; KYC gate reused verbatim (KycEarlyBanner/evaluateKycGate
  untouched) ✓; suggestion is an editable prefill, never auto-commit ✓.
- Behaviour deltas (additions): metal-from-itemType inference; gross-melt shown alongside the
  suggestion; one-tap accept prefill; the guide replaces the static lock. No guard weakened.
- For P1b: wiring the ProductSheet into the Ankauf post-buy (replace AnkaufBezahlenDialog's /fotos
  handoff) + retiring IntakeDraftsTray — out of scope here.
