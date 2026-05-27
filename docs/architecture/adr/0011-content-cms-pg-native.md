# ADR-0011 — PG-native CMS: storefront content lives in Postgres next to the inventory, no Strapi, no WordPress, no headless SaaS

- **Status:** Proposed (pending Basel review)
- **Date:** 2026-05-23
- **Deciders:** Basel, Claude
- **Related:** ADR-0008 (schema — adds migration `0013_content.sql`, second amendment to the original 11-file plan), ADR-0010 (AI gateway — content drafts go through `writeGermanProductDescription` and equivalents), ADR-0015 (intake pipeline produces product descriptions that become storefront content), ADR-0014 (publication events flow over SSE), ADR-0016 (product status reflects on storefront availability), ADR-0019 (Bridge "Content" panel for review/approve workflow), `docs/memory.md` §2 #35.

## Context

The storefront at `warehouse14.de` needs three categories of content:

1. **Product pages** — auto-generated from the intake pipeline, edited by Basel, rendered via Next.js ISR.
2. **Static pages** — Impressum, Datenschutz, AGB, Kontakt, Über uns. Legally mandatory for German webshops (§5 TMG Impressumspflicht).
3. **Editorial articles** — long-form content for SEO + brand: "Was bedeutet 585er Gold?", "Investment-Gold vs. Sammler-Gold", "Was ist ein Punzen?", etc. Drives organic traffic + customer education.

The default industry move is to bolt on a CMS — Strapi (self-hosted Node.js), WordPress (PHP), Contentful (SaaS), Sanity (SaaS). Every option introduces:

- A second database (or a different schema in the same one)
- A second authentication system to keep in sync
- A second permission model
- A second deployment surface
- For SaaS options, a DSGVO surface outside our jurisdiction control (ADR-0005)
- A sync pipeline between CMS content and our product database that must be maintained forever

This ADR rejects all of that. **The CMS is a small set of Postgres tables inside the same database the API serves.** The same Drizzle schema, the same role grants, the same hash-chain audit trail (ADR-0008), the same backup tier (ADR-0012). Next.js consumes content via the same `apps/api-cloud` endpoints it already uses for products. There is no separate CMS process.

Constraints:

1. **Compliance-mandatory static pages** (Impressum, Datenschutz, AGB) must be live from day one. Missing or incorrect Impressum = formal abmahnung exposure.
2. **Product descriptions** flow seamlessly from intake (ADR-0015) — the same `description_de` field on `products` is the canonical storefront content; the CMS layer wraps versioning + publishing controls around it.
3. **SEO-first architecture** — every published entity has structured metadata (Open Graph, Twitter Cards, JSON-LD Product schema) generated at publish time.
4. **Cache discipline** — Next.js ISR + Cloudflare CDN cache invalidation on publish. Manual purges are an anti-pattern.
5. **Audit + accountability** — every publish/unpublish action emits a ledger event with author + diff.
6. **No editor lock-in** — content is plain Markdown (or a structured field set), stored as text. We can re-platform if needed.
7. **Multilingual ready** — V1 ships DE; the schema accommodates multilingual rows from day one without migration.

## Decision

### 1. Five content tables, all in `0013_content.sql`

```sql
-- Static pages: Impressum, Datenschutz, AGB, Über uns, Kontakt, etc.
CREATE TABLE content_pages (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT         NOT NULL,                          -- 'impressum', 'datenschutz', etc.
  locale              CHAR(2)      NOT NULL DEFAULT 'de',
  status              TEXT         NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  title               TEXT         NOT NULL,
  body_markdown       TEXT         NOT NULL,
  seo_title           TEXT,
  seo_description     TEXT,
  seo_og_image_r2_key TEXT,
  -- Lifecycle
  created_by_user_id  UUID         REFERENCES users(id),
  published_by_user_id UUID        REFERENCES users(id),
  published_at        TIMESTAMPTZ,
  archived_at         TIMESTAMPTZ,
  -- Audit envelope
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (slug, locale)
);

-- Editorial articles / blog posts / education content.
CREATE TABLE content_articles (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT         NOT NULL,
  locale              CHAR(2)      NOT NULL DEFAULT 'de',
  status              TEXT         NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  category            TEXT,                                            -- 'education', 'news', 'shop_event'
  title               TEXT         NOT NULL,
  excerpt             TEXT,
  body_markdown       TEXT         NOT NULL,
  hero_image_r2_key   TEXT,
  seo_title           TEXT,
  seo_description     TEXT,
  seo_keywords        TEXT[],
  tags                TEXT[],
  -- Reading metadata
  reading_minutes_estimated INTEGER,
  -- Lifecycle
  author_user_id      UUID         REFERENCES users(id),
  created_by_user_id  UUID         REFERENCES users(id),
  published_by_user_id UUID        REFERENCES users(id),
  published_at        TIMESTAMPTZ,
  archived_at         TIMESTAMPTZ,
  ai_assisted         BOOLEAN      NOT NULL DEFAULT FALSE,             -- whether Claude helped draft
  ai_call_ids         BIGINT[],                                        -- references to ai_calls rows
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (slug, locale)
);

-- Media assets — Cloudflare R2 references, alt text, photo credits.
-- The intake pipeline writes here for product photos; the CMS uses it for hero images, OG images, etc.
CREATE TABLE media_assets (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  r2_key              TEXT         NOT NULL UNIQUE,
  mime_type           TEXT         NOT NULL,
  width_px            INTEGER,
  height_px           INTEGER,
  bytes               INTEGER,
  sha256_hex          TEXT,                                            -- content hash for dedup
  alt_text            TEXT,
  credit              TEXT,
  source              TEXT,                                            -- 'intake_pipeline', 'admin_upload', 'photoroom_processed'
  parent_media_id     UUID         REFERENCES media_assets(id),        -- e.g. the unprocessed original of a bg-removed photo
  -- Lifecycle
  uploaded_by_user_id UUID         REFERENCES users(id),
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Revision history — every published change keeps the prior body for diff + rollback.
CREATE TABLE content_revisions (
  id                  BIGSERIAL    PRIMARY KEY,
  entity_table        TEXT         NOT NULL,                            -- 'content_pages' | 'content_articles' | 'products' (for description_de revisions)
  entity_id           UUID         NOT NULL,
  revision_number     INTEGER      NOT NULL,
  body_before         TEXT,                                             -- nullable on first revision
  body_after          TEXT         NOT NULL,
  changed_by_user_id  UUID         NOT NULL REFERENCES users(id),
  change_note         TEXT,                                             -- optional free-form
  ai_assisted         BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (entity_table, entity_id, revision_number)
);
CREATE INDEX idx_content_revisions_entity ON content_revisions (entity_table, entity_id, revision_number DESC);

-- URL redirects — for slug renames or removed pages.
CREATE TABLE content_redirects (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  from_path       TEXT         NOT NULL UNIQUE,                         -- '/old-page-slug'
  to_path         TEXT         NOT NULL,                                -- '/new-page-slug' or external URL
  status_code     INTEGER      NOT NULL DEFAULT 301 CHECK (status_code IN (301, 302, 307, 308, 410)),
  reason          TEXT,
  active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

Schema role grants follow ADR-0008 §3: `warehouse14_app` has `INSERT, SELECT, UPDATE` on these tables (UPDATE limited to envelope columns: `status`, `updated_at`, etc., enforced per-column). No `DELETE`. Soft-archive via `status = 'archived'`.

### 2. The publishing pipeline — one verb, three steps, atomic

```ts
// packages/content/src/publish.ts
async function publish(opts: {
  entityTable: 'content_pages' | 'content_articles' | 'products';
  entityId: string;
  actorUserId: string;
  changeNote?: string;
}) {
  return await db.transaction(async tx => {
    // Step 1 — Load current and pending bodies. Validate publishable state.
    const entity = await loadEntity(tx, opts.entityTable, opts.entityId);
    validatePublishable(entity);   // throws on missing title, empty body, broken media refs, etc.

    // Step 2 — Snapshot the previous body into content_revisions.
    const prevRevision = await tx.execute(sql`
      SELECT MAX(revision_number) AS n FROM content_revisions
       WHERE entity_table = ${opts.entityTable} AND entity_id = ${opts.entityId}
    `);
    const nextRevisionNumber = (prevRevision.n ?? 0) + 1;
    await tx.insert(contentRevisions).values({
      entity_table: opts.entityTable,
      entity_id: opts.entityId,
      revision_number: nextRevisionNumber,
      body_before: entity.previously_published_body ?? null,
      body_after: entity.draft_body,
      changed_by_user_id: opts.actorUserId,
      change_note: opts.changeNote,
      ai_assisted: entity.ai_assisted ?? false,
    });

    // Step 3 — Promote draft to published. Update the entity row + emit ledger event.
    await tx.update(/* entity table */).set({
      status: 'published',
      published_by_user_id: opts.actorUserId,
      published_at: new Date(),
    }).where(/* entity id */);

    await ledger.emit({
      event_type: `${opts.entityTable}.published`,
      entity_table: opts.entityTable,
      entity_id: opts.entityId,
      actor_user_id: opts.actorUserId,
      payload: { revision_number: nextRevisionNumber, slug: entity.slug },
    }, tx);

    // Step 4 — Schedule cache invalidation (runs after transaction commits via afterCommit hook).
    onCommit(tx, () => purgeCdnCache([
      `https://warehouse14.de/${entity.slug}`,
      ...derivedUrls(entity),
    ]));
  });
}
```

The `publish()` function is the **only** path that flips `status = 'published'`. UI flows for "save draft," "preview," and "publish" all funnel here. The transaction guarantees the revision row + status update + ledger event commit together or roll back together.

### 3. Storefront consumption — Next.js ISR, no separate CMS API surface

The Next.js storefront calls `apps/api-cloud`'s existing routes for content. There is **no separate CMS service** — content is just another resource the API serves:

```
GET /api/storefront/pages/:slug       → returns published content_pages row by slug
GET /api/storefront/articles          → returns published content_articles list (paginated, by published_at desc)
GET /api/storefront/articles/:slug    → returns single published article
GET /api/storefront/products/:id      → returns published product details + description_de + photos
```

Routes are public (no auth required) for `status='published'` content; `status='draft'` content is only visible to authenticated ADMIN users via the admin-web preview surface.

Next.js leverages ISR (Incremental Static Regeneration):

```ts
// apps/storefront/src/app/[slug]/page.tsx
export const revalidate = 3600;        // ISR refresh every hour

export async function generateStaticParams() {
  const pages = await api.storefront.pages.list();   // build-time list of published slugs
  return pages.map(p => ({ slug: p.slug }));
}

export default async function Page({ params }: { params: { slug: string } }) {
  const page = await api.storefront.pages.get(params.slug);
  if (!page) notFound();
  return <ContentRenderer page={page} />;
}
```

ISR + Cloudflare CDN means content edits propagate to users within the cache invalidation window (max 60 minutes for routine edits, immediate for `publish()` via the purge call).

### 4. Cache invalidation — Cloudflare cache purge on publish

The `onCommit` hook in `publish()` calls Cloudflare's cache-purge API:

```ts
// packages/content/src/cdn.ts
async function purgeCdnCache(urls: string[]) {
  await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${secrets.CLOUDFLARE_API_TOKEN}` },
    body: JSON.stringify({ files: urls }),
  });
}
```

Triggered only after the DB transaction commits — failed publishes don't trigger purges. The purge call has its own retry policy (3 attempts with exponential backoff); a persistent failure logs `alert.cdn_purge_failed` for ADMIN attention but does not block publication (the ISR `revalidate: 3600` ensures eventual freshness).

### 5. AI-assisted content drafting — via `@warehouse14/ai-gateway`

Editorial articles support an "AI draft" flow:

```
ADMIN clicks "New article — AI assist" in Bridge Content panel
  → ADMIN provides: topic, target keywords, rough outline (free-form text)
  → calls gateway.tasks.composeBotReply (re-used for content composition) with article-writing prompt template
  → returns suggested German body_markdown + seo_title + seo_description + reading_minutes_estimated
  → ADMIN reviews in WYSIWYG editor (TipTap or similar Markdown editor)
  → ADMIN edits + clicks Publish
```

The published article records `ai_assisted = true` and `ai_call_ids = [<the gateway call IDs>]` so future audits can attribute which content was AI-influenced. This is transparency, not stigma — German consumers increasingly want to know.

**Product descriptions** (the `products.description_de` field) come from the intake pipeline (ADR-0015 §5). The CMS layer adds revision history to that field — every edit to a product's description writes a `content_revisions` row (with `entity_table='products'`).

### 6. SEO metadata generation — at publish time, structured

Every published entity has SEO fields. At publish time, derived fields are computed and embedded in the Next.js render:

| Render slot | Source | Notes |
|---|---|---|
| `<title>` | `seo_title` if set, else `title` | Truncated to 60 chars |
| `<meta name="description">` | `seo_description` if set, else `excerpt` if article, else first 160 chars of body | |
| Open Graph (`<meta property="og:*">`) | `seo_og_image_r2_key` + `seo_title` + `seo_description` | Default: shop branding image if not set |
| Twitter Card (`<meta name="twitter:*">`) | Same as OG | |
| JSON-LD Product schema (for product pages) | `products` row + `media_assets` + `tax_treatment_codes.description_de` | Generated at render time; helps Google rich results |
| JSON-LD Article schema (for content_articles) | Article row | Same |
| Canonical URL | Site URL + slug | |

The schema generators live in `packages/content/src/seo/` and are unit-tested against fixture entities.

### 7. Compliance-mandatory pages — seeded on first deploy

Migration `0013_content.sql` seeds six required pages with placeholder content + ADMIN responsibility to populate before launch:

```sql
INSERT INTO content_pages (slug, locale, status, title, body_markdown) VALUES
  ('impressum',     'de', 'draft', 'Impressum',                            'TODO — siehe §5 TMG'),
  ('datenschutz',   'de', 'draft', 'Datenschutzerklärung',                 'TODO — siehe DSGVO Art. 13'),
  ('agb',           'de', 'draft', 'Allgemeine Geschäftsbedingungen (AGB)', 'TODO'),
  ('widerrufsrecht','de', 'draft', 'Widerrufsbelehrung',                   'TODO — siehe §312g BGB'),
  ('versand-zahlung','de','draft', 'Versand & Zahlung',                    'TODO'),
  ('ueber-uns',     'de', 'draft', 'Über uns',                             'TODO');
```

These pages **cannot be the seed text** at launch — the worker `apps/worker/src/jobs/compliance-page-check.ts` runs daily and emits `alert.compliance_page_unfilled` if any required page is still `status='draft'` and body still contains the `TODO` placeholder. The Bridge surfaces these as severity `high` until resolved.

Recommended source for the legally-correct copy: **a German Steuerberater/lawyer review** before publishing. Templates from `e-recht24.de` or `it-recht-kanzlei.de` are common starting points; we customize per the shop's actual operations.

### 8. URL slug discipline — UNIQUE + redirects on rename

Renaming a published page requires:

1. Updating `slug` on the `content_pages` / `content_articles` row.
2. Inserting a row into `content_redirects` mapping `from_path = '/old-slug'` → `to_path = '/new-slug'` with `status_code = 301`.
3. Purging the old URL's cache.

The middleware in `apps/storefront` consults `content_redirects` before 404-ing any unknown path:

```ts
// apps/storefront/src/middleware.ts
export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const redirect = await api.storefront.redirects.match(path);
  if (redirect?.active) {
    return NextResponse.redirect(new URL(redirect.to_path, req.url), redirect.status_code);
  }
  return NextResponse.next();
}
```

No URL ever silently 404s if it was previously published — SEO juice is preserved, customer bookmarks keep working.

### 9. Multilingual support — schema-ready, V1 ships DE

The `locale` column on `content_pages` and `content_articles` is `CHAR(2)` (ISO 639-1). V1 ships **German only** (matching ADR-0017 §12's discipline — DE + EN + AR for the bot, but storefront is DE-only V1 because translation+SEO maintenance per locale is real work).

The schema accommodates multilingual rows without migration: when we ship EN/AR storefront in Phase 1.5, an additional row per `(slug, locale)` is created. The storefront's URL pattern adds a locale prefix: `/de/impressum`, `/en/impressum`, `/ar/impressum`. The middleware detects locale from URL and routes accordingly.

Article content is **not** auto-translated. Phase 1.5 manual translations via Basel's editorial review; Phase 2 may add `gateway.tasks.translateContent` for first-draft assistance with manual review.

### 10. Cherry-pick / reject from common CMS patterns

| Pattern | Verdict |
|---|---|
| Markdown body field | ✅ Adopt. Plain text is portable; we re-platform without lock-in. |
| WYSIWYG editor in admin | ✅ TipTap (Vue/React, Markdown-aware). Free, open-source. |
| Live preview before publish | ✅ "Preview as published" view in admin-web reads `status='draft'` content |
| Scheduled publish (publish at future date) | ⏳ Deferred — worker job + status enum extension. Not V1. |
| Comment/reply system on articles | ❌ Rejected for V1. Moderation cost is high; spam risk. |
| Multi-step review workflow (writer → editor → publisher) | ❌ Rejected for V1. Basel is owner/writer/editor/publisher. Phase 2+ if staff editorial team forms. |
| Asset CDN besides Cloudflare R2 | ❌ Rejected — R2 covers all use cases at zero egress. |
| Custom field types beyond Markdown + image | ⏳ Deferred. Markdown's embedded HTML supports most needs; structured fields added only when a use case justifies. |
| Page builder / block-based editor | ❌ Rejected for V1. Markdown is enough; block builders introduce schema complexity for marginal benefit. |

## Consequences

**Positive:**
- Zero additional infrastructure — content lives in the same Postgres we already run, backed up by the same WAL-G, audited by the same hash chain.
- One auth system, one permission model, one deploy pipeline. New developer onboarding is faster.
- DSGVO posture is unchanged — content stays in our Frankfurt-region Oracle DB.
- The storefront's product pages and editorial pages share rendering primitives, design tokens, and SEO logic.
- Revision history is first-class — rolling back a publish is one SQL update + cache purge.
- Compliance-mandatory pages cannot be silently missing — daily worker alert.
- AI assistance is opt-in, transparent (`ai_assisted = true`), and auditable (`ai_call_ids`).

**Negative:**
- ADMIN-only authoring; no "guest contributor" workflow. Acceptable for V1 / single-shop.
- Markdown body limits rich-layout (multi-column, embedded interactive widgets). We accept this for V1 — Markdown + embedded image + HTML escape hatch covers 95% of use cases.
- No headless API for third-party consumption of our content (e.g. for a future mobile app). Not needed in V1; trivially added later (the storefront API endpoints already serve content; expose them via a documented external API later).
- ADR-0008's migration plan grows from 11 → 13 (the appointment amendment in ADR-0020 brought it to 12; this ADR brings it to 13). Documented amendment.

**Mitigations:**
- The compliance-page worker check is non-blocking but high-severity, ensuring Basel never launches with placeholder Impressum.
- The TipTap editor's HTML escape hatch lets us drop in custom layouts when rare cases demand.
- Multilingual schema readiness (locale column) means Phase 1.5 EN/AR doesn't require migration drama.

## Alternatives considered

- **Strapi (self-hosted).** Rejected. Second Postgres schema, second auth system, separate deploy. Strapi has solved-content-modeling for big editorial teams; we have one editor and a tight ops budget.
- **WordPress (self-hosted on the same VM).** Rejected. PHP runtime alongside Node, separate plugin ecosystem with its own security cadence, separate backup. Heavy footprint for the marginal value.
- **Contentful / Sanity / Storyblok (SaaS).** Rejected explicitly. DSGVO data-residency leak; vendor lock-in on content schema; ongoing SaaS cost; not coherent with ADR-0005's EU-only stance.
- **Markdown files in the repo.** Considered. Simple, but loses revision history + admin editing UX + AI-draft integration. Acceptable for a developer-only project; wrong fit for owner-edited content.
- **Two databases (one for app, one for CMS).** Rejected. Doubles backup + monitoring + reconciliation surface for zero gain.
- **Headless CMS (Directus, KeystoneJS).** Considered. They're better than Strapi for our model, but still introduce a second admin UI and routing surface. Our Bridge already has the editing UX; one source of truth wins.

## Known limits & deferred decisions

1. **No multi-locale storefront in V1.** German only. The `locale` column is there for Phase 1.5 EN + AR expansion.
2. **No scheduled-publish.** ADMIN clicks Publish when ready. Phase 2 adds `publish_scheduled_at` if usage warrants.
3. **No editorial workflow (draft → reviewer → publisher).** ADMIN is the sole approver. Phase 2 if staff grows.
4. **No comments or user-generated content.** Moderation cost not justified by the audience size.
5. **No structured-data editor UI** beyond title + body + SEO fields. Phase 2 could add a "Featured Item" or "Related Products" block UI if needed.
6. **No automated translation.** Phase 1.5 manual; Phase 2 evaluates AI-assisted with manual review.
7. **No A/B test framework.** Phase 2+. SEO content benefits from longer observation windows than A/B tests typically deliver anyway.
8. **No external API for content.** Phase 2+ if mobile app or partner integrations demand.

## Migration ownership — second amendment to ADR-0008 §9

This ADR adds **migration `0013_content.sql`** to the master migration list, bringing the total from 12 (after ADR-0020) to **13 files**. Per ADR-0008 §9's "one logical concern per file" discipline, content is a coherent vertical (5 tables + seeds + indexes) that earns its own file.

```
packages/db/migrations/
├── 0001_extensions.sql
├── 0002_helpers.sql
├── 0003_roles.sql
├── 0004_auth.sql
├── 0005_reference.sql
├── 0006_products.sql
├── 0007_customers_kyc.sql
├── 0008_audit_chain.sql
├── 0009_transactions.sql
├── 0010_tse.sql
├── 0011_closing.sql
├── 0012_appointments.sql            # added by ADR-0020
└── 0013_content.sql                 # ← this ADR
```

The amendment is recorded in this ADR's §Migration ownership and in `memory.md`.

## References

- ADR-0008 — Schema (this ADR is the second amendment after ADR-0020)
- ADR-0010 — AI gateway (Claude composes editorial drafts)
- ADR-0014 — Live Ops (publish events flow over SSE to update Bridge counts)
- ADR-0015 — Intake pipeline (provides initial `products.description_de`)
- ADR-0016 — Inventory lock (product availability drives storefront visibility)
- ADR-0019 — Bridge UX (Content panel for review/edit/publish)
- §5 TMG (Telemediengesetz) — Impressumspflicht
- DSGVO Art. 13 — Datenschutzerklärungspflicht
- §312g BGB — Widerrufsrecht für Fernabsatzverträge
- Next.js ISR — https://nextjs.org/docs/app/building-your-application/data-fetching/incremental-static-regeneration
- Cloudflare Cache Purge API — https://developers.cloudflare.com/cache/how-to/purge-cache/
- TipTap editor — https://tiptap.dev
- `docs/memory.md` §2 #35
