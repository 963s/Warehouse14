# 0079 — Google Play release (Android Admin app)

The admin app (`apps/mobile`) is now packaged as a **signed Android App Bundle
(`.aab`)** for Google Play Console. Package id (applicationId): **`de.warehouse14.mobile`**.

## Artifacts (on the Desktop, `~/Desktop/W14-builds/`)
- `Warehouse14-PlayStore.aab` — the upload artifact for Play Console. Prod-baked
  (`EXPO_PUBLIC_API_BASE_URL=https://api.warehouse14.de`), signed with the upload key.
  Built by `apps/mobile/scripts/release-build.sh aab`.

## Upload (signing) key — IRREPLACEABLE, BACK IT UP
- Keystore: `~/Desktop/onlineApps/keystores/warehouse14-play-upload.keystore`
- Credentials (store password, key alias `warehouse14`, key password):
  `~/Desktop/onlineApps/keystores/warehouse14-play-signing.env` (chmod 600)
- Upload-key SHA-256:
  `75:7B:31:D8:9A:6B:6D:9A:E8:E8:56:52:3F:3D:6B:6E:3A:58:CB:59:93:96:90:A7:A9:30:D7:39:EF:B3:AD:11`

> Save BOTH files (keystore + the `.env`) in your password manager / offline backup.
> If the upload key is lost you can reset it via Play support (only if enrolled in
> Play App Signing); if Play App Signing is NOT used, a lost key means you can never
> update the app. Always enrol in Play App Signing (the default for new apps).

## Play Console steps (owner)
1. Play Console → **Create app** → name, German, app (not game), free/paid.
2. **Release → Setup → App signing**: keep **Play App Signing ON** (Google holds the
   real app-signing key; this `.aab` is signed with the *upload* key above).
3. **Testing → Internal testing → Create release** → upload `Warehouse14-PlayStore.aab`.
   - Internal testing is how you install on real devices before going public (an `.aab`
     is not directly sideloadable; Play serves a per-device APK).
   - Add tester emails, share the opt-in link, install from Play on the device.
4. Fill the required listing (icon, screenshots, short/full description, privacy
   policy URL, data-safety form, content rating) before promoting to Production.

## Rebuild a new version later
1. Bump `version` (and let prebuild derive `versionCode`) in `apps/mobile/app.json`.
2. `cd apps/mobile && JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
   bash scripts/release-build.sh aab` → fresh signed `.aab` on the Desktop.
3. Upload as a new release. Same upload key every time (read from the `.env`).

The injected signing (`-Pandroid.injected.signing.*`) survives `expo prebuild --clean`,
so no generated `android/` file needs hand-editing.
