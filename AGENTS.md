# AGENTS.md — Warehouse14 (read this first, fully, before touching anything)

This file is the single source of truth for **any** agent working on this repo —
a Claude Code session, the ZCode local executor, or a human picking the project up
cold. It is committed to the repo on purpose: it travels with the code, it is
version-controlled, and every modern AI coding tool reads an `AGENTS.md` at the
repo root automatically. If you read only one file, read this one — then follow
its pointers.

> Sensitive values (tokens, keys, passwords) are **never** written here. This file
> records **where** secrets live and **how** to connect, not the secret values
> themselves. See §4.

---

## 0. What this project is

Warehouse14 is the business operating system for a real, **live** German
precious-metals shop (the owner is Roman). The shop is open and transacting every
day. **Do not break production.** Treat the live API, the live cashier, and the
live storefront as sacred — additive, reversible changes only, verified before
release.

Stack: a pnpm + Turborepo monorepo, TypeScript strict throughout.

---

## 1. The apps (the map)

| Path | What it is |
|---|---|
| `apps/mobile` | ONE Expo app (SDK 55 / RN 0.83, New Architecture, Hermes) that builds **both iOS and Android**. It is the Owner OS + a full mobile cashier. Theming via NativeWind + `src/warehouse14/theme.ts` + `global.css`. |
| `apps/tauri-pos` | The desktop cashier (Tauri + React + Vite) for macOS/Windows — the main till. |
| `apps/api-cloud` | The Fastify server — the brain. Deployed at `https://api.warehouse14.de`. |
| `apps/worker` | Background jobs. |
| `apps/control-desktop` | Operator/control surface. |
| `packages/api-client` | The typed client over `api-cloud`, **shared** by mobile + cashier. The connection layer. |
| `packages/domain` | Shared domain types/logic. |
| `packages/db` | Drizzle schema + migrations. Build it first (`pnpm --filter @warehouse14/db build`) before a repo typecheck. |
| `packages/ui-kit` | Shared cashier design tokens/components. |
| `packages/auth-pin` | PIN auth primitives. |
| `packages/appointments` | Legacy appointments domain (the mobile Termine UI was removed — see §7). |

The public webshop `warehouse14-onlineshop` is a **separate** Next.js repo that
lives on the server, **not** in this monorepo. It is the **visual reference** for
the whole product. Its design system is captured verbatim in
[`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md) — use that, do not go hunting for
the storefront source.

---

## 2. Hard doctrines (non-negotiable — the owner enforces these and has rejected work that broke them)

**(a) No machine text ever reaches a human.** No underscore, no `SCREAMING_SNAKE`,
no raw English may appear in any rendered label, badge, toast, placeholder, or
error — in any app. Every backend enum/status/code maps to clean idiomatic German
through a **total** label map. The mobile spine is
`apps/mobile/src/warehouse14/german-text.ts` (exhaustive `describeError` + enum
maps); the cashier has its own label maps. **Never** fall back to the raw token
(`?? rawKey`); degrade unknowns to a German word like „Unbekannt".

**(b) Honesty.** A number shown to the owner is real data from a real endpoint, or
a clean German empty / locked / error state. Never fabricate a value, never render
a raw payload.

**(c) The full repo typecheck stays green — including `apps/tauri-pos`.** The gate
is `pnpm --filter @warehouse14/db build && pnpm -r typecheck` exit 0. Run it at
every checkpoint.

**(d) Never claim "done" without evidence** — a commit hash, the verbatim command
output, and a live check. False "green" claims are the fastest way to lose trust
here.

**(e) The app icon is the real shop logo** `apps/tauri-pos/public/shop-logo.svg`
(the WAREHOUSE 14 brass wordmark). Never invent a logo.

---

## 3. The design system (one identity across every app)

Full, exact spec: [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md). In one breath:

- A warm **parchment** ground (`#efece3`) + one **ink** (`#1c1c1c`) + hairlines.
  Never pure white.
- **Gilt** (`#a3823b`) is a thread / an edge / a seal **only** — never a fill, a
  background, or text.
- **Functional** colors (verdigris green, wax-red) carry **meaning** only
  (positive / error), never decoration.
- Fonts: **Bricolage Grotesque** (display/headings) + **Inter** (body) +
  **JetBrains Mono** (prices/quantities). All self-hosted, zero CDN (DSGVO).
- **Cormorant Garamond is the retired font** of the old "antique" theme. New work
  uses Bricolage. Any remaining `Cormorant` strings are stale doc comments or
  `dist/` build artifacts, not live usage — the live display font in
  `apps/mobile/src/warehouse14/theme.ts` is already `BricolageGrotesque`.
- Calm motion only. No glow, no bloom, no gaudy ripple.

Where it lives: mobile = `apps/mobile/src/warehouse14/theme.ts` + `global.css`;
cashier = `packages/ui-kit` tokens + `apps/tauri-pos`.

---

## 4. The server, the connections, and where secrets live (pointers, not values)

Everything connects to the server. The mobile and the cashier both talk to the
same brain.

- **Prod API:** `https://api.warehouse14.de` (a Cloudflare tunnel fronts the
  server). Healthy and live — do not point experiments at it.
- **The server:** reachable as `ssh myserver`. It runs a Docker stack at
  `/opt/warehouse14/docker-compose.prod.yml`: `warehouse14-api` (port 3001),
  `-worker`, `-postgres` (pgvector, pg17), `-redis`, `-cloudflared` (the tunnel),
  `-storefront`. Nginx config at `/etc/nginx/sites-available/warehouse14`.
- **Container images:** `ghcr.io/963s/warehouse14-api:latest`. A pre-finance
  rollback image is preserved (see `docs/memory.md`).
- **GitHub:** `origin` = `https://github.com/963s/Warehouse14.git`. Auth is
  **machine-level** — the `gh` CLI login, the SSH keys, and the git credential
  helper already configured on this Mac. **Any tool running on this Mac (including
  ZCode) inherits the same access automatically.** There is nothing to copy; do
  **not** write tokens into any file.
- **App secrets / env:** every app ships a `.env.example` describing the *shape*
  of its config (`./.env.example`, `apps/api-cloud/.env.example`,
  `apps/tauri-pos/.env.example`). The **real** values live in: the gitignored
  `.env` files already on this Mac, the server's `/opt/warehouse14/.env` (via
  `ssh myserver`), and the macOS keychain. To run locally: copy a `.env.example`
  to `.env` and fill it from the existing local `.env` or from the owner. **Never
  commit a real value** — a secrets file pushed to GitHub is a real leak that
  would expose the live business.
- **mTLS:** prod enforces a client cert via `cf-client-cert-sha256`. The mobile
  app passes through a deliberate server-side test-device-fingerprint escape hatch
  (see `apps/api-cloud` mTLS code). This is how an unsigned mobile build reaches
  prod.

---

## 5. Build + run recipes

- **Dev backend (local):** `apps/mobile/dev/reset-dev-backend.sh` (needs OrbStack +
  postgres up) → serves on `:3001`.
- **Mobile iOS (unsigned, prod-pointed):** `cd apps/mobile && npx expo prebuild
  --clean`, then pod install (set `LANG=en_US.UTF-8`), then an unsigned
  `xcodebuild` archive with `CODE_SIGNING_ALLOWED=NO`,
  `DEVELOPER_DIR=/Applications/Xcode-26.5.0.app/Contents/Developer`, and
  `EXPO_PUBLIC_API_BASE_URL=https://api.warehouse14.de`. Result is real New
  Architecture (`RCTNewArchEnabled=true`, `main.jsbundle` embedded). Deleting
  `ios/` before `prebuild --clean` is what makes pod install regenerate correct
  codegen headers.
- **Mobile Android:** set `ANDROID_HOME=/Users/basel/Library/Android/sdk` and
  `JAVA_HOME` to the Android Studio JBR, then `cd apps/mobile/android && ./gradlew
  :app:assembleRelease`. The Gradle-9 / foojay `IBM_SEMERU` failure and the R8
  Metaspace OOM are fixed permanently by the Expo config plugin
  `apps/mobile/plugins/withGradleWrapperVersion.js` (pins gradle wrapper 8.14.3,
  raises jvmargs to `-Xmx6144m`); it survives `prebuild --clean` via `app.json`.
  The `react-native-css` patch + `lightningcss` 1.30.1 override + `babel-preset-expo`
  are committed.
- **Cashier:** `cd apps/tauri-pos && pnpm tauri build` → `.app` / `.dmg` (current
  version 0.4.33, ad-hoc signed). An **official** release additionally needs
  `TAURI_SIGNING_PRIVATE_KEY` (the auto-updater) + the `APPLE_*` notarization vars.
  That step is the owner's trigger, not a bug — the bundle itself builds fine
  without them.

---

## 6. The branch model (keep it one trunk)

The working trunk is **`claude/w14-unify-and-complete`**. The ~50 scattered
`claude/*` branches were consolidated into it; the displaced ones were archived as
git tags (recoverable). Work off this trunk. Do **not** re-scatter into many
parallel branches; if you fan out sub-agents, keep them converging on one branch
and one design system.

---

## 7. What was removed — do not reintroduce

- **Termine (appointments)** in the mobile app: deleted. The owner does not want
  it. Focus is inventory management + the direct cashier.
- **The desktop cashier's QR-code companion connection / device pairing:** deleted.
  Native mobile apps replace it. Consequently these docs are now **historical /
  stale** — ignore them for new work: `docs/companion-architecture.md`,
  `docs/mobile-companion-repair-plan.md`,
  `docs/ios-companion-trusted-connection-plan.md`.

---

## 8. Existing reference docs (under `docs/`)

- `docs/DESIGN-SYSTEM.md` — the store design system (the current visual law).
- `docs/Verfahrensdokumentation.md` — the fiscal / GoBD procedure documentation.
- `docs/security-audit-2026-06-07.md`, `docs/deep-audit-2026-06-07.md`,
  `docs/system-logic-audit-2026-06.md` — past audits.
- `docs/design-ux-brief.md`, `docs/UX-REDESIGN.md` — UX direction.
- `docs/memory.md` — the long project history/log.
- `README.md` — setup.
- `apps/mobile/src/warehouse14/ui/DESIGN.md` — the mobile design notes.

---

## 9. How to work here

1. Read this file, then `docs/DESIGN-SYSTEM.md`.
2. Navigate fast with graphify (`graphify query "..."`); always verify a claim
   against the real source before acting on it.
3. Keep the doctrines in §2 true at every step.
4. Keep the repo typecheck green at each checkpoint.
5. Self-verify live where you can (the dev backend, the rendered app on a real
   device, the cashier window).
6. Report with evidence: file:line, verbatim command output, and a live check.
   Never claim done where you did not verify.
7. If you spawn sub-agents, coordinate them around **one** design system and
   **one** trunk — no conflicting parallel edits.
