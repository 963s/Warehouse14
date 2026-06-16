# Warehouse14 — Illogical / Half-Built Findings (verified against live `claude/deep-overhaul`)

All file:line refs below were spot-checked against the running branch. Severities re-graded by real-world money/legal/usability impact.

## BLOCKERS — wrong money or wrong law

**B1. Shift-close writes a malformed money string on a negative drawer (the everyday gold-buy case).**
`shifts.ts:324` formats cents as `${expectedCents/100n}.${String(expectedCents%100n).padStart(2,'0')}` with no sign handling. BigInt keeps the sign on both `/` and `%`, so −150 cents → `-1.-50`, −5 → `0.-5`. For an Ankauf-heavy shift (cash paid out for gold > cash sales + float) `expectedCents` is routinely negative. That malformed string lands in `shifts.system_expected_eur` (a `DecimalString` column) and feeds the `variance_eur` generated column → either a 500 on response serialization or a corrupted Kassensturz variance. The sibling `closings-finalize.ts:78-82 fromCents` already does it right.
*Fix:* extract `fromCents` to a shared helper and use it in both. **Effort: S.**

**B2. B2B reverse-charge sale ≥ €2.000 is blocked until a second, redundant KYC buyer is attached — then that buyer is discarded.**
`needsBuyer` (BezahlenDialog.tsx:431) keys only off `selectedBuyer`, ignoring the VIES-verified company. So a fully-identified B2B sale shows "Käufer zuordnen" and refuses to finalize until a private KYC buyer is also picked — then `finalizeWithTse` (453-479) overwrites `customerId` with the company id, throwing away the buyer the cashier was forced to verify. Confirmed at line 453 (`customerId = selectedBuyer?.id`) then the `if (isB2b)` block reassigns it.
*Fix:* when `isB2b` + VIES-valid company is resolved, treat it as satisfying the §10 gate (feed its id into the KYC eval, or skip `needsBuyer` for reverse-charge). **Effort: S.**

**B3. Bewertung/Konvolut acceptance applies the WRONG KYC threshold — €2.000 instead of "ID from €0,01" — for the identical legal act as Ankauf.**
`AcceptanceDialog.tsx:100-109` re-implements its own gate: `gwgThresholdReached = totalCents >= gwgCents`, never importing `evaluateKycGate` and never passing `direction:'ANKAUF'`. The single-item Ankauf path (`AnkaufBezahlenDialog.tsx:134`) correctly uses `evaluateKycGate({direction:'ANKAUF'})`, which requires ID from the first euro (`ankauf-kyc-gate.ts:82`) plus the §10 rolling window. So a €1.999 lot bought via "Konvolut bewerten" needs no KYC stamp in the UI, while the same goods entered one-by-one force one. The server trigger likely still blocks it, but the operator hits a cryptic server error instead of guidance.
*Fix:* replace the inline check with `evaluateKycGate({direction:'ANKAUF', ...})`, identical to Ankauf. **Effort: S.**

## HIGH — silent data loss or broken core feature

**H1. Split-brain storefront publishing: a product can be "LIVE im Web-Shop" yet permanently un-buyable.**
Catalog visibility gates on `is_published_to_web` (`storefront-catalog.ts:394`); add-to-cart gates on a *different* column `listed_on_storefront` (`storefront-cart.ts:208`). The live create path hardcodes `listedOnStorefront: false` (`ProductSheet.tsx:351`) and the publish toggle only flips `isPublishedToWeb` (`WebSeoPanel.tsx:106`). No POS surface ever sets `listed_on_storefront=true` → published products show in the catalog and reject every add-to-cart.
*Fix:* one flag drives both. Simplest: make cart/reserve read `is_published_to_web`; retire `listed_on_storefront`. **Effort: S** (or M if you also migrate the column).

**H2. Appraisal melt-value + weight/fineness break on a German comma, while the parallel Ankauf math handles it.**
`bewertung-math.ts:23` is a bare `/^\d+(\.\d+)?$/` with no `commaToDot`; `intake-math.ts:101-103` calls `commaToDot` first. So "7,965" in the appraisal form makes `computeSchmelzwertEur` throw/return null (Schmelzwert hint just vanishes → looks like "no price data"), and `AppraisalItemForm.tsx:106` sends the comma string straight to the server → 400 on the NUMERIC.
*Fix:* make `bewertung-math.parseScaled` comma-tolerant (reuse `commaToDot`, or delete the file and import from `intake-math`); normalize before sending. **Effort: S.**

**H3. Appraisal value field uses `normalizeDecimal`, which divides any thousands-dot price by 1000.**
`AppraisalItemForm.tsx:89,100` pipe the offer through `normalizeDecimal`, which treats the first dot as decimal and strips later dots (`decimal.ts:16-26`). "1.500" → "1.50". Antique/coin appraisals are routinely four+ figures; the lot lump-sum in `AppraisalItemsList.tsx:404` only does `.replace(',','.')` with no thousands guard. Ankauf deliberately avoided this with `EuroInput`. Three parsers for the same money, the riskiest one on the biggest amounts.
*Fix:* use `EuroInput` (or the comma-only normalizer) for the appraisal value and lot offer. **Effort: S.**

**H4. "weitere laden" replaces the page instead of appending — you cannot view past row 50.**
`Lager.tsx:138` renders only `q.data?.items` for the current offset; "weitere laden" bumps `pageOffset` and re-queries with no accumulator (`Lager.tsx:370`), so rows 1–50 are swapped for 51–100 while the footer still reads "50 von 312".
*Fix:* `useInfiniteQuery` flattened, or an explicit accumulator reset on filter change. **Effort: M.**

**H5. Two non-communicating dark-mode systems with different localStorage keys clobber each other.**
`lib/theme.ts` (key `warehouse14.theme`) backs boot `initTheme()` + the header/login `<ThemeToggle>`; `state/theme-store.ts` (key `w14.theme`) backs AppShell + Cmd+Shift+D. AppShell re-asserts `data-theme` from the store on every render (AppShell.tsx:104-107), so a dark choice on the PinLogin screen is overwritten on mount; the header toggle's Sun/Moon icon goes stale vs Cmd+Shift+D; and the two keys diverge across restarts. Both keys confirmed live.
*Fix:* one source of truth (the zustand store). Point `<ThemeToggle>` and `main.tsx` boot at the same key; reduce `lib/theme.ts` to a thin pre-paint reader or delete it. **Effort: M.**

## MEDIUM — security gaps, integrity, confusing UI

**M1. `POST /shifts/:id/cash-movements` has no owner/device check.** `shifts.ts:201-228` only verifies the shift exists + is OPEN. Any CASHIER/ADMIN can record a bank-drop/safe-transit/injection against *another terminal's* shift, silently altering its expected-drawer math and forensic variance — while open/close are device-bound + step-up gated. *Fix:* assert `s.deviceId === req.deviceId` and/or require step-up for BANK_DROP/SAFE_TRANSIT. **Effort: S.**

**M2. Step-up policy is inverted: writing integration SECRETS needs only ADMIN; nudging a tax tunable needs a fresh PIN.** `integrations.ts:439` (PUT secrets) has `requireRole('ADMIN')` and no `requireStepUp`; `settings.ts:236` (PATCH) has `requireStepUp`. A stale ADMIN session can swap WhatsApp/Chatwoot/AI credentials but not a tax threshold. *Fix:* add `requireStepUp(req)` to the integrations PUT (and the test-connection POST). **Effort: S.**

**M3. Shopper login brute-force protection is 30× weaker than staff.** `rate-limit.ts:58-67` PREFIX_LIMITS covers `/api/auth/` (10/min) but not `/api/storefront/auth/` — the shopper sign-in (`storefront-auth.ts`) falls through to the 300/min default. The per-account DB lockout doesn't cap password-spraying across many accounts from one IP. *Fix:* add `{ prefix:'/api/storefront/auth/', max:10 }`. **Effort: S.**

**M4. Receipt-result screen always shows "Bar erhalten" + "Wechselgeld" — even for a card-only sale.** `ReceiptResult` (BezahlenDialog.tsx:2412-2480) takes only `cashReceivedEur`/`changeEur` and unconditionally renders both rows; on a card sale that prints "Bar erhalten 0,00 €". For a split sale it shows only the cash leg, no card amount. *Fix:* pass payment method; render cash rows only when a cash leg exists. **Effort: S.**

**M5. Expected-drawer figure ignores Einlagen/Entnahmen and assumes cash-only revenue.** `KassenbuchPanel.tsx:61-66` sets `estimatedExpectedEur = openingFloat + currentShiftRevenueEur`, labelled "Erwarteter Kassenbestand", but never folds in the Einlage/Entnahme buttons it renders, and overstates by every card sale if the revenue aggregate isn't cash-only → phantom shortage at count time. *Fix:* confirm revenue is cash-tender-only; fold Einlagen(+)/Entnahmen(−) in, or relabel. **Effort: M.**

**M6. Control Desktop connection pill never probes on launch — stuck at "unbekannt".** `App.tsx:128` defines `checkConnection`; the only call site is the pill's `onClick` (187). The three mount effects (clock, theme, keydown) confirmed — none probe. A down backend looks identical to a never-checked one. *Fix:* `useEffect` calling it on mount + a 30s interval (the clock effect already polls). **Effort: S.**

**M7. Approval action invalidates a TanStack key nothing reads.** `ApprovalsPanel.tsx:130` invalidates `['bridge','overview']`, but `BridgeDashboard` uses a hand-rolled `useState`+`setInterval` (`useBridgeData`), no query key — confirmed. The cross-surface refresh is a no-op; the approvals tile stays stale until the 30s poll. (Also the key says 'overview' while the live endpoint is `/api/bridge/summary`.) *Fix:* migrate the Bridge to `useQuery(['bridge','summary'])` and invalidate that, or call its `refetch`. **Effort: M.**

**M8. `digit-nav.test.ts` tests fabricated data — green-lights a contract the app doesn't honor.** The fixture hardcodes `{digit:8, path:'/schreiben'}` and asserts `'8' → '/schreiben'` (test lines 18, 27), but the real registry has Schreiben at `digit:7` and no surface at 8 (surface-registry.ts:236). The test passes against its own fiction and can never catch a real digit-nav regression. *Fix:* import the real surfaces (or fix to `digit:7` + assert `8 → null`). **Effort: S.**

**M9. Duplicated config homes invite contradictory state.** Three overlapping clusters, all confirmed: (a) server-backed `IntegrationenSection` vs legacy localStorage `AiSection`/`SocialSection`/`ChatwootSection` configure the same four services in different stores (Einstellungen.tsx:70-99 vs IntegrationenSection.tsx:56-99); (b) AI toggles `visionEnabled`/`priceEstimateEnabled` + social handles are read by nothing (grep → zero consumers outside the store/screen) — switches that do nothing; (c) two tax-export UIs (`/steuer-export` surface + Einstellungen "steuer" section) duplicate the same `closingsApi` calls + step-up logic. *Fix:* one config home per service; delete or wire the dead toggles; extract one shared export component. **Effort: M.**

**M10. Two orphaned dialogs left in the tree.** `NeuesProduktDialog.tsx` (33 KB, untracked) and `InventoryAdjustmentDialog.tsx` are imported by nothing (ProductSheet's own header says it replaced them); grep confirms zero importers. Worse, the dead `NeuesProduktDialog.tsx:249` holds the *correct* `listedOnStorefront: willPublish` behavior the live sheet lost (see H1). `WebSeoPanel.tsx:4` docblock still names the dead parent. *Fix:* port the storefront-flag coupling into ProductSheet, then delete both; fix the docblock. **Effort: S.**

## LOW — vestigial fields, dead labels, minor UX (one-liners)

- **`listedOnEbay` is a redundant writable duplicate of `ebayState === 'ONLINE'`** — settable in PUT, never an operator control, can silently disagree after a delist (`product.ts:165`, `products.ts:351`). Derive it; drop from PUT/create. **S**
- **Bewertung seller-pick dead-ends** on "Bitte zuerst Kunde im Tab Kunden anlegen" with no inline create, unlike Ankauf's `CreateMode` (`BewertungCustomerStep.tsx:150`). Reuse the shared picker. **M**
- **Two stacked quick-tender rows** in the cash panel — smart "Schnellzahlung" chips above `AmountPad`'s own absolute 5/10/20 notes that undershoot a €1.500 due (BezahlenDialog.tsx:2045 + 2106). Pass `notes={[]}` or drop one row. **S**
- **Voucher redemption only on the cash tab** — no voucher+card path (BezahlenDialog.tsx:1959-2200). Move VoucherField above the method area, or label the limit. **S**
- **"Rabatte entfernen" wipes every per-line discount with no confirm/undo** (CartPanel.tsx:952), unlike line removal's 8s undo. Only show when a discount exists; add confirm/undo. **S**
- **Ankauf CTA hard-labelled "Bezahlen — Bar auszahlen"** even when the payout is a bank transfer chosen later (IntakeList.tsx:176 vs AnkaufBezahlenDialog.tsx:545). Make it neutral. **S**
- **Suggested-buy auto-prefill re-overwrites a deliberately cleared price** (IntakeList.tsx:416) — emptiness is the only signal. Add a `touched` ref. **S**
- **Offline Ankauf prints Code128 labels keyed on the operator-typed SKU as product id** before sync confirms it (AnkaufBezahlenDialog.tsx:273) — label may not scan if the server renumbers. Defer printing or mark it a provisional intake slip. **M**
- **LagerTable "anpassen" is inert italic text in the action column**, not a button (LagerTable.tsx:410) — fails keyboard/SR. Make it a real button or remove it. **S**
- **No reprint affordance on the ReceiptResult screen** — closing the preview loses the in-checkout reprint path (BezahlenDialog.tsx:1477). Add "Beleg drucken" re-opening the stored preview. **S**
- **Bridge re-implements StatusDot with raw hex** (`#16a34a/#ca8a04/#dc2626`, BridgeDashboard.tsx:52) instead of `--w14-*` tokens, so surface-1 colors differ from every other panel and don't track dark mode. Reuse the shared component. **S**
- **Bridge surfaces DLQ count twice** (left rail + center tile, BridgeDashboard.tsx:210 & 259). Pick one home. **S**
- **Non-canonical error envelopes**: rate-limit 429 (`{statusCode,error,message}` not `{error:{code,requestId}}`, plus a comment claiming the opposite, rate-limit.ts:123); calendar.ts:54 (`CALENDAR_ERROR`, leaks raw upstream message, no requestId); storefront-auth-google.ts:139/195 (`NOT_CONFIGURED`, no requestId). Route through the central error-handler. **S each**
- **Customer PII step-up only fires if already KYC-verified** (`customer-update.ts:130`) — exactly the pre-verification window where an identity swap matters is unprotected. Require step-up unconditionally for name/DOB/address. **S**
- **Stale comments lying about reality**: `products-list.ts:5-12` (claims the public storefront route is "Phase 1.5 / future" — it shipped); `AppShellHeader.tsx:4` + `surface-registry.ts:43` (ASCII nav diagram shows 1..8 with Werkstatt=#1, Bewertung=#8 — real order is Verkauf=1…Schreiben=7, Bewertung secondary). Comment-only fixes. **S each**
- **Dead `googleCalendar` store config + `setGoogleCalendar`** — no reader/writer; UI replaced by server `GoogleKalenderStatusCard` (integration-settings-store.ts:24-40). Delete. **S**
- **Spotlight alias collision**: `/termine` and `/kalender` both claim "kalender"/"calendar" (surface-registry.ts:298-323). Tighten aliases or merge. **S**
- **`onUndoRemove` casts a minimal object `as ProductListRow`** (Verkauf.tsx:342) — works only because `onSelectProduct` reads few fields; hides a contract gap. Store the original row. **S**
- **ApprovalsPanel types+fetches `eventId` but never uses it** (ApprovalsPanel.tsx:34) — resolution is transaction-scoped; the field implies otherwise. Drop or surface it. **S**
- **Several DB-modeled product fields are write-capable but uneditable in the UI**: `feingewichtGrams`, `collectorPremiumEur`, `provenanceNotes`, `descriptionEn`, `seoTitleEn`, `seoDescriptionEn`, `schemaOrgType`, `marketingAttributes` (products-detail.ts / product.ts schema, zero POS consumers). English storefront copy + JSON-LD can never be populated. Add inputs (WebSeoPanel/DetailsEditor) or drop from the schema. **M**

---

## TOP 5 TO FIX FIRST

1. **B1 — negative-drawer money bug (`shifts.ts:324`).** Corrupts or 500s the daily Kassensturz for a gold-buying shop, where a negative expected drawer is the *normal* case. S effort, shared `fromCents` already exists. Fix today.
2. **B3 — Bewertung KYC threshold (`AcceptanceDialog.tsx:100`).** A €1.999 lot buys with no ID stamp through one of two doors to the same legal act — a GwG/§259 exposure. S effort; swap in `evaluateKycGate`.
3. **B2 — B2B forced-then-discarded buyer (`BezahlenDialog.tsx:431/453`).** Blocks every B2B sale ≥ €2.000 behind a contradictory step, then throws the work away. S effort.
4. **H1 — split-brain storefront flag.** Every "published" product is silently un-buyable online; the whole reserve-and-pickup pipeline is dead on arrival. S effort, one-column decision.
5. **H2 + H3 — appraisal comma + thousands-dot parsers.** Both silently mangle real money on the largest, lowest-volume transactions (a "1.500" appraisal becomes 1,50 €, or the server 400s). S effort each; converge on `EuroInput` + `commaToDot`.

All five are S effort and confirmed live. M1 (cash-movements auth) and H4 (Lager pagination) are the strongest runners-up.