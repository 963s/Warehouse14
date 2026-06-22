#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# release-build.sh — build a PROD-BAKED cashier (.app + .dmg) that talks to
# https://api.warehouse14.de, INDEPENDENT of apps/tauri-pos/.env.local.
#
# WHY (the build-env trap): Vite inlines import.meta.env.VITE_* AT BUILD TIME.
# `.env.local` (localhost for `pnpm dev`) can win over `.env.production` in some
# load orderings, baking localhost into the shipped .app → "no connection".
# This script forces VITE_API_BASE_URL=prod in the SHELL, which Vite reads with
# the highest priority, so the artifact is prod-baked no matter what .env says.
# It then ASSERTS the baked bundle is prod (grep proof).
#
# Usage:  bash apps/tauri-pos/scripts/release-build.sh
# Prereqs: Rust + cargo, pnpm install done.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROD_ORIGIN="https://api.warehouse14.de"
# Shell env beats every .env file in Vite — force prod for this build only.
export VITE_API_BASE_URL="$PROD_ORIGIN"

POS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_OUT="$HOME/Desktop/W14-builds"
mkdir -p "$DESKTOP_OUT"
cd "$POS_DIR"

[ "${VITE_API_BASE_URL:-}" = "$PROD_ORIGIN" ] || { echo "❌ prod not forced"; exit 1; }
echo "✓ cashier release build: VITE_API_BASE_URL=$VITE_API_BASE_URL (forced prod, overrides .env.local)"

echo "=== tauri build (.app + .dmg, prod-baked) ==="
pnpm build:tauri 2>&1 | tail -4

# Locate + verify the baked bundle (the Vite dist index JS).
DIST_JS=$(find dist -name "*.js" -path "*assets*" 2>/dev/null | head -1)
if [ -n "$DIST_JS" ]; then
  prod_count=$(grep -aoc "api.warehouse14.de" "$DIST_JS" || echo 0)
  loc_count=$(grep -aoc "localhost" "$DIST_JS" || echo 0)
  echo "  cashier dist grep:"
  echo "    api.warehouse14.de : $prod_count (want ≥1)"
  echo "    localhost          : $loc_count (want 0)"
  [ "$prod_count" -ge 1 ] && [ "$loc_count" -eq 0 ] && echo "  ✅ PASS — prod-baked." || { echo "  ❌ FAIL"; exit 1; }
fi

# Copy the artifacts to the Desktop.
APP=$(find src-tauri/target/release/bundle/macos -name "*.app" 2>/dev/null | head -1)
DMG=$(find src-tauri/target/release/bundle/dmg -name "*.dmg" 2>/dev/null | head -1)
[ -n "$APP" ] && cp -R "$APP" "$DESKTOP_OUT/" && echo "  → $DESKTOP_OUT/$(basename "$APP")"
[ -n "$DMG" ] && cp "$DMG" "$DESKTOP_OUT/" && echo "  → $DESKTOP_OUT/$(basename "$DMG")"
echo "✓ cashier release build complete."
