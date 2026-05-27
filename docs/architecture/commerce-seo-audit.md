# Commerce + SEO Architecture Audit

**Date:** 2026-05-27
**Author:** CTO / principal architect
**Scope:** end-to-end audit of platform capacity for multi-domain collector commerce, semantic SEO, Google Business integration, omnichannel inventory truth, and long-horizon scalability.
**Status:** Findings document. Implementation gated until §11 architectural priorities are approved.

> **Reading instructions:** this is an honest audit. Where the platform is strong, I say so. Where it is structurally limiting, I say so harder. The scoring at §1.5 is the most important single number to read.

---

## 0. Framing

The platform has spent 26 backend days + 7 client days achieving **transactional integrity** — atomic reservations, hash-chained ledger, §25a tax discipline, KYC + sanctions hard-blocks, Z-Bon Blindsturz, mandatory step-up on storno. That work is exceptional and stays.

The question this audit answers is different: **does the same architecture support the commerce surface — categorisation, semantic search, public catalog, local SEO, Google Business, customer-intent capture, multilingual ecommerce — without future architectural collapse?**

The answer is mixed. The inventory truth model is exactly right (one `products` table, all channels read it). But the *commerce semantics layered onto that truth* are thin in some places, missing in others, and outright misshaped in one specific place (`item_type` enum). This document maps every gap, scores severity, and proposes additive evolution. **No destructive migrations are recommended.** Every fix lands as a new migration 0025+ that preserves Phase 1 Freeze guarantees.

---

## 1. Current strengths (what NOT to touch)

| # | Strength | Why it matters |
|---|---|---|
| **S-1** | Single `products` table is the canonical inventory truth | POS, Storefront, eBay, future marketplaces all read the same row. Race-safe via single-UPDATE `inventory-lock.reserve()`. ADR-0016 §1. |
| **S-2** | `sales_channel` enum (`POS \| WEB \| EBAY \| PHONE`, migration 0018) | Every transaction carries its channel. Channel-level reporting + reconciliation are first-class. |
| **S-3** | `embedding vector(1536)` column on `products` (migration 0006) | pgvector is installed (migration 0001) and `pgvector`-backed semantic similarity is already wired in the schema — currently unpopulated. Major asset for future "ähnliche Stücke" + collector-discovery. |
| **S-4** | Photo workflow state machine (FOTOGRAFIERT → BEARBEITET → FREIGESTELLT → ZUGEORDNET → FUER_EBAY_BEREIT) | Memory.md #70. Background-removed photos are tracked separately from raw captures — production-grade for both eBay and storefront listings. |
| **S-5** | eBay state machine (ENTWURF → GEPRUEFT → ONLINE → VERKAUFT → BEZAHLT → VERPACKT → VERSENDET → REKLAMIERT → RETOURNIERT) | Memory.md #70. Cross-channel sold-conflict trigger (`enforce_ebay_sold_reserves_locally`) already protects against double-sale. |
| **S-6** | Hash-chained ledger + SSE pulse (memory.md #57) | Every state change is auditable, replayable, and live-pushable to clients. The same substrate can publish to a search-index updater (Phase 1.5) without re-architecture. |
| **S-7** | `acquisition_cost_eur` is intake-locked + drives §25a margin math | The fiscal anchor of every resale. Cannot be silently rewritten. |
| **S-8** | `parent_product_id` (migration 0020) enables Konvolut (estate-batch) hierarchies | One parent + N children with pro-rata cost allocation. The shape supports "verkaufe Sammlung aus Nachlass von Oma" naturally. |
| **S-9** | Tax treatment is per-line snapshot (migration 0009) | A storefront sale months after intake still applies the treatment locked at intake — no drift even if the BMF table evolves. |
| **S-10** | `marketing_attributes JSONB` escape hatch on products (migration 0006) | Lets collector-specific facts (Michel-Nr, Krause-Nr, year minted, provenance narrative) land without schema migration during V1 — but see §3 for why this is also a partial weakness. |
| **S-11** | `customers.preferred_language` CHAR(2) with `de/en/ar` (migration 0007) | Multilingual customer-facing communication is built in at the data layer. Storefront emails / receipts can branch on this. |
| **S-12** | `customer_intake_requests`-shaped surface ALREADY EXISTS in spirit via `appraisals` | A public intake form can route into `appraisals (status='DRAFT', customer_expectation_eur, ...)` with minor extension. We don't need a parallel intake-request table — we extend the appraisal pipeline. |
| **S-13** | belegtext_templates (migration 0024) is the canonical legal-text store | Storefront FAQ / shipping / returns / Impressum can all reuse the versioning + audit pattern. Phase 1.5 #51 (CMS) extends this. |

These thirteen strengths are the platform's commerce foundation. Every recommended change preserves them.

---

## 1.5 Audit scorecard

Score = `1` (structural blocker, will cause refactor) → `10` (production-grade, no concerns).

| Dimension | Score | Justification |
|---|---|---|
| **Inventory truth integrity** | **9** | Single table, atomic reservation, channel-aware. Best-in-class. |
| **Audit lineage** | **10** | Hash-chained ledger + audit_log + ledger_events SSE. Untouchable. |
| **Transaction safety** | **10** | Balance trigger, sanctions trigger, closing-day trigger, storno discipline. |
| **POS workflows** | **8** | Verkauf + Kasse + Werkstatt + Day-8 Ankauf coming. Strong, with one minor: photo workflow is not wired into Ankauf-time UI yet. |
| **Backend API readiness** | **7** | All inventory/transaction/appraisal routes built. Storefront commerce routes built (Day 19). Missing: public catalog API, public intake-request API, sitemap API. |
| **Synchronization (POS ↔ ecommerce ↔ eBay)** | **8** | eBay sold-conflict trigger + storefront cart sweeper + reservation TTLs are correct. One latent gap: appraisal-accept route is incomplete (audit §15.3 of day8-domain-decision.md). |
| **Storefront commerce backend** | **6** | Schema exists (shoppers, carts, payment_intents). Routes exist (sign-in, cart, webhook). **No actual public product catalog API has been built.** The storefront has no GET endpoint to list products without authentication. |
| **Category taxonomy** | **3** | `item_type` is a flat 12-value enum biased toward metals/jewelry/watches. Briefmarken, Postkarten, Militaria, historische Dokumente, Sammlerstücke do NOT fit. No hierarchical categories. No subcategories. No category landing pages possible. |
| **Collector metadata** | **3** | `marketing_attributes JSONB` is the only home for: period (Biedermeier, Jugendstil), year minted (numismatics), catalog reference (Michel-Nr, Krause-Nr), country of origin, provenance chain. JSONB is opaque to indexing + faceting + structured-data rendering. |
| **SEO readiness** | **2** | No `slug` on products. URLs would be UUID-based. No `seo_title`/`seo_description` columns. No schema.org type column. No category slugs. **Schema-level anti-SEO.** |
| **Local SEO readiness** | **1** | No `business_locations` table. No `service_area_postal_codes`. No `opening_hours` schema. No address as structured data. The platform has no concept of "where the shop is" — only "where transactions happen on which device". |
| **Google Business compatibility** | **0** | Zero integration. No `google_place_id`. No review aggregation. No business-profile sync. The shop has no canonical address in the database. |
| **Structured data (schema.org)** | **0** | No JSON-LD emission anywhere. No `schema_org_type` per product. No `Product`/`CollectibleProduct`/`Coin`/`Stamp` type discrimination. |
| **Search architecture** | **3** | Current `q` is plain ILIKE on `name`+`description_de`+`sku` (Day 17). No tsvector + German stemming. No trigram for typo tolerance. No faceted aggregations. The pgvector embedding column exists but is unpopulated. |
| **Internationalization** | **4** | `customers.preferred_language` works. Products have only `description_de` — no `description_en`/`description_fr`. Categories don't exist, so multilingual categories don't either. Storefront would be German-only at V1. |
| **Customer intent capture** | **2** | No public `intake-request` form. "alte Münzsammlung verkaufen" → no path. WhatsApp webhook exists (Day 21) — could serve, but no web form ingress. |
| **Reputation layer** | **0** | No `customer_reviews` table. No Google-review import path. No trust schema markup. |
| **Control center commerce visibility** | **4** | Werkstatt dashboard tracks fiscal KPIs (today's revenue, open shifts). Does NOT track: uncategorized inventory, products missing primary photo, products missing slug, products without category. The Owner has no "list health" view. |
| **Future marketplace compatibility** | **6** | The single-truth inventory + channel enum means a future Etsy / Catawiki / Vinted integration drops in as a new `sales_channel` value + a webhook. The category taxonomy gap (score 3) is the only structural blocker. |
| **Multi-store / multi-location scalability** | **3** | Shifts are device-scoped (`shifts.device_id`), but the device has no `business_location_id` link. Two shops on one tenant would be possible via device groupings, but no formal model. |

### Overall composite

* **Operational backbone:** 9/10 — battle-tested, ship-ready
* **Commerce semantics:** 3/10 — structurally underweight
* **SEO + discoverability:** 1/10 — schema is hostile to SEO without intervention
* **Local business + Google:** 0/10 — does not exist as a concept yet

**The platform is a great POS that doesn't yet know it's also a commerce surface.** That asymmetry is fixable additively — but the fixes must land *before* the storefront ships, not after. Retrofitting categories + slugs + SEO metadata onto a populated catalog is painful; doing it before launch is a half-day's migration.

---

## 2. Critical architectural weaknesses (mapped to severity)

### W-1 — `item_type` enum is the wrong shape for multi-domain commerce
**Severity:** HIGH
**Current:** `item_type` is a PG enum with twelve values (`gold_jewelry`, `gold_coin`, `gold_bar`, `silver_jewelry`, `silver_coin`, `silver_bar`, `platinum_jewelry`, `platinum_coin`, `platinum_bar`, `antique`, `watch`, `other`).
**Problem:** the enum is biased toward precious metals + a single bucket for "antique". The domains Basel listed in the audit prompt — Briefmarken, Postkarten, Militaria, historische Dokumente, Nachlass-Sammlung, Schmuckankauf, Vintage & Kuriositäten — either don't fit, fall into `other`, or get mis-shoved into `antique`. A `Sammlerobjekt` taxonomy needs **hierarchical categories**, not a flat enum.
**Impact:** every storefront category page, every SEO landing, every faceted search assumes a tree. Without one, the storefront cannot show "Numismatik > Reichsmark > 5 Reichsmark Silber" or "Briefmarken > Deutschland > Bundesrepublik > 1949-1969".
**Why not destructive:** keep `item_type` as the legacy column. Add a separate `categories` table + `product_categories` join (M:N, with `is_primary` flag for the canonical breadcrumb). Migrate over time — `item_type` becomes derived from primary category and eventually deprecated. No data loss.

### W-2 — No `slug` column → URLs are UUID-based → SEO-hostile
**Severity:** HIGH
**Current:** `products.id UUID PRIMARY KEY` is the only stable identifier. Any storefront URL would look like `/produkt/6f8a3c2e-...` — opaque, unmemorable, un-rankable.
**Problem:** Google's URL ranking signals strongly weight keyword presence in path. UUID URLs lose this signal entirely.
**Impact:** every product detail page on the future storefront ranks worse than competitors who use slug-based URLs.
**Fix:** add `products.slug TEXT` with `UNIQUE WHERE archived_at IS NULL`. Canonical URL: `/artikel/{slug}-{sku-tail}` where the `sku-tail` is the last 6 chars of the SKU as a disambiguator. Slug is derived from `name` at intake (Owner can override). Migration is additive + idempotent (existing rows get a backfill slug from `slugify(name) || '-' || substring(sku, -6)`).

### W-3 — No SEO metadata override columns
**Severity:** MEDIUM
**Current:** product `name` and `description_de` serve double duty — they're both the operator-facing label AND the SEO content.
**Problem:** SEO best practice is to write `<title>` and `<meta description>` differently from in-app display copy. Owner needs to override per product without changing the in-app display.
**Fix:** add `seo_title TEXT`, `seo_description TEXT`, `seo_keywords TEXT[]` (informational, NOT keyword-stuffed — used for internal-linking heuristics). Render as: `<title>{seo_title ?? name + " — Warehouse14"}</title>`.

### W-4 — No collector metadata structure
**Severity:** HIGH
**Current:** `marketing_attributes JSONB` is the only place to put Michel-Nr, Krause-Nr, year minted, period, origin country, provenance notes.
**Problem:** JSONB is opaque to faceted search, to schema.org rendering, to GIN indexing without per-key extraction, and to Owner UX (no form fields). The schema doesn't *know* a stamp has a Michel-Nr; it just knows there's some JSON.
**Fix:** add typed columns for collector-universal facts:
* `year_minted_from INT` + `year_minted_to INT` (a range — coins minted across multiple years)
* `origin_country CHAR(2)` (ISO 3166-1 alpha-2)
* `period TEXT` (free text but indexed via trigram + autocomplete from `periods` reference table — Biedermeier, Jugendstil, Art Deco, …)
* `catalog_reference TEXT` (Michel-{n}, Krause-KM{n}, Sieg-{n}, …)
* `provenance_notes TEXT` (long-form chain of custody narrative)
Keep `marketing_attributes JSONB` for the truly per-domain edge cases (e.g., "this stamp has a printing error of type X").

### W-5 — No `business_locations` → no local SEO foundation
**Severity:** HIGH for ecommerce launch
**Current:** the platform doesn't store its own address. Devices have `device_id`s; shifts attach to devices. But "where is the shop?" — not in the schema.
**Problem:** local SEO and Google Business integration require:
* canonical street address
* lat/lng for "Goldankauf in meiner Nähe"
* opening hours in structured form
* service-area postal codes (which postal codes does the shop serve for home estate pickups?)
* `google_place_id` to bind to Google Business Profile
Without these, no JSON-LD LocalBusiness markup, no "Wegbeschreibung" link, no closest-shop routing for multi-location growth.
**Fix:** add `business_locations` table (see §11.5).

### W-6 — No `customer_reviews` aggregation point
**Severity:** MEDIUM
**Current:** Google reviews live on Google. The site has no place to import them.
**Problem:** schema.org `AggregateRating` for the LocalBusiness and `Review` for products both require a structured representation. Aggregating Google reviews + (future) in-app reviews into a single table powers both the JSON-LD markup AND the on-site "★★★★☆ 4.7 von 234 Bewertungen" widget.
**Fix:** add `customer_reviews` table sourced from (a) Google Business API (via worker job, Phase 1.5), (b) direct in-app reviews tied to `transactions.id`.

### W-7 — No public product API (catalog endpoint)
**Severity:** HIGH for storefront launch
**Current:** `GET /api/products` exists but is gated by `requireAuth + requireRole('ADMIN','CASHIER')` — internal-only. Storefront has no equivalent.
**Problem:** the storefront SSR has no way to read products without authenticating as staff.
**Fix:** add `GET /api/public/products` — unauthenticated, rate-limited, projection-narrowed (no `acquisition_cost_eur`, no `customer_expectation_eur`, no `is_commission`, no internal notes), filtered by `status='AVAILABLE'`, paginated, faceted. Powers all storefront category pages.

### W-8 — No structured data emission
**Severity:** HIGH for SEO
**Current:** the storefront has no SSR yet. When it lands (Phase 2.B), there is no infrastructure for emitting JSON-LD `<script type="application/ld+json">` blocks per page.
**Problem:** Google rich snippets, product cards in SERP, Knowledge Panel for the business — all require schema.org markup. Without it, the site ranks generically and loses CTR.
**Fix:** schema rendering library (server-side) that reads `business_locations` + `products` + `categories` + `customer_reviews` and emits the appropriate JSON-LD block per page type. This is **code**, not migration — lands with the storefront SSR.

### W-9 — Search is ILIKE-based, not tsvector
**Severity:** MEDIUM (operational), HIGH (SEO via faceted filter pages)
**Current:** `Day-17 GET /api/products?q=` does `ILIKE '%${q}%'` on `name + description_de + sku`.
**Problem:** no German stemming ("Briefmarke" doesn't match "Briefmarken"), no typo tolerance ("Krugerrand" vs "Krügerrand"), no relevance scoring, no faceted aggregation.
**Fix:** layered solution:
1. Add a `tsvector` materialized column (GENERATED) with `to_tsvector('german', name || ' ' || description_de || ' ' || marketing_attributes::text)` + GIN index. Owner-facing query gains free-text + stemming.
2. Add `pg_trgm` GIN index on `name` + `description_de` for fuzzy typo tolerance.
3. Populate the `embedding vector(1536)` column via worker job that calls the AI gateway at intake (ADR-0015). Semantic similarity ("zeige mir Münzen wie diese") becomes a `<-> ` operator lookup.

All three are additive indexes on existing columns. No table changes.

### W-10 — Customer intent capture has no web ingress
**Severity:** HIGH for organic acquisition
**Current:** WhatsApp webhook (Day 21) captures inbound messages. But the website cannot have "Verkaufen → Formular ausfüllen → wir melden uns" because there's no API to receive it.
**Problem:** intent flows like "Goldankauf Stuttgart → ich möchte Termin buchen" need a form that lands the request server-side, routes it to the Owner's task queue, and converts to an appraisal if the Owner accepts.
**Fix:** EITHER (a) extend `appraisals` with `source TEXT` and `status='OPEN_FROM_WEB'` to accept public submissions and let the existing accept-flow do its work, OR (b) add a thin `customer_intake_requests` table that decouples public form submissions from the formal appraisal record. Both are valid; I recommend **(a)** because it composes onto existing infrastructure.

### W-11 — Control-center has no commerce-completeness panel
**Severity:** MEDIUM (operational)
**Current:** Werkstatt shows fiscal KPIs (revenue today, gold spot, ledger feed). It does NOT show "Sammlung-Gesundheit".
**Problem:** the Owner has no way to see at-a-glance: "10 products without primary photo", "3 products without category", "5 products without slug". These metrics are CRITICAL for SEO + storefront launch readiness.
**Fix:** add aggregator endpoint `GET /api/dashboard/inventory-health` that returns these counts. Werkstatt gains a "Sammlung-Gesundheit" panel beside the existing tiles.

### W-12 — Sitemap + canonical-URL machinery missing
**Severity:** HIGH for SEO (when storefront launches)
**Current:** no sitemap.xml route, no canonical-URL strategy.
**Problem:** Google can crawl a site without sitemap but indexing depth + freshness suffer. Canonical URLs prevent filter-query duplicates from being treated as separate pages.
**Fix:** generate `/sitemap.xml` (index) + `/sitemap-products.xml` (50k chunks paginated) + `/sitemap-categories.xml` from DB. Canonical URL = `/artikel/{slug}-{sku-tail}` always; filter-query variants emit `<link rel="canonical">` to the base.

---

## 3. The `marketing_attributes` JSONB is a partial weakness

S-10 listed JSONB as a strength because it lets domain-specific facts land without migration. That's true for the proof-of-concept phase. But for the audit's purpose, JSONB is **a strength for prototyping and a weakness for SEO + faceted search**:

* JSON keys are NOT discoverable to the schema → no API documentation
* JSON values are NOT indexed without per-key GIN expression indexes → faceted filters degrade to full-table scans at scale
* JSON values are NOT typed → "1972" and `1972` and `"1972"` (string vs int vs string-of-int) all coexist → frontend rendering breaks
* JSON values are NOT in tsvector → search misses them
* JSON values cannot be referenced by schema.org markup without per-key handcoded extraction

The fix (W-4 above) is not "drop marketing_attributes" — it's "promote the universal facts (year, country, period, catalog ref) to typed columns; keep JSONB for genuinely domain-specific edges (printing-error type, watch-movement complication count, …)". The result: 90% of collector facts become discoverable + indexable + searchable, JSONB handles the 10% long tail.

---

## 4. Operational workflow alignment audit (Phase 2)

The prompt requires that POS workflows, intake workflows, valuation workflows, ecommerce workflows, Google indexing, search filters, category pages, inventory sync, reporting systems, and audit systems all operate on the **same inventory truth model**.

The audit finds:

| Workflow | Inventory truth | Drift risk |
|---|---|---|
| POS Verkauf | `products` directly via inventory-lock | ZERO |
| POS Ankauf (Day 8) | `products` INSERT in same TX as transactions | ZERO once Day 8 ships |
| Bewertung accept | `products` INSERT in same TX as appraisal accept | ZERO (when fix #I-38 lands) |
| Storefront cart | `products` via inventory-lock with STOREFRONT channel | ZERO |
| eBay state machine | `products` via PATCH /api/products/:id/ebay-state with trigger | ZERO |
| Storefront catalog (FUTURE) | Will read `products` via new `GET /api/public/products` | ZERO if W-7 fix uses same table |
| Search / SEO category pages | Will read `products` + future `categories` join | ZERO with W-1 fix |
| Reporting (Tagebuch) | `ledger_events` (downstream of products) | ZERO |
| Audit (audit_log) | Same TX as mutations | ZERO |

**Result:** the inventory truth model is *unified* across every existing and planned workflow. There is **no parallel inventory store** and no plan to introduce one. This is the most important finding in the audit and the reason every other gap is FIXABLE additively.

---

## 5. Search & SEO infrastructure audit (Phase 3)

### What the platform supports today
* Internal search (Day 17): ILIKE filter on staff catalog
* eBay listing state machine: provides external-listing audit trail
* photo workflow: produces background-removed photos suitable for catalog

### What is needed for storefront SEO
* `categories` tree with slugs (W-1)
* `products.slug` (W-2)
* `seo_title` / `seo_description` (W-3)
* Faceted search (tsvector + trigram + W-9)
* Sitemap (W-12)
* JSON-LD rendering (W-8)

### Customer intent flows mapped to operational handlers

| Intent | Landing surface | Backend handler | Workflow outcome |
|---|---|---|---|
| "alte Münzsammlung verkaufen" | `/verkaufen` or `/muenzen-verkaufen` | `POST /api/public/intake-requests` (new) → creates `appraisals(status='DRAFT', source='WEB')` | Owner sees it in `Aufgaben` (Day-11+) → schedules appointment → existing appraisal flow |
| "Silbermünzen schätzen lassen" | `/schaetzung` or `/schaetzung/silbermuenzen` | same as above with `request_type='APPRAISAL'` | Owner schedules → appraisal proper |
| "Nachlass mit Antiquitäten" | `/nachlass` | same as above with `request_type='ESTATE'` + `estimated_item_count` | Owner schedules pickup → multi-item appraisal |
| "Goldankauf Stuttgart" | `/goldankauf` + `/goldankauf/stuttgart` (local landing) | same as above with `service_area_postal_code` populated | Owner schedules → Ankauf surface (Day 8) |
| "Krugerrand 1972 kaufen" | `/artikel/krugerrand-1972-..` (product detail) | `GET /api/public/products/{slug}` + storefront cart flow (Day 19) | Existing storefront purchase path |
| "Antiquitäten Schorndorf" | `/sammlung/antiquitaeten` filtered by location | Category page using new `categories` tree | Browse + add to cart |

Every intent maps cleanly to existing or trivially-additive infrastructure. No new core systems needed beyond W-1 through W-12.

### What we explicitly REJECT
* **No keyword-stuffed doorway pages.** Each location page must have genuine local content (the actual shop's address + hours + photos + relevant inventory). A `/goldankauf-{any-city}` page that contains identical body text + a swapped city name is SEO spam and gets penalised.
* **No machine-generated meta descriptions optimising for click bait.** `seo_description` is Owner-authored (or auto-derived from `description_de` when blank).
* **No hidden text, no cloaking, no schema markup that doesn't match visible content.** Google's structured data guidelines are strict; we follow them.
* **No "X für Y Euro" autogenerated long-tail pages.** Real product pages with real inventory only.

---

## 6. Google Business + reputation layer audit (Phase 4)

### What is needed
1. `business_locations` table (W-5).
2. Worker job `google_reviews_sync` that hits the Google Business Profile API once daily, pulls reviews into `customer_reviews`, and pushes back the shop's `opening_hours` if changed in-app.
3. JSON-LD `LocalBusiness` (or domain-specific subtype: `JewelryStore` / `CollectiblesStore`) rendered on home + about + service-landing pages.
4. JSON-LD `AggregateRating` derived from `customer_reviews` table.
5. JSON-LD `Service` markup for `/goldankauf`, `/schaetzung`, `/nachlass` (with `areaServed` populated from `business_locations.service_area_postal_codes`).

### What is needed to NOT do
* Don't fake reviews. Don't embed fake schema.org Reviews. This is grounds for manual penalty.
* Don't claim service areas the shop doesn't actually serve. Schema.org `areaServed` must be honest.
* Don't auto-publish customer reviews without moderation. Owner approves each before they go live.

### Phase 1.5 add: `business_locations` is in the audit-recommended migration 0027.

---

## 7. Control center + commerce intelligence audit (Phase 5)

### Current Werkstatt KPIs (Day 3)
* Today's revenue
* Open shifts count
* Gold spot
* Live ledger feed

### What is missing for commerce intelligence
1. **Inventory-health tiles:**
   * Total products in DRAFT (not yet published)
   * Products in AVAILABLE missing primary photo
   * Products in AVAILABLE missing category
   * Products in AVAILABLE missing slug
   * Products listed on Storefront missing seo_description
2. **Pipeline tiles:**
   * Appraisals in DRAFT (intake-request inbox)
   * Appraisals in COMPLETED awaiting customer decision
   * eBay listings in REKLAMIERT (claims)
   * eBay listings in BEZAHLT awaiting packing
3. **Sync health tiles:**
   * Storefront cart sweeper last run + last error
   * Google reviews last sync (when Phase 1.5 #I-39 ships)
   * Webhook events DLQ depth

These all become rows in the existing `dashboard.summary` aggregator OR a new `/api/dashboard/inventory-health` aggregator. Tier-1 surface `Werkstatt` gains a "Sammlung-Gesundheit" section beneath the existing fiscal tiles.

---

## 8. Reliability + scalability audit (Phase 6)

### Multi-store scalability
The current `shifts.device_id` design assumes one shift per device. Two shops on one tenant means two device pools — feasible but unstructured. Recommended: add `business_location_id` to `devices` (FK) so reporting can aggregate per-location.

### Future marketplace compatibility
* `sales_channel` enum currently has POS / WEB / EBAY / PHONE.
* Adding ETSY / CATAWICA / VINTED / DELCAMPE is a one-line enum addition + a webhook + a worker reconciler (same pattern as Day-19 storefront, Day-21 eBay).
* The single-truth inventory means a sale on any marketplace updates `products.status='SOLD'` and emits a ledger event the others can observe.

### Localization growth
* Storefront launches German (V1).
* English second tier — requires `description_en` and `seo_title_en` / `seo_description_en` columns. Recommended now as part of W-4 migration to avoid a second migration later.
* Arabic third tier — Phase 2 (memory.md #74 already commits to DE primary, EN fallback, AR deferred).

### Async workflow safety
* All recommended migrations preserve the existing CONSTRAINT TRIGGER chain (sanctions, closing-day, balance, hash-chain).
* No introduced async dependency — the SEO layer is read-mostly from the storefront SSR. Writes (intake-request from web) flow through the same `appraisals` schema.

### Audit lineage preservation
* Every new write path (intake-request, public catalog, category change) emits to `audit_log` with redacted PII.
* Categories changes emit `category.assigned` / `category.removed` events to `ledger_events`.

---

## 9. Localization readiness

Current state:
* `description_de` only on products
* `customers.preferred_language` ∈ {de, en, ar}
* belegtext_templates carry `language` column
* No multilingual categories
* No `description_en` on products

Recommended state:
* Add `description_en TEXT` + `seo_title_en TEXT` + `seo_description_en TEXT` in the W-4 migration
* Categories table carries `name_de` + `name_en` from day one
* Storefront SSR reads `Accept-Language` header and selects column accordingly, falling back to DE
* Slug column has ONE value per product (slugs don't translate cleanly; the path stays `/artikel/{slug}-{sku-tail}` and the localised `<title>` + `<meta description>` change per request)

This avoids the trap of forking URLs by language (`/en/artikel/...`) which doubles the indexable surface and complicates canonicalisation. Single URL, content negotiation by header.

---

## 10. Future migration risks

| Risk | Severity | Mitigation |
|---|---|---|
| `item_type` enum hard-codes "antique" + "watch" without a category tree | HIGH | W-1 fix lands `categories` tree; `item_type` becomes derived. No data destruction. |
| `marketing_attributes` JSONB becomes the single home for ALL collector metadata, calcifying around opaque keys | HIGH | W-4 fix promotes universal columns; JSONB shrinks to edge cases. Migration backfills typed columns from existing JSONB by key. |
| Storefront launches without slugs → URL refactor is destructive after Google indexes the UUIDs | CRITICAL | Block storefront launch until W-2 ships. Non-negotiable. |
| Photo workflow stalls because no Owner UI surfaces the state machine | MEDIUM | Day 12 Foto-Werkstatt — already on the roadmap. |
| Embedding column stays unpopulated → semantic search remains aspirational | LOW | Worker job populates embeddings at intake via AI gateway (ADR-0015). Phase 1.5 task. |
| Google reviews scraping API access is rate-limited or revoked | MEDIUM | Worker job has fallback: read from Google Maps embed scrape (Phase 1.5 only if API path closes). |
| Schema.org schema versions change | LOW | JSON-LD library is a thin layer; version bumps land as code, not data migration. |

---

## 11. Recommended architectural priorities

Ranked by leverage (highest first). Each is additive, backwards-compatible with the Phase 1 Freeze, and lands as migration 0025+ if schema-touching.

### P1 — Migration 0025: categories + product_categories
* `categories (id, parent_id, slug, name_de, name_en, schema_org_type, display_order, hidden_from_storefront, created_at)` — self-FK for tree
* `product_categories (product_id, category_id, is_primary)` — M:N join with one primary per product
* `category_seo_metadata (category_id, language, title, description, h1)` — multilingual SEO override per category
* Seed the V1 taxonomy: Antiquitäten / Münzen (with sub: Goldmünzen, Silbermünzen, Antike Münzen, Briefmarken-Münzen) / Edelmetalle (sub: Goldbarren, Silberbarren) / Briefmarken (sub: Deutschland, Weltweit, Thematisch) / Schmuck (sub: Gold, Silber, Vintage) / Militaria / historische Dokumente / Postkarten / Sammlerobjekte
* Slugify rule: lowercase + diacritic-fold ("Münzen" → "muenzen") + space-to-hyphen
* Index: `categories_slug_uq UNIQUE`, `categories_parent_idx`, `product_categories_product_idx`, `product_categories_category_idx`, partial UNIQUE for one primary per product

### P2 — Migration 0026: products SEO + collector-metadata columns
* `products.slug TEXT` with `UNIQUE WHERE archived_at IS NULL`
* `products.seo_title TEXT`, `seo_description TEXT`, `seo_keywords TEXT[]`
* `products.schema_org_type TEXT` (defaults from primary category)
* `products.year_minted_from INT`, `year_minted_to INT`
* `products.origin_country CHAR(2)`
* `products.period TEXT`
* `products.catalog_reference TEXT`
* `products.provenance_notes TEXT`
* `products.description_en TEXT`, `seo_title_en TEXT`, `seo_description_en TEXT`
* `products.published_at TIMESTAMPTZ` — explicit storefront-publish event (separate from `created_at`)
* Backfill: `slug = slugify(name) || '-' || substring(sku, -6)` for existing rows
* Backfill `schema_org_type` heuristically: `gold_coin` / `silver_coin` → `Coin`; `*_jewelry` → `Product`; default `CollectibleProduct`
* Index: `products_slug_uq`, `products_published_at_idx`, `products_period_trgm_idx` (pg_trgm), `products_year_minted_idx`

### P3 — Migration 0027: business_locations + customer_intake_requests + customer_reviews
* `business_locations (id, name, street, postal_code, city, country_code, lat, lng, phone, email, google_place_id, opening_hours JSONB, service_area_postal_codes TEXT[], schema_org_business_type TEXT)`
* `customer_intake_requests` — OR extend `appraisals.source TEXT` + `status='OPEN_FROM_WEB'`. **Recommend extension** to avoid a parallel inbox.
* `customer_reviews (id, source enum (GOOGLE \| INTERNAL), source_review_id, shopper_id, transaction_id, rating_stars, body, published_at, moderated_by_user_id, moderated_at)`
* `devices.business_location_id UUID REFERENCES business_locations(id)` (nullable, backfill = primary location)

### P4 — Public catalog API (additive routes, no migration)
* `GET /api/public/categories` — tree
* `GET /api/public/categories/:slug` — single
* `GET /api/public/products` — paged + faceted (category, period, year-range, price-range, metal)
* `GET /api/public/products/:slug-{sku-tail}` — detail (projection: NO acquisition_cost, NO is_commission, NO internal notes)
* `POST /api/public/intake-requests` — rate-limited form ingress, lands in `appraisals(source='WEB')`
* `GET /api/public/sitemap.xml` — index
* `GET /api/public/sitemap-products.xml`
* `GET /api/public/business-locations` — for footer JSON-LD source data
* All gated behind a new `requirePublic` middleware (no auth, but stricter rate-limit + CSP).

### P5 — Search hardening (additive indexes, no schema changes)
* `products_fts_de_idx GIN (to_tsvector('german', name || ' ' || description_de || ' ' || marketing_attributes::text))`
* `products_name_trgm_idx GIN (name gin_trgm_ops)`
* Worker job `embeddings_backfill` that populates `products.embedding` for any AVAILABLE product where it's null

### P6 — Control-center commerce health panel
* `GET /api/dashboard/inventory-health` aggregator
* Werkstatt gains "Sammlung-Gesundheit" section under existing tiles
* Surfaces: drafts count, no-photo count, no-category count, no-slug count, no-published count

### P7 — Storefront SSR + JSON-LD library (Phase 2.B)
* Standalone Next.js app `apps/storefront`
* Reads from `/api/public/*` only
* JSON-LD library `packages/schema-org` emits per-page-type structured data from DB rows
* Sitemap generator runs at build OR on-demand
* This is a multi-week effort — explicitly deferred. P1–P6 are prerequisites.

---

## 12. Technical debt risks

If the platform launches storefront without P1–P6:
1. UUID URLs index in Google → URL refactor is destructive → 301 redirect maintenance for years
2. JSON-LD added retroactively → no historical type information → mass reclassification
3. JSONB-only attributes → faceted filters require runtime JSONB key extraction → query plans degrade as catalog grows beyond 5k items
4. No `business_locations` → no Local Pack ranking, no Google Business connection, no service-area schema
5. No public intake-request → all leads route via WhatsApp, missing the SEO conversion that web-to-form provides
6. Search ILIKE-only → relevance suffers, customer abandons → SEO bounce signals degrade

Cumulative cost: a Q3 rebuild touching every storefront route + every product surface + every URL. Avoiding it costs three migrations + one set of indexes — landed pre-launch.

---

## 13. Compliance + audit implications of the recommended additions

* All new tables get the same audit_log discipline (every INSERT/UPDATE emits a row).
* `customer_reviews.body` is PII-adjacent (may contain customer names). Use existing `withPii` decryption pattern.
* `customer_intake_requests.contact_*_encrypted` follows the customers table pattern (encrypt_pii / blind_index).
* `business_locations` is non-PII (the shop is public).
* JSON-LD emission is read-only — no audit concern.

---

## 14. Recommended sequencing

| Day | Deliverable | Schema impact |
|---|---|---|
| **Day 8** | Ankauf surface (existing plan, see day8-domain-decision.md) | +2 additive routes, 0 migrations |
| **Day 9** | Lager surface | 0 migrations (uses existing inventory_sessions) |
| **Day 10** | Kunden surface | 0 migrations |
| **Day 11** | Bewertung surface + appraisal-accept fix (#I-38) | 0 migrations |
| **Day 12** | Foto-Werkstatt | 0 migrations (Day 24 done) |
| **Day 13** | Sammlung-Taxonomie (P1 + P2) | **Migrations 0025 + 0026** |
| **Day 14** | Commerce Intelligence (P3) | **Migration 0027** |
| **Day 15** | Public Catalog API (P4) + Search hardening (P5) | 0 migrations, +indexes |
| **Day 16** | Werkstatt inventory-health panel (P6) | 0 migrations, +aggregator |
| **Day 17+** | Storefront SSR (P7) | Code-only |

This sequencing finishes ALL Tier-1 POS surfaces (Days 8–12) BEFORE turning to commerce semantics (Day 13+). Rationale: the Owner's daily workflow needs Ankauf + Lager + Kunden + Bewertung + Foto-Werkstatt first; the storefront launches without inventory if these aren't built. Commerce architecture (Day 13+) builds on a populated catalog, not an empty one.

---

## 15. Verdict

The platform is operationally robust and commerce-incomplete. Every gap identified is **additive-fixable**. Nothing in the current architecture is misshaped enough to require a destructive rewrite. The Phase 1 Freeze schema stays.

The commerce + SEO layer needs:
* **2 net-new migrations** (0025 categories, 0026 products SEO+collector, 0027 business+intake+reviews) — additive only
* **5 indexes** (FTS, trigram, slug, period, year)
* **8 public API routes** (catalog, sitemap, business, intake)
* **1 storefront SSR app** (Phase 2.B)
* **0 destructive changes**

This is **roughly 3 days of focused work** spread between Day 13 and Day 15 of the current Phase-2 plan — *after* the operational surfaces (Days 8–12) are shipped.

The recommendation is to:
1. **Approve this audit document as the binding architectural reference** for commerce + SEO + Google Business + storefront work.
2. **Hold the Phase 2 sequencing** (Days 8–12 operational, Days 13–17 commerce).
3. **Do NOT ship the storefront SSR before P1–P6 land.** Premature storefront launch with UUID URLs is the single highest-cost mistake the platform could make.
4. **Open Phase 1.5 #I-38** (appraisal-accept items/payments fix) — surfaced by Day-7 + Day-8 audits — to close before Day 11.
5. **Open Phase 1.5 #I-39** (Google Business Profile API integration) — Day 14 dependency.

The decision-record sibling is `docs/architecture/day8-domain-decision.md`. Together they define the next two weeks of architectural work.

---

**End of audit.**
