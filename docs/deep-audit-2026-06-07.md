# Warehouse14 POS — Deep Audit (2026-06-07)

_Multi-agent audit: 54/54 findings confirmed after adversarial verification._

## Overview

Warehouse14's POS has a strong, correct fiscal core (cents/Decimal money pipeline, TSE finalize, idempotency on the sale path, server-side GwG/KYC triggers) and most screens DO render German error banners on failed loads. But it is shipped to Windows with the authenticated-session path never confirmed working on that platform, and — more damaging day-to-day — the app has no honest connection-health signal: the one global badge is wired to navigator.onLine, the live SSE stream and its status dot only run on the Werkstatt home screen, and the cold-start session probe and several key screens (CatalogGrid, dashboard tiles, DayControl) fail closed/silent so a server-down state reads as "logged out" or "empty inventory" instead of "no connection." On top of that there are two genuine money/correctness defects: the Ankauf checkout can double-pay on a double-click (no sync mutex, no idempotency key, no server dedup), and a private high-value (≥€2.000) VERKAUF is literally un-completable because there is no buyer-attach UI to satisfy the §10 GwG gate. Several offline-queue paths (Ankauf, card) mislabel a durably-queued transaction as a hard failure, inviting duplicate payouts. The rest is i18n leakage (raw English enums), float-math nitpicks that don't book wrong figures, and bundle/perf polish.

## Connection root cause

There is no single bug — there is a missing connection-truth layer plus a real Windows-specific session risk. (1) ROOT of "app opens but no connection" on Windows: the session cookie is set SameSite=None;Secure;HttpOnly in prod (apps/api-cloud/src/routes/auth-pin.ts:346-353), and POS auth is cookie-ONLY (apps/tauri-pos/src/lib/api-context.tsx:120 credentials:'include'; server reads only the warehouse14.session cookie, apps/api-cloud/src/plugins/auth.ts:118-144). On macOS the webview origin is the secure tauri://localhost; on Windows WebView2 it defaults to the NON-secure http://tauri.localhost because tauri.conf.json sets no app.windows.useHttpsScheme. Sending a cross-site Secure;None cookie from a non-secure document requires both a secure context and third-party cookies enabled, and WebView2/Chromium increasingly blocks third-party cookies — so login returns 200+Set-Cookie but the cookie is never re-attached and the next GET reads as logged-out. FIX (durable, immune to cookie policy): return the session token from pin-login (it already exists as `token` in auth-pin.ts) and accept Authorization: Bearer in auth.ts:118-144 alongside the cookie; set it as a default header in api-context.tsx and pass it as a query param for the SSE EventSource (which can't set headers) in useLedgerStream.ts:103. Quick mitigation to try on the box first: set app.windows.useHttpsScheme=true so the Windows origin becomes a secure context. (2) ROOT of the cashier never being TOLD: nothing measures API reachability. The global SyncStatusBadge tracks only navigator.onLine (sync-store.ts:29,54-56) so it shows green "Bereit" while the Cloudflare tunnel/API is down; the cold-start probe catches network errors into setUnauthenticated() (useSessionProbe.ts:37-41) so an unreachable server silently shows the PIN pad; and CatalogGrid (CatalogGrid.tsx:210), the dashboard tiles (UebersichtPanel/Werkstatt.tsx:48) and DayControl ignore isError and render "empty/closed" instead of "connection lost." FIX: drive the badge from real request health (feed circuit-breaker open/close or last-successful-request timestamp into sync-store), add a distinct 'unreachable' session status that renders a "Keine Verbindung zum Server — erneut versuchen" screen, lift useLedgerStream to App.tsx so live status shows on every surface, and add isError branches to the silent screens. Also verify on the live server that TRUSTED_ORIGINS includes http://tauri.localhost and TEST_DEVICE_FINGERPRINT is still set to an ACTIVE device row, since both can independently dark the Windows POS.

## Workstreams


### [P0] Restore the connection lifeline (Windows session + honest health UX)

_This is the reported 'app opens but no connection' symptom and the single biggest shop-floor blocker. It is two coupled problems: the Windows cookie/session may never authenticate, and even when the server is genuinely down the app actively reassures the cashier all is well, so failures look like 'logged out' or 'empty inventory'._

1. Add a Bearer-token fallback so Windows auth is immune to third-party-cookie policy: return `token` from pin-login (apps/api-cloud/src/routes/auth-pin.ts), accept Authorization: Bearer in apps/api-cloud/src/plugins/auth.ts:118-144 alongside the cookie, set it as a default header in apps/tauri-pos/src/lib/api-context.tsx:113-124, and pass it as a query param for SSE in apps/tauri-pos/src/hooks/useLedgerStream.ts:103. Quick first try on the box: set app.windows.useHttpsScheme=true in tauri.conf.json.
2. Drive the global SyncStatusBadge from real reachability, not navigator.onLine: feed circuit-breaker open/close or a last-successful-request timestamp into apps/tauri-pos/src/state/sync-store.ts:29,54-56 and render an 'API nicht erreichbar' state in apps/tauri-pos/src/app/chrome/AppShellHeader.tsx:182,196.
3. Distinguish 'unreachable' from 'unauthenticated' on cold start: split the catch in apps/tauri-pos/src/hooks/useSessionProbe.ts:37-41 so ApiNetworkError/ApiCircuitOpenError set a new status and App.tsx:62-69 renders a 'Keine Verbindung zum Server — erneut versuchen' screen with retry, instead of the PIN pad.
4. Lift useLedgerStream(status==='authenticated') from Werkstatt.tsx:44 to apps/tauri-pos/src/app/App.tsx (per its own docstring useLedgerStream.ts:15) and surface status/lastError in global chrome so the live feed AND the AML/TSE alert toasts (AppShell useAlertSubscription) work on Kasse/Verkauf/Lager, not only home.
5. Add isError branches to the silent screens: CatalogGrid.tsx:210 ('Katalog konnte nicht geladen werden — Verbindung prüfen' + refetch), UebersichtPanel/Werkstatt.tsx:48 (thread isError instead of eternal 'Lädt…'), and DayControl.tsx:18-23 ('Schichtstatus nicht abrufbar' instead of defaulting to 'Tag noch nicht eröffnet').
6. Stop the SSE reconnect-forever-on-401 loop: in useLedgerStream.ts:128-141, after N consecutive failures probe /api/auth/session and on 401 drive the session store to unauthenticated rather than looping silently.
7. Server-side verification (live box, no code change): confirm TRUSTED_ORIGINS includes http://tauri.localhost AND https://tauri.localhost (security-headers.ts:82-86 is exact-match with credentials:true), and confirm TEST_DEVICE_FINGERPRINT is set to the cert_serial of an ACTIVE device row (mtls.ts:48-57) so /api/* GETs don't 403.

### [P0] Money correctness & duplicate-payout safety

_Direct money-loss vectors on the shop floor: a double-click pays a seller twice, and several offline paths tell the cashier a transaction failed when it was durably queued, inviting a re-run and a duplicate._

1. Ankauf double-pay: AnkaufBezahlenDialog.submit() (apps/tauri-pos/src/screens/ankauf/AnkaufBezahlenDialog.tsx:163,189,272) guards only with React state, has no idempotencyKey, and the server /api/transactions/ankauf route has no dedup. Add a synchronous inFlightRef mutex + idempotencyKeyRef (mirror Verkauf BezahlenDialog), gate the backdrop onClick on it, thread the key through AnkaufBody, and add a partial UNIQUE INDEX + 23505 handling on the server ankauf route.
2. Ankauf offline path mislabels a queued buy-in as failure: AnkaufBezahlenDialog catch (lines 229-242) checks only ApiError, so ApiOfflineQueuedError falls to 'Verbindung gestört'. Add an ApiOfflineQueuedError branch mirroring the cash sale path (BezahlenDialog.tsx:701) — show 'Ankauf offline gespeichert', print the label from local items, invalidate queries.
3. Card path tells cashier to Storno a charge that actually booked: BezahlenDialog.tsx:843 has no ApiOfflineQueuedError branch, so a card-authorized + finalize-queued sale prints the false 'Storno am Terminal ausführen'. Branch on ApiOfflineQueuedError first and show 'Karte autorisiert · Beleg wird synchronisiert' with the ZVT_CARD payment on the offline receipt.
4. ZVT post-auth finalize failure has no safe recovery: BezahlenDialog.tsx:819-852 re-enables the primary button which RE-AUTHORIZES (double charge) instead of retrying finalize. Add an explicit 'Erneut buchen' button that retries finalizeWithTse with the same idempotencyKeyRef (server-deduped), and/or auto-fire a ZVT reversal — not a wall of red text.
5. Fix the offline-queue GoBD classification + key-sealing: FISCAL_PATH_PREFIXES in offline-queue.ts:106 lacks the '/api' prefix so '/api/transactions/ankauf|finalize' are stored gobdRelevant=false; and BezahlenDialog passes idempotencyKey in the body, not meta.custom.idempotencyKey, so dedup isn't sealed. Match real '/api/...' paths and pass the key via meta.custom; add a test asserting isGobdRelevantPath('/api/transactions/finalize')===true.

### [P1] High-value sale (§10 GwG) flow is un-completable

_A normal expected gold-shop transaction — a private customer buying a €2.000+ coin/bar — cannot be finalized at all: the server gate (>= €2.000) requires a verified buyer, but Verkauf has no UI to attach one for a non-B2B sale, so the cashier hits a raw 403 they can re-click forever._

1. Add a 'Käufer zuordnen / Ausweis prüfen' customer picker to the Verkauf BezahlenDialog (BezahlenDialog.tsx:341-366 is currently the only customerId path and is B2B-only). Reuse customersApi.list/get + the stampKyc step-up flow already in AnkaufBezahlenDialog, wire the verified customer's id into FinalizeBody.customerId for the non-B2B path, and gate 'Zahlung abschließen' on a verified buyer whenever evaluateKycGate({direction:'VERKAUF'}).thresholdReached.
2. Make KYC_REQUIRED actionable: add a case to formatPaymentError (BezahlenDialog.tsx:1656-1666) returning 'Käufer muss per Ausweis geprüft werden — bitte Kunden zuordnen' and drive the dialog into the attach sub-step instead of looping on the raw server sentence.
3. Harden the server error classification: extend the route-level pre-check in transactions-finalize.ts:159-189 to reject direction==='VERKAUF' && total ≥ threshold && customerId==null (and the ANKAUF customerId==null case) with KycRequiredError up front, so the POS always gets a stable KYC_REQUIRED instead of relying on the brittle trigger-RAISE substring match in error-handler.ts:80.

### [P1] Reservation integrity & checkout UX correctness

_Silent inventory-lock leaks and display mismatches that confuse a busy cashier or make stock unsellable, on flows that run every transaction._

1. Zombie POS reservation: onRemoveLine in Verkauf.tsx:337-381 removes the line optimistically then releases; on release failure the line is gone from the cart but the server reservation (no TTL) is held forever, making the product unsellable. Re-insert the line (it still carries reservationSessionId) on failure so the operator can retry, or persist a 'pending release' list and retry on next launch.
2. Voucher-covered sale shows the wrong collect amount on the gold button: BezahlenDialog.tsx:1484-1491 appends totalEur, not dueEur. Render dueEur on the submit button when a voucher is applied (change math is already correct).
3. AppraisalItemForm rejects the German comma on 'Wert dieses Stücks' (AppraisalItemForm.tsx:110,233,340) while the sibling AppraisalItemsList normalises it — inconsistent. Normalise the comma before validation. (NeuesProduktDialog comma bug is listed under New-dialog hardening since the file is not yet shipped.)
4. AcceptanceDialog double-reject: reject() (AcceptanceDialog.tsx:169) has no submitting guard unlike accept(); add `if (submitting) return;` or a shared inFlightRef.

### [P1] New-dialog hardening (NeuesProduktDialog, pre-ship)

_NeuesProduktDialog.tsx is an untracked, not-yet-shipped file — fixing it now prevents shipping a dead-button money-entry dialog to the floor._

1. NeuesProduktDialog rejects the German comma on Einkaufswert/Verkaufspreis/Gewicht: DECIMAL_RE = /^\d+(\.\d{1,2})?$/ (NeuesProduktDialog.tsx:75) is dot-only, so '1.250,00' leaves 'Anlegen' permanently disabled with no error. Swap the three €/gram inputs to the shared EuroInput (or normalise with lib/decimal.ts isMoneyInput/normalizeDecimal) and send normalizeDecimal(...) in the POST body.
2. Acceptance label prints the product UUID instead of the SKU: AcceptanceDialog.tsx:116 sets sku: i.productId, so the Code128 won't match at the till. Use the accepted item's real SKU (other label paths use p.sku/product.sku).
3. ankauf-cart-store nextTempId resets to 0 each boot (ankauf-cart-store.ts:114), risking a same-ms collision with a rehydrated item and a wrong-row edit. Use crypto.randomUUID() or seed the counter from rehydrated items.

### [P2] German UI polish (no English enums on the floor)

_The product must be 100% professional German; raw enum codes and the wrong register leak in operator-visible places._

1. IntakeDraftsTray renders raw tax/status codes and the English fallback 'UNCLASSIFIED' (IntakeDraftsTray.tsx:79-80) and uses free-text inputs for Artikeltyp/Steuercode — use TAX_TREATMENT_LABEL + a German INTAKE_STATUS_LABEL and <select>s reusing ITEM_TYPE_OPTIONS.
2. ProductSheet interpolates the raw status enum ('AVAILABLE') into a German sentence (ProductSheet.tsx:806) — reuse the existing STATUS_LABEL map (extract it from LagerTable.tsx:21 into a shared module).
3. Replace the English 'Storefront' with the already-used 'Web-Shop' across WebSeoPanel.tsx:114-115,417, ProductSheet.tsx:806, Verkauf.tsx:213,294.
4. Switch the informal 'du' to 'Sie' in the label-print hint (ProductSheet.tsx:654).
5. AppointmentsWorkspace shows raw enums (VIEWING · BOOKED) — but it is currently dead/unrouted code (not in surface-registry); either delete it or, if revived, add German label maps using the REAL status enum (SCHEDULED/CONFIRMED/CHECKED_IN/IN_PROGRESS/COMPLETED/NO_SHOW/CANCELLED/RESCHEDULED — there is no 'BOOKED').
6. Define the missing CSS token: var(--w14-parchment-1) is used ~25× with no fallback (e.g. CartPanel.tsx:128, BezahlenDialog.tsx:1177) and resolves to transparent. Define --w14-parchment-1 in packages/ui-kit/src/tokens.css for light+dark, or add the var(...,var(--w14-parchment)) fallback. (The finding's '--w14-surface' name is wrong; the chip/contrast/hover sub-items are deferred polish.)

### [P2] Server hardening before go-live

_Real gaps that don't block the floor today (test mode) but must be closed before go-live; one is a wrong fiscal export the Steuerberater imports._

1. Documented per-route rate limits don't exist: rate-limit.ts:10-15 promises 10/min on /api/auth/* and 30/min on finalize/storno, but no route defines a config.rateLimit block, so the email/password sign-in (no DB lockout) shares only the 300/min/IP global bucket. Add env-aware per-route caps (strict in prod, relaxed in dev/test) keyed by IP on /api/auth/* and by actor on fiscal writes.
2. DATEV export hardcodes contra account 8400 for ALL sales (closing-export.ts:94-137) ignoring tax_treatment_code — for a gold shop, MARGIN_25A and INVESTMENT_GOLD_25C dominate, so the bulk of revenue is misclassified. Add a per-tax_treatment_code → SKR03 lookup (get the four mappings from the Steuerberater) and warn in the export header until then.
3. Add a boot guard in config/env.ts that refuses NODE_ENV=production when TEST_DEVICE_FINGERPRINT is set (unless an explicit escape flag), so the mTLS bypass (mtls.ts:48-57) can't silently survive into the hardened deploy. Pair with verifying Cf-Access-Jwt-Assertion against the team JWKS (mtls.ts:6-9, currently forwarded but never verified).
4. Narrow the webhook rate-limit exemption (rate-limit.ts:45-59) to exactly /api/webhooks/stripe and apply a finite IP cap to the other public, unauthenticated webhook routes so flooding garbage bodies can't force unbounded HMAC/DB work.
5. Add a ±50% plausibility band (or confirmOutlier flag) to the Owner manual metal-price override (metal-prices.ts:387-487) so a fat-finger can't silently poison every live Ankauf rate.
6. Pass { custom: { skipStepUp: true } } from useSessionProbe (useSessionProbe.ts:34) per its documented contract, and add skipOfflineQueue for /api/auth/* so a false navigator.onLine can never trap the login (offline-queue.ts:201-202).

### [P3] Money-math hygiene (no booked-value impact)

_parseFloat/Number/toFixed appear in a handful of preview/display paths. None book a wrong figure for the 2-dp German pipeline this POS produces, but they violate the cents-only discipline and are cheap to align._

1. AmountPad cash-tender keypad round-trips through toNumber(...).toFixed(2) (AmountPad.tsx:30,48,181) — replace with the fromCents(toCents(value)) cents pipeline.
2. MoneyAmount builds cents via Number(string-concat) (MoneyAmount.tsx:63), overflow past 2^53 only for ~900bn € — format directly from the split intPart/fracPart strings.
3. metal-margin preview (metal-margin.ts:16,37,40) and intake price-estimate (price-estimate.ts) use float math for previews/hints only — optionally reimplement in scaled bigint, or leave a 'preview-only' comment; the server re-derives the booked value.
4. classifyCartProductTax parses fineness with parseFloat (cart-math.ts:259) — thresholds 0.995/0.900 are far from float boundaries and the server re-classifies; optional bigint per-mille compare.

### [P3] Code consolidation & bundle/perf

_Maintainability risks (drifted duplicate money primitives) and cold-launch weight on WebView2 shop hardware. Not felt as bugs today but worth a pass._

1. computeSchmelzwertEur has DRIFTED between bewertung-math.ts:76 (guards null/undefined/empty) and intake-math.ts:91 (guards only null) — same calc, two behaviours by screen; consolidate to one with the stricter guard and a parity test.
2. toCents/fromCents/roundHalfEven are copy-pasted byte-for-byte across cart-math.ts, bewertung-math.ts, intake-math.ts — extract a single lib/money.ts so a future rounding fix can't miss a flow.
3. surface-registry.ts claims 'Lazy imports' but eagerly static-imports all 20 surfaces (no React.lazy anywhere), so every secondary screen (incl. the @fullcalendar suite via the orphaned AppointmentsWorkspace) parses on cold launch. Wrap secondary-tier components in React.lazy + Suspense, keep Verkauf/Ankauf/Kasse eager, and delete-or-lazy the @fullcalendar-pulling AppointmentsWorkspace.
4. Memoize CatalogGrid ProductTile (CatalogGrid.tsx:241) so a scanner burst doesn't re-render all 60 tiles ~3× per scan; pass a stable onSelect. CartRow/DiscountEditor memoization is negligible (tiny carts) — leave unless touched.
5. Decide Kurse nav tier: surface-registry.ts lists it as secondary (Spotlight-only) though it was meant to be promoted to primary chip #7; give it digit:7/tier:'primary' or update the project notes so registry and docs agree.

## All confirmed findings

| sev | area | title | files |
|---|---|---|---|
| critical | pos/ankauf | Ankauf checkout can double-pay on a double-click (no mutex, no idempotency key) | apps/tauri-pos/src/screens/ankauf/AnkaufBezahlenDialog.tsx:163, apps/tauri-pos/s |
| high | pos/auth · server/auth-cookie | Windows WebView2 likely drops the SameSite=None;Secure session cookie (cross-sit | apps/api-cloud/src/routes/auth-pin.ts:339-354, apps/tauri-pos/src/lib/api-contex |
| high | pos/auth · pos/connection-ux | Cold-start session probe fails CLOSED on network error → silently shows the PIN  | apps/tauri-pos/src/hooks/useSessionProbe.ts:32-42, apps/tauri-pos/src/app/App.ts |
| high | pos/verkauf | Private high-value VERKAUF (≥ €2.000) is un-completable — no customer-attach UI  | apps/tauri-pos/src/screens/verkauf/BezahlenDialog.tsx:341-366, apps/tauri-pos/sr |
| high | pos/verkauf | ZVT card path: finalize failure AFTER card authorization leaves the cashier to m | apps/tauri-pos/src/screens/verkauf/BezahlenDialog.tsx:819-852, apps/tauri-pos/sr |
| high | pos/lager | NeuesProduktDialog rejects German comma in money fields (dot-only regex) | apps/tauri-pos/src/screens/lager/NeuesProduktDialog.tsx:75, apps/tauri-pos/src/s |
| high | pos/chrome | Global connection badge lies: tracks navigator.onLine, not API/tunnel reachabili | apps/tauri-pos/src/state/sync-store.ts:29, apps/tauri-pos/src/state/sync-store.t |
| high | pos/werkstatt | Live SSE stream + connection dot mounted in Werkstatt, not app root — dies on na | apps/tauri-pos/src/screens/werkstatt/Werkstatt.tsx:44, apps/tauri-pos/src/hooks/ |
| high | pos/verkauf | Sale catalog shows 'Keine Treffer / Katalog ist leer' when the products API is u | apps/tauri-pos/src/screens/verkauf/CatalogGrid.tsx:208, apps/tauri-pos/src/scree |
| high | pos/ankauf | Ankauf finalize reports a durably-queued purchase as a hard failure (no ApiOffli | apps/tauri-pos/src/screens/ankauf/AnkaufBezahlenDialog.tsx:198, apps/tauri-pos/s |
| high | pos/verkauf | Card path tells cashier to Storno a charge that actually succeeded when finalize | apps/tauri-pos/src/screens/verkauf/BezahlenDialog.tsx:843, apps/tauri-pos/src/sc |
| high | server/rate-limit | Documented per-route rate limits on /api/auth/*, finalize, and storno are not wi | apps/api-cloud/src/plugins/rate-limit.ts:10-15, apps/api-cloud/src/routes/auth-p |
| high | server/mtls | TEST_DEVICE_FINGERPRINT mTLS bypass is still active in production | apps/api-cloud/src/plugins/mtls.ts:48-57, apps/api-cloud/src/config/env.ts:53-59 |
| high | pos/lager | NeuesProduktDialog rejects the German decimal comma on Einkaufswert/Verkaufsprei | apps/tauri-pos/src/screens/lager/NeuesProduktDialog.tsx:75, apps/tauri-pos/src/s |
| medium | pos/chrome · pos/connection-ux | No global 'nicht verbunden' / connection-lost indicator — failed GETs render as  | apps/tauri-pos/src/app/App.tsx:62-77, apps/tauri-pos/src/app/chrome/AppShell.tsx |
| medium | pos/auth | Session probe does not pass skipStepUp — violates its documented contract and ri | apps/tauri-pos/src/hooks/useSessionProbe.ts:34, apps/tauri-pos/src/lib/api-conte |
| medium | pos/connection · packages/api-client | offline-queue short-circuits on navigator.onLine — an unreliable WebView2 signal | packages/api-client/src/middleware/offline-queue.ts:201-202, apps/tauri-pos/src/ |
| medium | pos/auth · server/mtls | Production build sends no device identity header; the whole POS depends on the s | apps/tauri-pos/src/lib/api-context.tsx:113-124, apps/tauri-pos/src/main.tsx:39 |
| medium | pos/verkauf | VERKAUF KYC_REQUIRED 403 surfaces as a raw server sentence with no actionable pa | apps/tauri-pos/src/screens/verkauf/BezahlenDialog.tsx:1656-1666, apps/tauri-pos/ |
| medium | pos/verkauf | Per-line release failure leaves an optimistically-removed line as a silent zombi | apps/tauri-pos/src/screens/verkauf/Verkauf.tsx:337-381, apps/tauri-pos/src/state |
| medium | ui-kit and screens | Six UI defects across ui-kit and POS screens | packages/ui-kit/src/tokens.css:15, packages/ui-kit/src/components/Button.tsx:30 |
| medium | pos/bewertung | Acceptance prints product UUID instead of SKU on intake labels | apps/tauri-pos/src/screens/bewertung/AcceptanceDialog.tsx:116 |
| medium | pos/werkstatt | Home overview tiles stick on 'Lädt…' forever when dashboard summary errors | apps/tauri-pos/src/screens/werkstatt/UebersichtPanel.tsx:27, apps/tauri-pos/src/ |
| medium | pos/werkstatt | Day-control banner shows 'Tag noch nicht eröffnet' when the shift query errors | apps/tauri-pos/src/screens/werkstatt/DayControl.tsx:18, apps/tauri-pos/src/scree |
| medium | api-client/offline-queue | Fiscal mutations never classified GoBD-relevant — offline-queue path mismatch on | packages/api-client/src/middleware/offline-queue.ts:106, packages/api-client/src |
| medium | pos/secondary (IntakeDraftsTray) | AI-Intake-Prüftray rendert rohe Status-/Steuercodes und englischen Fallback 'UNC | apps/tauri-pos/src/screens/secondary/IntakeDraftsTray.tsx:79, apps/tauri-pos/src |
| medium | pos/lager + pos/verkauf | Englischer Begriff 'Storefront' statt 'Web-Shop' in operator-sichtbaren Texten | apps/tauri-pos/src/screens/lager/ProductSheet.tsx:806, apps/tauri-pos/src/screen |
| medium | pos/lager (ProductSheet) | Produktblatt zeigt rohen Status-Enum (z. B. AVAILABLE) statt deutscher Bezeichnu | apps/tauri-pos/src/screens/lager/ProductSheet.tsx:806 |
| medium | server/mtls | Cloudflare Access JWT assertion is forwarded but never verified | apps/api-cloud/src/plugins/mtls.ts:6-9, apps/api-cloud/src/plugins/mtls.ts:46-60 |
| medium | server/closing-export | DATEV export posts every VERKAUF to revenue account 8400 regardless of tax treat | apps/api-cloud/src/routes/closing-export.ts:94-137 |
| medium | server/rate-limit | Webhook prefix is unconditionally exempt from rate limiting — any /api/webhooks/ | apps/api-cloud/src/plugins/rate-limit.ts:45-59, apps/api-cloud/src/lib/public-ro |
| medium | pos/bewertung | AppraisalItemForm 'Wert dieses Stücks' rejects the German comma | apps/tauri-pos/src/screens/bewertung/AppraisalItemForm.tsx:110, apps/tauri-pos/s |
| medium | pos/lib | toCents/fromCents/roundHalfEven duplicated verbatim across three money-math libs | apps/tauri-pos/src/lib/cart-math.ts:29, apps/tauri-pos/src/lib/cart-math.ts:40 |
| medium | pos/lib | computeSchmelzwertEur is duplicated AND has drifted between the Ankauf and Bewer | apps/tauri-pos/src/lib/bewertung-math.ts:76, apps/tauri-pos/src/lib/intake-math. |
| medium | pos/app-chrome | Surface registry is statically imported despite "Lazy imports" comment — no code | apps/tauri-pos/src/app/chrome/surface-registry.ts:61-79, apps/tauri-pos/src/app/ |
| medium | pos/secondary | Entire @fullcalendar suite (5 packages) shipped in the bundle via orphaned Appoi | apps/tauri-pos/src/screens/secondary/AppointmentsWorkspace.tsx:13-17, apps/tauri |
| low | server/cors · pos/connection | Live-server TRUSTED_ORIGINS likely missing http://tauri.localhost (and https://t | apps/api-cloud/src/plugins/security-headers.ts:82-86, apps/api-cloud/src/config/ |
| low | pos/sse | EventSource SSE reconnects forever on a hard 401/403 with no surfaced error and  | apps/tauri-pos/src/hooks/useLedgerStream.ts:128-141, apps/tauri-pos/src/hooks/us |
| low | pos/verkauf | Voucher-covered VERKAUF: the finalize button still shows the full total, not the | apps/tauri-pos/src/screens/verkauf/BezahlenDialog.tsx:1484-1491, apps/tauri-pos/ |
| low | server/transactions | Verkauf finalize KYC pre-check only fires for an attached customer — the friendl | apps/api-cloud/src/routes/transactions-finalize.ts:159-189, apps/tauri-pos/src/s |
| low | pos/bewertung | AcceptanceDialog reject() has no re-entry guard (double reject) | apps/tauri-pos/src/screens/bewertung/AcceptanceDialog.tsx:169, apps/tauri-pos/sr |
| low | pos/ankauf | Ankauf intake nextTempId counter resets to 0 each boot (theoretical collision) | apps/tauri-pos/src/state/ankauf-cart-store.ts:114 |
| low | ui-kit / kasse Bezahlen | AmountPad cash-tender keypad round-trips the amount through a JS float (toFixed/ | packages/ui-kit/src/components/AmountPad.tsx:30, packages/ui-kit/src/components/ |
| low | ui-kit | MoneyAmount builds integer cents via Number(string-concat), which can overflow p | packages/ui-kit/src/components/MoneyAmount.tsx:63 |
| low | kurse / pricing preview | metal-margin Ankauf preview computes the buy rate with JS float (parseFloat + mu | apps/tauri-pos/src/lib/metal-margin.ts:16, apps/tauri-pos/src/lib/metal-margin.t |
| low | intake-pipeline | intake price-estimate uses float math for the suggested Ankauf/Verkauf prices | packages/intake-pipeline/src/price-estimate.ts:37, packages/intake-pipeline/src/ |
| low | verkauf cart-math (tax classification) | classifyCartProductTax parses fineness with parseFloat for the §25c/§25a purity  | apps/tauri-pos/src/lib/cart-math.ts:259 |
| low | pos/secondary (Termine/AppointmentsWorkspace) | Termin-Buchung zeigt rohe englische Enum-Codes (VIEWING, BUYBACK_EVAL, BOOKED) s | apps/tauri-pos/src/screens/secondary/AppointmentsWorkspace.tsx:24, apps/tauri-po |
| low | pos/lager (ProductSheet) | Informelle Anrede „du" statt professionellem „Sie" im Etiketten-Hinweis | apps/tauri-pos/src/screens/lager/ProductSheet.tsx:654 |
| low | server/transactions-finalize | ANKAUF via /transactions/finalize with null customerId skips the friendly KYC pr | apps/api-cloud/src/routes/transactions-finalize.ts:162-192, apps/api-cloud/src/s |
| low | server/metal-prices | Owner manual price-override (POST /api/metal-prices) accepts pricePerGramEur wit | apps/api-cloud/src/routes/metal-prices.ts:387-487, apps/api-cloud/src/schemas/me |
| low | pos/chrome | Kurse nav tier contradicts the documented shipped state (secondary vs primary ch | apps/tauri-pos/src/app/chrome/surface-registry.ts:157, apps/tauri-pos/src/app/ch |
| low | pos/verkauf | Catalog grid ProductTile not memoized — full re-render of up to 60 tiles on ever | apps/tauri-pos/src/screens/verkauf/CatalogGrid.tsx:220-234, apps/tauri-pos/src/s |
| low | pos/verkauf | Cart rows (CartRow / DiscountEditor) re-render on every cart mutation | apps/tauri-pos/src/screens/verkauf/CartPanel.tsx:177-187, apps/tauri-pos/src/scr |