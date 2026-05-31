# CLAUDE.md — Warehouse14 Developer Guide

This file provides context-engineering guidance, command shortcuts, and project-specific constraints for coding agents working on the Warehouse14 monorepo.

---

## 1. Command Shortcuts

Always use the following commands for development, typechecking, testing, and formatting:

| Action | Command | Scope |
| :--- | :--- | :--- |
| **Build Client** | `pnpm --filter @warehouse14/api-client build` | Pre-requisite for app typecheck |
| **Typecheck POS** | `pnpm --filter @warehouse14/tauri-pos typecheck` | Validates POS frontend |
| **Typecheck Worker**| `pnpm --filter @warehouse14/worker typecheck` | Validates background daemon |
| **Test Client** | `pnpm --filter @warehouse14/api-client test` | Pure middleware & logic tests |
| **Test Worker** | `pnpm --filter @warehouse14/worker test <test-file>`| Run specific worker test |
| **Linter / Format**| `biome check --write <file>` | Fix lint & formatting errors |

---

## 2. strict Code & Styling Guidelines

### A. TypeScript Type Safety
- **No `any` or `as never`**: Write strict, explicit type declarations.
- **Optional Properties**: The compiler enforces `exactOptionalPropertyTypes`. Do not pass `undefined` as a value to fields typed as optionally omitted (e.g. `{ signal?: AbortSignal }`). Use helpers or omit the key entirely.
- **Indexed Access**: Enforced `noUncheckedIndexedAccess`. Guard array index reads (e.g., `const x = arr[i]; if (!x) ...`) before processing.

### B. Navigation & UX Patterns
- **Karteikasten-Index**: Thin top header rail containing Arabic digit + mid-dot + Cormorant Garamond small-caps label (e.g., `1 · WERKSTATT`).
- **No Sidebars/Hamburger Menus**: Keep the navigation flat and simple.
- **Universal Search**: Spotlight Magnifier palette (`Cmd/Ctrl + K`) for deep navigations and entity searches.
- **Roman Numerals**: Reserved strictly for content counts, receipt counters, and broadside headlines.

### C. Regulatory & Compliance Rules
- **Asymmetric KYC (ADR-0007)**:
  - **Ankauf (Buying from customer)**: ID verification is **always mandatory** from €0.01.
  - **Verkauf (Selling to customer)**: Anonymous Tafelgeschäft allowed under €2,000. ID required only at €2,000 and above.
- **Durable Audit Logs**: Every critical action (Overrides, overrides, overrides) must register an audit event in `audit_log` with step-up verification.
- **Stable Money Math**: Money math must be done in cents using `bigint-cents` scale 4 math helpers ([bewertung-math.ts](apps/tauri-pos/src/lib/bewertung-math.ts)) — never float arithmetic on prices.

---

## 3. Active Sprint Guidance
We are currently implementing **Epic A: Gold Price API & Calculations**. Refer to `docs/memory.md` for historical decisions and `warehouse14_grand_strategy_gap_analysis.md` for architectural roadmaps.
