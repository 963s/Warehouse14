# Warehouse14

> Hybrid Cloud/Desktop ERP & POS for **gold, rare coins, and antiques** retail in Germany.
> Built for strict GoBD, TSE (KassenSichV), GwG, §25a/§25c UStG, DSGVO compliance.

**Brand:** Warehouse14
**Domain:** [warehouse14.de](https://warehouse14.de)
**Location:** Weil am Rhein, Germany — Dreiländereck (DE / CH / FR border region).
**Status:** Phase 0 — Foundation. No business logic yet.

---

## Stack

| Layer              | Tech                                                                |
| ------------------ | ------------------------------------------------------------------- |
| Monorepo           | Turborepo + pnpm workspaces                                         |
| Desktop POS        | Tauri 2 + React 19 + Vite + TypeScript                              |
| Master Control     | Tauri 2 wrapper around Next.js admin-web (live ops from home)       |
| Backend API        | Node.js + Fastify + Zod + Pino                                      |
| Admin Dashboard    | Next.js *(Phase 1+)*                                                |
| Public Storefront  | Next.js *(Phase 2+)* — `warehouse14.de`                             |
| Database (cloud)   | PostgreSQL 17 — Oracle Cloud, Frankfurt DE                          |
| Database (local)   | SQLite via `better-sqlite3` (Tauri offline cache)                   |
| ORM                | Drizzle                                                             |
| Auth               | better-auth                                                         |
| Live transport     | SSE over mTLS, fronted by Cloudflare Tunnel                         |
| Storefront payments| Mollie (primary) + Stripe (intl fallback)                           |
| POS payments       | ZVT Kassenterminal (primary) + SumUp Solo (alt)                     |
| AI providers       | OpenAI (KYC OCR) + Anthropic Claude (content) via `@warehouse14/ai-gateway` |
| Lint / Format      | Biome                                                               |
| Money type         | `numeric(18,2)` in PG + Decimal.js in TS — **no floats, ever**      |

See [`docs/memory.md`](./docs/memory.md) for full project memory and [`docs/architecture/adr/`](./docs/architecture/adr/) for architectural decisions.

---

## Prerequisites

- **Node.js** >= 20.18.0 (see `.nvmrc`)
- **pnpm** >= 9.15.0 (`npm install -g pnpm@9.15.0`)
- **Docker** + Docker Compose (for local PostgreSQL & Redis, and production deploys to Oracle Cloud)
- **Rust toolchain** — only required when working on `apps/pos-desktop` or `apps/control-desktop`

---

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Start local services (PostgreSQL + Redis)
docker compose -f infrastructure/docker/docker-compose.yml up -d

# 3. Copy env template
cp .env.example .env

# 4. Run tests for what's been built
pnpm test

# 5. Run lint + typecheck
pnpm lint
pnpm typecheck
```

`pnpm dev` will be wired up after Chunk 0.3 (API) lands. Currently the only "live" code is the `Money` value object in `packages/domain` — exercised via tests.

---

## Repository Structure

```
warehouse14/
├── apps/                    # Deployable applications
│   ├── pos-desktop/         # Tauri 2 + React POS, in-shop (Chunk 0.4)
│   ├── api-cloud/           # Fastify backend API (Chunk 0.3)
│   ├── admin-web/           # Next.js admin dashboard (Phase 1+)
│   ├── control-desktop/     # Tauri 2 wrapper for live owner control (Chunk 0.5)
│   └── storefront/          # Next.js public storefront — warehouse14.de (Phase 2+)
│
├── packages/                # Shared libraries
│   ├── config/              # Shared tsconfig + biome presets
│   ├── domain/              # Pure TS business types (Money, Tax, ...)
│   ├── db/                  # Drizzle schema + migrations (Chunk 0.2)
│   ├── shared-types/        # Zod schemas, event types (Phase 1+)
│   ├── ai-gateway/          # OpenAI + Anthropic + Photoroom abstraction (Phase 1+)
│   ├── tse-client/          # Fiskaly TSE wrapper (Phase 2+)
│   ├── payments/            # Mollie + Stripe + ZVT adapters (Phase 2+)
│   ├── datev-exporter/      # DATEV CSV exporter (Phase 3+)
│   ├── dsfinvk-exporter/    # DSFinV-K v2.0 exporter (Phase 3+)
│   ├── ui/                  # Shared React UI primitives (Phase 1+)
│   └── logger/              # Pino wrapper (Phase 1+)
│
├── infrastructure/
│   ├── docker/              # docker-compose.yml — local dev + Oracle Cloud production target
│   └── github-actions/      # CI workflows (lives in .github too)
│
├── docs/
│   ├── memory.md            # Central memory — source of truth (was hmstr.md)
│   ├── architecture/adr/    # Architecture Decision Records
│   └── compliance/          # GoBD, TSE, DSFinV-K, DATEV notes
│
└── .github/workflows/       # CI/CD entry points
```

Phase 0 delivers a thin vertical slice: just enough to prove the bones work together.

---

## Compliance References

This project must satisfy German fiscal & legal requirements:

- **GoBD** — Append-only ledger, audit trail, 10-year retention
- **KassenSichV / TSE** — Fiskaly SIGN DE V2 cloud TSE
- **DSFinV-K** — Mandatory fiscal export format (v2.0)
- **DATEV** — CSV export (EXTF_, SKR03/SKR04)
- **GwG** — Anti-money-laundering: ID required for cash buys ≥ €2,000 (Warehouse14 policy: ID always on Ankauf)
- **§25a UStG** — Margin tax for antiques, collector coins, worked jewelry
  *(NOT raw bullion — see [`memory.md`](./docs/memory.md))*
- **§25c UStG** — VAT exemption for investment gold
- **DSGVO** — All infrastructure in Frankfurt, Germany (Oracle Cloud)

---

## Installing the desktop POS

Pre-built binaries are published on the
[Releases page](../../releases/latest). Pick the right one for your
machine:

| Platform | File |
|---|---|
| macOS Apple Silicon | `Warehouse14.POS_<ver>_aarch64.dmg` |
| macOS Intel | `Warehouse14.POS_<ver>_x64.dmg` |
| Windows 10/11 (x64) | `Warehouse14.POS_<ver>_x64-setup.exe` |

**macOS first-launch:** the build is ad-hoc–codesigned but not Apple
Developer-ID–signed (see `SECURITY.md` for the rationale). macOS shows a
one-time **"unidentified developer"** prompt — **not** "is damaged and
can't be opened": the bundle carries an internally consistent ad-hoc
signature (`_CodeSignature/CodeResources` sealed), so Gatekeeper treats
it as unsigned-but-intact rather than tampered. Clear the prompt once,
either way:

- **Recommended (no terminal):** in Finder, right-click (or Control-click)
  **Warehouse14 POS.app** → **Open** → confirm **Open** in the dialog.
  macOS remembers the approval for every later launch.
- **Or** strip the Gatekeeper quarantine flag from a terminal:
  ```
  sudo xattr -dr com.apple.quarantine "/Applications/Warehouse14 POS.app"
  ```

Auto-updates apply without any of this — the updater verifies its own
minisign signature independently of macOS code-signing.

**Windows first-launch:** SmartScreen shows "Windows protected your PC".
Click "More info" → "Run anyway". The NSIS installer places the
binary under `%LOCALAPPDATA%\Programs\Warehouse14 POS\`.

The app expects a backend API on `http://localhost:3001` by default.
For salon deployments, the build pipeline emits a separate variant that
points at the production cloud endpoint.

## Auto-updates

The desktop binary polls the GitHub Releases endpoint **hourly** for a
new tag. When one is available, an unobtrusive parchment banner
appears at the top of the window: "Neue Version X.Y.Z verfügbar".
One click downloads + verifies (minisign against the embedded public
key) + relaunches the app on the new version. The operator is never
forced — "Später" hides the banner for the current session.

The signature verification is independent of macOS Gatekeeper /
Windows Authenticode — even unsigned OS-side, the update channel is
cryptographically secured by the project's own minisign key.

Full release-automation contract: see `memory.md §25
[RELEASE_AUTOMATION]`.

## Contributing

Pull requests welcome. The Brutal Audit (memory.md §19) and the
locked invariants (memory.md §24.6 + `SECURITY.md`) define what must
NOT regress. Run `pnpm typecheck` + `cargo check` in
`apps/tauri-pos/src-tauri/` before opening a PR; CI runs the same
matrix on every push.

## License

[MIT](./LICENSE) — © 2026 Basel — Warehouse14.
