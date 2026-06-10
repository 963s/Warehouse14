# Warehouse14 — Security Audit (2026-06-07)

**Auditor role:** dedicated security review (authN/authZ, injection, webhooks, secrets/infra/CI, Tauri desktop, crypto/PII/GoBD-GwG).
**Method:** read-only review of real code across `apps/{api-cloud,worker,tauri-pos,control-desktop}`, `packages/*`, `infrastructure/*`, `.github/*`. No files modified.
**Context:** LIVE API at `api.warehouse14.de` (Cloudflare tunnel → docker-compose.prod.yml). Current posture is **test mode** (`TEST_DEVICE_FINGERPRINT` bypass, PIN `0000` seeded) — several findings are *acceptable now but MUST close before go-live*; those are marked **[GO-LIVE GATE]**.

## Overall verdict
The **fiscal-integrity core is genuinely strong**: ledger hash-chain (`FOR UPDATE` head, no backdating, INSERT-only grants), `SECURITY DEFINER` triggers owned by a privileged role, least-privilege DB roles, atomic finalize + idempotency, storno negation + one-storno-per-original, atomic inventory reservation, parameterized SQL everywhere, no XSS sinks in the webview, OS-keychain secrets, signed HTTPS OTA updater, helmet + strict CORS allow-list, non-root containers, internal-only Postgres/Redis. The exploitable gaps are concentrated in: **(1) a few prod-config regressions**, **(2) the GwG/AML enforcement layer being advisory not enforced**, **(3) missing auth-surface rate limiting**, and **(4) a handful of latent issues that arm themselves the moment the AI key / mTLS / Chatwoot go live.**

Severity counts: **Critical 5 · High 8 · Medium 12 · Low/Hardening 14.**

---

## CRITICAL

### C1 — better-auth may sign sessions with a public default secret (no fail-fast)
- **Where:** `apps/api-cloud/src/plugins/auth.ts:59` (`betterAuth({...})` has **no `secret:`**); `apps/api-cloud/src/config/env.ts` (no `AUTH_SECRET`/`BETTER_AUTH_SECRET` in the validated `EnvSchema` — verified absent). better-auth falls back to `process.env.AUTH_SECRET || BETTER_AUTH_SECRET || "better-auth-secret-123456789"` and in prod only logs an error, does **not** crash.
- **Impact:** If the live `.env` is missing/misnames `AUTH_SECRET`, every email/password session token is signed with a publicly known constant → an attacker forges a valid `warehouse14.session` and authenticates as any staff user, bypassing PIN + mTLS for that surface. Total auth compromise on misconfig, with zero signal.
- **Fix:** Add `AUTH_SECRET: Type.String({ minLength: 32 })` to `EnvSchema` (no default → boot fails if absent) and pass it explicitly: `betterAuth({ secret: opts.env.AUTH_SECRET, baseURL: 'https://api.warehouse14.de', ... })`. **Verify the live server's `.env` already contains a 32-byte random `AUTH_SECRET`.**

### C2 — Storefront shopper session cookie is never `Secure` in production
- **Where:** `apps/api-cloud/src/routes/storefront-auth.ts:186` and `:294` pass the literal `{ NODE_ENV: 'development' }` into `setShopperCookie()` (`:77`), whose `secure: env.NODE_ENV === 'production'` (`:87`) therefore resolves to `secure:false` **always**. The plugin isn't even registered with `env` (`app.ts` registers `storefrontAuthRoutes` with no opts).
- **Impact:** Internet-facing B2C session token (`warehouse14.shopper_session`, 32-byte bearer, 30-day TTL) is transmitted without `Secure`. Any forced `http://` request (downgrade, mixed content) leaks it in cleartext → shopper account takeover (PII, addresses, order history, cart/checkout).
- **Fix:** Make the plugin `FastifyPluginAsync<{ env: Env }>`, register it with `{ env: opts.env }`, and call `setShopperCookie(reply, token, expiresAt, opts.env)`. Consider `sameSite:'strict'` + `__Host-` prefix for this cookie. (Contrast: staff PIN-login at `auth-pin.ts:345` already forces `secure:true` correctly.)

### C3 — Sanctions screening result is never persisted → GwG block trigger can never fire
- **Where:** `apps/api-cloud/src/routes/customers-check-sanctions.ts:117` audits the outcome only; it never `UPDATE`s `customers.sanctions_match`. The DB guard `transactions_validate_sanctions` (`packages/db/migrations/0013_security_hardening.sql:75`) blocks only when `sanctions_match = TRUE`. Verified: the column is set TRUE in exactly one place — an integration test.
- **Impact:** The entire sanctions wall is decorative. A confirmed OpenSanctions hit is shown in the UI and audited, but the next ANKAUF/VERKAUF for that customer passes the trigger untouched → the shop transacts with a sanctioned party while believing it's blocked. EU/OFAC AML exposure.
- **Fix:** On `matched: true`, inside a tx: `UPDATE customers SET sanctions_match = TRUE, sanctions_screened_at = now() WHERE id = $id` (app role already has `GRANT UPDATE(sanctions_match)`, migration 0007). Set `sanctions_screened_at` on every screen; emit an `alert.sanctions_match` ledger event on a hit.

### C4 — `trust_level = 'BANNED'` does not block any transaction
- **Where:** `packages/db/migrations/0024_customer_trust_belegtext.sql` adds the `BANNED` value but **no enforcement trigger** (verified: no `BEFORE INSERT` on `transactions` references `trust_level`/`BANNED`). `customers-list.ts:87` filters BANNED out of the **picker UI only** — bypassable by sending a known `customerId` straight to `/transactions/finalize` or `/transactions/ankauf`.
- **Impact:** "Ban this seller" is cosmetic. A banned fence/fraudulent seller can still be transacted with by a cashier (or a replayed request). For a §259 StGB (Hehlerei) defense this is exactly the customer who must be refused.
- **Fix:** Add a `SECURITY DEFINER` `BEFORE INSERT` trigger on `transactions` (mirror `transactions_validate_sanctions`) that `RAISE EXCEPTION` when the referenced customer's `trust_level = 'BANNED'`. Owned by `warehouse14_security` with `GRANT SELECT(id, trust_level)`.

### C5 — Committed mTLS client private key + matching cert (working device credential)
- **Where:** `apps/api-cloud/dev-certs/dev-client.key` (2048-bit RSA) and `dev-client.crt` are **git-tracked** (not gitignored). Canonical SHA-256 fingerprint = `71defad08503fcfb00b0b57e7654b3ed48afb264d34c69c3edb90a65a6b8f698`. Consumed by `plugins/mtls.ts`; the **same fingerprint** is the dev bypass value in `apps/tauri-pos/.env.local:5` (`VITE_DEV_DEVICE_FINGERPRINT`).
- **Impact:** Anyone with the repo holds a complete device identity. It becomes a **full device-auth bypass in prod** if either (a) prod `TEST_DEVICE_FINGERPRINT` equals that value, or (b) a `devices` row with `cert_serial = 71defad0…f698` exists in prod (e.g. prod ever bootstrapped from this machine). In the **current test deployment** (bypass on, this exact fingerprint trusted) it is effectively a live device credential for anyone with the repo. Prod *also* trusts a client-supplied `Cf-Client-Cert-Sha256` header directly (`mtls.ts`), so if the origin is reachable off-tunnel an attacker can present any active device serial.
- **Fix:** `git rm --cached apps/api-cloud/dev-certs/dev-client.{crt,key}`, add `apps/api-cloud/dev-certs/` to `.gitignore` (dev-bootstrap regenerates locally). Treat the key as compromised: confirm no prod `devices` row or `TEST_DEVICE_FINGERPRINT` uses `71defad0…f698`. Purge from git history if cheap.

---

## HIGH

### H1 — No auth-surface rate limiting; per-user lockout = Owner-lockout DoS; `trustProxy:true` defeats the IP limiter
- **Where:** `plugins/rate-limit.ts` (global 300/min only; the documented per-route `/api/auth/* = 10/min` and `finalize/storno = 30/min` overrides are **not implemented** — `grep rateLimit src/routes` = 0 hits). PIN lockout (`@warehouse14/auth-pin`) is keyed on the **user row**. `app.ts:144` sets `trustProxy: true` (trust-all); the limiter keys on the resulting `req.ip`; storage is **in-memory** (Redis container exists but the API has no Redis client).
- **Impact:** (a) **Account-lockout DoS** — 5 bad PINs lock the single seeded Owner out of the POS for 30 min, repeatable. (b) **Brute-force bypass** — `trustProxy:true` lets a client inject `X-Forwarded-For` to rotate the rate-limit key on every request, defeating any IP limit on `/api/auth/sign-in`/`step-up`. (c) In-memory counters reset on restart and don't hold across replicas.
- **Fix:** Implement the documented per-route limits (`config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`) keyed on a header you control at the edge (`CF-Connecting-IP`), not raw XFF; set `trustProxy` to the Cloudflare hop count (`1`) so `req.ip` is non-spoofable; back the limiter with the existing Redis (add `REDIS_URL` to `env.ts` + a shared store).

### H2 — Swagger UI + OpenAPI spec are public in production
- **Where:** `lib/public-routes.ts` `PUBLIC_PREFIXES` includes `/docs` and `/openapi.json`; `swagger.ts:36` emits a `Production` server `https://api.warehouse14.de`; no `NODE_ENV` gate at `app.ts:164`.
- **Impact:** `GET https://api.warehouse14.de/openapi.json` returns the complete endpoint/parameter/auth-scheme map — a full recon blueprint for targeting the fiscal/PII endpoints.
- **Fix:** Register `swaggerPlugin` only when `NODE_ENV !== 'production'` (or put `/docs` + `/openapi.json` behind Cloudflare Access); remove them from `PUBLIC_PREFIXES` in prod.

### H3 — Public self-registration is one schema change from anonymous staff accounts
- **Where:** `plugins/auth.ts:61` `emailAndPassword: { enabled: true, autoSignIn: true }` with **no `disableSignUp`**; `/api/auth/*` is public. The only thing blocking account creation today is an accidental `users.role NOT NULL` with no default (`migrations/0004_auth.sql:86`) + no better-auth `additionalFields.role`.
- **Impact:** Defense-by-accident. Any future `role DEFAULT 'CASHIER'` or an `additionalFields:{role:{defaultValue:'CASHIER'}}` (added to "make staff signup work") silently turns `POST /api/auth/sign-up` into anonymous creation of authenticated staff with a live session cookie → all `requireRole('ADMIN','CASHIER')` endpoints (customer PII, transactions, dashboard) become public.
- **Fix:** Make the closure explicit: `emailAndPassword: { enabled: true, disableSignUp: true }` (staff provisioned out-of-band), or a sign-up `before` hook that hard-rejects.

### H4 — Voucher redemption is a TOCTOU race → balance double-spend
- **Where:** `apps/api-cloud/src/routes/vouchers.ts:246` — `SELECT … FROM vouchers WHERE code=…` (no `FOR UPDATE`), then balance check, redemption insert, and absolute-value `UPDATE current_balance_eur`. No unique constraint on `voucher_redemptions` tying tx↔voucher; the `CHECK (current_balance_eur >= 0)` is always satisfied by the app-computed value. (Found independently by two agents.)
- **Impact:** Two concurrent `POST /vouchers/:code/redeem` for the full balance both read the old balance, both pass, both write the same new balance → €200 redeemed from a €100 voucher. Insider/compromised-terminal financial loss. (Storno is protected by a unique index; vouchers has no equivalent.)
- **Fix:** `SELECT … FOR UPDATE` (Drizzle `.for('update')`) to serialize. Better, atomic conditional decrement: `UPDATE vouchers SET current_balance_eur = current_balance_eur - $amt WHERE id=$id AND status='ACTIVE' AND current_balance_eur >= $amt RETURNING current_balance_eur` → 0 rows = 409. Add a non-negative `CHECK` as defense-in-depth.

### H5 — `POST /api/ai/compose` enables unbounded LLM cost / billing DoS
- **Where:** `apps/api-cloud/src/routes/ai-compose.ts:83` — `requireAuth` + role only; accepts 8,000-char input, `max_tokens:1200`, **no per-route rate limit and no spend cap** (unlike the WhatsApp bot path which has `checkConversationBudget`).
- **Impact:** Any logged-in cashier (or stolen cashier session) scripts ~300 req/min of 8 KB prompts → thousands of paid completions/hour on the owner's `ANTHROPIC_API_KEY`, until the account is exhausted (which also kills the legit WhatsApp bot — shared key). Latent until the key is set, but fully wired.
- **Fix:** Add `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` + a daily per-actor spend cap (reuse `ai_calls` accounting). Consider ADMIN-only.

### H6 — Unauthenticated WhatsApp/IG/Messenger senders drive privileged bot tool calls (+ prompt injection)
- **Where:** `packages/ai-gateway/src/tools.ts` (`book_appointment`, `escalate_to_human`) → `apps/api-cloud/src/lib/whatsapp-bot-tools.ts:144` (INSERT) / `:248` (disables bot 12h + `pg_notify` with attacker text). The orchestrator feeds the **raw customer message** into the tool-use loop (`orchestrator.ts:136`); no human-in-the-loop, no per-sender identity check on booking; anonymous senders insert with `customerId = null`.
- **Impact:** Once `ANTHROPIC_API_KEY` is live, any anonymous sender can: (1) spam real `appointments` rows / squat the single ADMIN's calendar; (2) prompt-inject `escalate_to_human` to silence the bot for 12h and push attacker-controlled text into the operator inbox. No auth/captcha; only the per-conversation EUR budget bounds it.
- **Fix:** Require a resolved known `customerId` before `book_appointment` (else "propose → human confirms"); per-sender turn rate limit + daily bot-created-appointment cap; harden the system prompt; never render `escalate.reason`/`customerNotes` unescaped in operator UIs.

### H7 — Email/phone blind index is never normalized → duplicate customers + AML dedup bypass
- **Where:** `customers.ts:117`, `customer-update.ts:159/169`, `customers-list.ts:80`, `storefront-auth.ts:133/161/231` all call `blind_index(${raw})`. The SQL function does **not** lowercase/trim (its own comment: *"Caller MUST normalize"*); no caller does. (`packages/db/src/pii.ts:17` even documents the intended `lower(...)`.)
- **Impact:** `Anna@x.de` vs `anna@x.de` → different HMAC → the active-unique index doesn't collide → same person stored twice. Breaks GDPR erasure/dedup and lets a seller fragment cumulative-ankauf history across case/whitespace variants, undermining €15k cumulative-DD tracking. Storefront email login becomes case-sensitive.
- **Fix:** Normalize in one place before hashing — lowercase+trim email, E.164 phone — at **all write and lookup** sites (or bake it into the SQL function, but phone needs E.164 not lowercase, so app-side is cleaner). Backfill existing rows.

### H8 — Meta/WhatsApp/Chatwoot `hub.verify_token` compared with `===` (non-constant-time)
- **Where:** `webhooks-whatsapp.ts:102`, `webhooks-whatsapp-intake.ts:90`, `webhooks-meta-socials.ts:80` — `q['hub.verify_token'] === <secret>`. The POST signature path correctly uses `timingSafeEqual`; the GET handshake does not. These routes are public **and explicitly exempt from rate limiting** (`rate-limit.ts:50`) → unlimited unthrottled timing samples.
- **Impact:** Remote timing side-channel to recover the long-lived verify token byte-by-byte → complete Meta's webhook handshake (and, per Meta-side config, influence delivery registration).
- **Fix:** Add a `safeEqStr` (length-checked `timingSafeEqual`) helper in `meta-signature.ts` and use it for all verify-token comparisons.

---

## MEDIUM

### M1 — [GO-LIVE GATE] `TEST_DEVICE_FINGERPRINT` bypass live + promised boot guard missing + `Cf-Client-Cert-Sha256` trusted from header
- `plugins/mtls.ts:51` — when set in prod, any request **with no client cert** is treated as the seeded device (mTLS device-gating effectively off). `scripts/dev-bootstrap.ts:27` claims `src/lib/prod-safety.ts` refuses the dev CN at boot — **that file does not exist**. `extractCertFingerprint` trusts the `Cf-Client-Cert-Sha256` header, safe only if Cloudflare is the sole ingress and strips client copies.
- **Fix (go-live):** unset `TEST_DEVICE_FINGERPRINT`; implement the boot guard (refuse to start if prod + bypass set, or if a `warehouse14-dev-*` cert / `*@warehouse14.local` owner exists); verify origin is tunnel-only and/or verify `Cf-Access-Jwt-Assertion` server-side against the team JWKS.

### M2 — `WAREHOUSE14_MOCK_HARDWARE` env flips a **release** build into fabricated TSE signatures
- `apps/tauri-pos/src-tauri/src/config.rs:18` — `is_mock_mode()` honors the env var even in release; mock TSE returns plausible-but-counterfeit KassenSichV signatures, mock ZVT returns fake auth codes. `WAREHOUSE14_FISKALY_BASE_URL` (`:39`) is likewise env-overridable → redirect bearer-token Fiskaly calls to an attacker host.
- **Impact:** Local env control (malware, tampered shortcut, supply-chained launcher) silently disables real fiscalization → counterfeit TSE blocks on receipts; or Fiskaly token exfil.
- **Fix:** Gate `is_mock_mode()` / base-URL / fail-rate overrides behind `cfg!(debug_assertions)` so they're **compiled out of release**.

### M3 — Remote Chatwoot SDK injected into the privileged main window
- `apps/tauri-pos/src/lib/chatwoot.ts:59` appends `https://chat.warehouse14.de/packs/js/sdk.js` to the main window, which holds the full IPC capability set (`decrypt_and_load_kyc_document`, keychain, print, sql). CSP pins the host, so the whole defense rests on that one self-hosted host never being compromised.
- **Impact:** If `chat.warehouse14.de` (a Chatwoot the owner self-hosts) is ever popped, swapped `sdk.js` runs native commands inside the till — e.g. decrypt every KYC ID scan and exfil via the CSP-allowed `api.warehouse14.de`. GwG/GDPR breach.
- **Fix:** Load the widget in a **separate Tauri window/webview with an empty capability set** (or `<iframe sandbox>`), so widget JS can never reach `invoke`. Hardcode the prod Chatwoot host (non-editable). Add SRI if pinned.

### M4 — Client-controlled R2 object keys on photo/document/KYC registration
- `photos.ts:120/252`, `documents.ts:129`, `customer-kyc-documents.ts:137` store an arbitrary client-supplied `r2Key` without verifying the server presigned it; schemas allow any 1–1024-char string. Presign route generates safe keys, but registration trusts the client.
- **Impact:** A CASHIER can register a guessed `kyc/<uuid>` key as a *product* photo (surfacing it via the product's public URL) or cross-link another customer's document. **Exploitability depends on R2 bucket ACLs** (public-read by key = squarely exploitable; per-object presigned = bounded). Not filesystem traversal (S3 keys).
- **Fix:** Constrain each schema with a per-prefix regex and reject cross-prefix keys; bind the registered key to an outstanding presign issued to `req.actor.id`; serve customer/KYC docs only via short-TTL presigned GETs, never a guessable public base.

### M5 — SSE ledger stream: connection-exhaustion DoS
- `sse-ledger.ts:134` opens a **dedicated, non-pooled** Postgres connection per subscriber (`LISTEN`); no per-actor/global connection cap. Auth + replay bound are correct.
- **Impact:** A compromised/over-shared ADMIN session (recall PIN `0000`) opens N `EventSource` connections → exhausts Postgres `max_connections` → site-wide outage.
- **Fix:** Cap concurrent SSE connections per-actor and globally (429 past cap); ideally one shared `LISTEN` fanned out to subscribers.

### M6 — Socials/Chatwoot webhooks have no idempotency → signed-payload replay re-runs LLM + tool side-effects
- Meta `X-Hub-Signature-256` has no timestamp (no replay defense, unlike Stripe). WhatsApp paths dedupe by unique `meta_message_id`/`wamid`, but `webhooks-meta-socials.ts:126` and `webhooks-chatwoot.ts:114` have **no DB idempotency** and call the bot for every accepted delivery.
- **Impact:** A captured valid signed delivery replayed repeatedly → repeated paid LLM turns + repeated booking/escalation side-effects.
- **Fix:** Add unique-id idempotency tables for socials (`mid`) and Chatwoot (message id); gate bot dispatch on first delivery; optional short-TTL seen-signature cache.

### M7 — [GO-LIVE GATE] GwG/KYC identification thresholds not enforced server-side
- `transactions-finalize.ts:416` / `transactions-ankauf.ts` — no check that an identification/KYC doc exists at/over the €2,000 (GwG §10) / €10k / €15k lines (thresholds seeded in `0011_closing.sql:459` but never read by an enforcing path). `lib/smurfing.ts` is detect-only and ANKAUF-only.
- **Fix:** At minimum a soft gate: when `|total| ≥ threshold` and no verified KYC, require step-up + an override reason written to the ledger (ideally a DB trigger).

### M8 — High-value approval queue is advisory; risk flags shown to approver are POS-supplied (spoofable)
- `approvals.ts:217` resolving an approval just emits a ledger event; `transactions-finalize.ts` never requires an approval (only `requireStepUp`, satisfiable by the cashier's own PIN). `sanctionsMatch`/`pepMatch`/`kycComplete` shown to the approver (`approvals.ts:171`) come from the POS payload, not a server read.
- **Fix:** If approval is meant to gate, make finalize refuse a high-value tx lacking a matching `command.approval_resolved{status:APPROVED}`; re-derive risk flags server-side from `customers`.

### M9 — Release CI installs deps with `--frozen-lockfile=false`
- `.github/workflows/release.yml:99`, `infrastructure/ci/release.yml:104,219`. The OTA artifacts that auto-update every Windows POS are built without honoring the committed lockfile (drift / between-tag-published malicious version risk). (`ci.yml`/`db-suites.yml` correctly use `--frozen-lockfile`.)
- **Fix:** Use `--frozen-lockfile` in release workflows.

### M10 — Third-party GitHub Actions pinned to mutable tags in the signing pipeline
- `release.yml` / `infrastructure/ci/*` — `tauri-apps/tauri-action@v0`, `dtolnay/rust-toolchain@stable`, `pnpm/action-setup@v4`, `docker/*-action@v3/@v6`. These jobs hold `TAURI_SIGNING_PRIVATE_KEY` + `contents:write`.
- **Impact:** A compromised/retagged upstream action could exfiltrate the OTA signing key (→ forge updates every POS auto-installs) or tamper with the bundle.
- **Fix:** Pin every third-party action to a full commit SHA (version in a comment). Prioritize `tauri-action` and `docker/*`.

### M11 — `lpr` printer-name argument injection (frontend-controlled, unvalidated)
- `apps/tauri-pos/src-tauri/src/commands/pdf.rs:97` and `label.rs:127` — `Command::new("lpr").arg("-P").arg(&params.printer_name)` with `printer_name` a free-text renderer input (`GeraeteManager.tsx:273/418`). Not shell RCE (uses `arg()`), but a value starting with `-` is parsed by `lpr` as an option (CUPS `-o`, `-#999999` copies).
- **Fix:** Validate against `^[A-Za-z0-9_.-]{1,127}$` and reject a leading `-`, or require membership in `list_system_printers()`. Both files.

### M12 — Host header forwarded into better-auth request URL; no fixed `baseURL`
- `plugins/auth.ts:90` builds the better-auth `Request` URL from client `Host`/`X-Forwarded-Proto`; no `baseURL` set → cookie `Secure`/prefix + any future callback/reset URLs lean on attacker-influenced input.
- **Fix:** Set `baseURL: 'https://api.warehouse14.de'` and ignore inbound `Host` for the internal `Request`.

---

## LOW / HARDENING

- **L1 — `.env.production` not gitignored (footgun):** `.gitignore` ignores `.env`/`.env.local` but not `.env.production`. The two committed `.env.production` files are safe today (only `VITE_API_BASE_URL`), but any future secret there would be committed. Tighten to ignore all `.env*` except `*.example`.
- **L2 — Dev device fingerprint committed in `apps/tauri-pos/.env.local`** (file claims it's gitignored but it's tracked). Release builds are clean (prod `.env.production` doesn't set it). `git rm --cached`, rotate, ensure `.gitignore` covers it.
- **L3 — `sharp()` decompression-bomb DoS:** `media-engine/composite.ts:43/50/58` constructs Sharp on uploaded bytes with no `limitInputPixels`/`failOn`. Add `sharp(bytes,{limitInputPixels:24_000_000,failOn:'error'})` + metadata pre-check; run card-gen in the worker.
- **L4 — Rate-limiter exempts ALL `/api/webhooks/*`** (`rate-limit.ts:50`), broader than its Stripe rationale → unsigned-body flood forces unbounded HMAC CPU. Apply a finite limit to non-Stripe webhooks.
- **L5 — `cloudflared:latest`** (`docker-compose.prod.yml:102`) — only floating image; pin a version.
- **L6 — Stale top-level `.env.example`** references a different project (`goldhaus`) + `AUTH_SECRET=""`, mismatching `env.ts`. Misleads operators (feeds C1). Delete/align.
- **L7 — Single shared PII key, no rotation** (`WAREHOUSE14_PII_KEY`, env-sourced, copied into request context). Dev key not hardcoded in source (good). Go-live: distinct high-entropy prod key in a secrets manager; plan pgcrypto re-encrypt rotation + per-tenant keys.
- **L8 — `audit_log` is append-only by grant but not hash-chained** (by design — the chained `ledger_events` is the fiscal record; AML alerts are written to both, the chained copy authoritative). Accept; note a DBA/superuser could edit `audit_log`.
- **L9 — Step-up freshness is session-scoped, not operation-scoped** (`auth-policy.ts:110`) — one step-up authorizes all gated actions for 10 min. Optionally bind the most destructive ops to an operation+nonce.
- **L10 — better-auth's own session cookie is `SameSite=Lax`** (no `crossSubDomainCookies`) → dropped in the cross-site Tauri webview; only the hand-rolled PIN path sets `SameSite=None`. Functional/consistency gap; align if the password flow is used in-app.
- **L11 — `lib/smurfing.ts:4` references "Weil am Rhein"** — wrong shop location in shipped code (shop is Schorndorf 73614). Info-correctness; fix the comment.
- **L12 — Storefront `locations` endpoint exposes `phone`/`email`** (`storefront-catalog.ts:459`) to anyone. Confirm these are intended-public business contacts or gate them. Also: unauth full-catalog scraping (global 300/min only) + leading-wildcard `ILIKE` DoS amplifier.
- **L13 — MCP `appraise_estate_item` exposed to CASHIER** (`mcp/tools/appraise-estate-item.ts:303`) and no per-route limit on `/api/mcp`. Re-evaluate role; add a limit; treat free-text args as untrusted before the real LLM is wired.
- **L14 — DATEV/closing export not scoped to the finalized snapshot** (`closing-export.ts:185`) — selects by calendar day, no `state`/`shop_id` filter, re-derives live. GoBD wants the immutable Z-snapshot. Filter to the closing's own set/state; read finalized figures.

---

## Verified SOLID (no action — for confidence)
- SQL injection: none — Drizzle / parameterized `sql` everywhere; the only two `sql.raw` sites use hardcoded-map / internal values.
- SSRF: none — every outbound `fetch` targets a fixed or operator-env host; VIES path strips to `[A-Za-z0-9]`.
- Mass assignment: none — explicit named field whitelists; `coerceTypes` off.
- Money/numeric: robust — regex-constrained decimal strings + Decimal.js, sign discipline, server-side refund/price snapshots.
- Webhook POST signatures: correct — raw-body, length-checked `timingSafeEqual`, Stripe timestamp tolerance + idempotency.
- Ledger hash-chain, role separation (no app-role UPDATE/DELETE on fiscal tables), finalize atomicity/idempotency, storno negation + one-per-original, atomic inventory reservation, closing-day immutability: all correctly built.
- Tauri: no `innerHTML`/`eval` sinks, no `unsafe-inline`/`unsafe-eval` CSP, signed HTTPS OTA updater (not MITM-able), tokens in httpOnly cookies, TSE/KYC keys in OS keychain, KYC path-traversal defended (canonicalize+prefix check), shell scope `allow-open` only.
- Randomness/hashing: `crypto.randomBytes`/`randomUUID`, AES-256 pgcrypto with per-row IV, no `Math.random`/md5/sha1/ECB; PII encrypted at rest, key connection-scoped, never logged.
- Docker: non-root, pinned bases, no build-ARG secrets, internal-only Postgres/Redis, least-privilege DB roles enforced at boot.

## Recommended remediation order
1. **Today (live prod):** C1 (enforce/verify `AUTH_SECRET`), C2 (storefront cookie), C5 (remove committed key + verify prod trust).
2. **This week (compliance + financial):** C3 (persist sanctions), C4 (enforce BANNED), H4 (voucher `FOR UPDATE`), H1 (auth rate limits + `trustProxy` scope), H2 (close Swagger), H3 (`disableSignUp`).
3. **Before AI key goes live:** H5, H6, M6.
4. **Before go-live cutover:** M1, M2, M7, H7 (+ backfill), and the rest of Medium.
5. **Hardening backlog:** all Low.
