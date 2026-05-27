# Day 8 — Domain Decision: Aufnahme vs Bewertung

**Status:** Decided (2026-05-27)
**Decider:** CTO / principal architect
**Stakeholders:** Basel (Owner), single-operator workflow

---

## 1. Context

After Day 7, the platform turned a corner. The seven days from the Phase 2 kick-off built the *transactional spine* (Werkstatt, Karteikasten navigation, Operational Foundations, Kasse, Verkauf). Verkauf is now production-grade: atomic reservation, persisted cart, sign-out cleanup, rapid-scan path, step-up interceptor, shift guard.

But Verkauf is a **consumer** of inventory. The system has no Owner-facing surface that *creates* inventory. The only path to populate `products` today is `POST /api/products` (manual admin), which exists as a route but has no operator UI. The cashier can only sell what was already in the catalog. **This is the bottleneck of daily operations** for a Goldhandel / antiques / coin business where every item is unique and intake happens continuously.

The next architectural pillar must close the inventory creation loop. Two candidates competed for this slot:

* **Option A — Aufnahme (Tier-1 surface III, "Ankauf"):** single-counter intake. Customer walks in with one or several items; Owner buys them on the spot; cash leaves the drawer; products land in `AVAILABLE`. The 80% case — used many times per day.
* **Option B — Bewertung (Tier-1 surface VIII):** formal appraisal workflow. Multi-item estate / Konvolut. Owner appraises each piece, customer takes the offer overnight, ACCEPT triggers pro-rata cost allocation and creates child products as a batch. The 20% case — used weekly or monthly, but per-transaction value 10×–100× higher.

Both have full backend support: migration 0019 (Ankauf) and migration 0020 (appraisals). The decision is purely about *which workflow ships first* — and which therefore becomes the foundation the other composes onto.

This document records the architectural choice and its consequences.

---

## 2. Decision

**Build Aufnahme (Ankauf) as the Day 8 foundation.**

The single-counter intake flow is the next layer the platform needs. The estate-appraisal flow (Bewertung) lands later as a *composition over Ankauf primitives*, not the other way around.

This is not a feature ranking — it is a structural decision. Ankauf is the **atomic inventory-creation event**; Bewertung is a **batched, deliberative, customer-paced superset** of that atomic event. Building the atom first reveals the natural seams the batch flow will reuse; building the batch first risks over-abstracting before we have observed the atom in real operator hands.

---

## 3. Rejected alternative — Bewertung-first

The seductive argument for building Bewertung first: "If we model the hardest case, the simpler case falls out for free." This is the classic second-system trap.

Why it is rejected, point by point:

| Argument for Bewertung-first | Counter |
|---|---|
| "Highest-revenue events deserve the most engineering attention." | Revenue *per event* is high, but daily inventory creation depends on the FREQUENT path. A working Bewertung surface that ships in two weeks is worth less than a working Ankauf that ships in three days; one delays one estate per week, the other delays every walk-in. |
| "If Bewertung works, Ankauf is trivially derived." | Wrong vector. Bewertung is Ankauf-of-N-items + customer-overnight-think + pro-rata + Bewertungsprotokoll PDF. The atom is Ankauf. You cannot derive the atom from the molecule by *removing* parts of the molecule — the parts you remove (the multi-day state, the negotiation buffer, the formal PDF) are the parts the simpler flow *actively wants to avoid*. |
| "Building the harder case first surfaces all primitives." | True only if the harder case actually uses every primitive. Bewertung does NOT exercise: per-scan barcode speed, rapid cash-out from the Schublade in 30 seconds, single-item §25a margin entry under pressure. Those primitives only emerge from the Ankauf-fast path. |
| "Bewertung exercises the formal compliance chain hardest (KYC + sanctions + customer signature)." | All three are needed by Ankauf too — Ankauf hits the GwG identity check on EVERY transaction (no €750 threshold for buys; for cash Ankauf the discipline is identical). The compliance chain gets exercised hundreds of times sooner via Ankauf than via Bewertung. |

The over-abstraction risk is concrete: had we built Bewertung first, the Ankauf surface would inherit a multi-step state machine (DRAFT → COMPLETED → ACCEPTED) that does not fit a 90-second cash buy. The cashier would be paying the cognitive cost of a deferred-decision workflow on every single coin transaction. That is the kind of fork-in-the-road decision that compounds for years.

---

## 4. Architectural reasoning

### 4.1 Inventory lifecycle truth

The platform's inventory lifecycle has six states the system already enforces:

```
       ┌──────────────── product creation ───────────────┐
       ▼                                                  │
   DRAFT  ──(publish)──▶  AVAILABLE  ──(reserve)──▶  RESERVED  ──(finalize)──▶  SOLD
                              ▲                          │
                              └─── (release) ────────────┘
```

Today, only the right half is built (RESERVED ↔ AVAILABLE ↔ SOLD via Verkauf). The DRAFT → AVAILABLE entry edge has no operator UI. Ankauf is the surface that draws that edge.

Bewertung also creates products but it does so *transactionally inside the accept route* (see `appraisals.ts:622` — `completedAt: drizzleSql\`COALESCE(${appraisals.completedAt}, now())\``). The intake act for Bewertung is the appraisal accept, not a separate "save product" call. So Bewertung first would still leave the DRAFT-edge unowned by any operator surface for the daily case.

### 4.2 Mutation boundaries

Ankauf mutations are:

* `INSERT INTO products` (one row per item) with `acquired_from_customer_id = customer.id`, `status='AVAILABLE'` (skip DRAFT — Owner is committing at the moment of intake), `is_commission=false` unless the operator flips a flag, `tax_treatment_code` defaulted to `MARGIN_25A` for second-hand goods.
* `INSERT INTO transactions` (one row, `direction='ANKAUF'`, `total_eur = Σ items.acquisition_cost`, `customer_id = customer.id` — REQUIRED by `transactions_ankauf_requires_customer` CHECK, migration 0013 C-1).
* `INSERT INTO transaction_items` (one row per intake item, `line_total_eur = acquisition_cost`, treatment snapshot per line).
* `INSERT INTO transaction_payments` (single CASH outflow, `amount_eur = total_eur`).
* `INSERT INTO audit_log` (`ankauf.completed` with redacted PII).
* `INSERT INTO cash_movements` is automatic via the transaction itself (the shift's running cash balance updates).
* All four DB triggers fire: sanctions-block, closing-day, balance-equality, hash-chain.

All five INSERTs occur within a single DB transaction (Drizzle `db.transaction`). This is a clean atomic unit. The pieces are not new — they are exactly the same primitives Verkauf finalize uses, mirrored.

Bewertung mutations are: ALL of the above PLUS the pre-existing appraisal row + items + pro-rata recompute + the multi-day state machine + the photo workflow per item. The Ankauf mutation set is a strict subset of the Bewertung mutation set.

### 4.3 Ownership boundaries

The Verkauf rebuild taught us that ownership lives at three layers:

* **Backend** owns truth (the DB triggers reject invalid states unconditionally).
* **Zustand store** owns local intent (the cart, the in-flight reservations).
* **Surface coordinator** owns lifecycle wiring (the Reserve→Get→Add atom).

Ankauf reuses this exact pattern with minor mirror inversions:

| Layer | Verkauf | Ankauf |
|---|---|---|
| Local store | `useCartStore.lines[]` (products to sell, with reservation IDs) | `useIntakeStore.items[]` (products to buy, with draft IDs) |
| Coordinator | Reserve → Get → addLine | Validate → Sanctions → addItem |
| Atomic action | `transactionsApi.finalize` (VERKAUF) | `transactionsApi.finalize` (ANKAUF) |
| Compliance hook | Step-up if `total ≥ threshold` | Step-up if `total ≥ threshold` (same env var) |
| Shift guard | `ShiftGuard` if `current==null` | `ShiftGuard` (shared component, refactor to be direction-aware) |

So building Ankauf is **maximally additive** — it reuses cart-math, shift-guard, step-up interceptor, sign-out cascade, beforeunload, persist middleware. The blast radius on existing code is small.

### 4.4 Dependency graph impact

```
                            ┌─── (Day 8) Aufnahme ────┐
                            │   creates products      │
                            ▼                         │
   Verkauf  ◀─── catalog ─── products  ◀──────────────┘
   (Day 7)
                                          ┌─── (Day 11) Bewertung ────┐
                                          │   estate batch intake     │
                                          │   composes Ankauf + multi-┤
                                          │   item + pro-rata + signal│
                                          └────────────┬──────────────┘
                                                       ▼
                                                  same products table

   (Day 9)   Lager        ── reads from products ── assigns Lagerort
   (Day 10)  Kunden       ── reads from customers ── shows Ankauf history
   (Day 12)  Foto-Werkstatt ── attaches to product_photos via state machine
```

Aufnahme is the bottleneck node. Every subsequent surface (Lager, Kunden, Foto-Werkstatt, Bewertung) depends on Aufnahme having populated the products + customers tables with real Owner-entered rows. Building Aufnahme first unblocks the entire downstream sequence; building Bewertung first leaves the simpler atomic case un-modelled until later — meaning every daily operation requires the heavyweight surface.

### 4.5 API coupling

Backend surface used by Ankauf (Day 8):

* `GET /api/customers?q=...` — lookup (already exists, Day 17)
* `POST /api/customers` — create with PII encryption (already exists, Day 17)
* `PATCH /api/customers/:id/kyc` — stamp `kyc_verified_at` (already exists, Day 26)
* `GET /api/metal-prices/current` — Schmelzwert hint (already exists, Day 23)
* `POST /api/transactions/finalize` — ANKAUF direction (already exists, Day 13 + Day 21 trade-in extensions)
* `GET /api/products/:id` — post-creation verification (already exists, Day 7)

Zero new endpoints needed for V1 Day 8. The backend was prepared for this on Days 17, 23, and 26. The API contract is frozen; this surface just consumes it.

### 4.6 Synchronization complexity

Ankauf emits these ledger events on a successful intake:

* `transaction.created` (direction='ANKAUF') — invalidates dashboard (via existing `shouldInvalidateDashboard` predicate).
* No `alert.*` emission unless sanctions hard-block triggered, which the BEFORE INSERT trigger handles before the route reaches finalize.

The SSE bridge already propagates these. No SSE wiring changes needed.

Bewertung, in contrast, would emit:

* `appraisal.opened`, `appraisal.completed`, `appraisal.accepted` (with pro-rata), `appraisal.rejected`
* Plus the implicit `transaction.created` on accept.

So Bewertung-first would have required new ledger event types in the `shouldInvalidateDashboard` predicate AND new toast routing for `appraisal.*` events. Ankauf-first defers that complexity until we actually need it.

---

## 5. Operational reasoning

### 5.1 Daily frequency

Owner intake patterns at the Weil am Rhein shop (per Basel's domain notes, paraphrased):

* Counter walk-ins selling 1–3 items each: **dozens per day**.
* Counter walk-ins selling a full Konvolut (estate batch): **0–2 per week**.

The daily ledger gets a working Verkauf-fed catalog only when Ankauf is built. Bewertung-first means every daily walk-in goes back to "Owner enters by hand via the admin route or via a database client" — an operational embarrassment.

### 5.2 Operator ergonomics

Ankauf must be **fast** — under 90 seconds for a single coin from sanctions-cleared customer to cash-out. The information density per second is high: the Owner has the item in hand, the customer is waiting, decisions are immediate. The surface must front-load the bottleneck (KYC + sanctions) so the items panel never has to refuse a save.

Bewertung is **deliberate** — minutes to hours per appraisal. The customer is not waiting at the counter; they're considering. The pacing is the opposite of Ankauf. Building Bewertung first would have trained us to think about pacing wrong.

### 5.3 Failure recovery

Ankauf failure modes:

| Failure | Recovery |
|---|---|
| Sanctions hard-block | Surface explicit wax-red toast; offer "Abbrechen". No partial state in DB (BEFORE INSERT trigger rejects). |
| Customer lookup fails (network) | Inline retry with cached field state. |
| Mid-transaction crash | Persisted `useIntakeStore.items` survives. Operator resumes on relaunch. NO products were created (transaction rolled back). |
| Cash short in drawer | Detected at the Kasse layer (shift `system_expected_eur` goes negative — sanity warn in Z-Bon close). Ankauf does NOT need to verify drawer balance pre-emptively; the Kasse Blindsturz catches it. |
| Operator entered wrong acquisition cost | Storno discipline (Day 15 storno route, mandatory step-up). Same path as Verkauf wrong-price recovery. |

All five recovery paths reuse existing infrastructure. Zero new failure-recovery code.

---

## 6. Compliance implications

### 6.1 GwG (Geldwäschegesetz) — money laundering

Ankauf has a §10 GwG duty: identity must be recorded for cash transactions ≥ €2,000 (or any "verdächtiger Vorgang"). The backend trigger refuses ANKAUF without `customer_id` regardless of amount (Phase 1 over-compliant by design — the Owner can choose to record IDs for smaller buys too). Day 8 Ankauf must:

* Force customer selection before items can be added (UI hard-gate).
* Surface the customer's `kyc_verified_at` status prominently — un-verified customers should require KYC stamp (`PATCH /api/customers/:id/kyc`) before completing high-value buys. Step-up is automatic via the interceptor.
* Block sanctions-listed customers via the existing BEFORE INSERT trigger. The trigger throws `SANCTIONS_BLOCK`; the surface translates this to a wax-red lock-screen.

### 6.2 Anti-Hehlerei (§ 259 StGB)

The Owner has a positive duty to NOT buy items they know or should suspect are stolen. The system supports this with:

* `customer_trust_level` (`NEW | VERIFIED | VIP | SUSPICIOUS | BANNED`, Day 26) — surface must show this prominently.
* `price_expectation_notes` (Owner's free-text history per customer) — surface must show this near the offer entry.
* Photo capture (deferred to Foto-Werkstatt Day 12) — V1 Ankauf can mark a `photo_pending=true` boolean in cart-store metadata and the Owner cycles back later. Not a blocker for Day 8 ship.

### 6.3 §25a Differenzbesteuerung (margin VAT)

Every Ankauf-sourced product defaults to `tax_treatment_code='MARGIN_25A'` — the second-hand-from-private-individual case. The Owner can override at intake (e.g., `INVESTMENT_GOLD_25C` for refining-grade gold). The `acquisition_cost_eur` set here is what `cart-math.computeLineMath` uses two months later when the item sells via Verkauf. Drift on this number is a tax problem.

So Ankauf must:

* Store `acquisition_cost_eur` per item with bigint-cents precision (NO floats).
* NEVER allow the field to be edited after the transaction lands (the `is_commission` + `acquired_from_customer_id` columns are `intake-locked` per migration 0015 — Owner cannot rewrite history).
* The PUT /api/products route refuses these fields via `additionalProperties: false` (already enforced).

The intake surface's responsibility is to make the cost field **highly visible** and **easy to verify** before commit. The operator must look at the number twice before the transaction lands.

### 6.4 Customer signature on Ankaufbeleg

§ 259 StGB defense improves with a customer-signed declaration ("I, the seller, declare this item is mine to sell"). V1 ships physical signature on the printed Ankaufbeleg; Phase 1.5 #I-14 will add a touchscreen digital signature stamped onto the audit record. Day 8 must print the Beleg with the declaration paragraph; the customer signs with a pen.

The German legal text comes from the `belegtext_templates` table (kind=`ANKAUFBELEG_DECLARATION`, seeded in migration 0024). The surface fetches it via `GET /api/belegtext-templates/current?kind=ANKAUFBELEG_DECLARATION&language=de`.

---

## 7. Migration considerations

**No new migrations required.** The full schema for Ankauf landed across migrations 0009 (transactions + direction), 0013 (sanctions + Ankauf-requires-customer + closing-day), 0015 (acquired_from_customer_id + is_commission), 0019 (paired_with for trade-in), 0021 (metal price helper functions), 0023 (audit log), 0024 (belegtext templates). The schema layer of the Backend Freeze is intact.

**Two additive routes are required** (Phase-1 intelligence findings — see §15 below). Adding a route is not a schema change and is therefore permitted post-Freeze (same precedent as `GET /api/products/:id` on Day 7).

* `GET /api/customers?q=...` — paged search by name / email blind-index / phone blind-index. Returns the minimal projection (id, fullName, kycVerifiedAt, trustLevel, sanctionsMatch) — no decrypted PII in the list (matches the Day-17 separation between list and detail).
* `POST /api/transactions/ankauf` — dedicated Ankauf path. One DB transaction: INSERT products (status='AVAILABLE', acquired_from_customer_id), INSERT transactions (direction='ANKAUF'), INSERT transaction_items (one per product, line_total = acquisitionCostEur), INSERT transaction_payments (single CASH outflow, amount = total). The four DB triggers fire normally (sanctions, closing-day, balance-equality, hash-chain). The existing `transactions-finalize` route stays VERKAUF-only — it calls `finalizeReservation()` which has no meaning for Ankauf items that don't pre-exist as RESERVED.

---

## 8. Performance implications

* Customer lookup query: indexed by `email_blind_index` + `phone_blind_index` (Day 17). Sub-millisecond on a 10k-customer table.
* Sanctions check: in-memory after first hit (cached by trigger function). Sub-millisecond.
* Metal price hint: cached at the `metal_prices` table with the partial UNIQUE constraint guaranteeing one current row per metal — single-row SELECT. Sub-millisecond.
* Finalize transaction: same path as Verkauf finalize. ~50ms p95 measured Day 21 E2E.

Total Owner-perceived latency on "Aufnehmen & Bezahlen": ~80ms p95 from click to receipt. Acceptable.

---

## 9. Render-churn discipline (lesson from Day 7)

Day 7 surfaced the `inCart: Set<string>` rebuild on every render. The Day-8 implementation inherits the lesson:

* Stable selectors (`selectIntakeItems`, etc.) declared once at module scope.
* Derived state memoised on its dependency hash.
* Set-mutating reducers guard against identity changes when the operation is a no-op.
* Photo URL previews lazy-loaded.

The intake form has more inputs per row than the Verkauf cart row (8–10 fields vs the 3-field display row), so list virtualisation may need consideration if the operator routinely processes 20+ items in one session. V1 caps at 50 items per intake session (a generous estate Konvolut); above that, the operator should use Bewertung (Day 11). Document the cap as a soft business rule, not a hard limit.

---

## 10. Projected technical debt avoided

By choosing Ankauf-first:

1. **No fictional state machine.** We do not pre-bake a multi-step DRAFT → COMPLETED → ACCEPTED enum into the daily flow. The single-step intake is honestly modelled.
2. **No premature batch abstraction.** When Bewertung lands (Day 11), it composes the Ankauf primitives via a clear `BewertungController` that delegates to the same `transactionsApi.finalize`. We pay the abstraction tax exactly once, at the point we use it.
3. **No "is this an appraisal" boolean leaking through every surface.** Bewertung's existence is opt-in via its own surface route; Ankauf knows nothing about appraisals.
4. **Shared `ShiftGuard`, `customer-lookup-drawer`, `kyc-status-chip`, and `compliance-banner` components emerge naturally.** These get extracted into `screens/_shared/` only when the second consumer (Bewertung) actually exists. No speculative shared library on Day 8.
5. **No "Aufnahme is just an appraisal-of-one" anti-pattern.** Forcing the simple case through the complex case's wrapper would have cost ~30% extra latency per intake AND obscured the audit trail (the audit log would carry confusing fields like `appraisal_was_skipped=true`).

By NOT choosing Bewertung-first:

1. **Estate purchases remain delayed by ~1 week.** Acceptable: the Owner has been running them on paper for years; one more week is fine.
2. **No premature investment in PDF rendering.** The Bewertungsprotokoll PDF (Phase 1.5 #I-18) doesn't need to be solved on Day 8 — the appraisal route ships with JSON export only, deferred to Phase 1.5.

---

## 11. Future module implications

Once Ankauf ships:

* **Day 9 — Lager (warehouse):** reads `products` table with the new Owner-entered rows. Adds Lagerort assignment + Stichtagsinventur (inventory session) — `inventory_sessions` schema landed Day 21. Heavy READ surface; no new mutations beyond `POST /api/products/:id/location`.
* **Day 10 — Kunden (customer master):** reads the customers populated by Ankauf customer-lookup. First-class customer detail view with: KYC history, trust-level controls (with step-up), Ankauf history (`GET /api/customers/:id/products`), transaction history.
* **Day 11 — Bewertung:** composes Ankauf primitives + adds appraisal-state-machine + multi-item batch + pro-rata. Routes already exist (Day 22).
* **Day 12 — Foto-Werkstatt:** the photo workflow state machine (Day 24 migration 0022). Consumed by both Ankauf (re-link photos to the just-created products) and Bewertung (per-item).
* **Day 13 — Edelmetallkursraum (Tier-2):** the live metals dashboard. Used as a hint in Ankauf, used as math in Bewertung.

Building Ankauf first means Days 9-13 each compose cleanly on the foundation. Building Bewertung first would have forced us to revisit Ankauf in Day 11 and likely refactor the multi-step state out of the daily flow.

---

## 12. Open risks / accepted trade-offs

1. **No customer signature digital capture in V1.** The Ankaufbeleg is printed and signed with a pen. The signed paper is the audit evidence; the system audit log carries the operator's identity + timestamp + decision. Phase 1.5 #I-14 lands digital touchscreen signature.
2. **No barcode scanner support for intake yet.** The operator types the item name. Acceptable: most second-hand items have no manufacturer barcode anyway. Phase 1.5 may add a "SKU lookup by Owner's pre-printed label" path for re-intake of returned items.
3. **No multi-currency at intake.** Sortenkasse (Phase 1.5 #I-12) handles CHF/EUR border-shop edge cases later.
4. **Per-item photo capture deferred.** Owner CAN proceed without a photo, with a "Foto-Werkstatt erforderlich" tag in `internal_tasks` auto-created at intake. The task surface (Day 11+) surfaces this backlog. Compliance-safe because the product is not yet `listed_on_storefront` until photographed.
5. **No live Schmelzwert hint if `metal_prices` is stale (>24h old).** Surface degrades gracefully — the hint just disappears, the operator enters their own number.

---

## 13. Implementation scope — Day 8 freeze

Within scope:

* `screens/ankauf/Ankauf.tsx` — main coordinator (shift-guarded like Verkauf)
* `screens/ankauf/CustomerPanel.tsx` — lookup / create / KYC status / sanctions
* `screens/ankauf/IntakePanel.tsx` — items stack (Roman-numbered like Verkauf cart)
* `screens/ankauf/IntakeItemCard.tsx` — per-item form (name + metal + weight + fineness + condition + acquisitionCost + listPrice + taxTreatment)
* `screens/ankauf/AnkaufBezahlenDialog.tsx` — cash-out review + receipt
* `state/intake-store.ts` — persisted Zustand store mirroring `cart-store` patterns
* `lib/intake-math.ts` — Schmelzwert hint + total-cost summation (bigint cents)
* `lib/ankauf-receipt.ts` — receipt body builder fetching belegtext template
* Shared component extraction: `screens/_shared/ShiftGuard.tsx` + `_shared/ComplianceBanner.tsx` (moved from `verkauf/`)

Out of scope (deferred with explicit Phase 1.5 / future-Day notes):

* Per-item photo capture flow
* Digital touchscreen signature
* Bewertung composition layer
* Trade-in (Verkauf + Ankauf paired in one click — Day 21 backend exists; UX composes Verkauf and Ankauf surfaces in a future "Inzahlungnahme" Tier-2 mode)
* Multi-currency (CHF buy)
* Bewertungsprotokoll PDF

---

## 14. Verdict

**Aufnahme (Ankauf) is the Day 8 foundation.** The platform's inventory truth begins where the Owner enters the items, and that flow must be fast, compliance-safe, and additive over Day 7's primitives. Bewertung is a future composition over this foundation, not a parent of it.

Implementation begins after this document is in `main`.

---

## 15. Phase-1 repository intelligence findings (2026-05-27)

A deeper pass over the backend before any client code was written surfaced three structural items that shape the Day-8 implementation:

### 15.1 Customer search endpoint is missing

`apps/api-cloud/src/routes/customers.ts` ships only `POST /api/customers`, `GET /api/customers/:id`, `GET /api/customers/:id/products`, `GET /api/customers/:id/transactions`. There is **no** paged search route, despite the DB carrying `email_blind_index` + `phone_blind_index` (migration 0007) and the unique partial indexes ready to power it.

**Decision:** add `GET /api/customers?q=&limit=&offset=` as an additive Day-8 route. The route compares the query string against `email_blind_index = blind_index($q)` and `phone_blind_index = blind_index($q)` for exact contact matches, plus a `withPii`-decrypted `ILIKE` on `full_name` for fuzzy name matches. Returns minimal-projection rows. ADMIN + CASHIER may search.

### 15.2 `transactions-finalize` route is VERKAUF-only in practice

`apps/api-cloud/src/routes/transactions-finalize.ts:165–177` unconditionally calls `finalizeReservation(tx, { productId, sessionId })` for every body item — moving each from RESERVED → SOLD. That is the correct contract for Verkauf, but it is **meaningless for Ankauf**: an Ankauf item has no prior RESERVED state because the product is being created at the moment of the buy.

The TypeBox schema accepts `direction='ANKAUF'`, the `transactions_ankauf_requires_customer` CHECK fires correctly, but the body shape (`items[].productId` + `items[].reservationSessionId`, both required UUIDs) is wrong for Ankauf — there are no productIds yet, and no reservations.

**Decision:** add a **separate** `POST /api/transactions/ankauf` route. Distinct schema, distinct route handler. Reuses the same DB triggers, the same audit hooks, the same step-up interceptor. The two-route shape preserves clarity (Verkauf is sell-from-inventory; Ankauf is create-into-inventory) and avoids the schema drift that would come from stretching FinalizeBody to optionally mean either.

### 15.3 Pre-existing tech debt: `appraisals.ts` accept route is incomplete

`apps/api-cloud/src/routes/appraisals.ts:583` carries the literal line `void transactionItems; void transactionPayments;  // imports unused but kept for future`. The Ankauf transaction that the accept route inserts has NO `transaction_items` and NO `transaction_payments` rows attached. The Day-17 balance trigger `verify_transaction_balance` (migration 0016) will refuse this at COMMIT with `Transaction balance: transaction X has no items at COMMIT`. **The Bewertung accept path is currently un-shippable.**

This is pre-existing tech debt, not caused by Day 8. Logged as **Phase 1.5 #I-38** and surfaced to Basel in the Day-8 report. Day 11 (Bewertung surface) must close this gap before any UI work happens — and the natural fix is to **reuse the same atomic primitive Day 8 builds** (`POST /api/transactions/ankauf`) from inside the accept handler.

This finding actually *strengthens* the Day-8 decision: building the Ankauf primitive first means Bewertung's accept route can compose against a proven, tested, audit-clean entry point rather than reinventing it. The Phase 1.5 #I-38 fix becomes a small refactor over the Day-8 path.

### 15.4 Backend surface for Day-8 Ankauf

| Route | Status |
|---|---|
| `GET /api/customers?q=` | **NEW (Day 8)** — additive search |
| `POST /api/customers` | exists |
| `GET /api/customers/:id` | exists |
| `PATCH /api/customers/:id/kyc` | exists (Day 26) |
| `PATCH /api/customers/:id/trust` | exists (Day 26) |
| `GET /api/metal-prices/current` | exists (Day 23) |
| `GET /api/belegtext-templates/current?kind=ANKAUFBELEG_DECLARATION` | exists (Day 26) |
| `POST /api/transactions/ankauf` | **NEW (Day 8)** — atomic create-products + transaction + items + payments |
| `GET /api/products/:id` | exists (Day 7) — for post-creation verification |
| `GET /api/shifts/current` | exists (Day 21) — for ShiftGuard |

Two new additive routes. Zero schema changes. Two new schemas in `apps/api-cloud/src/schemas/`. Two new tests in `apps/api-cloud/tests/`. Two new client domains in `packages/api-client/src/domains/` (customers list + ankauf, or extend existing).

### 15.5 Updated Day-8 scope

The original §13 scope assumed a pure-client delivery. With the Phase-1 findings, Day 8 splits into three commits:

1. **Commit A — Backend additive routes** (`api-cloud`)
   * `routes/customers-list.ts` (new) + tests
   * `routes/transactions-ankauf.ts` (new) + tests
   * `schemas/ankauf.ts` (new)
   * `schemas/customer-list.ts` (new)
   * Register in `app.ts`

2. **Commit B — api-client extension** (`api-client`)
   * `domains/customers.ts` extended with `list`
   * `domains/transactions.ts` extended with `ankauf` (separate method, distinct body shape from `finalize`)

3. **Commit C — tauri-pos Ankauf surface**
   * `screens/ankauf/*` (per §13)
   * `state/intake-store.ts` (persisted, mirrors cart-store patterns)
   * `lib/intake-math.ts` (bigint cents — Schmelzwert hint + totals)
   * Shared component extraction: `screens/_shared/ShiftGuard.tsx` (moved from `verkauf/`)

The QA gate at the end remains: all 7 packages typecheck green; `as never` baseline unchanged; `process.env` baseline unchanged; no Phase-1 migration files added.
