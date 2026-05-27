# ADR-0017 — WhatsApp customer service bot: Claude-backed intent routing, six narrow tools, graceful human handoff, GDPR-aware retention

- **Status:** Proposed (pending Basel review)
- **Date:** 2026-05-23
- **Deciders:** Basel, Claude
- **Related:** ADR-0010 (every LLM call routes through `@warehouse14/ai-gateway`), ADR-0014 (Inbox panel in Control Desktop receives handoffs via SSE), ADR-0015 (intake pipeline runs on the *other* WhatsApp number — different webhook, different lifecycle), ADR-0016 (bot's inventory search calls into the lock's read-only views), ADR-0019 (Inbox panel + Attention Router surface conversations + handoff requests), ADR-0020 (bot can book appointments via the `book()` function), `docs/memory.md` §2 #34, §3 (KYC + GwG).

## Context

The Customer Service Bot is the public face of Warehouse14 outside the storefront. Customers send WhatsApp messages to a published number; the bot answers most inquiries (inventory, prices, hours, basic Q&A); when it cannot — or when the customer prefers a human — the conversation hands off cleanly to Basel or a staff member via Control Desktop's Inbox panel.

The design must be ruthless on two axes:

1. **Honesty about what AI can and cannot decide.** The bot will never quote a price the system isn't sure of, never accept a complaint without escalation, never finalize a sale, never touch KYC. The narrow tool catalog reflects this discipline.
2. **Customer experience.** A bot that frustrates customers is worse than no bot. We measure handoff rate, resolution rate, and customer satisfaction signals; if the bot falls below thresholds, we tune (or temporarily disable in favor of human-only) without redeploys.

Constraints:

1. **Separate WhatsApp number from intake** (ADR-0015 §1). This is the *public* number, Meta-Business-Verified with display name "Warehouse14".
2. **Meta-approved templates for outbound** outside the 24-hour conversation window. Free-form replies allowed inside the window.
3. **GDPR** — conversation transcripts are PII (customer phone + chat content). Storage encrypted at rest, 5-year retention with right-to-erasure honored on request.
4. **Cost ceiling per conversation** — runaway tool-calling loops would burn the AI gateway budget. Hard cap at €0.50 per conversation per day; conversation pauses with human-handoff escalation when reached.
5. **Bot transparency** — every bot message identifies itself ("🤖 Warehouse14 Assistant"). German regulatory + Meta guidelines require this and the customer deserves it.
6. **Sentiment-aware escalation** — frustration, complaint, or negative sentiment auto-escalates to human.
7. **24-hour window discipline** — outbound outside the window is template-only; the UI surfaces this constraint clearly to the human operator during handoff.

## Decision

### 1. Architecture — one inbound webhook, one bot orchestrator, six narrow tools, one handoff path

```
                  WhatsApp customer (public number)
                              │
                              ▼  inbound message
            POST /webhooks/whatsapp/customer-service
                              │
                              ▼
                    ┌───────────────────┐
                    │  bot_orchestrator │  ◄── one Tauri-managed process / API endpoint
                    └─────────┬─────────┘
                              │
                       ┌──────┴──────┐
                       │             │
                       ▼             ▼
              gateway.tasks    conversations table
              .classifyIntent  (load history)
                       │             │
                       └──────┬──────┘
                              │
                              ▼  intent + history + customer context
                    ┌───────────────────┐
                    │   tool router     │
                    └─────────┬─────────┘
                              │
        ┌─────────┬───────────┼────────────┬───────────┬──────────────┐
        ▼         ▼           ▼            ▼           ▼              ▼
  search_     get_item_   estimate_   book_       check_        escalate_
  inventory   details     buyback_    appointment order_         to_human
                          price                   status
        │         │           │            │           │              │
        └─────────┴───────────┼────────────┴───────────┘              │
                              ▼                                       ▼
                    gateway.tasks.composeBotReply              Control Desktop
                              │                                Inbox panel (SSE)
                              ▼
                       outbound WhatsApp                         Human takes over
```

The orchestrator is a single Fastify route handler. Its only state is the per-message conversation context (loaded from DB on each inbound). No long-lived bot agent process; each message is a stateless function call.

### 2. The six tools — narrow by design

```ts
// packages/customer-bot/src/tools/index.ts
export const BOT_TOOLS = [
  {
    name: 'search_inventory',
    description: 'Semantic search across AVAILABLE products. Returns up to 5 best matches with name, price, photo URL, brief description.',
    schema: z.object({ query: z.string().min(2).max(200), max_results: z.number().int().min(1).max(5).default(5) }),
  },
  {
    name: 'get_item_details',
    description: 'Full details of a single product including photos, weight, hallmark, condition, and any provenance notes.',
    schema: z.object({ product_id: z.string().uuid() }),
  },
  {
    name: 'estimate_buyback_price',
    description: 'Estimate the price the shop would pay for a customer-described item (Ankauf). Returns a price band, NEVER a final number. Always says "subject to physical evaluation."',
    schema: z.object({
      metal: z.enum(['gold', 'silver', 'platinum']),
      karat: z.string().optional(),                                   // e.g. '585', '750'; null = unknown
      weight_grams_estimated: z.number().positive().optional(),
      description: z.string().max(500),                               // free-form from customer ("I have a ring my grandmother left me")
    }),
  },
  {
    name: 'book_appointment',
    description: 'Book a viewing/buyback/consultation appointment. Uses the canonical book() function from packages/appointments.',
    schema: z.object({
      appointment_type: z.enum(['VIEWING', 'BUYBACK_EVAL', 'CONSULTATION']),
      starts_at: z.string().datetime(),
      duration_minutes: z.number().int().positive().optional(),
      customer_phone: z.string(),
      customer_name: z.string(),
      linked_product_ids: z.array(z.string().uuid()).optional(),
      customer_notes: z.string().max(500).optional(),
    }),
  },
  {
    name: 'check_order_status',
    description: 'Look up a customer storefront order by order ID or by the phone number on file. Returns status (placed / paid / ready / picked up / shipped) and ETA.',
    schema: z.object({ order_id: z.string().uuid().optional(), phone_e164: z.string().optional() }),
  },
  {
    name: 'get_appointment_status',
    description: 'Read-only lookup of an existing appointment by ID or by the customer phone. Returns state, slot time, staff name, linked items. Does NOT modify the appointment in any way — for cancel/reschedule/modify, use escalate_to_human(reason="appointment_modification").',
    schema: z.object({ appointment_id: z.string().uuid().optional(), phone_e164: z.string().optional() }),
  },
  {
    name: 'escalate_to_human',
    description: 'Hand the conversation to a human (Basel or a staff member with INBOX_HANDLER role). Provides a structured reason and a one-paragraph summary of the conversation so far.',
    schema: z.object({
      reason: z.enum(['complaint','price_negotiation','high_value_enquiry','legal_question','sensitive_topic','customer_requested','low_confidence','sentiment_negative','cost_ceiling_reached','appointment_modification','language_not_supported']),
      conversation_summary: z.string().max(500),
    }),
  },
] as const;
```

#### Seven things the bot **cannot** do

These are deliberately not in the tool catalog and the system prompt enforces them:

| Forbidden | Why |
|---|---|
| Modify product prices | Pricing discipline — only ADMIN |
| Issue personal discount offers | Same |
| **Negotiate / haggle (Mukasara)** — accept, counter, or even acknowledge a customer's lower price offer | Per Basel's directive 2026-05-23. The luxury / precious-metals customer experience is built on trust in marked prices; a bot that negotiates erodes it. **Any customer message of the shape "would you take €X" / "is the price negotiable" / "can you do better" → polite apology + immediate `escalate_to_human(reason='price_negotiation')`.** The system prompt blocks all four common haggling response patterns explicitly. |
| Complete a sale / take payment | PCI scope + KYC + TSE all require the POS or storefront flow |
| Discuss customer complaints in detail | Escalate immediately to a human; bot acknowledges + escalates |
| Collect or verify KYC documents | Capture is a manual cashier flow with §25c / §25a discipline |
| Answer legal/tax/regulatory questions | "I'm not qualified to answer that — let me get Basel" + escalate |

#### Appointment operations — read-OK, modify-escalate

Per Basel's directive 2026-05-23, appointment-related tool usage is **split** to prevent customers from manipulating the schedule via bot:

| Operation | Allowed for bot? | Mechanism |
|---|---|---|
| **Read** appointment status ("Is my appointment for Saturday still confirmed?") | ✅ Yes | New tool `get_appointment_status` (read-only — returns: state, slot, staff name, linked items) |
| **Confirm** an existing booking (customer replies "CONFIRM" to a reminder) | ✅ Yes | The bot already handles this via the reminder lifecycle (ADR-0020 §7) — recording a customer-side confirmation is a state-machine read on existing data, not a new booking |
| **Book a new** appointment | ✅ Yes | `book_appointment` tool — canonical `book()` from ADR-0020 |
| **Cancel** an appointment | ❌ No — escalate | `escalate_to_human(reason='appointment_modification')`. Cancellations cascade through soft holds + customer notifications + slot release; a bot-initiated cancel that lands wrong is hard to reverse. ADMIN signs off. |
| **Reschedule** an appointment | ❌ No — escalate | Same rationale. The customer drives the request; a human commits the change. |
| **Modify** linked items (add/remove from VIEWING) | ❌ No — escalate | Same. ADMIN reviews. |

The tool catalog is updated to add **`get_appointment_status`** and explicitly **does not** include cancel/reschedule/modify operations. The system prompt also includes: *"If the customer asks you to cancel or change an existing appointment, acknowledge briefly and use `escalate_to_human(reason='appointment_modification')`. Do not attempt to handle these requests."*

### 3. Intent classification — Claude Haiku for cheap routing

Every inbound non-trivial message hits `gateway.tasks.classifyCustomerIntent` (cheap Haiku-tier task per ADR-0010):

```ts
// gateway.tasks.classifyCustomerIntent input/output
type Input = {
  message_text: string;
  recent_conversation: { role: 'customer' | 'bot' | 'human'; content: string; sent_at: Date }[];  // last 6 turns
  known_customer_context?: { name?, last_purchase?, language? };
};

type Output = {
  primary_intent: 'product_search' | 'item_details_question' | 'price_inquiry' | 'buyback_request' | 'appointment_booking' | 'order_status' | 'general_q' | 'complaint' | 'compliment' | 'goodbye';
  confidence: number;                       // 0..1
  language_detected: 'de' | 'en' | 'fr' | 'ar' | 'tr' | 'other';
  sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated';
  contains_pii: boolean;
  suggested_tools: string[];                // hint for the orchestrator
};
```

The orchestrator uses this output to route:

- `confidence < 0.7` → `escalate_to_human(reason='low_confidence')`
- `sentiment in ('negative', 'frustrated')` → `escalate_to_human(reason='sentiment_negative')`
- `primary_intent='complaint'` → escalate immediately (do not attempt to resolve)
- `primary_intent='price_inquiry'` AND amount appears > €2000 → escalate (`reason='high_value_enquiry'`)
- otherwise → call appropriate tools per `suggested_tools`, then `composeBotReply`

### 4. Reply composition — Claude Sonnet for quality, with the catalog as ground truth

The orchestrator gathers tool outputs, then calls `gateway.tasks.composeBotReply`:

```ts
type Input = {
  conversation: ConversationTurn[];
  tool_outputs: { tool: string; result: unknown }[];
  customer_language: 'de' | 'en' | 'fr' | 'ar' | 'tr';   // bot replies in customer's language
  shop_voice: { ... };                                   // persona constants (warm, knowledgeable, never pushy)
  signature: '🤖 Warehouse14 Assistant';                  // appended automatically
};
```

The system prompt enforces:

- **Never hallucinate inventory.** If `search_inventory` returned no results, say so + offer to escalate or take a callback request.
- **Never quote a final price.** Only ranges. Always "subject to physical evaluation" for buyback.
- **Always include the bot signature** on every outbound message.
- **Use the customer's language** as detected by `classifyCustomerIntent`. DE primary; EN/FR/AR/TR fallback.
- **Tone:** warm but not over-friendly; expert but not condescending; brief but not curt.
- **Never claim to be human.** If asked "Are you a bot?", answer truthfully.

### 5. Human handoff — clean, contextual, reversible

When `escalate_to_human` fires (either from confidence/sentiment/intent or as a tool call from the LLM), the orchestrator:

1. Sets `whatsapp_conversations.state = 'human_engaged'` and records the trigger.
2. Stops the bot from auto-replying on future inbound from this conversation until the human re-opens auto-reply or marks the conversation closed.
3. Pushes the conversation to the Bridge **Inbox panel** (ADR-0019) with severity `high` and a structured summary (the conversation_summary parameter from the tool call).
4. Sends an immediate acknowledgement to the customer (template if outside 24h window): *"I'll get Basel to take this — he'll reply shortly. Thanks for your patience."*
5. Emits `ledger_events` row `conversation.handoff_to_human` with the trigger reason.

The Inbox panel shows the full transcript, the bot's tool calls, the customer's profile (if linked), and any recent transactions. The human replies from the Inbox; replies are dispatched via WhatsApp API under one of two personas, with a toggle in the Inbox UI:

- **Default: "Basel" persona** (per Basel's directive 2026-05-23). Luxury / precious-metals customers expect a *personal touch* — when the human picks up the conversation, the customer sees the message arrive without the bot signature and with a tone that signals "the owner is personally engaged." Replies under this persona omit the bot's `🤖 Warehouse14 Assistant` footer and replace it with the human's own sign-off (e.g. *"— Basel"* or the staff member's name if delegated).
- **Toggle: "Warehouse14 Assistant" persona.** For routine inquiries that a staff member handles in volume, the assistant persona is appropriate (and avoids customers thinking Basel personally typed 47 reply messages today). Toggle is a single click in the Inbox composer; setting persists per-conversation thread.

When the conversation later resumes bot-side auto-reply (after the human marks `resolved`), the bot signature returns. The transition is silent — the customer simply notices the next message has the bot footer back.

The persona choice is captured in each `whatsapp_messages.sender_role` value: `'human:basel'` vs `'human:assistant:basel'` for the same physical sender — this gives us a clean audit trail of *who appeared to send what*, distinct from *who actually clicked send*. Both are recorded for forensic purposes.

**Bot continues to listen but does not reply.** If the human goes idle (no reply for 5+ minutes) and the customer sends a new message, the orchestrator sends a template: *"Mr. Basel is reviewing — he'll respond shortly."* If the human idle exceeds 30 minutes, the conversation surfaces in the Control Desktop as a `high` alert.

The human marks the conversation `resolved` when done; the bot resumes auto-reply for subsequent messages.

### 6. 24-hour WhatsApp conversation window — discipline at the dispatcher

```ts
// packages/customer-bot/src/dispatch/sendOutbound.ts
export async function sendOutbound(conversation: Conversation, body: string, opts: {
  template_id?: string;        // required if outside window
  free_form_text?: string;     // required if inside window
}) {
  const now = new Date();
  const lastInbound = conversation.lastInboundAt;
  const insideWindow = lastInbound && (now.getTime() - lastInbound.getTime() < 24 * 3600 * 1000);

  if (insideWindow) {
    // Free-form text allowed
    return whatsapp.sendText({
      to: conversation.customerPhone,
      body: opts.free_form_text ?? body,
    });
  } else {
    // Window closed — must use a pre-approved template
    if (!opts.template_id) {
      throw new OutsideWhatsAppWindowError(
        'Outbound message attempted outside the 24-hour window without a template. ' +
        'Either send a pre-approved template, or wait for a customer-initiated message.'
      );
    }
    return whatsapp.sendTemplate({
      to: conversation.customerPhone,
      template_name: opts.template_id,
      language: conversation.customerLanguage,
    });
  }
}
```

The Control Desktop Inbox displays the **window timer** prominently for every conversation: *"23h 12m remaining in conversation window."* When the window closes, the reply box switches from free-form text to a template picker.

### 7. Templates pre-approved with Meta — registered during Phase 1 onboarding

V1 templates (each registered in DE + EN + AR; FR + TR are Phase 1.5 additions):

```
welcome_first_message_v1
handoff_acknowledgement_v1
"appointment_booked_confirmation_v1" (also used by ADR-0020)
appointment_reminder_2h_v1
appointment_no_show_followup_v1
out_of_hours_acknowledgement_v1
escalation_in_progress_v1
buyback_quote_followup_v1
order_ready_for_pickup_v1
order_shipped_v1
generic_re_engagement_v1                // careful — Meta restricts re-engagement templates
quote_apology_v1                        // unique-item-sold compensation (used by ADR-0016 §6.bis as `appointment_item_replaced_v1` variant)
```

Each template is reviewed by Basel + Steuerberater for legal accuracy (no implicit promises of price, no warranty claims, etc.) before submission to Meta.

### 8. GDPR — conversation storage, retention, erasure

```sql
-- The two storage tables are introduced in migration 0007_customers_kyc.sql (per ADR-0008 §9)
-- because customers and conversations are conceptually adjacent.

CREATE TABLE whatsapp_conversations (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_phone_e164 TEXT         NOT NULL,
  customer_id         UUID         REFERENCES customers(id),         -- linked if we recognize the phone
  customer_language   CHAR(2)      NOT NULL DEFAULT 'de',
  channel             TEXT         NOT NULL DEFAULT 'customer_service',
  state               TEXT         NOT NULL DEFAULT 'bot_active',    -- 'bot_active'|'human_engaged'|'closed'|'window_closed'
  last_inbound_at     TIMESTAMPTZ,
  last_outbound_at    TIMESTAMPTZ,
  -- GDPR retention
  retention_until     DATE         NOT NULL DEFAULT (now() + INTERVAL '5 years'),
  erasure_requested_at TIMESTAMPTZ,
  erasure_completed_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE whatsapp_messages (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id       UUID         NOT NULL REFERENCES whatsapp_conversations(id),
  whatsapp_message_id   TEXT         NOT NULL UNIQUE,                 -- Meta's wamid
  direction             TEXT         NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender_role           TEXT         NOT NULL,                        -- 'customer'|'bot'|'human:<user_id>'
  body_encrypted        BYTEA,                                        -- pgcrypto-encrypted body
  body_redacted_for_logs TEXT,                                        -- "[redacted PII]" placeholder for non-secure logs
  media_r2_key          TEXT,
  ai_metadata           JSONB,                                        -- classify output, tool calls, model, cost
  sent_at               TIMESTAMPTZ  NOT NULL,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_whatsapp_msgs_conversation ON whatsapp_messages (conversation_id, sent_at);
```

**Encryption at rest:** message bodies encrypted column-level via `pgcrypto` with the key in Oracle Vault (same key as KYC data; per ADR-0008 §5). The encryption is for storage-leak protection — the application decrypts on read with `warehouse14_app` role.

**Retention:** 5 years (regulatory recommendation for German B2C correspondence). After expiry, a worker job purges (deletes the rows; this is one of the few legal `DELETE` paths — the ledger event from the day of erasure proves what was removed).

**Right to erasure (DSGVO Art. 17):** customer asks to be forgotten → ADMIN initiates from Control Desktop → all conversations + messages + linked customer record either anonymized (keep transaction records under §147 AO, but replace PII with `[erased]`) or hard-deleted (where law permits, e.g. no transaction record). Erasure executes within 30 days of request per regulation.

### 9. Cost ceiling per conversation per day — €0.50 hard cap

The bot's cost budget is monitored by the AI gateway (ADR-0010 §3). For the customer service flow specifically:

```sql
-- system_settings
('cs_bot.per_conversation_daily_cost_cap_eur', '0.50')
```

Before each LLM call, the orchestrator sums today's `ai_calls.cost_eur WHERE consumer_ref ->> 'conversation_id' = X`. If the total approaches the cap, the bot escalates to a human: *"I want to make sure I'm being helpful — let me get a teammate to continue this with you."* Human takeover doesn't carry the cost ceiling. Runaway tool-calling loops are bounded at ~€0.50 cost per conversation per day.

### 10. Bot signature transparency

Every outbound bot message ends with the signature:

> 🤖 Warehouse14 Assistant — Basel ist nicht selbst am Apparat. Falls Sie mit Basel sprechen möchten, schreiben Sie einfach "Basel".

(German default; EN/FR/AR/TR templates have the equivalent wording.)

This is both a Meta WhatsApp Business policy requirement and a customer-trust foundation. Conversations that begin with the bot can be promoted to "Basel directly" with a single keyword.

### 11. Sentiment-driven auto-escalation

The intent classifier returns `sentiment`. Negative or frustrated sentiment for **two consecutive turns** triggers `escalate_to_human(reason='sentiment_negative')` even if confidence is otherwise high. The threshold (two consecutive vs one) is tuned via `system_settings.cs_bot.negative_sentiment_escalation_turns` (default 2, range 1-5).

### 12. Multilingual support — DE + EN + AR for V1 (locked); TR + FR Phase 1.5; RU Phase 2

Per Basel's directive 2026-05-23, V1 ships with **exactly three languages**: German, English, Arabic. Adding more languages would block launch on Meta's template-approval queue (24-72h per template per language) and is not justified by Phase 1 customer-base evidence.

| Language | Status | Trigger for next phase |
|---|---|---|
| **German (de)** | V1 primary — locked | All system prompts, templates, error fallbacks. The shop's location language. |
| **English (en)** | V1 — locked | Customer-language auto-detect; all V1 templates registered with Meta. |
| **Arabic (ar)** | V1 — locked | All V1 templates registered with Meta in Arabic; Basel's own native language for QA. |
| French (fr) | **Phase 1.5** — explicitly deferred | Activated after Q1 storefront analytics show ≥5% French-language inbound. Templates pre-drafted but not submitted to Meta until trigger. |
| Turkish (tr) | **Phase 1.5** — explicitly deferred | Same trigger. Weil am Rhein has Turkish-speaking community; we monitor demand before front-loading template registration. |
| Russian (ru) | Phase 2 | Lowest demographic indicator; revisit after Phase 1 data. |

If a customer writes to the bot in a not-yet-supported language (FR, TR, RU, etc.) in V1, the bot:

1. Detects the language via `classifyCustomerIntent.language_detected`.
2. Replies in **German** (shop default) with a polite acknowledgement that the bot speaks DE/EN/AR.
3. Escalates to a human (`reason='language_not_supported'` — a new escalation reason added to the enum) so Basel can engage manually if he speaks the language.

This is honest: we do not pretend to multi-language support we have not yet built, and the customer is not left talking to a confused bot.

### 13. Bot-vs-human handoff: the inverse direction

A human can also explicitly hand a conversation **back** to the bot ("I've answered the urgent part, the bot can take it from here"). UI action in the Inbox panel toggles `state = 'bot_active'`; subsequent inbound goes through the bot. This is the closing-the-loop flow.

## Consequences

**Positive:**
- Customers get instant responses 24/7 for common questions; the bot handles the volume the owner couldn't possibly answer manually.
- Six narrow tools + six explicit refusals make the bot behavior predictable; no surprise hallucinations.
- Human handoff is clean, contextual, and reversible — the bot is an extension of the human, not a replacement.
- Cost ceiling per conversation prevents runaway billing from a stuck loop.
- GDPR is encoded in the schema: encryption, retention, erasure all have clear paths.
- Sentiment + confidence routing means the bot does not insist on resolving conversations it shouldn't be touching.

**Negative:**
- Meta's WhatsApp Business templates require pre-approval; rejecting templates can take days. Mitigation: front-load template registration during Phase 1 onboarding.
- Per-conversation cost ceiling is a coarse instrument; a very chatty legitimate customer might hit it and trigger handoff. We accept this as a feature (better human contact than a budget blowout).
- Multilingual quality varies by Claude's training distribution. DE + EN + AR are strong; FR is acceptable; TR is fair. Phase 1.5 evaluates whether to expand.

**Mitigations:**
- Template registration is a Phase 1 checklist item with named owner (Basel) and lead time tracking.
- Conversation-cost dashboard in Control Desktop shows per-conversation spend; alerts on 80% of conversations hitting the ceiling.
- Bot quality is monitored via a daily metric: bot resolution rate (closed without human handoff). Target ≥ 60% at 3 months, ≥ 75% at 12 months.

## Alternatives considered

- **Off-the-shelf chatbot platform (ManyChat, Landbot, etc.).** Rejected. DSGVO surface; data residency outside our control; integration with inventory + appointments + payments would be a brittle middleware layer.
- **OpenAI Assistants API as the bot brain.** Rejected. Hides orchestration; debugging is opaque; provider lock-in. Our orchestrator + Claude is transparent and switchable.
- **Voice-call bot.** Rejected for V1. WhatsApp message-based is the right medium for a small shop; phone IVR adds complexity and customer friction.
- **Email bot.** Phase 2; storefront customer service may need an email fallback. Reuses most of this architecture.
- **Always-on human (no bot at all).** Rejected. Doesn't scale; misses the productivity multiplier the bot provides; customers wait too long for trivial questions.
- **More tools (e.g. let the bot create new product listings).** Rejected. The six-tool catalog is deliberate; expanding scope erodes the predictability guarantee.

## Known limits & deferred decisions

1. **No voice message transcription in V1.** Voice notes from customers are flagged for human handoff. Phase 1.5 adds Whisper.cpp transcription within the AI gateway.
2. **No proactive bot messages.** Bot only replies; it does not initiate (except via the appointment-reminder workflow from ADR-0020, which is template-driven, not bot-decision-driven).
3. **No multi-customer same-conversation logic.** WhatsApp doesn't support group conversations for business numbers in this mode.
4. **No automated upsells or cross-sells beyond what `search_inventory` naturally surfaces.** Pushy bots erode trust.
5. **No customer self-service order cancellation.** Cancellations go through human handoff. We may automate after observing patterns.
6. **No A/B testing framework for bot prompts.** V1 is one prompt; we iterate by editing. Phase 2 may add prompt versioning if we have data to evaluate.

## References

- ADR-0010 — AI gateway (`classifyCustomerIntent`, `composeBotReply`, cost ceiling enforcement)
- ADR-0014 — Inbox panel SSE delivery + handoff alerts
- ADR-0015 — Intake pipeline (different WhatsApp number; do not confuse — distinct webhook, distinct lifecycle)
- ADR-0016 — Inventory lock (bot's `search_inventory` reads from the same source of truth)
- ADR-0019 — Bridge UX (Inbox panel; bot status indicator in right rail)
- ADR-0020 — Appointment system (bot can book via canonical `book()` function)
- Meta WhatsApp Business Platform — https://developers.facebook.com/docs/whatsapp/cloud-api
- Meta WhatsApp Business Policy (24h window, templates) — https://www.whatsapp.com/legal/business-policy
- DSGVO Art. 17 (right to erasure)
- BfDI guidance on chatbots and AI in customer service
- `docs/memory.md` §2 #34, §3 (KYC + GwG facts — bot's KYC blocker)
