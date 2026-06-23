#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# release-build.sh — build PROD-BAKED mobile artifacts (.ipa + .apk) that talk
# to https://api.warehouse14.de, INDEPENDENT of apps/mobile/.env.
#
# WHY THIS EXISTS (the build-env trap, Round 3 lesson):
#   Expo inlines process.env.EXPO_PUBLIC_* AT BUILD TIME from apps/mobile/.env.
#   A developer's .env (localhost for `pnpm start`) would otherwise BAKE
#   localhost into the release .ipa/.apk → "no connection" on a real device
#   (localhost = the device itself). The source default is already prod, but
#   .env wins over the source. So a release build MUST force prod in the
#   shell environment, which Expo reads with HIGHER priority than .env.
#
# This script exports EXPO_PUBLIC_API_BASE_URL=https://api.warehouse14.de before
# every build, so the artifact is prod-baked no matter what .env says. It then
# ASSERTS the baked bundle contains prod and NOT localhost (the grep proof).
#
# Usage:
#   bash apps/mobile/scripts/release-build.sh ios      # → ~/Desktop/W14-builds/Warehouse14.ipa
#   bash apps/mobile/scripts/release-build.sh android  # → ~/Desktop/W14-builds/Warehouse14.apk
#   bash apps/mobile/scripts/release-build.sh all
#
# Prereqs: Xcode (full), Android Studio JBR + SDK, pnpm install done.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROD_ORIGIN="https://api.warehouse14.de"
export EXPO_PUBLIC_API_BASE_URL="$PROD_ORIGIN"
# Belt + suspenders: also clear any stray local override from the shell.
export REACT_NATIVE_PACKAGER_HOST="" 2>/dev/null || true

MOBILE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$MOBILE_DIR/../.." && pwd)"
DESKTOP_OUT="$HOME/Desktop/W14-builds"
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
if [ ! -d "$DEVELOPER_DIR" ]; then
  # Fall back to the installed Xcode name on this machine.
  DEVELOPER_DIR="$(dirname "$(xcode-select -p 2>/dev/null || echo /Applications/Xcode.app/Contents/Developer)")"
  export DEVELOPER_DIR
fi

mkdir -p "$DESKTOP_OUT"

# Assert the shell env is prod BEFORE building (guard against a stale shell).
if [ "${EXPO_PUBLIC_API_BASE_URL:-}" != "$PROD_ORIGIN" ]; then
  echo "❌ EXPO_PUBLIC_API_BASE_URL is not prod ('$PROD_ORIGIN'); refusing to build a broken artifact." >&2
  exit 1
fi
echo "✓ release build: EXPO_PUBLIC_API_BASE_URL=$EXPO_PUBLIC_API_BASE_URL (forced prod, overrides .env)"

cd "$MOBILE_DIR"

# ── verify the artifact bundle (prod present / localhost absent) ──────────────
verify_bundle() {
  local label="$1" bundle="$2"
  local prod_count loc_count lan_count
  prod_count=$(grep -aoc "api.warehouse14.de" "$bundle" 2>/dev/null || echo 0)
  loc_count=$(grep -aoc "localhost" "$bundle" 2>/dev/null || echo 0)
  lan_count=$(grep -aoc "192\.168\." "$bundle" 2>/dev/null || echo 0)
  echo "  $label bundle grep:"
  echo "    api.warehouse14.de : $prod_count occurrence(s)  (want ≥1)"
  echo "    localhost          : $loc_count occurrence(s)  (want 0)"
  echo "    192.168.           : $lan_count occurrence(s)  (want 0)"
  if [ "$prod_count" -lt 1 ] || [ "$loc_count" -gt 0 ] || [ "$lan_count" -gt 0 ]; then
    echo "  ❌ FAIL — bundle is NOT prod-baked. Do not ship." >&2
    return 1
  fi
  echo "  ✅ PASS — prod-baked, no localhost/LAN."
}

# ── iOS: .ipa (unsigned, real New Arch) ───────────────────────────────────────
build_ios() {
  echo "=== iOS release build (New Arch, prod-baked) ==="
  rm -rf ios
  npx expo prebuild --platform ios --clean
  cd ios
  # Archive into a Payload/ for the unsigned .ipa the owner signs himself.
  rm -rf build
  # Archive for a REAL DEVICE (iphoneos / arm64), unsigned — the owner signs it
  # himself. NEVER iphonesimulator: a simulator .app cannot install on an iPhone.
  xcodebuild \
    -workspace Warehouse14.xcworkspace \
    -scheme Warehouse14 \
    -configuration Release \
    -sdk iphoneos \
    -destination 'generic/platform=iOS' \
    -archivePath build/Warehouse14.xcarchive \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" AD_HOC_CODE_SIGNING_ALLOWED=YES \
    archive 2>&1 | tail -5 || true
  # The unsigned device .app lives inside the archive.
  local app
  app=$(find build/Warehouse14.xcarchive/Products/Applications -name "*.app" 2>/dev/null | head -1)
  [ -n "$app" ] || { echo "❌ no Warehouse14.app produced (device archive failed)"; exit 1; }
  # Assert it is a device build, not a simulator one.
  if ! plutil -p "$app/Info.plist" 2>/dev/null | grep -q 'iphoneos'; then
    echo "❌ archive is not an iphoneos (device) build — refusing"; exit 1
  fi
  # Pack the unsigned .ipa.
  rm -rf /tmp/w14-ipa && mkdir -p /tmp/w14-ipa/Payload
  cp -R "$app" /tmp/w14-ipa/Payload/
  ( cd /tmp/w14-ipa && zip -qr "$DESKTOP_OUT/Warehouse14.ipa" Payload )
  echo "  → $DESKTOP_OUT/Warehouse14.ipa"
  # Verify the baked bundle.
  verify_bundle "iOS" "$app/main.jsbundle"
  echo "  RCTNewArchEnabled: $(plutil -p "$app/Info.plist" 2>/dev/null | grep -i RCTNewArch | head -1)"
  cd "$MOBILE_DIR"
}

# ── Android: release .apk ─────────────────────────────────────────────────────
build_android() {
  echo "=== Android release build (prod-baked) ==="
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
  rm -rf android
  npx expo prebuild --platform android --clean
  cd android
  ./gradlew :app:assembleRelease --no-daemon 2>&1 | tail -3
  local apk
  apk=$(find . -name "*.apk" -path "*release*" 2>/dev/null | head -1)
  [ -n "$apk" ] || { echo "❌ no release apk produced"; exit 1; }
  cp "$apk" "$DESKTOP_OUT/Warehouse14.apk"
  echo "  → $DESKTOP_OUT/Warehouse14.apk"
  # Verify the baked bundle.
  verify_bundle "Android" <(unzip -p "$apk" assets/index.android.bundle 2>/dev/null)
  cd "$MOBILE_DIR"
}

case "${1:-all}" in
  ios) build_ios ;;
  android) build_android ;;
  all) build_ios; build_android ;;
  *) echo "usage: $0 {ios|android|all}"; exit 1 ;;
esac

echo ""
echo "✓ release build(s) complete. Prod-baked artifacts on the Desktop:"
ls -lh "$DESKTOP_OUT"/Warehouse14.ipa "$DESKTOP_OUT"/Warehouse14.apk 2>/dev/null
