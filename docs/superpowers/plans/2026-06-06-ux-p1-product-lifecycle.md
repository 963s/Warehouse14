# UX P1 — Unified Product Lifecycle (Lager side) Implementation Plan

> **For agentic workers:** implement task-by-task; commit per task. Steps use `- [ ]`.

**Goal:** Replace `NeuesProduktDialog` + `InventoryAdjustmentDialog` with ONE `ProductSheet`
(right slide-over on the P0 `Sheet`) — the single place to create AND manage a product, with the
lifecycle as ordered, collapsible sections. Kill the `/fotos` dead-end via a round-trip return; one
consistent label control; a pure-derived lifecycle status chip; a discoverable "Auf eBay anmelden".

**Architecture:** Frontend-only. Reuse every existing endpoint/hook (`productsApi`, `ebayApi`,
`categoriesApi`, `mcpApi`, `useLabelPrinter`, `WebSeoPanel`) and the locked pure logic
(`product-publish.ts`, `adjustment-notes.ts`). New pure module `product-lifecycle.ts` (TDD). New
ui-kit `Accordion` primitive (behaviour-tested) for the collapsible lifecycle sections. Manage mode
fetches `productsApi.get(id)` (ProductDetail) keyed by a shared query key.

**Tech Stack:** React 18, TanStack Query, react-router, `@warehouse14/ui-kit` P0 primitives, vitest.

---

## Photos decision — **option (b)** (deep route + round-trip return)

`Fotos.tsx` is a **1139-LOC** camera/crop/R2 state machine entered by `?mode=produkt&productId=`.
Embedding it inline would mean decoupling that whole pipeline — high risk, large diff, easy to break
KYC/orphan modes. **Decision (b):** keep `/fotos` as the deep capture route, but make it feel like a
step of the sheet:
- The sheet's **Fotos** section shows a "Fotos aufnehmen / verwalten" button that navigates to
  `/fotos?mode=produkt&productId=<id>&returnTo=<urlenc(/lager?produkt=<id>)>`.
- `Lager` reads `?produkt=<id>` on mount and **re-opens the ProductSheet in manage mode** for that id
  → the operator lands back on the SAME product sheet. No strand.
- `Fotos` reads `?returnTo` and renders a real **"← Zurück zum Produkt"** breadcrumb that navigates
  back to it. (If `returnTo` absent, behaviour unchanged.)
- Photo thumbnails/count are best-effort (shown only if a product-photos list endpoint exists;
  otherwise the button + round-trip alone kills the dead-end, which is the hard requirement).

---

## Behaviour-parity matrix (the bar: a reviewer must do EVERYTHING the two dialogs did)

| Old behaviour | New home in ProductSheet |
|---|---|
| Create: POST /api/products (DRAFT), generateSku, fields, isMoneyInput validation | **Details** section, create mode |
| "Sofort verkaufsbereit" → PUT status=AVAILABLE when price>0; €0 guard; auto-print; toasts; draft→/fotos | create submit; reuse `decidePublish`/`isPositivePrice`; auto-print; draft → round-trip to /fotos |
| Adjustment: reason radios (LOCATION_CHANGE/LOST/DAMAGED/FOUND/OPERATOR_NOTE) | **Bestand** section |
| LOCATION_CHANGE requires all 3 location fields | same guard |
| notes ≥ 8 (`adjustment-notes.ts`) + live feedback | reuse, same feedback |
| POST /api/products/:id/inventory-adjustment; step-up via interceptor; toasts; invalidate ['products','list'] | identical |
| Web & SEO tab (`WebSeoPanel`): isPublishedToWeb, category, slug, seo_*, AI | **Web & SEO** section embeds `<WebSeoPanel productId/>` |
| Manual "Label drucken" (gated status!==SOLD && !archived) + auto-print on create | **Etikett** section: preview + always-available "Drucken" + auto-print on create |
| (none — dead-end) | **Fotos** round-trip; **Handel** eBay affordance; **lifecycle chip** |

**Deliberate ADDITIONS (call out, not regressions):** lifecycle chip; one-place "Verkaufsbereit machen"
(DRAFT→AVAILABLE) in manage mode (reuses the locked publish guard); the photos round-trip return;
the eBay affordance. No guard weakened; step-up/role gating preserved (same endpoints + interceptor).

---

## File structure

- **Create** `packages/ui-kit/src/components/Accordion.tsx` — collapsible section group (+ test).
- **Create** `apps/tauri-pos/src/lib/product-lifecycle.ts` — pure `deriveLifecycleStage` (+ test).
- **Create** `apps/tauri-pos/src/screens/lager/ProductSheet.tsx` — the unified sheet.
- **Create** `apps/tauri-pos/src/screens/lager/product-sheet-sections/` (Details, Bestand, Preis,
  Etikett, Fotos, Handel) — or inline sections in ProductSheet if small. Keep each focused.
- **Modify** `apps/tauri-pos/src/screens/lager/Lager.tsx` — open ProductSheet both ways; `?produkt=` deep-open.
- **Modify** `apps/tauri-pos/src/screens/secondary/Fotos.tsx` — `returnTo` breadcrumb.
- **Delete** `NeuesProduktDialog.tsx`, `InventoryAdjustmentDialog.tsx`.
- **Modify** `apps/tauri-pos/src/app/chrome/DIALOG-MIGRATION.md`, `packages/ui-kit/src/index.ts`.

---

## Sub-commits (commit per task)

### Task 1 — ui-kit `Accordion` primitive (TDD)
**Files:** Create `packages/ui-kit/src/components/Accordion.tsx` + `Accordion.test.tsx`; export in `index.ts`.

- [ ] **Step 1 — failing test** (`Accordion.test.tsx`):
```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Accordion, AccordionItem } from './Accordion.js';

describe('Accordion', () => {
  it('toggles a section open/closed and wires aria-expanded + region', () => {
    render(
      <Accordion>
        <AccordionItem id="a" title="Details" defaultOpen={false}>
          <p>body-a</p>
        </AccordionItem>
      </Accordion>,
    );
    const header = screen.getByRole('button', { name: /Details/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('body-a')).toBeNull();
    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('body-a')).toBeInTheDocument();
  });

  it('renders a header-right adornment (e.g. a status chip) and a defaultOpen item', () => {
    render(
      <Accordion>
        <AccordionItem id="b" title="Preis" defaultOpen adornment={<span>chip</span>}>
          <p>body-b</p>
        </AccordionItem>
      </Accordion>,
    );
    expect(screen.getByText('chip')).toBeInTheDocument();
    expect(screen.getByText('body-b')).toBeInTheDocument(); // defaultOpen
  });
});
```
- [ ] **Step 2** — run `pnpm --filter @warehouse14/ui-kit test` → FAIL (module missing).
- [ ] **Step 3** — implement `Accordion` + `AccordionItem` (each item owns open state; header is a
  `<button aria-expanded aria-controls>`; body `<div role="region">` rendered only when open; token
  styling, ≥48px header, chevron, optional `adornment` slot on the right).
- [ ] **Step 4** — run test → PASS. Export from `index.ts`.
- [ ] **Step 5** — commit: `feat(ui-kit): Accordion primitive for collapsible sections`.

### Task 2 — pure `deriveLifecycleStage` (TDD)
**Files:** Create `apps/tauri-pos/src/lib/product-lifecycle.ts` + `.test.ts`.

- [ ] **Step 1 — failing test** covering every transition + boundary:
```ts
import { describe, expect, it } from 'vitest';
import { deriveLifecycleStage } from './product-lifecycle.js';

const base = { status: 'DRAFT' as const, listPriceEur: '0.00', photoCount: 0 };
describe('deriveLifecycleStage', () => {
  it('SOLD/RESERVED/AVAILABLE map first, regardless of price/photos', () => {
    expect(deriveLifecycleStage({ ...base, status: 'SOLD', listPriceEur: '0.00' })).toBe('Verkauft');
    expect(deriveLifecycleStage({ ...base, status: 'RESERVED' })).toBe('Reserviert');
    expect(deriveLifecycleStage({ ...base, status: 'AVAILABLE' })).toBe('Veröffentlicht');
  });
  it('DRAFT with a positive price is Bepreist', () => {
    expect(deriveLifecycleStage({ ...base, listPriceEur: '12.50' })).toBe('Bepreist');
  });
  it('DRAFT, no price, with photos is Fotos', () => {
    expect(deriveLifecycleStage({ ...base, photoCount: 2 })).toBe('Fotos');
  });
  it('DRAFT, no price, no photos is Entwurf; 0,00 is not positive', () => {
    expect(deriveLifecycleStage(base)).toBe('Entwurf');
    expect(deriveLifecycleStage({ ...base, listPriceEur: '0,00' })).toBe('Entwurf');
  });
});
```
- [ ] **Step 2** — run `pnpm --filter @warehouse14/tauri-pos test` → FAIL.
- [ ] **Step 3** — implement, reusing `isPositivePrice` from `product-publish.js` (DRY):
```ts
import { isPositivePrice } from './product-publish.js';
export type LifecycleStage = 'Entwurf' | 'Fotos' | 'Bepreist' | 'Veröffentlicht' | 'Reserviert' | 'Verkauft';
export interface LifecycleInput { status: 'DRAFT'|'AVAILABLE'|'RESERVED'|'SOLD'; listPriceEur: string; photoCount?: number; }
export function deriveLifecycleStage(p: LifecycleInput): LifecycleStage {
  if (p.status === 'SOLD') return 'Verkauft';
  if (p.status === 'RESERVED') return 'Reserviert';
  if (p.status === 'AVAILABLE') return 'Veröffentlicht';
  if (isPositivePrice(p.listPriceEur)) return 'Bepreist';
  if ((p.photoCount ?? 0) > 0) return 'Fotos';
  return 'Entwurf';
}
```
- [ ] **Step 4** — run test → PASS. **Step 5** — commit.

### Task 3 — ProductSheet shell + create mode (replaces NeuesProduktDialog)
Build `ProductSheet` on `Sheet`; `mode: 'create' | { productId }`. Create mode = the NeuesProduktDialog
form (ported to `Field`/`Input`/`Select`/`Checkbox`), same validation, same submit (POST → decidePublish
→ PUT → auto-print → toasts → draft round-trip to /fotos). Header shows lifecycle chip ("Entwurf" in
create). Wire Lager "+ Neues Produkt" → ProductSheet create. Keep old dialog until Task 9. Commit.

### Task 4 — manage mode + Bestand section (parity with InventoryAdjustmentDialog Bestand)
Manage mode fetches `productsApi.get(id)`. Accordion sections; **Bestand** = reason radios + location
(required on LOCATION_CHANGE) + notes≥8 (reuse `adjustment-notes`) → `adjustInventory`; toasts; invalidate
`['products','list']` + the detail key. Commit.

### Task 5 — Preis & Veröffentlichen + Web & SEO
**Preis:** DRAFT+price>0 → "Verkaufsbereit machen" (PUT status=AVAILABLE; reuse `isPositivePrice`);
AVAILABLE → "Bereits verkaufsbereit". **Web & SEO:** `<WebSeoPanel productId={id} />`. Commit.

### Task 6 — Etikett section (one consistent label control)
Preview (SKU, name, weight, price) + "Drucken" (`useLabelPrinter`, gated `status!=='SOLD' && !archivedAt`).
Auto-print on create already in Task 3. Commit.

### Task 7 — Fotos round-trip (kill the dead-end)
Fotos section: "Fotos aufnehmen / verwalten" → `/fotos?mode=produkt&productId=<id>&returnTo=<urlenc>`.
`Lager` reads `?produkt=<id>` → opens manage sheet. `Fotos` reads `?returnTo` → back breadcrumb. Commit.

### Task 8 — Handel (eBay) affordance
`ebayState===null` → "Auf eBay anmelden" → `ebayApi.transition(api,id,{toState:'ENTWURF'})` + invalidate;
else show current `ebayState` + a hint to open the eBay console. Commit. (If large, stub with the wired
button + a note — do not block the sheet.)

### Task 9 — delete old dialogs + rewire + docs
Delete `NeuesProduktDialog.tsx`, `InventoryAdjustmentDialog.tsx`; remove imports from `Lager.tsx`; update
`DIALOG-MIGRATION.md` (mark NeuesProdukt/InventoryAdjustment DONE via ProductSheet). Commit.

### Task 10 — verify
`pnpm typecheck`; `pnpm lint:all` (net-0-new); ui-kit + tauri-pos tests green; `vite build`; run app
(MOCK_HARDWARE=1) — exercise create + edit + publish + label + photos round-trip. Commit any fixups.

---

## Self-review
- Spec coverage: §4.1 keystone (one sheet, ordered sections) ✓; gap-5 fragmentation ✓; /fotos dead-end
  (Task 7) ✓; one label control (Task 6) ✓; lifecycle chip pure+tested (Task 2) ✓; eBay affordance
  (Task 8) ✓. Behaviour parity matrix above maps every old behaviour. Reuses locked publish/notes logic.
- Types: `deriveLifecycleStage`/`LifecycleInput`, `Accordion`/`AccordionItem`, `WebSeoPanel({productId})`,
  `ebayApi.transition(client,id,{toState})`, `useLabelPrinter().print(LabelData[])` — consistent with the
  Explore-verified signatures.
- Risk: photo count needs an endpoint — best-effort, round-trip is the hard requirement (covered without it).
