# UX P5 — Kasse plain-language daily ritual Implementation Plan

> **For agentic workers:** implement task-by-task; commit per task. Steps use `- [ ]`.

**Goal:** Reframe the Kasse surface into a plain-language daily ritual — "Tag beginnen" / "Tag
abschließen", a legible Erwartet · Gezählt · Differenz close-out with a visible tolerance, and
de-jargoned Z-Bon/Kassenbuch wording — WITHOUT changing any fiscal logic.

**Architecture:** Frontend language + clarity reframe only. A new pure `kassensturz.ts`
(`classifyDifferenz`, bigint-cents, TDD) drives the close-out READOUT tone/tolerance; the numbers
themselves stay server-sourced. The blind-count guarantee, the shift open/close endpoints, the
TSE-signed Z-Bon, and the server-generated `systemExpectedEur`/`varianceEur` are untouched.

**Tech Stack:** React 18, TanStack Query, vitest, `@warehouse14/ui-kit` P0 primitives.

---

## Where "Erwartet" comes from (proof it's the SAME fiscal number)
- `shiftsApi.close()` returns `ShiftView` with **`systemExpectedEur`** (server-computed:
  `opening_float + Σcash_sales + Σinjections − Σbank_drops − Σsafe_transits`, apps/api-cloud shifts
  route) and **`varianceEur`** (a Postgres **GENERATED stored column** = `blind_count − system_expected`,
  migration 0019 — there's a db test asserting `550.00 − 545.50 = 4.50`).
- The client **displays** these. `classifyDifferenz` computes `counted − expected` for the readout —
  a math identity equal to the server's `varianceEur` — plus the tone/tolerance for display only. It
  **never** invents the expected figure and **never** hides a real shortage (the signed Differenz is
  always shown).

## Blind-count guarantee (NOT weakened)
ZBonDialog stays two-phase: the operator types `blindCountEur` FIRST (expected hidden), then the server
returns `systemExpectedEur`/`varianceEur` and the RESULT phase renders them. I only make that result
readout prominent + add the tolerance line. The TSE/Z-Bon path (server-owned, step-up via interceptor)
is untouched.

## Tolerance
The setting `cash_drawer.variance_alert_threshold_eur` exists (ADMIN-editable, 0–1000 €) but isn't
surfaced. The variance is recorded regardless of it — it only drives an alert tone, not enforcement.
I'll surface it as a visible comfort line ("Differenz bis ±X € ist im Rahmen") using the real value if
a client settings GET exists, else a clearly-labelled standard default (€5,00). Honest because the
signed Differenz is always shown.

---

## Tasks (commit per task)

### Task 1 — pure `classifyDifferenz` (TDD)
**Files:** Create `apps/tauri-pos/src/lib/kassensturz.ts` + `.test.ts`.
- [ ] **Step 1 — failing test:**
```ts
import { describe, expect, it } from 'vitest';
import { classifyDifferenz } from './kassensturz.js';

describe('classifyDifferenz (counted − expected vs tolerance)', () => {
  it('exact match → 0,00 and tone ok (within tolerance)', () => {
    const r = classifyDifferenz({ countedEur: '545.50', expectedEur: '545.50', toleranceEur: '5.00' });
    expect(r.differenzEur).toBe('0.00');
    expect(r.tone).toBe('ok');
    expect(r.withinTolerance).toBe(true);
  });
  it('over beyond tolerance → +9,50, tone over, flagged', () => {
    const r = classifyDifferenz({ countedEur: '555.00', expectedEur: '545.50', toleranceEur: '5.00' });
    expect(r.differenzEur).toBe('9.50');
    expect(r.tone).toBe('over');
    expect(r.withinTolerance).toBe(false);
  });
  it('short beyond tolerance → −10,50, tone short, flagged (never hidden)', () => {
    const r = classifyDifferenz({ countedEur: '535.00', expectedEur: '545.50', toleranceEur: '5.00' });
    expect(r.differenzEur).toBe('-10.50');
    expect(r.tone).toBe('short');
    expect(r.withinTolerance).toBe(false);
  });
  it('exactly at the threshold is within (inclusive)', () => {
    const r = classifyDifferenz({ countedEur: '550.50', expectedEur: '545.50', toleranceEur: '5.00' });
    expect(r.differenzEur).toBe('5.00');
    expect(r.withinTolerance).toBe(true);
    expect(r.tone).toBe('ok');
  });
  it('tolerates the German comma', () => {
    const r = classifyDifferenz({ countedEur: '535,00', expectedEur: '545,50', toleranceEur: '5,00' });
    expect(r.differenzEur).toBe('-10.50');
    expect(r.tone).toBe('short');
  });
  it('missing expected → no classification (null), tone ok, no fake shortage', () => {
    const r = classifyDifferenz({ countedEur: '100.00', expectedEur: null, toleranceEur: '5.00' });
    expect(r.differenzEur).toBeNull();
    expect(r.tone).toBe('ok');
    expect(r.withinTolerance).toBe(true);
  });
});
```
- [ ] **Step 2** — FAIL. **Step 3** — implement with bigint-cents (reuse `toCents`/`fromCents` from
  `intake-math.ts`, comma-tolerant): `diff = countedCents − expectedCents`; `within = |diff| ≤ tolCents`;
  tone `ok` if within, else `short` (diff<0) / `over` (diff>0); null counted/expected →
  `{differenzEur:null, tone:'ok', withinTolerance:true}`. **Step 4** — PASS. **Step 5** — commit.

### Task 2 — "Tag beginnen" (ShiftOpenPanel)
**Files:** `ShiftOpenPanel.tsx`.
- "Kasse geschlossen" → big **"Tag beginnen"** with subtitle **"Schicht öffnen"**; the one-liner
  **"Zähle dein Startgeld in der Schublade."**; button "Schicht eröffnen" → **"Tag beginnen"** (≥48px,
  fullWidth already). Same `shiftsApi.open` call + validation. Commit.

### Task 3 — "Tag abschließen" + Kassenbuch reframe (KassenbuchPanel)
**Files:** `KassenbuchPanel.tsx`.
- Header "Kasse" stays but add a plain "Heute" framing; the journal section "Aktueller Stand" /
  cash-movement area reframed to **"Heute · Ein- und Auszahlungen"** (D). Close section: button
  "Tagesabschluss (Z-Bon)" → **"Tag abschließen"** with subtitle **"Tagesabschluss · Z-Bon"** + the
  one-liner **"Der Z-Bon ist der gesetzliche Tagesabschluss (KassenSichV)."** (C). Commit.

### Task 4 — legible close-out readout (ZBonDialog)
**Files:** `ZBonDialog.tsx`.
- Input phase unchanged (blind count first). RESULT phase: a prominent three-line readout
  **Erwartet · Gezählt · Differenz** (big numbers), driven by `classifyDifferenz(blindCountEur,
  systemExpectedEur, tolerance)` for the tone + a visible **"Differenz bis ±X € ist im Rahmen"** line;
  Differenz coloured short=wax-red / over=gold / ok=verdigris; the signed number always shown. Display
  the server's `systemExpectedEur`/`varianceEur` (authoritative). TSE/close call untouched. Commit.

### Task 5 — verify
`pnpm typecheck`; `lint:all` net-0-new; ui-kit + tauri-pos tests green; vite build; run app
(MOCK_HARDWARE=1) — open ritual + the Erwartet/Gezählt/Differenz readout render. Commit fixups.

---

## Self-review
- Spec: two-action framing (T2/T3, A) ✓; Erwartet/Gezählt/Differenz readout + visible tolerance
  (T4/T1, B) ✓; jargon one-liners (T3, C) ✓; Kassenbuch reframe (T3, D) ✓; pure cash math TDD incl.
  exact/over/short/at-threshold/missing/German-comma (T1) ✓.
- Fiscal parity: Erwartet sourced from `systemExpectedEur` (server) — proof above; varianceEur (server
  generated column) displayed; blind count preserved; TSE/Z-Bon path + enforcement untouched. The
  client only computes the display Differenz (= server variance) + tone.
- Types: `classifyDifferenz({countedEur, expectedEur, toleranceEur}) → {differenzEur: string|null,
  tone: 'ok'|'short'|'over', withinTolerance}` — consistent across tasks.
