# Dialog migration checklist (UX P0 → incremental)

The shared `@warehouse14/ui-kit` **`Dialog`** (centered) / **`Sheet`** (right
slide-over) + **Form** primitives (`Field` / `Input` / `Select` / `Textarea` /
`Checkbox`) are the single accessible foundation: focus trap + restore, ESC /
backdrop close, scroll-lock, `aria-modal` + `aria-labelledby`, ≥48px targets.

Every remaining hand-rolled `<div role="dialog">` should migrate to it
incrementally. Behaviour must stay identical (same fields, submit calls,
validation/guards) — only the wrapper changes.

## Done (P0 — proof in production)
- [x] `app/chrome/StepUpModal.tsx` — Dialog core (freeform body; `showClose=false`).
- [x] `screens/kasse/CashMovementDialog.tsx` — Dialog + `DialogBody`/`DialogFooter`
      slots + `Field`/`Input` (the form-primitive proof).

## Remaining DIY dialogs (migrate one per touch, when next edited)
- [ ] `screens/kasse/ZBonDialog.tsx` — two-phase (input → result); Dialog core, keep `EuroInput`.
- [ ] `screens/verkauf/StornoDialog.tsx`
- [ ] `screens/verkauf/BezahlenDialog.tsx` — **payment**: migrate the shell only, do NOT touch finalize/payment logic.
- [ ] `screens/kunden/CustomerCreateDialog.tsx` — strong `Field`/`Input` candidate.
- [ ] `screens/kunden/CustomerEditDialog.tsx`
- [ ] `screens/kunden/CustomerTrustDialog.tsx`
- [ ] `screens/bewertung/AcceptanceDialog.tsx`

## Deliberately NOT migrated (rewritten in P1 — porting now is wasted work)
- `screens/lager/NeuesProduktDialog.tsx`
- `screens/lager/InventoryAdjustmentDialog.tsx`
- `screens/ankauf/AnkaufBezahlenDialog.tsx`
  → all three are replaced by the P1 **Unified Product Lifecycle** product `Sheet`.

## Stays bespoke
- `app/chrome/Spotlight.tsx` — a command palette (combobox/listbox), not a form
  dialog. It already sets `role="dialog" aria-modal`, so the number-key nav guard
  (`isAnyDialogOpen`) correctly suppresses while it is open.
