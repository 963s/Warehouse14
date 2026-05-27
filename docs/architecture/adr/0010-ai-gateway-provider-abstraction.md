# ADR-0010 — `@warehouse14/ai-gateway`: single-import abstraction for every LLM, Vision, and embedding call

- **Status:** Proposed (pending Basel review)
- **Date:** 2026-05-23
- **Deciders:** Basel, Claude
- **Related:** ADR-0008 (every AI call that affects business state emits a ledger event), ADR-0014 (Live Ops surface for cost/budget alerts), ADR-0015 (the first heavy consumer — Intake Pipeline), ADR-0016 §6.bis (semantic search compensation uses this gateway), ADR-0017 pending (Customer Service Bot also routes through this gateway), `docs/memory.md` §2 #34, §4 (AI providers table).

## Context

Warehouse14 will eventually issue tens of thousands of AI calls per month — Vision OCR for KYC, Vision classification for the Intake Pipeline, Claude for German marketing copy, Claude for customer-service bot replies, embeddings for product search, Photoroom for background removal. Each call costs euros, each call carries DSGVO implications, each call has a retry/timeout/circuit-breaker concern, each call needs an audit story.

If business code imports provider SDKs directly — `import OpenAI from 'openai'` here, `import Anthropic from '@anthropic-ai/sdk'` there — within six months we will have:

- Cost tracking scattered across the codebase (or missing entirely).
- Inconsistent retry policies (one call retries forever, another never).
- DSGVO posture leaks (a developer accidentally sends raw KYC text to a US endpoint).
- Provider lock-in (swapping Claude Sonnet 4.6 → 4.7 means grepping the whole repo).
- Zero observability of which task is burning the budget.
- No way to stub AI in CI deterministically.

This ADR establishes a **single import point** — `@warehouse14/ai-gateway` — that every consumer uses. The gateway owns provider selection, cost tracking, retry policy, DSGVO discipline, caching, and observability. **Business code calls high-level tasks, never low-level provider methods.**

Constraints:

1. **One import surface.** CI lints for direct imports of `openai`, `@anthropic-ai/sdk`, `replicate`, etc. outside `packages/ai-gateway`.
2. **Task-level abstractions, not API-level.** Consumers call `gateway.tasks.extractKycFields(image)`, not `gateway.openai.chat.completions.create({...})`.
3. **Cost-aware by construction.** Every call records cost; daily/monthly budgets per task class are enforced.
4. **Failure-aware by construction.** Retry, timeout, circuit breaker, fallback provider — all centralized.
5. **DSGVO-aware by construction.** Each task declares what category of data it sends (PII / non-PII / commercial-content-only) and the gateway routes to the appropriate EU-resident endpoint.
6. **Deterministic in tests.** A test mode returns canned fixtures; unit tests of business logic never hit a real provider.
7. **Idempotent where the underlying call permits.** Identical inputs return cached outputs (Redis), respecting cache-control headers per task.

## Decision

### 1. Package shape — `packages/ai-gateway`

```
packages/ai-gateway/
├── src/
│   ├── index.ts                          # the only public export — `gateway`
│   ├── tasks/                            # high-level business-relevant operations
│   │   ├── extractKycFields.ts
│   │   ├── extractItemAttributes.ts
│   │   ├── detectHallmark.ts
│   │   ├── ocrScaleReading.ts
│   │   ├── removeBackground.ts
│   │   ├── embedProduct.ts
│   │   ├── embedQuery.ts
│   │   ├── writeGermanProductDescription.ts
│   │   ├── composeWalkInCompensation.ts  # used by ADR-0016 §6.bis
│   │   ├── classifyCustomerIntent.ts
│   │   ├── composeBotReply.ts
│   │   └── index.ts                      # re-exports tasks namespace
│   ├── providers/                        # the only files that import vendor SDKs
│   │   ├── openai.ts
│   │   ├── anthropic.ts
│   │   ├── photoroom.ts
│   │   ├── opensanctions.ts              # not LLM but same discipline
│   │   └── types.ts                      # ProviderClient interface
│   ├── core/
│   │   ├── budget.ts                     # cost tracker + budget enforcement
│   │   ├── cache.ts                      # Redis-backed idempotent result cache
│   │   ├── retry.ts                      # exponential backoff + jitter
│   │   ├── circuitBreaker.ts             # half-open / closed / open per provider+task
│   │   ├── fallback.ts                   # provider-fallback policy table
│   │   ├── ledger.ts                     # writes `ai_calls` rows + ledger events
│   │   └── testMode.ts                   # fixture-backed responses for CI
│   ├── policies/
│   │   ├── dsgvoMatrix.ts                # which task → which provider for what data class
│   │   └── modelSelection.ts             # cheap-vs-expensive routing per task
│   └── errors.ts                         # AiGatewayError, ProviderRateLimited, BudgetExceeded, etc.
└── tests/
    ├── tasks/                            # one suite per task with stub providers
    ├── core/
    │   ├── budget.test.ts
    │   ├── retry.test.ts
    │   ├── circuitBreaker.test.ts
    │   └── cache.test.ts
    └── fixtures/                         # canned responses keyed by task + input hash
```

The single public export is the `gateway` object exposing `gateway.tasks.*`. Nothing else leaks out of the package.

### 2. Task catalog — the V1 surface

| Task | Purpose | Primary provider | Fallback | Data class |
|---|---|---|---|---|
| `extractKycFields` | OCR a customer's ID card → structured fields | OpenAI GPT-4o-mini Vision (EU endpoint) | Claude Sonnet 4.6 Vision (EU) | **PII** (ID document) |
| `extractItemAttributes` | Classify a gold/coin/antique photo → structured attributes for Intake Pipeline | OpenAI GPT-4o-mini Vision | Claude Sonnet 4.6 Vision | non-PII (commercial inventory) |
| `detectHallmark` | Vision specialized on a hallmark closeup — match against `hallmarks` table | OpenAI GPT-4o-mini Vision | Claude Sonnet 4.6 Vision | non-PII |
| `ocrScaleReading` | Read a digital scale's display value from a photo | OpenAI GPT-4o-mini Vision | Claude Sonnet 4.6 Vision | non-PII |
| `removeBackground` | Strip background from a product photo | Photoroom | (none — fallback is "use original photo with `bg_removal_pending` flag") | non-PII |
| `embedProduct` | Generate a 1536-dim embedding for a product's description+attributes | OpenAI `text-embedding-3-large` (truncated to 1536) | (none — embedding dimension is provider-locked) | non-PII |
| `embedQuery` | Embed a customer's search query for semantic search | OpenAI `text-embedding-3-large` | (none) | **light PII** (the query may name the customer; treated as PII tier) |
| `writeGermanProductDescription` | Compose marketing copy for storefront + eBay listing | Claude Sonnet 4.6 (EU) | Claude Haiku 4.5 (EU) | non-PII |
| `composeWalkInCompensation` | Compose intelligent-compensation message for ADR-0016 §6.bis | Claude Haiku 4.5 | Claude Sonnet 4.6 | **light PII** (customer first name only) |
| `classifyCustomerIntent` | Bot router for ADR-0017 — what does the customer want? | Claude Haiku 4.5 | Claude Sonnet 4.6 | **PII** (customer phone + message) |
| `composeBotReply` | Generate the bot's actual reply | Claude Sonnet 4.6 | Claude Haiku 4.5 | **PII** (full conversation context) |

**Why these tasks, not more granular API methods:** each row is a *business operation*. The model choice, prompt template, retry budget, and DSGVO routing are all bound at the task level. Consumers cannot accidentally call a generic `gateway.openai.chat.completions(...)` because it does not exist.

### 3. Cost tracking — every call accounted, every budget enforced

Every call writes a row to `ai_calls` in the same DB transaction as the business-side effect it powers (where applicable; standalone calls write standalone rows):

```sql
CREATE TABLE ai_calls (
  id              BIGSERIAL    PRIMARY KEY,
  task            TEXT         NOT NULL,        -- 'extractKycFields' etc.
  provider        TEXT         NOT NULL,        -- 'openai' | 'anthropic' | 'photoroom' | ...
  model           TEXT         NOT NULL,        -- 'gpt-4o-mini' | 'claude-sonnet-4-6' | ...
  input_tokens    INTEGER      NOT NULL DEFAULT 0,
  output_tokens   INTEGER      NOT NULL DEFAULT 0,
  cost_eur        NUMERIC(12,6) NOT NULL,       -- 6 dp to capture sub-cent embedding calls
  duration_ms     INTEGER      NOT NULL,
  status          TEXT         NOT NULL,        -- 'ok' | 'rate_limited' | 'timeout' | 'budget_exceeded' | 'circuit_open' | 'error'
  error_class     TEXT,                         -- null on ok
  idempotency_key TEXT,                         -- nullable; populated for cacheable tasks
  cache_hit       BOOLEAN      NOT NULL DEFAULT FALSE,
  consumer_ref    JSONB,                        -- e.g. {intake_session_id: '...'} for traceability
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_calls_task_day     ON ai_calls (task, berlin_business_day(created_at));
CREATE INDEX idx_ai_calls_provider_day ON ai_calls (provider, berlin_business_day(created_at));
```

**Budget enforcement** runs per (task, day). Configured in `system_settings`:

```sql
INSERT INTO system_settings (key, value) VALUES
  ('ai_budget.daily_eur.total',                          '50.00'),
  ('ai_budget.daily_eur.task.extractItemAttributes',     '20.00'),
  ('ai_budget.daily_eur.task.writeGermanProductDescription', '15.00'),
  ('ai_budget.daily_eur.task.embedProduct',              '2.00'),
  -- ...
  ('ai_budget.alert_threshold_pct',                      '80'),
  ('ai_budget.hard_stop_threshold_pct',                  '110');
```

Before each call, the gateway:

1. Queries today's spend for this task: `SELECT SUM(cost_eur) FROM ai_calls WHERE task = $1 AND berlin_business_day(created_at) = berlin_business_day(now())`.
2. If `spend >= budget * 0.80` → emit `alert.ai_budget_threshold` ledger event (once per task per day).
3. If `spend >= budget * 1.10` → throw `BudgetExceededError`, the call is **not made**. The consumer receives a typed error and must decide whether to skip or escalate (e.g. ADMIN override via Control Desktop sets `ai_budget.hard_stop_threshold_pct` higher for the day).

The 10% over-budget grace exists because aborting mid-pipeline (Intake Pipeline halfway through processing a customer's items) is worse than blowing the budget by €5. The hard stop catches runaway loops.

### 4. Multi-provider fallback — explicit table, no implicit magic

The fallback table lives in `policies/dsgvoMatrix.ts` and is reviewed in every PR that touches it:

```ts
export const FALLBACK_MATRIX: Record<TaskName, FallbackChain> = {
  extractKycFields: [
    { provider: 'openai',    model: 'gpt-4o-mini',     reason: 'primary'  },
    { provider: 'anthropic', model: 'claude-sonnet-4-6', reason: 'failover_on_rate_limit_or_timeout' },
  ],
  writeGermanProductDescription: [
    { provider: 'anthropic', model: 'claude-sonnet-4-6', reason: 'primary' },
    { provider: 'anthropic', model: 'claude-haiku-4-5',  reason: 'degraded_quality_acceptable_for_marketing_copy' },
  ],
  embedProduct: [
    { provider: 'openai', model: 'text-embedding-3-large', reason: 'primary' },
    // No fallback: embedding dimensions are provider-locked; cross-vendor would break the index.
  ],
  // ...
};
```

The retry/fallback executor walks the chain:

1. Attempt step 1 with retry policy (3 attempts, exponential backoff 200ms → 800ms → 3200ms, jitter ±25%).
2. On exhaustion → emit `ai.fallback.engaged` ledger event, attempt step 2 with its own retry budget.
3. On exhaustion of the chain → throw typed `ProviderExhaustedError`. Consumer decides what to do (Intake Pipeline degrades; bot escalates to human).

**No silent fallback.** Every fallback engagement is observable, alertable, and recorded.

### 5. Idempotency cache — Redis-backed, content-addressed

For tasks where identical inputs deterministically produce equivalent outputs (`embedProduct`, `extractItemAttributes` on the same image, etc.), the gateway computes an idempotency key:

```
idempotency_key = sha256(task_name || sorted_input_canonical_form)
```

Cache lookup hits Redis with the key. On hit, the gateway returns the cached response and writes an `ai_calls` row with `cache_hit=true, cost_eur=0`. TTL per task:

| Task | TTL | Reasoning |
|---|---|---|
| `extractKycFields` | **none — never cached** | PII regulatory: do not retain |
| `extractItemAttributes` | 7 days | the image and item are immutable; re-running the same intake won't change facts |
| `removeBackground` | 30 days | output is deterministic for a given input image |
| `embedProduct` | **indefinite** | embedding is a pure function of input; the cache row may be evicted under memory pressure but never proactively expired |
| `embedQuery` | 24 hours | customer queries vary; long-tail repeat is low |
| `writeGermanProductDescription` | 7 days | regenerating gives slightly different copy each time — cache to ensure consistency on retries |
| `composeBotReply` | **never cached** | conversational, context-dependent |

The cache is **strictly an optimization**. The system functions correctly with cache disabled (a Redis outage degrades cost, not correctness).

### 6. Retry, timeout, circuit breaker

| Concern | Policy |
|---|---|
| Per-call timeout | 30 s default; configurable per task (KYC OCR is 60 s because Vision is slow; embedding is 10 s) |
| Retry | 3 attempts on transient errors (429, 5xx, network). Exponential backoff with jitter. Non-transient errors (400, 401, 422) do **not** retry. |
| Circuit breaker | Per `(provider, task)`. Opens after 5 consecutive failures within 60 s. Stays open 30 s. Half-open allows one probe before closing. While open, the gateway skips to the fallback provider immediately (no retry delay). |
| Bulkhead | Per-provider concurrency limit — OpenAI 20 concurrent, Anthropic 15, Photoroom 5. Prevents a slow provider from starving healthy ones. |

Circuit-breaker state is in-process (per worker). For multi-worker deployment, each worker tracks independently — this is intentional: a network partition affecting one worker should not trip the breaker for others.

### 7. DSGVO posture — explicit data-class declaration per task

Every task declares its data class at registration time:

```ts
defineTask('extractKycFields', {
  dataClass: 'PII_DOCUMENT',
  endpoints: {
    openai:    'https://eu.api.openai.com/v1/chat/completions',     // EU endpoint (Azure-backed)
    anthropic: 'https://api.anthropic.com/v1/messages',             // primary EU routing per Anthropic contract
  },
  retention: 'none',                                                 // do not cache; do not log payloads
  redactInLogs: ['image_base64', 'fields'],
});

defineTask('writeGermanProductDescription', {
  dataClass: 'NON_PII_COMMERCIAL',
  endpoints: { anthropic: '...' },
  retention: 'cache_7d',
  redactInLogs: [],
});
```

The gateway's log writer **enforces redaction at the log boundary** — any field listed in `redactInLogs` is replaced with `[REDACTED]` before any log line, audit row, or stack trace is emitted. The application code can never accidentally log raw KYC data through this channel.

The `dataClass` is also surfaced to Control Desktop as a "where does customer data flow?" report — answers the auditor's DSGVO §30 (Records of Processing Activities) question with a one-click export.

### 8. Test mode — deterministic stubs from fixtures

In test environments (`NODE_ENV=test` or `GATEWAY_MODE=fixtures`), the gateway swaps every provider for a stub that:

1. Computes the idempotency key.
2. Looks up `tests/fixtures/{task}/{key}.json`.
3. Returns the fixture or throws `MissingFixtureError` with a clear message including the key and the command to capture a new fixture from a real call.

Fixtures are captured by running tests in `GATEWAY_MODE=record` against real providers, frozen, committed. This gives:

- Deterministic CI (no provider flakes break the build).
- Cost-free CI (no calls to paid APIs).
- Reviewable AI behavior — fixture diffs in PRs show how prompt changes affect output.

### 9. Streaming support — for tasks that benefit, by explicit opt-in

Tasks that produce long output (`writeGermanProductDescription`, `composeBotReply`) expose a streaming variant:

```ts
const stream = await gateway.tasks.composeBotReply.stream({ messages, customerContext });
for await (const chunk of stream) {
  // forward to SSE / WhatsApp incremental message
}
```

Only the consumer chooses to stream; the non-streaming default returns the complete result. Streaming uses Server-Sent Events from provider to gateway to consumer; the cost row is written on stream completion, not on first byte.

### 10. Observability — every signal Prometheus-scraped

Per-task metrics emitted:

```
ai_calls_total{task,provider,status}
ai_call_duration_seconds{task,provider}    (histogram)
ai_call_cost_eur{task,provider}            (counter)
ai_budget_remaining_eur{task,scope=daily}  (gauge — for dashboards and alerts)
ai_cache_hit_ratio{task}                   (gauge)
ai_circuit_breaker_state{task,provider}    (0=closed, 1=half_open, 2=open)
ai_fallback_engaged_total{task,from_provider,to_provider}
```

Grafana dashboards (per ADR-0012 §6): cost-per-day per task, fallback frequency, p95 latency, cache hit rate, budget burn rate. Alerts on budget at 80% / 100% / 110%, circuit breaker open >5 min, cache hit rate <50% on cacheable tasks.

## Schema sketch — `ai_calls` and the budget config

Already shown in §3. Restated: one append-only `ai_calls` table (writes pass through the role grants from ADR-0008 — `INSERT, SELECT` only, no UPDATE/DELETE), one `system_settings` namespace for budget config.

## Consequences

**Positive:**
- Single point to swap providers, change prompts, rotate keys, enforce budgets, control PII flow. The gateway is the contract.
- Every euro spent on AI is in `ai_calls` and visible in Control Desktop. Budget surprises become budget alerts.
- DSGVO posture is declarative, not aspirational. Each task says where its data goes; the gateway routes accordingly; the redaction-in-logs is enforced.
- Tests don't pay AI bills and don't flake on provider outages.
- Fallback chains are documented in code, reviewed in PRs, alerted when engaged. Operational transparency.

**Negative:**
- Yet another abstraction layer between business code and providers. We accept this — the leverage is enormous.
- Adding a new task requires touching the gateway. We accept this — it's the choke point that makes the cost/DSGVO/fallback discipline work.
- Fixture maintenance: as prompts evolve, fixtures need re-recording. A `pnpm capture-fixtures <taskName>` command makes this one command. Acceptable overhead.
- Circuit breaker state is per-process; a slow provider can take longer to be globally noticed across workers. Acceptable at single-VM scale; revisit when sharding.

**Mitigations:**
- Adding a new task is a 3-file PR (task file, provider call, fixtures). Templated via `pnpm gateway:scaffold-task <name>`.
- The DSGVO export ("where does customer data flow?") is one Bash command away and lives in `apps/admin-web` for ADMIN self-service.
- Fallback engagement metrics are alerted on so a slow degradation doesn't go unnoticed.

## Alternatives considered

- **Direct SDK imports across the codebase.** Rejected; explained at length in Context. The leverage of centralization outweighs the abstraction overhead by an order of magnitude.
- **Generic "LLM router" library (LangChain, LlamaIndex).** Rejected. These libraries impose their own abstractions (agents, chains, memory) that conflict with our task-level model. We need ~1000 lines of focused gateway code, not 50,000 lines of generic framework.
- **Per-task package** (`@warehouse14/openai-kyc`, `@warehouse14/claude-marketing`, etc.). Rejected; defeats the centralization goal — cost tracking and DSGVO matrix scatter across packages again.
- **Run our own OpenAI-API-compatible router** (LiteLLM, OpenRouter, etc.) and have the gateway call that. Rejected for V1; adds a network hop, a third-party dependency, and complicates DSGVO routing. Revisit if we ever need to dynamic-route at runtime based on cost.
- **Stream all calls** (eager streaming). Rejected; for short outputs streaming adds complexity (chunk reassembly, retry-mid-stream) without UX benefit. Streaming is opt-in.
- **Per-call cost ceiling instead of per-task daily budget.** Rejected as the *only* mechanism — a runaway loop calling a cheap task 100,000 times is not caught by a per-call ceiling. Daily budget catches it within minutes.

## Known limits & deferred decisions

1. **Per-call cost ceilings.** Not in V1. Add when we see a use case for high-stake one-shot calls (e.g. a $5 OpenAI o1 call to triage an ambiguous KYC scan).
2. **Per-customer or per-shop budget allocation.** Single shop V1; the budget is global. Multi-shop adds `shop_id` to `ai_calls` and per-shop budgets in `system_settings`.
3. **Model-specific cost tables.** Hardcoded today in `core/budget.ts` against a manually-maintained price list. When providers add models we update the list. A future "auto-update prices from provider pricing pages" worker is overkill until we have ≥10 active models.
4. **Real-time streaming embeddings.** OpenAI's embedding API isn't streaming. Not a limit per se, but noted.
5. **Caching policy for the customer-service bot conversation.** `composeBotReply` is uncached today; if response latency becomes a concern we may cache the last assistant turn keyed on the conversation hash, with short TTL.
6. **Provider-side data-retention guarantees.** We trust the OpenAI/Anthropic EU contracts; we do not verify them cryptographically. If a future regulator demands proof, we may need to add on-premise model serving (vLLM + open-weights model on a separate Oracle VM) for the most sensitive tasks.

## References

- ADR-0008 — Schema; the `ai_calls` audit table and the `system_settings` budget keys
- ADR-0014 — Live Ops; budget threshold alerts flow through this transport
- ADR-0015 — Intake Pipeline (first heavy consumer; defined in the next ADR)
- ADR-0016 §6.bis — Walk-in compensation (uses `embedProduct` + `composeWalkInCompensation`)
- ADR-0017 (pending) — Customer Service Bot (will use `classifyCustomerIntent`, `composeBotReply`)
- OpenAI EU data residency — https://openai.com/policies/eu-data-residency
- Anthropic EU operations — https://www.anthropic.com/legal/eu-rep
- Photoroom API — https://www.photoroom.com/api
- `docs/memory.md` §2 #34, §4 (AI providers table)
