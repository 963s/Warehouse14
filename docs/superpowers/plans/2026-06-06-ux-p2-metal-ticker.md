# UX P2 — Metal-price Ticker Implementation Plan

> **For agentic workers:** implement task-by-task; commit per task. Steps use `- [ ]`.

**Goal:** Replace the 983-LOC `Kurse` PRIMARY tab + the redundant Werkstatt Edelmetallkurs panel
with an always-visible, glanceable metal-price **ticker strip** in the app chrome + a lightweight
**detail popover** (compact sparkline); demote `Kurse` to a Spotlight-reachable secondary surface
(its deep charts + ADMIN override preserved).

**Architecture:** Frontend-only. Reuse the existing `['metal-prices','rates']` TanStack query (shared
cache → no second fetch) via a new `useMetalRates` hook. A pure `formatMetalTick(current, prior)`
module (TDD) drives the cells. New ui-kit primitives: `Popover` (anchored, behaviour-tested) +
`Sparkline` (pure SVG). Ticker mounts in `AppShell` below the header.

**Tech Stack:** React 18, TanStack Query, `@warehouse14/ui-kit`, vitest + jsdom + testing-library.

---

## Decisions (stated up front)

- **Δ source — reuse `ratesQ`, no second fetch.** `metalPricesApi.current` returns no prior, so it
  can't yield a Δ. `metalPricesApi.rates` returns BOTH `currentPricePerGramEur` and
  `avg10dPricePerGramEur` per metal in ONE query (the same `['metal-prices','rates']` key Kurse uses
  → TanStack dedups → no extra network). The ticker's Δ = current vs the 10-day average (the shop's
  trend reference); labelled "ggü. Ø 10 T" in the popover so the semantics are explicit. The pure
  module is agnostic — it takes `(current, prior)`.
- **Chart — lightweight `Sparkline`, leave Kurse intact.** `TradingTerminal.tsx` (the interactive
  candlestick/zoom/pan chart) is tightly coupled to range/MA/Ankauf state — unsafe to extract now.
  The popover needs a *glance*, not the terminal. So: a new pure `Sparkline` ui-kit primitive
  (values:number[] → SVG polyline) fed REAL `metalPricesApi.history` points. Kurse's PriceChart +
  TradingTerminal are untouched; the popover's "Details / Verlauf" link opens full `/kurse`.
- **Popover — build it.** ui-kit has no anchored overlay. Build a `Popover` (anchored to a trigger
  ref, portal, click-outside + ESC close, focus on open + restore on close, `role="dialog"`
  non-modal) — behaviour-tested at the P0 bar. A centered Dialog would be heavier/wrong for a price
  glance.

---

## File structure
- **Create** `packages/ui-kit/src/components/Popover.tsx` (+ test) — anchored overlay.
- **Create** `packages/ui-kit/src/components/Sparkline.tsx` (+ test) — pure compact SVG line.
- **Create** `apps/tauri-pos/src/lib/metal-tick.ts` (+ test) — pure `formatMetalTick`.
- **Create** `apps/tauri-pos/src/hooks/useMetalRates.ts` — the shared rates query (same key as Kurse).
- **Create** `apps/tauri-pos/src/app/chrome/MetalTicker.tsx` — the strip + the per-cell detail popover.
- **Modify** `apps/tauri-pos/src/app/chrome/AppShell.tsx` — mount `<MetalTicker/>` below header.
- **Modify** `apps/tauri-pos/src/app/chrome/surface-registry.ts` — Kurse → secondary; Schreiben → digit 7.
- **Modify** `apps/tauri-pos/src/screens/werkstatt/Werkstatt.tsx` — remove the Edelmetallkurs panel.
- **Modify** `packages/ui-kit/src/index.ts` — export Popover + Sparkline.

---

## Tasks (commit per task)

### Task 1 — pure `formatMetalTick` (TDD)
**Files:** Create `apps/tauri-pos/src/lib/metal-tick.ts` + `.test.ts`.
- [ ] **Step 1 — failing test:**
```ts
import { describe, expect, it } from 'vitest';
import { formatMetalTick } from './metal-tick.js';

describe('formatMetalTick', () => {
  it('up → verdigris tone with a + delta', () => {
    const t = formatMetalTick('62.50', '60.00');
    expect(t.tone).toBe('up');
    expect(t.price).toBe('62,50');         // German comma, 2 dp
    expect(t.deltaLabel.startsWith('+')).toBe(true);
  });
  it('down → wax-red tone with a − delta', () => {
    const t = formatMetalTick('58,00', '60,00'); // German-comma inputs tolerated
    expect(t.tone).toBe('down');
    expect(t.deltaLabel.includes('−') || t.deltaLabel.includes('-')).toBe(true);
  });
  it('flat → neutral tone, zero delta', () => {
    expect(formatMetalTick('60.00', '60.00').tone).toBe('flat');
  });
  it('missing/zero prior → neutral, no divide-by-zero', () => {
    expect(formatMetalTick('60.00', null).tone).toBe('flat');
    expect(formatMetalTick('60.00', '0').tone).toBe('flat');
    expect(formatMetalTick(null, '60.00').price).toBe('—');
  });
});
```
- [ ] **Step 2** — run `pnpm --filter @warehouse14/tauri-pos test` → FAIL.
- [ ] **Step 3** — implement: parse via `normalizeDecimal` (reuse, no float drift on parse), compute
  delta % as `(cur-prior)/prior`, tone up/down/flat (epsilon for flat), price formatted with German
  comma + 2dp; `deltaLabel` = signed percent (e.g. `+4,2 %`). Null/zero prior → `{tone:'flat'}`; null
  current → `{price:'—', tone:'flat', deltaLabel:''}`.
- [ ] **Step 4** — PASS. **Step 5** — commit.

### Task 2 — ui-kit `Sparkline` (TDD)
**Files:** Create `packages/ui-kit/src/components/Sparkline.tsx` + `.test.tsx`; export in index.
- [ ] **Step 1 — failing test:**
```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sparkline } from './Sparkline.js';

describe('Sparkline', () => {
  it('renders an svg polyline with one point per value', () => {
    const { container } = render(<Sparkline values={[1, 3, 2, 5]} ariaLabel="Verlauf" />);
    const poly = container.querySelector('polyline');
    expect(poly).not.toBeNull();
    expect((poly?.getAttribute('points') ?? '').trim().split(/\s+/).length).toBe(4);
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('Verlauf');
  });
  it('renders nothing meaningful for <2 points (no crash)', () => {
    const { container } = render(<Sparkline values={[]} ariaLabel="leer" />);
    expect(container.querySelector('polyline')).toBeNull();
  });
});
```
- [ ] **Step 2** — FAIL. **Step 3** — implement pure SVG: map values → points in a viewBox, `<polyline>`
  with `tone` colour (gold/verdigris/wax-red token), `aria-label`, no external deps; `<2` points → no
  polyline. **Step 4** — PASS. **Step 5** — commit.

### Task 3 — ui-kit `Popover` (TDD, P0 bar)
**Files:** Create `packages/ui-kit/src/components/Popover.tsx` + `.test.tsx`; export in index.
- [ ] **Step 1 — failing test** (open/close/ESC/click-outside/focus + aria; positioning is visual, not
  asserted in jsdom):
```tsx
import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Popover } from './Popover.js';

function Harness(): JSX.Element {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button ref={anchor} type="button" onClick={() => setOpen(true)}>open</button>
      <button type="button">outside</button>
      <Popover open={open} anchorRef={anchor} onClose={() => setOpen(false)} ariaLabel="Detail">
        <button type="button">inside</button>
      </Popover>
    </div>
  );
}
describe('Popover', () => {
  it('opens anchored, moves focus in, ESC closes + restores focus to trigger', () => {
    render(<Harness />);
    const trigger = screen.getByText('open');
    trigger.focus();
    fireEvent.click(trigger);
    const pop = screen.getByRole('dialog');
    expect(pop).toHaveAttribute('aria-label', 'Detail');
    expect(pop.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('closes on a click outside the popover + anchor', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('open'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
```
- [ ] **Step 2** — FAIL. **Step 3** — implement: portal to body; position from
  `anchorRef.current.getBoundingClientRect()` (fixed, below the anchor, clamped to viewport); on open
  capture+restore focus (rising-edge, like ModalShell) and focus first focusable/panel; `document`
  keydown ESC; `document` mousedown outside (not in popover, not in anchor) → onClose; `role="dialog"`
  (non-modal — no aria-modal, no scroll-lock). **Step 4** — PASS. **Step 5** — commit.

### Task 4 — `useMetalRates` hook + `MetalTicker` strip + AppShell mount
**Files:** Create `apps/tauri-pos/src/hooks/useMetalRates.ts`, `apps/tauri-pos/src/app/chrome/MetalTicker.tsx`;
modify `AppShell.tsx`.
- `useMetalRates` = `useQuery({ queryKey:['metal-prices','rates'], queryFn:()=>metalPricesApi.rates(api),
  staleTime:20_000, refetchInterval:20_000 })` — SAME key as Kurse (shared cache, no second fetch).
- `MetalTicker`: row of 4 cells (Gold/Silber/Platin/Palladium) via `METAL_KIND_ORDER`; each cell uses
  `formatMetalTick(rate.currentPricePerGramEur, rate.avg10dPricePerGramEur)` → label · €/g (mono) · Δ
  (verdigris/wax-red). Loading → skeleton; error/stale → last-known + faint "stale" hint. Touch cells
  ≥44px. Clicking a cell opens the detail popover (Task 5).
- AppShell: insert `<MetalTicker/>` between `SubBreadcrumb` and `<main>`. Commit.

### Task 5 — `MetalDetailPopover` (Popover + Sparkline + real history)
Clicking a cell anchors a `Popover`: current €/g, Δ (with "ggü. Ø 10 T"), last-update (`fetchedAt`), a
compact `Sparkline` from `metalPricesApi.history({metal, limit:60})` (a per-metal query, enabled only
while open), and a "Details / Verlauf →" link → `navigate('/kurse')`. Commit.

### Task 6 — demote Kurse off the primary rail
`surface-registry.ts`: Kurse `tier:'secondary'`, drop its `digit`, add aliases; Schreiben `digit:7`
(keep 1–7 contiguous). The module-load invariant must still pass. Spotlight reaches Kurse. Commit.

### Task 7 — remove the Werkstatt Edelmetallkurs panel
`Werkstatt.tsx`: remove the `<EdelmetallkursPanel/>` import + render; if it orphans a fetch, remove
that too; if removal destabilises the left column, leave it and note. Commit.

### Task 8 — verify
`pnpm typecheck`; `lint:all` net-0-new; ui-kit + tauri-pos tests green; vite build; run app
(MOCK_HARDWARE=1) — ticker renders, popover opens with a sparkline, digit-nav still guards. Commit fixups.

---

## Self-review
- Spec coverage: ticker strip (T4) ✓; reuse query/no-2nd-fetch (T4 shared key) ✓; detail popover +
  chart (T5, T2) ✓; Popover primitive + test (T3) ✓; demote Kurse + contiguous digits + preserve
  override/charts (T6 — Kurse untouched) ✓; remove Werkstatt panel (T7) ✓; TDD pure formatMetalTick
  (T1) ✓; digit-nav preserved (registry-driven, still guards). 
- Δ semantics (current vs Ø10T) stated + surfaced in UI — not hidden.
- Types: `formatMetalTick(current,prior)→{price,deltaLabel,tone}`, `Sparkline{values,tone,ariaLabel}`,
  `Popover{open,anchorRef,onClose,ariaLabel,children}`, `MetalRate.{currentPricePerGramEur,
  avg10dPricePerGramEur}`, `metalPricesApi.history({metal,limit})` — consistent with Explore facts.
