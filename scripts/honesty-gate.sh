#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# honesty-gate.sh — the desktop doctrine (a)/(b) leak counter.
#
# Greps the OPERATOR-FACING desktop source (apps/tauri-pos/src +
# apps/control-desktop/src) for the frozen set of patterns that let a raw
# machine string reach a human, or bake a dev URL into a shipped build:
#
#   err.message / error.message / j.error.message   — raw wire text to the UI
#   ?? err                                          — raw-token enum fallback
#   humanizeEnum                                    — ad-hoc English-ish deriver
#   localhost:3001                                  — dev API in operator code
#
# Phase 0: WARN-ONLY. It prints the live count and every hit, and exits 0 so it
# never blocks a merge yet. Phase 2 (the parity sweep) drives this exact set to
# ZERO, then flips the gate to fail-on-nonzero by running it with STRICT=1.
#
# The baseline is whatever THIS set returns today (~89 at Phase 0), never a
# hand-typed number — the sweep and the gate can therefore never disagree.
#
# Usage:
#   bash scripts/honesty-gate.sh          # warn-only: print count + hits, exit 0
#   STRICT=1 bash scripts/honesty-gate.sh # fail (exit 1) when the count is > 0
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The frozen regex set. Kept as one array so the sweep target and the gate are
# literally the same list.
PATTERNS=(
  'err\.message'
  'error\.message'
  'j\.error\.message'
  '\?\? err'
  'humanizeEnum'
  'localhost:3001'
)

# Operator-facing desktop source only. Exclude tests and generated declarations —
# a leak in a *.test.ts never reaches a human.
SEARCH_DIRS=(
  "apps/tauri-pos/src"
  "apps/control-desktop/src"
)

alt="$(IFS='|'; echo "${PATTERNS[*]}")"

hits="$(
  grep -REn "${alt}" "${SEARCH_DIRS[@]}" \
    --include='*.ts' --include='*.tsx' \
    2>/dev/null \
    | grep -v -E '\.test\.tsx?:' \
    | grep -v -E '\.d\.ts:' \
    || true
)"

count="$(printf '%s' "$hits" | grep -c . || true)"

echo "─────────────────────────────────────────────────────────────"
echo "  Honesty gate — raw-token / dev-URL leaks in desktop UI code"
echo "─────────────────────────────────────────────────────────────"
if [ "$count" -gt 0 ]; then
  printf '%s\n' "$hits"
  echo "─────────────────────────────────────────────────────────────"
fi
echo "  Total leaks: ${count}"
echo "  Patterns:    err.message · error.message · j.error.message · ?? err · humanizeEnum · localhost:3001"
echo "  Scope:       apps/tauri-pos/src + apps/control-desktop/src (excl. tests, .d.ts)"

if [ "${STRICT:-0}" = "1" ] && [ "$count" -gt 0 ]; then
  echo "  STRICT mode: FAIL — the sweep must drive this to zero." >&2
  exit 1
fi
echo "  Mode: warn-only (set STRICT=1 to fail on any leak)."
exit 0
