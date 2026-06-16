# Mobile/Companion Repair Plan — engineered, not patched

**Diagnosis verified against `claude/deep-overhaul` (live).** Every root cause below was confirmed in-file, not taken on faith. Three shipping batches + one thing that waits for the iOS plan.

---

## 1. Verdict per defect — confirmed root cause

| # | Defect (his words) | Root cause — confirmed | Location |
|---|---|---|---|
| **Add-product** | | | |
| A1 | "Category should be first — it's not even there" | Mobile form has **zero** category UI; `whAdd()` never reads the tree nor sends `primaryCategoryId`. Proxy already allows the read — SPA just never calls it. | `app.js` whAdd return (~2099-2123); `companion.rs:1633` `get_under("categories")` ✅allowed |
| A2 | "Save is in the middle, not the bottom" | `btn-row[save,saveOnce]` is rendered **before** `moreBtn`+`moreBody` — Save literally precedes half the fields. | `app.js` `el("div",{class:"btn-row"},[saveBtn,saveOnceBtn])` then `moreBtn, moreBody, msg` |
| A3 | "Gold-type / filter fields are hidden" | `Art`/`Zustand`/`Steuerart` live inside `moreBody` (`display:none`), gated behind "Mehr ▾". | `app.js` `moreBody = el(...,style:"display:none")` |
| A4 | (is it even real?) | **Confirmed real creator** — validates, `proxyJson("products","POST")`, uploads photos, persists sticky. Not a stub. | `app.js` whAdd → `proxyJson("products","POST",payload)` |
| **Weight / date** | | | |
| W1 | "300 g shows as 300,0000" | DB `weight_grams NUMERIC(10,4)` → postgres-js returns `"300.0000"`; POS renders the raw string, only swapping `.`→`,`. **Presentational only.** | `LagerTable.tsx:243`; `ProductSheet.tsx:852,1414` |
| W2 | price shows `300.00 €` (dot) | Raw NUMERIC string interpolated, no locale format. | `ProductSheet.tsx:1415` |
| W3 | mobile rejects 3-dp gold weight | SPA reuses 2-dp money validator `isMoney` (`\d{1,16}(\.\d{1,2})?`) for weight; POS uses scale-3. Inconsistent. | `app.js` `isMoney(wgtI.value)` |
| D1 | "Geburtsdatum 15.06.1990 → cryptic English 400" | Label promises `TT.MM.JJJJ`, field sends raw string; server schema is `format:'date'` (ISO), **enforced** by auto-registered ajv-formats; raw AJV message surfaced to UI. **POS-only — companion has no DOB form.** | `customer.ts:34`; `CustomerCreateDialog.tsx:100,191` + 3 siblings |
| **Photos** | | | |
| P1 | "I take a photo and can't see it" | `paintReviewImage` swaps img in **only** on `onload`; `onerror` revokes URL and **restores nothing** → frozen spinner, dead end. | `app.js` paintReviewImage `img.onerror` |
| P2 | iPhone photos never display/save | http LAN → no live camera → file fallback returns **HEIC**; decode-fail catch keeps **raw HEIC**, upload **hardcodes `contentType:"image/jpeg"`**, server sharp has no HEIC → 400, never persisted. | `app.js` fallback catch + `uploadPhoto` `contentType:"image/jpeg"`; `photo-direct-upload.ts` 400 |
| P3 | black photo (iOS live) uploaded silently | `shoot()` pushes frame straight to review — skips `renderJpeg`/`canvasLooksBlack` guard the file path has. | `app.js` `shoot()` `ctx.drawImage`→`toBlob`→`showReview` |
| P4 | spinner hangs forever | `decodeImage`/`paintReviewImage` settle only inside `onload`/`onerror`, **no timeout** → never settles on odd format. | `app.js` decodeImage |
| P5 | "can't replace from gallery" | file input has `capture="environment"` → iOS/Android force camera, kill library. | `app.js` `capture:"environment"` |
| **Inventory** | | | |
| I1 | "can't change type/details on mobile" | (a) editor builds no `itemType` control, PUT body only `{name,listPriceEur,status,isPublishedToWeb}`; (b) server `UpdateProductBody` is `additionalProperties:false` and **omits `itemType`** by fiscal design. | `app.js` saveProduct; `product.ts:155` |
| I2 | "can't tell if it's online vs only in-store; no publish button" | List endpoint **omits `isPublishedToWeb`/`ebayState`** (only `listedOnStorefront/Ebay`) → toggle inits from wrong field; row shows physical state only. | `products-list.ts:145-146` (no `isPublishedToWeb`); `app.js` `statusShort(p.status)` only |
| **Transport / QR / appts** | | | |
| C1 | Android "connection not private" wall | Self-signed cert advertised on **bare IP** (`https://{ip}:{port}`); cert SAN `warehouse14.local` is never published → name-match path dead, IP path always wins (strictest case). | `companion.rs:2180` url=ip; SAN unused |
| C2 | no fingerprint/guidance on pairing screen | Rust exposes `secure`+`tls_fingerprint`; **React interface drops both**. | `GeraeteKoppeln.tsx:26-36` |
| C3 | brittle IP / dead `.local` | mDNS advertises only `_w14pos._tcp` per-pid; never registers `warehouse14.local`. IP breaks on DHCP change. | `mdns.rs` vs `companion.rs:152` |
| C4 | reconnect "never ends" | Flat `setTimeout(...,3000)` in **both** session-revalidate and display socket — no backoff, no jitter → N-device 3s thundering herd. | `app.js` retry/`scheduleReconnect` |
| C5 | stuck "Verbindung wird wiederhergestellt" | Reconnect probe uses **raw `fetch("/cart")`** (no `fetchT`); half-open socket never settles → no retry ever scheduled. | `app.js` `attempt()` raw fetch |
| C6 | stale mother Bearer looks like Wi-Fi outage | Hub remaps 401→503 (correct), but only fix is on mother; nothing tells operator. | `companion.rs` 401→503; `app.js` generic msg |
| C7 | timeout flap | SPA 12s < reqwest 15s < router 30s — **shortest budget is innermost-wrong**; client aborts a call the hub would've finished. | `app.js:379` 12s; `companion.rs` 15s/30s |
| Q1 | QR overflows box / bleeds in dark mode | `qrcode` crate `.min_dimensions(220,220)` → intrinsic ~231px SVG with hardcoded `width/height`, injected into a 200px box with **no `overflow` and no CSS size override**. | `companion.rs:739`; `GeraeteKoppeln.tsx:221-238` |
| Q2 | "dark mode inverts QR" | **Non-issue** — colors hardcoded black-on-white, dark mode is token-only, no `filter:invert`. Symptom is purely the Q1 overflow looking worse on dark panel. | `companion.rs:740-741` |
| T1 | staff-phone booking impossible (empty slots) | `available_slots()` does `CROSS JOIN staff_working_hours`; **prod has 0 rows, no migration ever seeds it**. Storefront uses a different, seeded model — that's why public booking works. | `0012_appointments.sql:491`; **confirmed: no `INSERT INTO staff_working_hours` anywhere** |
| T2 | walk-in name/phone dropped | SPA sends `contactName/contactPhone`; `BookBody` doesn't declare them, INSERT omits the columns. ajv tolerates extras (no 400) but ignores. | `appointments.ts` (no contact_name); storefront route does write them |
| T3 | "~70 red error codes" | **Could not reproduce in this repo** — all 3 client paths emit one message, no loop. The `/termin` page is a Next.js app **outside this repo** (`~/warehouse14-onlineshop`); most likely a React error-boundary/Strict-Mode stack expansion. | needs live capture |

---

## 2. Fix order — 3 batches by impact-on-his-flow

### BATCH 1 — the add-product flow end-to-end *(where he's blocked daily)*

Goal: **category-first → fields visible → photo that actually shows → review → Save pinned at bottom.** One coherent rebuild of `whAdd()`, not five patches.

| Step | Change | Files | Eff | Risk |
|---|---|---|---|---|
| B1.1 | **Category picker FIRST.** Fetch tree via existing `proxyJson("categories","GET")` (proxy already allows it), cache module-scope, build a cascading drill-down mirroring `CategoryPicker.tsx`; render as the first field. On leaf-select, follow `POST products` with a **non-fatal** `PUT products/<id>` carrying `primaryCategoryId/categoryIds` (proxy allows PUT) — exactly as desktop does. | `app.js` (whAdd) | **L** | low |
| B1.2 | **Promote Art/Zustand/Steuerart out of `moreBody`** into the always-visible flow as the "Filter & Gold-Art" group, after Bezeichnung/Preis. `typeS/condS/taxS` are already module-scoped — just re-parent. | `app.js` | M | low |
| B1.3 | **Reorder to one top-down flow, Save LAST.** New order: Kategorie → Bezeichnung+Preis → Art/Zustand/Steuerart → Foto → Lagerort → optional rares in a small disclosure → review notice → **`btn-row` pinned at bottom** (sticky footer `class:"pad"` bar). | `app.js` | M | low |
| B1.4 | **Weight 3-dp validator.** Add `isWeight`/weight-normalizer (`^\d{1,10}(\.\d{1,3})?$`) replacing `isMoney` at the weight call sites — matches POS scale-3 + the `NUMERIC(10,4)` column. | `app.js` | S | low |
| B1.5 | **Photo P1 — never dead-end review.** In `paintReviewImage` `img.onerror`: clear spinner, show "Bild ließ sich nicht anzeigen — neu aufnehmen" + force retake controls. Add 8s watchdog around `onload`. | `app.js` | S | low |
| B1.6 | **Photo P4 — decode timeout.** Add timeout race in `decodeImage` (reject after ~8s) so the existing `.catch` restores retake state. Clear timer in both ok + error. | `app.js` | S | low |
| B1.7 | **Photo P3 — black-frame guard on live capture.** Route `shoot()` through the same `renderJpeg`/`canvasLooksBlack` path as the file capture; on black, stay in capture with a German notice instead of uploading black. | `app.js` | S | low |
| B1.8 | **Photo P2 — never upload undecoded HEIC.** On `renderJpeg` reject, do **not** keep raw `f` — block `useShot` until a real JPEG/WebP exists; pass `blob.type || "image/jpeg"` to `uploadPhoto` instead of hardcoding. (Client re-encode is the fix; server libheif is the optional belt.) | `app.js` | M | med |
| B1.9 | **Photo P5 — gallery replace.** Offer two inputs: "Aufnehmen" (`capture=environment`) + "Aus Galerie wählen" (no `capture`); wire review "replace" to the gallery chooser. | `app.js` | S | low |
| B1.10 | **Weight/price display (POS render).** Add `formatGrams(raw)` + reuse `fmtEur` in `apps/tauri-pos/src/lib/decimal.ts`; replace raw interpolation at the 3 render sites so 300→"300 g", price→"300,00 €". **Do NOT touch the NUMERIC(10,4) column** — melt-math needs it. | `decimal.ts`, `LagerTable.tsx:243`, `ProductSheet.tsx:852,1414,1415` | S | low |
| B1.11 | **DOB German→ISO.** Add `germanDateToIso()` in `apps/tauri-pos/src/lib/`; call in the 4 submit builders + block submit with a German inline message on null; format ISO→`TT.MM.JJJJ` on display; masked numeric input. *(POS-only — companion has no DOB form, confirmed.)* | `CustomerCreateDialog.tsx:100`, `CustomerPanel.tsx:647`, `KaeuferPicker.tsx:677`, `CustomerEditDialog.tsx:85` + 1 lib | M | low |

> B1.11 (DOB) and B1.10 (weight/price) are **POS-screen** edits, not companion `app.js` — they ride the same OTA but are independent of the mobile rebuild, so they can land/verify first as quick wins.

### BATCH 2 — inventory status + publish control + editable details

| Step | Change | Files | Eff | Risk |
|---|---|---|---|---|
| B2.1 | **Server: surface publish/channel in list.** Add `isPublishedToWeb` + `ebayState` to the `products-list` select **and** the response map **and** the `ProductListResponse` TypeBox item (Fastify strips fields absent from the response schema — the known repo gotcha). | `products-list.ts:145,247` + response schema | M | low |
| B2.2 | **Mobile: channel indicator in row.** In `inventoryRow`, render a 2nd badge beside `statusShort`: green "Online" when `isPublishedToWeb===true`, muted "Nur Laden" otherwise, "eBay" chip when `ebayState==="ONLINE"`. Forward `ebayState` in `normalizeProducts`. | `app.js` | M | low |
| B2.3 | **Mobile: per-item publish toggle.** Inline button PUTs `{isPublishedToWeb}` to `products/<id>` (proxy already allows PUT/GET). Have `openDetail` **re-fetch `GET products/<id>`** so the toggle inits from true `isPublishedToWeb`, not the `listedOnStorefront` fallback. | `app.js` | M | low |
| B2.4 | **Mobile: editable details that the server accepts.** Add `condition`, `descriptionDe`, stamp `stampErhaltung/stampMinr`, `primaryCategoryId` to the editor + `saveProduct` body — all already in `UpdateProductBody`. | `app.js` | M | low |
| B2.5 | **Type (Art): show read-only, don't fake-edit.** Display `itemType` via the German `ITEM_TYPES` map so the worker sees it. **Do NOT make it freely editable** — it's a fiscal classification (§25a/§25c). True re-typing needs a separate audited ADMIN/step-up correction route, scoped out of this update. | `app.js` (+ noted as future server route) | S (display) | med (policy) |

### BATCH 3 — connection / stability / Android warning / QR / appointments

| Step | Change | Files | Eff | Risk |
|---|---|---|---|---|
| B3.1 | **QR overflow (fixes the visible dark-mode bleed).** Add `overflow:hidden` to the QR box + scoped `.qrBox svg { width:100%; height:100%; display:block }`; or strip the SVG's hardcoded `width/height` before inject and rely on `viewBox`. Keep `background:#fff`. | `GeraeteKoppeln.tsx:221-238` (+ optional `companion.rs:739`) | S | low |
| B3.2 | **Backoff + jitter.** Replace both flat 3s delays with capped exponential `min(30s, 1s·2^n) ±20%`, reset on success. | `app.js` retry + `scheduleReconnect` | S | low |
| B3.3 | **Reconnect probe through `fetchT`.** `fetch("/cart")` → `fetchT("/cart",{...},8000)` so a half-open socket aborts and backoff actually fires. | `app.js` `attempt()` | S | low |
| B3.4 | **Order the timeout budgets.** Innermost shortest: raise SPA proxied-call default to ~20s (or lower reqwest to ~10s) so a slow cloud surfaces as one upstream error, not a client abort that reads as a dropped LAN link. | `app.js:379` (+ `companion.rs`) | S | low |
| B3.5 | **Display poll: slow + visibility-pause + no double-arm.** Fallback poll 3–5s, pause on hidden tab (mirror `startApptPoll`), guarantee interval cleared before re-arm. | `app.js` | S | low |
| B3.6 | **Pairing-screen fingerprint + explainer (kills the "terror").** Add `secure?`/`tlsFingerprint?` to the TS interface; render grouped-hex fingerprint + calm German note: "Beim ersten Verbinden zeigt das Handy eine Sicherheitswarnung — im eigenen WLAN normal. Erweitert → Trotzdem fortfahren. Prüfziffer: …". | `GeraeteKoppeln.tsx:26-36, 217-289` | S | low |
| B3.7 | **Stale-Bearer banner on the mother.** Re-call `companion_set_auth` whenever the cloud token renews; POS banner when hub Bearer is empty/stale ("Begleit-Geräte sind getrennt — bitte anmelden"). Optionally distinguish 503-from-hub vs transport in the SPA message. | mother React + `companion.rs` | M | low |
| B3.8 | **Appointment slots — seed `staff_working_hours`.** Idempotent migration: `INSERT … ON CONFLICT DO NOTHING` for the 2 prod staff with the Mo–Fr 10–18 / Sa 10–14 bands already in `system_settings 'appointments.business_hours'`. (Or unify so `available_slots()` falls back to business_hours.) **Until this, the staff phone cannot book — confirmed 0 rows live.** | new migration | M | low |
| B3.9 | **Appointment walk-in fields.** Add `contactName/contactPhone` to `BookBody`, map `customerPhone→contact_phone`, write the existing `contact_name/contact_phone` columns (mirror storefront route); drop the `customer_notes`-stuffing fallback. | `appointments.ts` + `app.js` | S | low |
| B3.10 | **Android cert wall — proper fix (the heavy part).** Register mDNS `warehouse14.local` → hub IP, advertise `https://warehouse14.local:8714` (matches the SAN), encode that in the QR. Stable across DHCP + one-time-trustable. **This is the only L item in Batch 3 and the riskiest** — see §4. | `mdns.rs`, `companion.rs:152,2180` | L | med |

---

## 3. "No more patchwork" guardrails — how each fix is **verified on the real mobile flow**, not just compiled

Every change is proven on the actual SPA before it ships. The hub **static-serves `app.js`** — no Rust rebuild needed to test SPA logic, so the loop is fast.

1. **Serve the SPA locally + drive it in a real mobile viewport.** `node -c app.js` (syntax gate) → serve `companion-web/` → open in **Preview MCP** resized to a phone viewport (`preview_resize` ~390×844) → `preview_snapshot`/`preview_screenshot` after each batch. The visual claims (Save-at-bottom B1.3, category-first B1.1, QR-no-overflow B3.1 **toggled into dark mode**, channel badges B2.2) are signed off from a screenshot, not from "it compiles".
2. **Photo pipeline — drive the actual failure inputs.** Feed the file-input path a **synthetic HEIC and a corrupt blob** and confirm: P1 shows the retake control (no frozen spinner), P4 times out to retake, P3 black-canvas stays in capture, P2 blocks upload until a JPEG exists. Confirm via `preview_console_logs` that `uploadPhoto` sends `blob.type`, not hardcoded jpeg.
3. **Mock the proxy for offline component tests.** Stub `/categories`, `/products`, `/products/:id` so B1.1 picker, B2.1–B2.4 inventory, and the publish toggle are exercised end-to-end against canned payloads — proving the SPA actually *renders* the new server fields.
4. **Server fields proven against the live response, not the schema.** For B2.1 and B3.9, after redeploy **curl prod** and grep the JSON for `isPublishedToWeb`/`ebayState` and a booking echoing `contact_name` — because *Fastify strips fields absent from the response schema* has bitten this repo before. Schema green ≠ field present.
5. **Appointment slots proven on prod data.** After B3.8, run `SELECT count(*) FROM available_slots('CONSULTATION',30,now(),now()+'2 days',NULL,NULL)` against prod and require **> 0** before declaring the staff phone bookable. (It's 0 today — that's the whole bug.)
6. **Transport fixes proven by induced failure, not reasoning.** Kill the mother mid-session and watch the SPA console: backoff intervals must **lengthen** (B3.2), the half-open probe must **abort at ~8s** and reschedule (B3.3), and the stale-Bearer banner must appear on the mother (B3.7).
7. **DOB/weight proven on the POS, in the POS.** `pnpm --filter tauri-pos test` for `germanDateToIso` + `formatGrams` (round-trip `15.06.1990`↔ISO, `"300.0000"`→"300 g", `"7.965"`→"7,965 g"), then run the POS in mock and type a German date + a 300 g item and read the rendered string.
8. **Lint/typecheck net-zero-new** (`pnpm lint:all`, measure via stash, not against the stale 1121) + `cargo check` for any Rust touch.

Nothing is called "done" off a green build. Each item has a *behavioural* check on the real surface.

---

## 4. What ships as one update vs. what waits for the iOS trusted-connection plan

### Ships as ONE OTA (POS version bump → tag → release → `gh release edit --latest`)
The entire SPA lives in the POS bundle and the POS-screen edits ride the same build:

- **All of Batch 1** (category-first, field promotion, Save-at-bottom, all 5 photo fixes, weight 3-dp, weight/price display, DOB).
- **All of Batch 2** (publish/channel — needs the **api + migrate redeploy** for B2.1, done alongside).
- **Batch 3 except B3.10**: QR overflow (B3.1), backoff (B3.2), probe timeout (B3.3), budget ordering (B3.4), poll throttle (B3.5), fingerprint+explainer (B3.6), stale-Bearer banner (B3.7), appointment slots seed (B3.8 — migration+redeploy), walk-in fields (B3.9 — api redeploy).

> Server-side pieces (B2.1, B3.8, B3.9) require the standard **api/migrate redeploy** (buildx arm64 → save → ssh load) *before* the OTA, and the response fields must be curled on prod first (guardrail #4).

### Waits for the separate, already-documented iOS trusted-connection plan
- **B3.10 — `.local` mDNS + name-matched HTTPS cert** (task **#89**, "mDNS .local publish", still pending). This is the only **L/medium-risk** transport item and it's the real fix for the iOS secure-context **live camera** and the permanent one-time-trust. It's intentionally decoupled because it needs Basel's physical iPhone to validate the trust-once flow and the mDNS resolution on real iOS/Android — exactly the "iOS trusted-HTTPS for the LIVE camera deferred (needs Basel's iPhone)" gate already in the record.
  - **Crucially, the scary-wall *symptom* is softened in the shipping update** by B3.6's fingerprint+explainer — the wall stops reading as danger now, while the permanent name-stable cert lands with the iOS plan.
- **T3 ("~70 red errors")** — the `/termin` source is the Next.js app **outside this repo** (`~/warehouse14-onlineshop`). Cannot be fixed from here. Action: capture the phone's console/network on `https://79.76.116.239/termin`; the likely fix (error-boundary hardening + disabling Strict-Mode double-mount) lands in that separate repo. **B3.8 removes the most likely *real* staff-phone booking failure regardless.**
- **B2.5 true re-typing** — deliberately **not** in this update. Retroactively changing `item_type` rewrites the tax treatment of an already-booked acquisition; it needs its own audited ADMIN/step-up correction route. This update only makes the type **visible** read-only.

---

**Relevant paths (all absolute):**
- Companion SPA — `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src-tauri/companion-web/app.js`
- Hub/proxy/QR/cert — `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src-tauri/src/commands/companion.rs`, `…/src/commands/mdns.rs`
- Pairing UI — `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src/screens/secondary/GeraeteKoppeln.tsx`
- POS render/format — `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src/lib/decimal.ts`, `…/screens/lager/{LagerTable,ProductSheet,NeuesProduktDialog}.tsx`
- POS DOB forms — `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src/screens/kunden/{CustomerCreateDialog,CustomerPanel,KaeuferPicker,CustomerEditDialog}.tsx`
- Server — `/Users/basel/Desktop/warehouse14/apps/api-cloud/src/routes/{products-list,appointments}.ts`, `…/src/schemas/{product,customer}.ts`
- Appointment slots — `/Users/basel/Desktop/warehouse14/packages/db/migrations/0012_appointments.sql` (new seed migration to add)