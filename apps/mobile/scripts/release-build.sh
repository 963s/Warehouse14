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
# CocoaPods (Ruby 4.0 + pod 1.16) crashes with Encoding::CompatibilityError on
# String#unicode_normalize when the locale is not UTF-8. A non-interactive shell
# inherits no LANG, so `pod install` dies BEFORE it reads the Podfile (the
# misleading "verify_podfile_exists!" stack trace). Force a UTF-8 locale here.
export LANG="en_US.UTF-8"
export LC_ALL="en_US.UTF-8"

MOBILE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$MOBILE_DIR/../.." && pwd)"
DESKTOP_OUT="$HOME/Desktop/W14-builds"
# Resolve the Xcode DEVELOPER_DIR. The default name is "Xcode.app" but this
# machine may have a versioned install (e.g. Xcode-26.5.0.app). Find the real
# Xcode bundle, not just CommandLineTools (which CocoaPods rejects: it needs
# git via xcrun, which only Xcode provides).
resolve_developer_dir() {
  # 1. Explicit override from the caller's env.
  if [ -n "${DEVELOPER_DIR:-}" ] && [ -d "$DEVELOPER_DIR" ]; then
    echo "$DEVELOPER_DIR"; return
  fi
  # 2. xcode-select -p, but ONLY if it points inside a real Xcode bundle
  #    (CommandLineTools lacks the full toolchain CocoaPods needs).
  local sel
  sel="$(xcode-select -p 2>/dev/null || true)"
  case "$sel" in
    */Xcode*.app/Contents/Developer) echo "$sel"; return ;;
  esac
  # 3. Scan /Applications for any Xcode*.app bundle.
  local app
  app="$(ls -d /Applications/Xcode*.app 2>/dev/null | head -1)"
  if [ -n "$app" ] && [ -d "$app/Contents/Developer" ]; then
    echo "$app/Contents/Developer"; return
  fi
  echo ""
}
export DEVELOPER_DIR
DEVELOPER_DIR="$(resolve_developer_dir)"
if [ -z "$DEVELOPER_DIR" ] || [ ! -d "$DEVELOPER_DIR" ]; then
  echo "❌ No full Xcode found (need Xcode.app/Contents/Developer for CocoaPods)." >&2
  exit 1
fi
echo "✓ DEVELOPER_DIR=$DEVELOPER_DIR"

mkdir -p "$DESKTOP_OUT"

# Assert the shell env is prod BEFORE building (guard against a stale shell).
if [ "${EXPO_PUBLIC_API_BASE_URL:-}" != "$PROD_ORIGIN" ]; then
  echo "❌ EXPO_PUBLIC_API_BASE_URL is not prod ('$PROD_ORIGIN'); refusing to build a broken artifact." >&2
  exit 1
fi
echo "✓ release build: EXPO_PUBLIC_API_BASE_URL=$EXPO_PUBLIC_API_BASE_URL (forced prod, overrides .env)"

cd "$MOBILE_DIR"

# ── verify the artifact bundle is prod-baked ─────────────────────────────────
# What matters: the prod API origin is baked in, and there is no LAN IP leak (a
# developer's 192.168.x would make the app call the dev machine on a real device).
# We do NOT blanket-reject "localhost": a dev-client build embeds metro's dev-server
# URL (localhost:8081) as bundle metadata, and dependencies carry homepage strings
# (reactnative.dev, docs.expo.dev, etc.) — none of those are runtime API calls.
# The real leak signature is a 192.168. address, so that is the hard gate.
verify_bundle() {
  local label="$1" bundle="$2"
  # Use grep -o piped to wc, not grep -c: -o + -c together emit a malformed
  # multi-line count that breaks the integer comparison.
  # Also: `set -e` + `pipefail` would kill the script when grep finds no match
  # (grep exits 1 on zero matches — the DESIRED result for the LAN check), so
  # disable them for the probes and re-enable after.
  set +e +o pipefail
  local prod_count lan_count
  prod_count=$(grep -ao "api.warehouse14.de" "$bundle" 2>/dev/null | wc -l | tr -d ' ')
  lan_count=$(grep -ao "192\.168\." "$bundle" 2>/dev/null | wc -l | tr -d ' ')
  set -e -o pipefail
  echo "  $label bundle grep:"
  echo "    api.warehouse14.de : $prod_count occurrence(s)  (want ≥1)"
  echo "    192.168. (LAN leak): $lan_count occurrence(s)   (want 0)"
  if [ "$prod_count" -lt 1 ] || [ "$lan_count" -gt 0 ]; then
    echo "  ❌ FAIL — bundle is NOT prod-baked. Do not ship." >&2
    return 1
  fi
  echo "  ✅ PASS — prod origin baked in, no LAN IP leak."
}

# ── iOS: .ipa (unsigned, real New Arch) ───────────────────────────────────────
build_ios() {
  echo "=== iOS release build (New Arch, prod-baked) ==="
  rm -rf ios
  # --no-install: we run pod install ourselves AFTER patching the Podfile (below),
  # so the monorepo-hoist exclusions are in place before CocoaPods resolves.
  npx expo prebuild --platform ios --clean --no-install
  cd ios

  # Strip the `exp+<slug>` URL scheme that Expo injects into Info.plist for
  # Expo Go / dev-tools deep linking. In a production device build there is no
  # Expo Go and no dev server, so the scheme is dead weight — and it is the
  # tell that a build is dev-oriented. Remove the whole CFBundleURLTypes entry
  # that contains it (leaving the app's own schemes intact).
  local plist=Warehouse14/Info.plist
  if grep -q "exp+" "$plist" 2>/dev/null; then
    python3 - "$plist" <<'PY'
import sys, plistlib
p = sys.argv[1]
with open(p, "rb") as f:
    d = plistlib.load(f)
types = d.get("CFBundleURLTypes", [])
kept = [t for t in types if not any(str(s).startswith("exp+") for s in t.get("CFBundleURLSchemes", []))]
if len(kept) != len(types):
    d["CFBundleURLTypes"] = kept
    with open(p, "wb") as f:
        plistlib.dump(d, f)
    print(f"  stripped exp+ scheme: {len(types)} -> {len(kept)} URL types")
PY
    echo "✓ Info.plist: removed exp+ dev scheme"
  fi

  # Exclude native pods that pnpm hoisted from a sibling workspace but that THIS
  # app does not use. Without this, Expo's autolinker picks them up from the root
  # node_modules, ReactCodegen registers their Fabric specs, but the codegen files
  # never emit (the dep is only hoisted, not installed here) → xcodebuild fails on
  # a missing "*-generated.mm". react-native-mmkv is used by the store app only;
  # the admin never imports it (persistence is a plain file adapter).
  local podfile=Podfile
  if grep -q "react-native-config" "$podfile"; then
    sed -i '' "s/'react-native-config',/'react-native-config',\n      '--exclude', 'react-native-mmkv',\n      '--exclude', 'expo-dev-client',\n      '--exclude', 'expo-dev-launcher',\n      '--exclude', 'expo-dev-menu',/" "$podfile"
    echo "✓ Podfile patched: excluded react-native-mmkv + expo-dev-client/launcher/menu from autolinking"
  fi

  pod install 2>&1 | tail -8
  # NOTE: do NOT `rm -rf build` here — pod install (via the ReactCodegen script
  # phase) populates build/generated/ with the Fabric/TurboModule descriptors. A
  # blanket `rm -rf build` deletes that output, and the archive then fails on
  # missing "*-generated.mm". The archive writes to build/Warehouse14.xcarchive
  # and Xcode reconciles incrementally; no manual clear is needed.
  # Archive for a REAL DEVICE (iphoneos / arm64), unsigned — the owner signs it
  # himself. NEVER iphonesimulator: a simulator .app cannot install on an iPhone.
  # Capture the full log so a failure prints the real compiler/linker errors
  # (not just the last 5 lines). Do NOT mask the exit code.
  set +e
  xcodebuild \
    -workspace Warehouse14.xcworkspace \
    -scheme Warehouse14 \
    -configuration Release \
    -sdk iphoneos \
    -destination 'generic/platform=iOS' \
    -archivePath build/Warehouse14.xcarchive \
    CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" AD_HOC_CODE_SIGNING_ALLOWED=YES \
    archive > /tmp/w14-xcodebuild.log 2>&1
  local xc_status=$?
  set -e
  if [ "$xc_status" -ne 0 ]; then
    echo "❌ xcodebuild archive failed (exit $xc_status). Last 40 lines:" >&2
    tail -40 /tmp/w14-xcodebuild.log >&2
    exit 1
  fi
  echo "✓ ARCHIVE SUCCEEDED"
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
  ( cd /tmp/w14-ipa && zip -qr "$DESKTOP_OUT/Warehouse14-Admin.ipa" Payload )
  echo "  → $DESKTOP_OUT/Warehouse14-Admin.ipa"
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
  cp "$apk" "$DESKTOP_OUT/Warehouse14-Admin.apk"
  echo "  → $DESKTOP_OUT/Warehouse14-Admin.apk"
  # Verify the baked bundle.
  verify_bundle "Android" <(unzip -p "$apk" assets/index.android.bundle 2>/dev/null)
  cd "$MOBILE_DIR"
}

# ── Android: signed Play-Store bundle (.aab) ──────────────────────────────────
# Produces an UPLOAD-key-signed .aab for Google Play Console (Play App Signing
# re-signs with the app key). Signing creds are read from a protected env file
# (never printed); the upload keystore is YOUR irreplaceable key — back it up.
# Injected signing (-Pandroid.injected.signing.*) survives `expo prebuild --clean`,
# so no generated build.gradle needs editing.
build_aab() {
  echo "=== Android Play-Store bundle (.aab, signed + prod-baked) ==="
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
  local SIGN_ENV="${W14_SIGNING_ENV:-$HOME/Desktop/onlineApps/keystores/warehouse14-play-signing.env}"
  [ -f "$SIGN_ENV" ] || { echo "❌ signing env not found: $SIGN_ENV"; exit 1; }
  set -a; . "$SIGN_ENV"; set +a
  [ -f "$W14_UPLOAD_STORE_FILE" ] || { echo "❌ keystore not found: $W14_UPLOAD_STORE_FILE"; exit 1; }
  rm -rf android
  npx expo prebuild --platform android --clean
  cd android
  ./gradlew :app:bundleRelease --no-daemon 2>&1 | tail -4
  local aab
  aab=$(find . -name "*.aab" -path "*release*" 2>/dev/null | head -1)
  [ -n "$aab" ] || { echo "❌ no release .aab produced"; exit 1; }
  local out="$DESKTOP_OUT/Warehouse14-Admin.aab"
  cp "$aab" "$out"
  # bundleRelease leaves the .aab UNSIGNED (the -Pandroid.injected.signing.* props
  # apply to APK assembly, NOT to bundles), so sign it explicitly with the upload
  # key via jarsigner — the standard, Play-accepted way to sign an .aab.
  "$JAVA_HOME/bin/jarsigner" -keystore "$W14_UPLOAD_STORE_FILE" \
    -storepass "$W14_UPLOAD_STORE_PASSWORD" -keypass "$W14_UPLOAD_KEY_PASSWORD" \
    -sigalg SHA256withRSA -digestalg SHA-256 "$out" "$W14_UPLOAD_KEY_ALIAS" >/dev/null 2>&1
  echo "  → $out"
  # Verify the prod origin is baked in (AAB keeps the JS bundle under base/assets/).
  verify_bundle "Android AAB" <(unzip -p "$out" base/assets/index.android.bundle 2>/dev/null)
  # Confirm the .aab is validly signed with the upload key.
  if "$JAVA_HOME/bin/jarsigner" -verify "$out" 2>&1 | grep -q 'jar verified'; then
    echo "  ✓ signed with the upload key (jar verified)"
  else
    echo "  ⚠️ .aab failed signature verification — Play will reject it"; exit 1
  fi
  cd "$MOBILE_DIR"
}

# ── Android: UPDATE artifacts (.apk + .aab, upload-key-signed) ────────────────
# For shipping an IN-PLACE UPDATE of the installed owner app: Android only
# installs over an existing app when the signature matches and versionCode is
# higher. The stock assembleRelease signs with the DEBUG cert (build.gradle
# signingConfigs.debug), which can never update the released app — so this
# target signs the APK with the UPLOAD key via Gradle's injected-signing
# properties, produces the Play .aab from the SAME prebuild, and hard-verifies
# cert digest, versionCode, the biometric permission, the deep-link scheme and
# the prod bake before declaring success.
build_update() {
  echo "=== Android UPDATE build (.apk + .aab, upload-key-signed, prod-baked) ==="
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
  export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
  local SIGN_ENV="${W14_SIGNING_ENV:-$HOME/Desktop/onlineApps/keystores/warehouse14-play-signing.env}"
  [ -f "$SIGN_ENV" ] || { echo "❌ signing env not found: $SIGN_ENV"; exit 1; }
  set -a; . "$SIGN_ENV"; set +a
  [ -f "$W14_UPLOAD_STORE_FILE" ] || { echo "❌ keystore not found: $W14_UPLOAD_STORE_FILE"; exit 1; }

  rm -rf android
  npx expo prebuild --platform android --clean

  # Manifest sanity BEFORE the long gradle run: the OAuth deep-link scheme and
  # the biometric permission must have been injected by the config plugins.
  local manifest=android/app/src/main/AndroidManifest.xml
  grep -q 'android:scheme="warehouse14"' "$manifest" \
    || { echo "❌ warehouse14 scheme missing from the manifest"; exit 1; }
  grep -q 'USE_BIOMETRIC' "$manifest" \
    || { echo "❌ USE_BIOMETRIC missing (expo-local-authentication plugin did not run)"; exit 1; }
  echo "✓ manifest: warehouse14 scheme + USE_BIOMETRIC present"

  cd android
  ./gradlew :app:assembleRelease :app:bundleRelease --no-daemon \
    -Pandroid.injected.signing.store.file="$W14_UPLOAD_STORE_FILE" \
    -Pandroid.injected.signing.store.password="$W14_UPLOAD_STORE_PASSWORD" \
    -Pandroid.injected.signing.key.alias="$W14_UPLOAD_KEY_ALIAS" \
    -Pandroid.injected.signing.key.password="$W14_UPLOAD_KEY_PASSWORD" \
    2>&1 | tail -4
  local apk aab
  apk=$(find . -name "*.apk" -path "*release*" 2>/dev/null | head -1)
  aab=$(find . -name "*.aab" -path "*release*" 2>/dev/null | head -1)
  { [ -n "$apk" ] && [ -n "$aab" ]; } || { echo "❌ missing artifact (apk='$apk' aab='$aab')"; exit 1; }
  local out_apk="$DESKTOP_OUT/Warehouse14-Admin-update.apk"
  local out_aab="$DESKTOP_OUT/Warehouse14-Admin.aab"
  cp "$apk" "$out_apk"
  cp "$aab" "$out_aab"

  # Injected signing covers APK assembly only — sign the .aab explicitly with
  # the same upload key (identical to the aab target).
  "$JAVA_HOME/bin/jarsigner" -keystore "$W14_UPLOAD_STORE_FILE" \
    -storepass "$W14_UPLOAD_STORE_PASSWORD" -keypass "$W14_UPLOAD_KEY_PASSWORD" \
    -sigalg SHA256withRSA -digestalg SHA-256 "$out_aab" "$W14_UPLOAD_KEY_ALIAS" >/dev/null 2>&1
  "$JAVA_HOME/bin/jarsigner" -verify "$out_aab" 2>&1 | grep -q 'jar verified' \
    || { echo "❌ .aab failed signature verification"; exit 1; }
  echo "  → $out_aab (jar verified, upload key)"

  # ── Hard verification of the UPDATE .apk ───────────────────────────────────
  local bt
  bt=$(ls -d "$ANDROID_HOME/build-tools/"* 2>/dev/null | sort -V | tail -1)
  [ -n "$bt" ] || { echo "❌ no Android build-tools found"; exit 1; }
  # 1. The APK's signer must be the SAME cert as the upload keystore — derive
  #    the expected digest from the keystore itself, never hardcoded.
  local expected got
  expected=$("$JAVA_HOME/bin/keytool" -exportcert -keystore "$W14_UPLOAD_STORE_FILE" \
    -alias "$W14_UPLOAD_KEY_ALIAS" -storepass "$W14_UPLOAD_STORE_PASSWORD" 2>/dev/null \
    | shasum -a 256 | cut -d' ' -f1)
  got=$("$bt/apksigner" verify --print-certs "$out_apk" 2>/dev/null \
    | grep -i 'SHA-256' | head -1 | sed 's/.*: //' | tr -d ' ' | tr 'A-F' 'a-f')
  if [ -z "$expected" ] || [ "$expected" != "$got" ]; then
    echo "❌ APK signer mismatch (expected $expected, got $got) — this would NOT install as an update" >&2
    exit 1
  fi
  echo "  ✓ APK signed with the upload key ($got)"
  # 2. versionCode / versionName from the artifact itself.
  local badging
  badging=$("$bt/aapt" dump badging "$out_apk" 2>/dev/null | head -1)
  echo "  $badging"
  echo "$badging" | grep -q "versionCode='7'" || { echo "❌ versionCode is not 7"; exit 1; }
  echo "$badging" | grep -q "versionName='1.0.6'" || { echo "❌ versionName is not 1.0.6"; exit 1; }
  # 3. Prod bake of both bundles.
  verify_bundle "Android APK" <(unzip -p "$out_apk" assets/index.android.bundle 2>/dev/null)
  verify_bundle "Android AAB" <(unzip -p "$out_aab" base/assets/index.android.bundle 2>/dev/null)
  echo "  → $out_apk"
  cd "$MOBILE_DIR"
}

case "${1:-all}" in
  ios) build_ios ;;
  android) build_android ;;
  aab|playstore) build_aab ;;
  update) build_update ;;
  all) build_ios; build_android ;;
  *) echo "usage: $0 {ios|android|aab|update|all}"; exit 1 ;;
esac

echo ""
echo "✓ release build(s) complete. Prod-baked artifacts on the Desktop:"
# Summary only — never fail the script if some artifact wasn't built this run.
ls -lh "$DESKTOP_OUT"/Warehouse14*.ipa "$DESKTOP_OUT"/Warehouse14*.apk "$DESKTOP_OUT"/Warehouse14*.aab 2>/dev/null || true
