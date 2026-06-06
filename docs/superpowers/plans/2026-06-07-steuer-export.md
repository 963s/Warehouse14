# Steuer-Export Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. TDD the pure CSV builder; wire the rest.

**Goal:** A POS "Steuer-Export" surface where ADMIN + the READONLY Steuerberater list daily closings and download the tax exports on demand (DATEV + Kassenbericht), with DSFinV-K status surfaced.

**Architecture:** Server already exposes `GET /api/closings` (list) + `GET /api/closings/:id/export/datev` (DATEV CSV, ADMIN+step-up). We (a) widen those to READONLY, (b) ADD `GET /api/closings/:id/export/kassenbericht` (real close figures → CSV, ADMIN+READONLY+step-up), (c) add a typed `closings` api-client domain + a `responseType: 'text'` path so CSV bodies survive the middleware chain (which otherwise JSON-parses), (d) add a Tier-2 `/steuer-export` surface with per-row download buttons. No fiscal row is mutated; every number is server-sourced.

**Tech Stack:** Fastify + Drizzle (api-cloud), TanStack Query + React (tauri-pos), typed api-client, vitest, biome.

---

## Audit conclusions (sourcing / decisions)

- **DATEV** export EXISTS (`/export/datev`, real txns → SKR03 booking lines). Widen to READONLY.
- **Kassenbericht** — NO endpoint. ADD one. Source = the REAL `daily_closings` row (all figures present: business_day, state, counts, gross/net verkauf/ankauf, `vat_by_treatment` JSONB, `payments_by_method` JSONB, cash expected/counted/variance, TSE counts, finalized_at). NOT recomputed.
- **DSFinV-K** — NO download endpoint; only the worker `dsfinvk_daily_export` job pushes to Fiskaly cloud. → SURFACE that as info, do not build a download.
- **GDPdU/GoBD `.dtd` bundle** — does not exist; DEFER (flagged follow-up). DSFinV-K is the modern cash-register equivalent.
- **Roles**: `requireRole(req, 'ADMIN','READONLY')` is variadic-ok. READONLY = Steuerberater. Step-up = `requireStepUp` (10-min window), keep on downloads.
- **PDF**: no Typst/PDF compiler in repo → CSV is the pragmatic, house-consistent format (DATEV is CSV).
- **api-client**: terminal `JSON.parse`s every body → CSV would throw. Add `responseType: 'text'` opt threaded to the terminal; on 2xx text, skip JSON.parse. Errors stay JSON so the step-up interceptor still fires.

## File Structure

- Create `apps/api-cloud/src/lib/kassenbericht-export.ts` — pure `buildKassenberichtCsv(closing)` (German labelled semicolon CSV).
- Create `apps/api-cloud/tests/unit/kassenbericht-export.test.ts` — TDD the builder.
- Modify `apps/api-cloud/src/routes/closing-export.ts` — widen roles to READONLY; add the kassenbericht route.
- Modify `packages/api-client/src/types.ts` + `middleware.ts` + `client.ts` — add `responseType: 'text'`.
- Create `packages/api-client/src/domains/closings.ts` — `ClosingListItem`, `closingsApi.{list,datevCsv,kassenberichtCsv}`.
- Modify `packages/api-client/src/index.ts` — export the domain.
- Create `apps/tauri-pos/src/lib/download-file.ts` — `downloadTextFile(filename, text, mime)`.
- Create `apps/tauri-pos/src/screens/secondary/SteuerExport.tsx` — the surface.
- Modify `apps/tauri-pos/src/app/chrome/surface-registry.ts` — Tier-2 entry (≤8 Tier-1 cap untouched).

---

## Task 1 — Pure Kassenbericht CSV builder (TDD, api-cloud)

**Files:** Create `lib/kassenbericht-export.ts` + `tests/unit/kassenbericht-export.test.ts`.

- [ ] Write failing test: `buildKassenberichtCsv` emits a header line, the business day, state, net Verkauf/Ankauf, cash expected/counted/variance, TSE counts, and one row per VAT-treatment + payment-method entry; German decimals (comma); semicolon-delimited; no fabricated values (only what's in the closing object).
- [ ] Run → fails (module missing).
- [ ] Implement `buildKassenberichtCsv(c: KassenberichtInput): string` — pure, string-in/string-out; numbers already strings.
- [ ] Run → green. biome clean.

## Task 2 — Widen roles + add kassenbericht route (api-cloud)

**Files:** Modify `routes/closing-export.ts`.

- [ ] `GET /api/closings`: `requireRole(req, 'ADMIN','READONLY')`.
- [ ] `GET /api/closings/:id/export/datev`: `requireRole(req, 'ADMIN','READONLY')` (keep step-up).
- [ ] Add `GET /api/closings/:id/export/kassenbericht` — auth + `requireRole('ADMIN','READONLY')` + `requireStepUp`; load the full closing row; `buildKassenberichtCsv`; `Content-Disposition: attachment; filename="Kassenbericht_<day>.csv"`; `text/plain; charset=utf-8`.
- [ ] typecheck api-cloud green.

## Task 3 — api-client `responseType:'text'` + closings domain

**Files:** Modify `types.ts`, `middleware.ts`, `client.ts`; create `domains/closings.ts`; modify `index.ts`.

- [ ] Add `responseType?: 'json' | 'text'` to `RequestOptions` + `RequestMeta`; thread in `request()`; in terminal, on 2xx when `meta.responseType==='text'` return raw text (skip JSON.parse). Errors unchanged.
- [ ] `domains/closings.ts`: `ClosingListItem` type (mirrors server), `closingsApi.list`, `.datevCsv(id)` + `.kassenberichtCsv(id)` via `request<string>(..., { responseType:'text' })`.
- [ ] Export from `index.ts`. typecheck + build api-client green.

## Task 4 — POS surface + download helper + registry

**Files:** Create `lib/download-file.ts`, `screens/secondary/SteuerExport.tsx`; modify `surface-registry.ts`.

- [ ] `downloadTextFile(filename, text, mime)` — Blob + object URL + temporary `<a download>` click + revoke.
- [ ] `SteuerExport.tsx`: role-gate (ADMIN/READONLY else notice); `useQuery(['closings','list'])`; table of closings (date, state chip, net Verkauf/Ankauf, TSE health "alles signiert / N Lücke"); per-row DATEV + Kassenbericht buttons (≥48px, Icon) that fetch the CSV (step-up interceptor auto-handles 403) → `downloadTextFile`; a DSFinV-K info note (auto Fiskaly push) + a GDPdU follow-up note.
- [ ] Registry: Tier-2 `/steuer-export`, label "Steuer-Export", no digit, aliases (datev, kassenbericht, dsfinvk, steuer, export, finanzamt, steuerberater).
- [ ] Gates: typecheck, biome, lint:all net-0-new, tauri-pos+ui-kit+api-cloud tests, vite build.

## Self-review

- Spec coverage: surface ✓(T4), DATEV ✓(T2), Kassenbericht ✓(T1/2), DSFinV-K surfaced ✓(T4), GDPdU deferred ✓, READONLY+step-up ✓(T2), Tier cap ✓(T4), no-facade sourcing ✓(T1 from real row).
- Money = strings throughout; no float.
