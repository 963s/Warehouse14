# ADR-0015 — AI Intake Pipeline: WhatsApp photo → Photoroom → multi-call Vision → Claude German draft → Control Desktop, in under 90 seconds

- **Status:** Proposed (pending Basel review)
- **Date:** 2026-05-23
- **Deciders:** Basel, Claude
- **Related:** ADR-0010 (every AI call here routes through `@warehouse14/ai-gateway`), ADR-0008 (schema requirements drive the staging tables), ADR-0014 (status updates surface to Control Desktop via SSE), ADR-0016 (publishing a draft inserts a product into the inventory authority), ADR-0007 (tax_treatment classification respects the §25a / §25c rules), `docs/memory.md` §2 #34, §3 (compliance facts).

## Context

The intake of unique gold/coin/antique items is the **bottleneck of the entire business**. Every minute spent by Basel or a senior staff member typing dimensions, classifications, marketing copy, and price suggestions is a minute not spent on customers. Today, intake is manual. After this pipeline, it is **photo-to-publishable-draft in under 90 seconds, with the senior reviewer doing the one thing only they can do: judging the final draft and clicking Publish.**

The pipeline must:

1. **Accept input from a phone the staff member already carries.** No new app to install, no separate device. WhatsApp Business Cloud API.
2. **Group photos of the same item intelligently.** A typical item has 3–5 photos (front, back, hallmark closeup, scale-reading, packaging).
3. **Run AI work in parallel wherever the data dependencies allow.** Photoroom for background removal does not depend on Vision classification; both run concurrently.
4. **Produce a structured draft** with item type, weight, karat, hallmarks, condition, tax treatment, price band, and a German marketing description — every field auto-filled, each editable by the reviewer.
5. **Reach the Control Desktop's "Intake Drafts" tray as a single visual card** within 90 seconds p99.
6. **Loop back to the staff member via WhatsApp** with status updates so they know the item is being processed and when it's published.
7. **Degrade gracefully on every failure mode** — Photoroom down, Vision rate-limited, Claude timeout, LBMA feed stale. Never a dead-end.
8. **Be idempotent.** A re-sent message or a re-run job never duplicates a draft or produces a second product.
9. **Respect ADR-0007 / §25a discipline** — the tax_treatment classifier is *deterministic Rust/TS logic*, not an LLM judgment. The Vision call provides a hint; the classifier decides.

The constraint Basel hammered: **this should feel like magic to the staff member, like inevitability to the reviewer, and like compliance to the auditor.** All three audiences served by the same pipeline.

## Decision

### 1. Two physically-distinct WhatsApp numbers

| Number | Purpose | Audience | Meta Business Verification |
|---|---|---|---|
| **Intake** (number B — internal) | Staff sends photos for AI processing | known internal phone numbers only | not required (number not published) |
| **Customer Service** (number A — public) | Customer inquiries, bot + human handoff (ADR-0017 pending) | the public; bot-first | **required** — "Warehouse14" verified display name |

The intake number is configured in Meta with a webhook pointing at `apps/api-cloud`'s `/webhooks/whatsapp/intake` endpoint. Messages from unknown phone numbers are rejected with a polite template ("This number is for staff intake. Please write to our customer service number: …").

### 2. Staff identification by phone — `staff_phone_numbers` table

```sql
CREATE TABLE staff_phone_numbers (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID         NOT NULL REFERENCES users(id),
  phone_e164    TEXT         NOT NULL UNIQUE,           -- '+491701234567'
  role          TEXT         NOT NULL,                  -- 'INTAKE_FIELD_BUYER' | 'INTAKE_IN_SHOP' | 'BOTH'
  verified_at   TIMESTAMPTZ  NOT NULL,                  -- registered during onboarding, SMS-confirmed
  active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

Each incoming webhook is matched on the sender's phone (E.164 form). Unknown → rejection template. Known but `active=false` → silent drop + alert in Control Desktop. This is the only identity layer for intake — no PINs, no app login, no QR pairing. The staff member's phone *is* the identity.

### 3. The state machine — `intake_sessions`

```sql
CREATE TYPE intake_status AS ENUM (
  'RECEIVED',           -- first message of a session arrived, grouping window open
  'GROUPED',            -- 60s window closed, session locked for processing
  'PROCESSING',         -- AI work in progress
  'ENRICHED',           -- AI work complete, draft assembled
  'READY_FOR_REVIEW',   -- visible in Control Desktop's Intake Drafts tray
  'PUBLISHED',          -- reviewer approved; products row created
  'REJECTED',           -- reviewer rejected; session closed with reason
  'NEEDS_MORE_INFO',    -- reviewer requested clarification; ball back to staff via WhatsApp
  'FAILED'              -- pipeline error survived all retries; in DLQ for ADMIN attention
);

CREATE TABLE intake_sessions (
  id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_phone_id      UUID            NOT NULL REFERENCES staff_phone_numbers(id),
  started_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
  grouping_closes_at  TIMESTAMPTZ     NOT NULL,                  -- started_at + 120s, extended on each new message (configurable in system_settings)
  status              intake_status   NOT NULL DEFAULT 'RECEIVED',
  product_id          UUID            REFERENCES products(id),   -- populated when PUBLISHED
  rejected_reason     TEXT,
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  reviewer_user_id    UUID            REFERENCES users(id),
  reviewer_decided_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);
CREATE INDEX idx_intake_sessions_status   ON intake_sessions (status);
CREATE INDEX idx_intake_sessions_grouping ON intake_sessions (grouping_closes_at) WHERE status = 'RECEIVED';
```

```sql
CREATE TABLE intake_messages (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            UUID         NOT NULL REFERENCES intake_sessions(id),
  whatsapp_message_id   TEXT         NOT NULL UNIQUE,            -- Meta's wamid; the idempotency key
  direction             TEXT         NOT NULL CHECK (direction IN ('inbound','outbound')),
  message_type          TEXT         NOT NULL,                   -- 'image' | 'text' | 'audio' | 'status'
  media_r2_key          TEXT,                                    -- for image/audio
  text_body             TEXT,
  received_at           TIMESTAMPTZ  NOT NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_intake_messages_session ON intake_messages (session_id, received_at);
```

```sql
CREATE TABLE intake_drafts (
  id                          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id                  UUID         NOT NULL UNIQUE REFERENCES intake_sessions(id),

  -- AI outputs (gateway-task-mapped)
  bg_removed_photo_keys       TEXT[],                          -- R2 keys after Photoroom
  vision_classification       JSONB,                           -- raw output of extractItemAttributes
  vision_hallmark_detection   JSONB,                           -- raw output of detectHallmark
  vision_scale_reading        JSONB,                           -- raw output of ocrScaleReading (nullable)

  -- Enrichment (deterministic logic, not AI)
  lbma_price_snapshot_eur_per_g NUMERIC(15,4),                 -- from cached LBMA feed at enrichment time
  tax_treatment_code          TEXT         REFERENCES tax_treatment_codes(code),
  classifier_explanation      TEXT,                            -- "matched MARGIN_25A because item_type=gold_jewelry AND has_hallmark=true"
  suggested_acquisition_eur   NUMERIC(18,2),
  suggested_sale_eur          NUMERIC(18,2),

  -- AI marketing copy
  german_description          TEXT,
  marketing_angles            JSONB,                           -- [{angle, suggested_seo_keywords}]
  embedding                   VECTOR(1536),                    -- for similarity search later

  -- Reviewer overrides (filled when approving)
  final_data                  JSONB,                           -- merged data the reviewer actually wants published

  -- Lifecycle
  pipeline_errors             JSONB,                           -- accumulated per-step error log; empty on clean run
  created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

Every state transition emits a `ledger_events` row (ADR-0008). The chain extends. Even an in-development intake is auditable years later.

### 4. Multi-image grouping — 120-second window with staff override

The default grouping rule:

> While any new message arrives from the same `staff_phone_id`, slide the grouping window forward to **`now() + 120s`**. When `now() > grouping_closes_at`, transition the session from `RECEIVED` to `GROUPED` and start processing.

**Why 120 seconds, not 60.** Basel's field-experience review (2026-05-23): the original 60s assumed a stationary photographer doing nothing but uploading. Reality: a staff member photographs the front, walks to find the loupe for a hallmark closeup, places the item on the scale, gets briefly interrupted by a customer at the counter, then resumes. 60 seconds truncates the session and produces orphan drafts. 120 seconds covers the realistic interruption pattern without bloating the queue or noticeably delaying pipeline kickoff (the staff member usually closes early via `DONE` anyway). The value is stored in `system_settings.intake.grouping_window_seconds` so an operator can tune it without a deploy.

Staff overrides via text commands, parsed by a small regex + keyword-table layer (never LLM — deterministic, cheap, and unit-testable):

| Command type | Effect | Languages recognized at V1 |
|---|---|---|
| `DONE` | Close the grouping window immediately. | `done`, `finished`, `end`, `ok` (EN) · `fertig`, `ende`, `erledigt`, `ok` (DE) · `تم`, `انتهيت`, `خلاص`, `جاهز` (AR) |
| `NEW` / `NEXT` | Close current session and start a new one — next image starts fresh. | `new`, `next` (EN) · `neu`, `nächster`, `weiter` (DE) · `جديد`, `التالي` (AR) |
| `CANCEL` | Move current session to REJECTED with reason `staff_cancelled`. | `cancel`, `discard`, `abort` (EN) · `abbrechen`, `verwerfen`, `storno` (DE) · `الغاء`, `إلغاء`, `تجاهل`, `حذف` (AR) |
| `HELP` / `?` | Reply with template listing the commands in the staff member's preferred language. | `help`, `?` (EN) · `hilfe`, `?` (DE) · `مساعدة`, `?`, `؟` (AR) |
| Split: `1-3 = A, 4 = B` (with or without `📷`/`IMAGES`/`BILDER`/`صور` prefix) | Split current session: photos 1–3 → session A, photo 4 → session B. | regex is language-agnostic on numbers and separators; prefix words optional in any language |

#### Why a keyword table, and how to extend it

The command parser lives in `packages/intake-pipeline/src/parser/overrideCommands.ts`. The keyword map is a single typed constant:

```ts
type CommandType = 'DONE' | 'NEW' | 'CANCEL' | 'HELP';
type LanguageCode = 'de' | 'en' | 'ar';

const OVERRIDE_COMMAND_KEYWORDS: Record<CommandType, Record<LanguageCode, readonly string[]>> = {
  DONE:   { de: ['fertig','ende','erledigt','ok'], en: ['done','finished','end','ok'], ar: ['تم','انتهيت','خلاص','جاهز'] },
  NEW:    { de: ['neu','nächster','weiter'],       en: ['new','next'],                  ar: ['جديد','التالي'] },
  CANCEL: { de: ['abbrechen','verwerfen','storno'],en: ['cancel','discard','abort'],    ar: ['الغاء','إلغاء','تجاهل','حذف'] },
  HELP:   { de: ['hilfe','?'],                     en: ['help','?'],                    ar: ['مساعدة','?','؟'] },
};
```

Adding Turkish or Russian (or any other staff language) is **one row per language per command type** — no parser logic changes, no new tests beyond the keyword fixture file. Property-based tests assert: every keyword in the table is recognized as exactly its command type, and ambiguous tokens (e.g. `ok` as both an affirmation and `DONE`) resolve consistently.

The parser is **case- and diacritic-insensitive**, ignores leading/trailing punctuation, and strips emoji. Normalization is via `String.prototype.normalize('NFKD')` + accent stripping for Latin scripts; for Arabic, the parser strips tashkeel (diacritics) and normalizes alif variants (`أ`, `إ`, `آ` → `ا`). Tested with property-based tests against ~300 fuzzed inputs per language.

#### Staff's preferred language is per-phone

The `staff_phone_numbers` table carries `preferred_language CHAR(2) NOT NULL DEFAULT 'de'` (the canonical ISO 639-1 code). Inbound parsing tries the staff member's preferred language first (highest hit rate), then falls back to the other registered languages. Outbound status messages (§8) use the preferred language too — a staff member who registered with `preferred_language = 'ar'` receives `intake_ready_v1_ar`, not the German template.

#### Why this approach is bulletproof

- **Never an LLM.** A misclassified command would create real damage (cancelling a session by mistake). Deterministic regex + keyword table can be reasoned about exhaustively in code review.
- **Property-tested.** Every keyword is asserted in CI; every ambiguous token (`ok`) has a documented resolution rule.
- **Extensible.** Adding a language is a config change — no parser code touched, no risk of regression to existing languages.
- **Documented in the staff onboarding card.** A laminated A5 card in each staff member's shop kit lists the commands in their preferred language with examples.

### 5. Parallel AI processing — three Vision calls + one Photoroom, concurrent

Once a session enters `GROUPED`, the worker dispatches **all four AI jobs in parallel**:

```ts
// apps/worker/src/jobs/intake-process.ts
async function processSession(sessionId: string) {
  const session = await loadSession(sessionId);
  const photos = await loadSessionPhotos(session.id);  // R2-fetched bytes

  await db.update(intakeSessions).set({ status: 'PROCESSING', processingStartedAt: new Date() })
        .where(eq(intakeSessions.id, sessionId));

  const results = await Promise.allSettled([
    // Parallel #1: background removal for every photo
    Promise.all(photos.map(p => gateway.tasks.removeBackground({
      imageBytes: p.bytes,
      idempotencyKey: p.contentHash,
    }))),

    // Parallel #2: main classification on the best (highest-resolution, full-item) photo
    gateway.tasks.extractItemAttributes({
      images: photos.map(p => ({ bytes: p.bytes, mimeType: p.mimeType })),
      consumerRef: { intake_session_id: sessionId },
    }),

    // Parallel #3: hallmark detection on closeup photos (heuristically detected by EXIF / aspect ratio)
    detectHallmarkIfApplicable(photos, sessionId),

    // Parallel #4: scale reading OCR if a scale-display photo is present
    detectScaleReadingIfApplicable(photos, sessionId),
  ]);

  // Merge regardless of partial failures — each `result.status` is checked individually.
  const draft = assembleDraft(session, results);

  // Enrichment is deterministic (no AI calls here).
  draft.lbmaPriceSnapshot   = await readCachedLbmaPrice();         // §6
  draft.taxTreatmentCode    = classifyTaxTreatment(draft.visionClassification);  // §7 — deterministic
  draft.suggestedPriceBand  = computePriceBand(draft);             // deterministic from weight × LBMA × margin curve

  await db.update(intakeDrafts).set(draft).where(eq(intakeDrafts.sessionId, sessionId));

  // Now the marketing copy (Claude). Sequential after enrichment because the prompt
  // includes the tax_treatment, suggested price band, and structured attributes.
  const copy = await gateway.tasks.writeGermanProductDescription({
    attributes: draft,
    consumerRef: { intake_session_id: sessionId },
  });
  draft.germanDescription = copy.text;
  draft.marketingAngles    = copy.angles;

  // Embedding for future similarity search (ADR-0016 §6.bis).
  draft.embedding = await gateway.tasks.embedProduct({
    text: `${draft.visionClassification.item_type} ${copy.text}`,
    consumerRef: { intake_session_id: sessionId },
  });

  await finalizeDraft(sessionId);  // marks ENRICHED → READY_FOR_REVIEW, emits SSE
  await sendWhatsAppStatus(session, 'ready');
}
```

**Latency math** with the parallel design:

- Photoroom (3 photos in parallel): ~2 s
- Vision main: ~5 s
- Vision hallmark: ~5 s
- Vision scale OCR: ~3 s
- → **All four wait-clocked: ~5 s** (the slowest one wins)
- Sequential enrichment (LBMA cached, tax classifier deterministic): ~50 ms
- Claude description: ~4 s
- Embedding: ~500 ms

**Total p50: ~10 s. p99: ~90 s** (with one retry on the worst-case step).

### 6. LBMA price feed — cached, never per-item

The London Bullion Market Association publishes the daily gold/silver/platinum fix in JSON. A cron job (`apps/worker/src/jobs/lbma-fetch.ts`) runs **every 15 minutes** during LBMA market hours (08:30–15:30 London time), fetches the latest, and writes to `system_settings`:

```sql
UPDATE system_settings SET value = '{"timestamp":"2026-05-23T08:30:00Z","gold_usd_per_oz":"...","gold_eur_per_g":"..."}'
 WHERE key = 'lbma.latest_fix';
```

Each fetch also writes a row to `lbma_price_history` for trend analysis. The pipeline reads the latest from `system_settings`, never calls LBMA directly — so a busy intake morning doesn't hammer the upstream and doesn't pay 100× redundant latency.

If the cached price is older than 24 hours, the pipeline still proceeds but flags the draft with `pipeline_errors.lbma_stale = true`; the reviewer sees a yellow warning.

### 7. Tax-treatment classifier — pure deterministic rules

This is the most important architectural discipline in this ADR: **the tax classification is not done by an LLM.** German tax law is not subject to AI judgment.

`packages/inventory-lock/src/tax-treatment-classifier.ts` — **expanded ruleset per Basel's 2026-05-23 review** covering §25c investment gold (with explicit purity + post-1800 + 80%-markup criteria), §25a margin tax (jewelry, antiques, collector coins, watches), and §13b reverse charge (B2B Altgold, applied at sale time not intake time):

```ts
export function classifyTaxTreatment(
  vision: VisionClassification,
  lbmaPriceCache: LbmaSnapshot,
): {
  code: TaxTreatmentCode;
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
  requires_admin_confirmation: boolean;
  legal_reference: string;
} {
  const { item_type, karat_visible, hallmarks_visible, estimated_age_band, condition } = vision;
  const purity = karatToPurityPer1000(karat_visible);   // 14K → 585, 22K → 916, 24K → 999

  // ─────────────────────────────────────────────────────────────────────
  // Rule 1 — §25c Investment Gold: GOLD BARS
  //   Criterion (UStG §25c Anlage 2): bars with purity ≥ 995/1000.
  // ─────────────────────────────────────────────────────────────────────
  if (item_type === 'gold_bar') {
    if (purity !== null && purity >= 995) {
      return {
        code: 'INVESTMENT_GOLD_25C',
        explanation: `Gold bar with purity ${purity}/1000 ≥ 995 — §25c UStG investment gold (VAT exempt)`,
        confidence: 'high',
        requires_admin_confirmation: false,
        legal_reference: '§25c UStG Anlage 2 Nr. 1',
      };
    }
    // Bar below 995/1000 — does not qualify; falls back to 19% standard.
    // ADMIN must verify the acquisition document (sometimes assayed re-melts qualify after re-stamp).
    return {
      code: 'STANDARD_19',
      explanation: `Gold bar with purity ${purity ?? 'unknown'}/1000 — below §25c threshold (995). ` +
                   `Defaults to 19% standard VAT pending ADMIN verification of acquisition documents.`,
      confidence: 'low',
      requires_admin_confirmation: true,
      legal_reference: '§25c UStG Anlage 2 Nr. 1 (negative)',
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Rule 2 — §25c Investment Gold: GOLD COINS
  //   Three independent paths qualify:
  //     (a) Coin appears on the BMF / EU annual published list of recognized
  //         investment-grade coins (the simplest and safest path).
  //     (b) All three criteria met: post-1800 issue + purity ≥ 900/1000
  //         + market price ≤ 80% above its gold content value.
  //   Otherwise: §25a margin tax for collector coins, or STANDARD_19 fallback.
  // ─────────────────────────────────────────────────────────────────────
  if (item_type === 'gold_coin') {
    const coinId = identifyCoin(vision);

    // (a) — BMF/EU annual list (Krugerrand, Maple Leaf, Eagle, Britannia, Wiener Philharmoniker, etc.)
    if (coinId && INVESTMENT_GRADE_COINS_WHITELIST.has(coinId)) {
      return {
        code: 'INVESTMENT_GOLD_25C',
        explanation: `Recognized investment-grade coin (${coinId}) on annual BMF/EU §25c list`,
        confidence: 'high',
        requires_admin_confirmation: false,
        legal_reference: '§25c UStG Anlage 2 Nr. 2 (Verzeichnis BMF)',
      };
    }

    // (b) — Explicit §25c criteria check
    const issueYearEst = estimateIssueYear(vision);                   // null if unknown
    const markupOverSpot = computeMarkupOverSpot(vision, lbmaPriceCache); // 0.25 = 25% over spot; null if uncalculable

    if (issueYearEst !== null && issueYearEst > 1800
        && purity !== null   && purity >= 900
        && markupOverSpot !== null && markupOverSpot <= 0.80) {
      return {
        code: 'INVESTMENT_GOLD_25C',
        explanation: `Coin post-1800 (est. ${issueYearEst}), purity ${purity}/1000 ≥ 900, ` +
                     `market markup ${(markupOverSpot * 100).toFixed(0)}% ≤ 80% — meets §25c criteria`,
        confidence: 'medium',                          // photo-estimated year is not legally sufficient
        requires_admin_confirmation: true,             // ADMIN must verify against catalog reference
        legal_reference: '§25c UStG Anlage 2 Nr. 2 lit. b',
      };
    }

    // Coin not investment-grade → §25a margin tax (collector / numismatic value)
    return {
      code: 'MARGIN_25A',
      explanation: `Coin not on §25c whitelist and explicit criteria not met ` +
                   `(year ${issueYearEst ?? 'unknown'}, purity ${purity ?? 'unknown'}/1000, ` +
                   `markup ${markupOverSpot !== null ? (markupOverSpot * 100).toFixed(0) + '%' : 'uncalculable'}) ` +
                   `— treating as collector coin under §25a margin tax`,
      confidence: 'medium',
      requires_admin_confirmation: true,
      legal_reference: '§25a UStG',
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Rule 3 — Worked jewelry (Schmuck) → §25a margin tax
  //   Used jewelry with hallmark in fair-or-better condition is the canonical
  //   §25a case. Hallmarked + poor-condition is borderline (could be scrap or
  //   collectible). No-hallmark is scrap-candidate (Rule 5).
  // ─────────────────────────────────────────────────────────────────────
  if (item_type === 'gold_jewelry' || item_type === 'silver_jewelry') {
    if (hallmarks_visible.length > 0 && condition !== 'poor') {
      return {
        code: 'MARGIN_25A',
        explanation: `Used ${item_type === 'gold_jewelry' ? 'gold' : 'silver'} jewelry with hallmark, ` +
                     `condition ${condition} — §25a margin tax (acquisition cost determines margin)`,
        confidence: 'high',
        requires_admin_confirmation: false,
        legal_reference: '§25a UStG Abs. 1',
      };
    }
    // Hallmarked but poor: still a §25a candidate, ADMIN verifies it's not scrap-route
    if (hallmarks_visible.length > 0 && condition === 'poor') {
      return {
        code: 'MARGIN_25A',
        explanation: `Hallmarked jewelry in poor condition — §25a candidate, but ADMIN to verify ` +
                     `whether item is for resale (margin) or scrap melt (Rule 5).`,
        confidence: 'low',
        requires_admin_confirmation: true,
        legal_reference: '§25a UStG Abs. 1 (borderline with §13b scrap)',
      };
    }
    // No hallmark → fall through to Rule 5 (scrap)
  }

  // ─────────────────────────────────────────────────────────────────────
  // Rule 4 — Antiques (>100 years per BMF definition)
  //   Age estimation from a photo is NOT legally sufficient — provenance
  //   documentation required. Classifier flags MARGIN_25A and forces ADMIN.
  // ─────────────────────────────────────────────────────────────────────
  if (item_type === 'antique' && estimated_age_band === 'antique') {
    return {
      code: 'MARGIN_25A',
      explanation: 'Antique (estimated >100y from visual cues) → §25a margin tax. ' +
                   'Age estimate from photo only — ADMIN to verify provenance documentation.',
      confidence: 'medium',
      requires_admin_confirmation: true,             // legal age threshold requires documentation
      legal_reference: '§25a UStG Abs. 1 (Antiquität, BMF Schreiben 28.11.2019)',
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Rule 5 — Silver coins
  //   Silver is NOT in scope for §25c (gold-only exemption).
  //   Collector value → §25a; pure bullion → 19% standard.
  // ─────────────────────────────────────────────────────────────────────
  if (item_type === 'silver_coin') {
    if (isCollectorSilver(vision)) {                  // hallmark of mint + clear collector indicators
      return {
        code: 'MARGIN_25A',
        explanation: 'Silver coin with collector/numismatic indicators → §25a margin tax',
        confidence: 'medium',
        requires_admin_confirmation: true,
        legal_reference: '§25a UStG (silver collector)',
      };
    }
    return {
      code: 'STANDARD_19',
      explanation: 'Silver coin without clear collector indicators → standard 19% VAT',
      confidence: 'low',
      requires_admin_confirmation: true,
      legal_reference: '§12 Abs. 1 UStG (Standard)',
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Rule 6 — Watches
  //   Default to §25a (Wiederverkäufer status assumed); ADMIN verifies
  //   acquisition documentation for margin scheme eligibility.
  // ─────────────────────────────────────────────────────────────────────
  if (item_type === 'watch') {
    return {
      code: 'MARGIN_25A',
      explanation: 'Watch resale → §25a margin tax candidate (Wiederverkäufer status assumed). ' +
                   'ADMIN to verify acquisition documentation.',
      confidence: 'low',
      requires_admin_confirmation: true,
      legal_reference: '§25a UStG',
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Rule 7 — Scrap metal for melting (Altgold / Altsilber)
  //   At INTAKE: classified as STANDARD_19 (safe default for retail).
  //   At SALE: if B2B + buyer is a registered Wiederverkäufer + applicable
  //   conditions, §13b reverse charge applies. THIS IS A SALE-TIME OVERRIDE,
  //   NOT AN INTAKE-TIME CLASSIFICATION. See note below the function.
  // ─────────────────────────────────────────────────────────────────────
  if ((item_type === 'gold_jewelry' || item_type === 'silver_jewelry') 
      && hallmarks_visible.length === 0) {
    return {
      code: 'STANDARD_19',
      explanation: `Unmarked ${item_type === 'gold_jewelry' ? 'gold' : 'silver'} jewelry → scrap-melt candidate. ` +
                   `Retail (B2C): standard 19% VAT. B2B sale to a Wiederverkäufer may trigger §13b reverse ` +
                   `charge at sale time (not classified here). ADMIN to verify.`,
      confidence: 'low',
      requires_admin_confirmation: true,
      legal_reference: '§12 Abs. 1 UStG (retail) / §13b UStG Abs. 2 Nr. 9 (B2B reverse charge — sale-time override)',
    };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Rule 8 — Borderline / unknown / unmatched
  //   Safe default: STANDARD_19 + forced ADMIN review. Over-collecting VAT
  //   is recoverable. Under-collecting is a Steuerprüfung exposure.
  // ─────────────────────────────────────────────────────────────────────
  return {
    code: 'STANDARD_19',
    explanation: 'No matching tax-treatment rule. Defaulting to 19% standard pending ADMIN verification.',
    confidence: 'low',
    requires_admin_confirmation: true,
    legal_reference: '§12 Abs. 1 UStG (safe default)',
  };
}
```

**Critical note — §13b Reverse Charge applies at SALE time, not INTAKE time.**

The intake classifier produces a tax_treatment for the *product on the shelf*. The §13b reverse-charge case (B2B Altgold sale to a registered Wiederverkäufer) is a **sale-time invoice override**, not a property of the product. When the cashier finalizes a sale and toggles "B2B reverse-charge invoice" on the checkout screen (visible only to ADMIN or cashiers with the explicit grant):

1. The invoice issued uses the reverse-charge tax code, not the product's stored `tax_treatment_code`.
2. The customer's `customer.vat_id_de` is captured and validated against the BZSt service in real time.
3. The invoice carries the legally-required note: *"Steuerschuldnerschaft des Leistungsempfängers nach §13b Abs. 2 Nr. 9 UStG."*
4. The product's `tax_treatment_code` is recorded for audit alongside the reverse-charge flag — both visible in the `ledger_events` row.

The intake classifier intentionally does **not** know B2B vs B2C. It classifies the asset; the sale flow handles the channel-specific tax treatment. This separation keeps both surfaces simple and auditable.

**Borderline-case discipline (per Basel's review):**

Every classifier output where `requires_admin_confirmation = true` blocks the Publish button in Control Desktop until ADMIN clicks "Verify tax treatment." The verification UI shows the classifier's explanation, legal reference, the raw Vision output, and a free-form note field whose contents land in `intake_drafts.final_data.admin_verification_note` and in the `ledger_events` row for the publish action. **The system never auto-publishes a borderline item.**

The function is **exhaustive over the `item_type` enum** (a compile-time switch-exhaustiveness check in TypeScript catches missing cases on any future expansion of `item_type`), unit-tested with **property-based testing (~800 randomized inputs)** verifying every rule's output across the full purity / year / markup space, and the **only** place tax treatment is decided. The Vision call provides inputs; the classifier interprets them; the reviewer can override only with a written reason that lands in the ledger.

### 8. Status messages back to staff via WhatsApp

Status events are sent to the staff member's phone, in their preferred language (German default for V1):

| Stage | Template message (DE) |
|---|---|
| RECEIVED (first photo of a new session) | "✅ Empfangen. Sende weitere Fotos derselben Position oder schreibe DONE." |
| GROUPED (60s window closed) | "🔄 Verarbeite jetzt. Du bekommst eine Nachricht in ca. 30 Sekunden." |
| READY_FOR_REVIEW | "👁️ Entwurf bereit: {item_name} ~{weight}g · {karat} · Preisvorschlag €{price}. Warte auf Freigabe vom Inhaber." |
| PUBLISHED | "✅ Veröffentlicht auf warehouse14.de + eBay. Artikel-ID: #{product_id_short}." |
| REJECTED | "❌ Inhaber abgelehnt: {reason}" |
| NEEDS_MORE_INFO | "📸 Bitte sende ein weiteres Foto: {what_is_missing}" |
| FAILED (pipeline error survived retries) | "⚠️ Verarbeitungsfehler — der Inhaber wurde benachrichtigt." |

Outbound messages use pre-approved Meta templates with placeholder substitution. The English / Arabic / Turkish / Russian translations land in Phase 2 when staff diversity demands.

### 9. Failure handling per step — no dead-ends, every degradation visible

| Step failure | Behavior | Visible to whom |
|---|---|---|
| **Photoroom rate-limited** | Each photo retried via gateway's backoff. After 3 attempts, draft proceeds with original photos + `pipeline_errors.bg_removal_pending=true`; a worker re-tries every 30 min. | reviewer sees yellow chip on the draft |
| **Photoroom hard error** | Same as above — original photos used; draft is publishable; ADMIN sees the chip. | reviewer |
| **Vision main fails 3× → fallback Claude Vision** | Per gateway's fallback chain (ADR-0010 §4). If fallback also fails, draft is created with `vision_classification = NULL` and reviewer fills in manually. WhatsApp status: NEEDS_MORE_INFO with "Foto unscharf, bitte erneut senden." | staff + reviewer |
| **Vision returns low-confidence** (`needs_human_review_reasons.length > 0`) | Draft proceeds; the reasons are shown in the reviewer's UI as bullet points to focus on. | reviewer |
| **Hallmark detection inconclusive** | Optional step — pipeline proceeds without it; classifier may downgrade tax_treatment confidence accordingly. | reviewer (downstream effect on tax_treatment confidence) |
| **Scale OCR fails or no scale photo** | Pipeline proceeds; weight remains the Vision estimate (lower confidence); reviewer enters actual weight. | reviewer |
| **LBMA price > 24h stale** | Pipeline proceeds; reviewer sees yellow "LBMA-Preis veraltet" warning; suggested price uses stale value with flag. | reviewer + ADMIN (cron job alert) |
| **Tax classifier returns `requires_admin_confirmation`** | Draft proceeds; the chip in Control Desktop is yellow and the Publish button is disabled until ADMIN clicks "Verify tax treatment." | reviewer (forced confirm step) |
| **Claude description fails 3× → fallback Haiku** | If both fail, draft published without description; reviewer types one. WhatsApp status mentions this gap. | reviewer |
| **Embedding fails** | Non-blocking; backfill job runs nightly to retry embeddings for products without one. | observability only |
| **Worker crashes mid-pipeline** | BullMQ retries the job from the last checkpoint (state machine column). At most-once side effects (one WhatsApp status message per stage) protected by `whatsapp_message_id_out` uniqueness. | observability only |
| **All retries exhausted, no recovery possible** | Session moves to FAILED; surfaces in Control Desktop "Intake Failures" panel; ADMIN can manually retry or reject. | ADMIN |

### 10. Idempotency — every message can be replayed safely

- Meta sometimes redelivers a webhook (their at-least-once guarantee). Each `intake_messages` row is uniquely keyed on `whatsapp_message_id` — duplicate inserts no-op.
- Pipeline jobs are keyed on `session_id`; re-running a job updates the same draft row.
- Outbound status messages are keyed on `(session_id, message_type)` — sending "READY" twice for the same session is a no-op.
- Publishing a draft is wrapped in a DB transaction; if `INSERT INTO products` succeeds but the eBay mirror call fails, the products row exists and the mirror reconciler (ADR-0016 §5) picks it up.

A re-deployed worker with a half-finished job in flight catches up cleanly without producing duplicates.

### 11. Schema sketch — the staging tables that ADR-0008's migration 0006 will own

Already shown in §3. To restate the migration boundary: `intake_sessions`, `intake_messages`, `intake_drafts`, `staff_phone_numbers`, `lbma_price_history` all land in **migration `0006_products.sql`** (per ADR-0008 §9) because they're product-lifecycle staging tables. The `INSERT, SELECT, UPDATE` grants for `warehouse14_app` apply; `DELETE` is forbidden as everywhere else (a stale RECEIVED session is reclaimed via UPDATE to a `cancelled` status, not DELETE).

## Consequences

**Positive:**
- Staff productivity gain estimated at **5×** vs manual intake (90s pipeline vs 8 min manual data entry per item).
- Every published product has a consistent description style — Claude-driven copy in a single voice. Storefront and eBay listings look professional from day one.
- Every published product has an embedding from day one, unlocking the semantic search compensation flow (ADR-0016 §6.bis) and future bot-driven search (ADR-0017).
- The tax classifier discipline guarantees that no AI hallucination can publish a wrongly-classified item — the classifier rules are reviewed in code, not generated text.
- Failure modes are enumerated, visible, and recoverable. The pipeline degrades gracefully rather than collapsing.

**Negative:**
- AI cost per intake estimated at **~€0.08** (3× Vision + 3× Photoroom + 1× Claude + 1× embedding) at 50 items/day = ~€4/day = ~€120/month. Modest, within memory.md §4 / ADR-0010 budget.
- Multi-image grouping based on 60s window can mis-group if a staff member is photographing two items rapidly. Mitigation: the staff `NEW` / `📷 1-3=A, 4=B` commands; documented in onboarding.
- The pipeline depends on three external services (Photoroom, OpenAI, Anthropic) plus LBMA. Outage of any forces degradation but never blockage. Documented in §9.
- WhatsApp Business templates require Meta pre-approval; new template = ~24-48h lead time. We pre-register all V1 templates during onboarding so launch is not blocked.

**Mitigations:**
- Cost dashboard in Control Desktop shows daily intake spend; alerts on 80%/100%/110% of the per-task daily budget (gateway from ADR-0010).
- A daily reconciliation job verifies every `intake_sessions.status = 'PUBLISHED'` has a matching `products` row with all required fields.
- A weekly "intake health" report goes to ADMIN: avg latency, p95 latency, failure breakdown by stage, top reasons for `requires_admin_confirmation`.
- Pre-registered template names: `intake_received_v1`, `intake_grouped_v1`, `intake_ready_v1`, `intake_published_v1`, `intake_rejected_v1`, `intake_more_info_v1`, `intake_failed_v1`.

## Alternatives considered

- **Native staff app (Tauri or React Native) for photo capture.** Rejected. New install, new login, new training. WhatsApp is on every phone already, no friction.
- **OpenAI Assistants API for the whole pipeline.** Rejected. Hides the orchestration in a third-party black box; cost is opaque; debugging when "the assistant" misbehaves is impossible.
- **Single Vision call combining classification + hallmark + scale OCR.** Rejected. The combined prompt is longer, latency is higher (a single 8-second call vs three 5-second parallel calls), and one bad sub-extraction taints the whole. Three specialized calls give cleaner failure modes.
- **LLM-based tax classifier.** Rejected explicitly. Tax law is not subject to model temperature. Hard rule.
- **Skip the bg-removal stage and use raw photos.** Rejected for storefront/eBay quality. The 2-second Photoroom cost buys a 10× perceived professionalism. Optional graceful-degradation path exists for outages.
- **Use eBay's own listing-generation AI.** Rejected. We need the same description on warehouse14.de + eBay; consistency matters; vendor lock-in matters.
- **Synchronous processing inside the webhook handler.** Rejected absolutely. Webhook timeout is ~20s, our pipeline is up to 90s, and Meta will redeliver if the response is slow. BullMQ async + status messages is the only correct shape.

## Known limits & deferred decisions

1. **One staff member per intake session.** A field buyer hands off to a senior reviewer who continues the conversation — currently this would create two sessions. V1 limit; if it bites in practice, a "transfer session" command is a small add.
2. **No video intake.** WhatsApp accepts video; we silently drop in V1. Video classification is a Phase 2 ADR.
3. **No multi-item-in-one-photo handling.** If staff send a tray of 10 rings in one photo, the pipeline treats it as one item. The staff member must photograph individually or use the split command.
4. **LBMA-only price source.** Per-karat pricing (e.g., `goldapi.io`) is `Phase 1 evaluate` per memory.md §4. If LBMA + karat lookup table is insufficient (Vision can't reliably tell 14K from 18K), we add the paid provider as an enrichment step.
5. **No auto-publish.** Every draft requires reviewer approval. We considered an auto-publish path for high-confidence small-value items but rejected as risky — first wave of business is built on reviewer trust.
6. **No re-intake of an already-published item.** If staff send photos of an item already in inventory (same hallmark + similar attributes), the pipeline does not detect duplication. Phase 2 adds a duplicate-detector step using `embedProduct` + similarity search before publishing.
7. **Single language input.** Staff intake commands are language-flexible (deterministic keyword match across DE/EN/AR) but Claude generation is German-only. Multilingual storefront is Phase 2.
8. **One LBMA fetch worker.** Single-VM is fine; if we add multi-shop later, each shop reads the same cached price, but the fetcher remains single-source-of-truth.

## References

- ADR-0008 — Schema (the staging tables migrate via `0006_products.sql`)
- ADR-0010 — AI Gateway (every AI call routes through it)
- ADR-0014 — Live Ops (status events flow over SSE to Control Desktop)
- ADR-0016 — Inventory lock (publishing a draft = `INSERT INTO products` + state transition to `AVAILABLE` + eBay mirror enqueue)
- ADR-0007 — GwG / §25a (the tax classifier respects the rules)
- ADR-0017 (pending) — Customer Service Bot (will reuse Photoroom + embedding tasks defined here)
- WhatsApp Business Cloud API — https://developers.facebook.com/docs/whatsapp/cloud-api
- LBMA gold/silver fixings — https://www.lbma.org.uk/prices-and-data
- `docs/memory.md` §2 #34, §3 (compliance facts), §4 (AI providers + LBMA)
