# Warehouse14 mobile — build & signing

POC builds use **EAS cloud** so no local Xcode / Android SDK is required. The
only profile that matters for the POC is `preview` (see `eas.json`): Android →
installable `.apk`, iOS → device build signed with **your own** Apple cert.

Bundle id (both platforms): `de.warehouse14.mobile` (`app.json`). Your iOS
provisioning profile's App ID **must** match this.

---

## One-time setup

```bash
npm i -g eas-cli      # if not installed
eas login             # your free Expo account
```

## Android `.apk` (fully automated — Expo manages the keystore)

```bash
cd apps/mobile
eas build -p android --profile preview
```

Produces an internal-distribution **APK**. Download the link EAS prints and
install it on any Android device (enable "install unknown apps").

## iOS `.ipa` — signed with YOUR cert (nothing provisioned on this Mac)

1. Export from your Apple Developer account (Keychain → your *Apple
   Distribution* cert → Export → `.p12` with a password; download a matching
   **Ad Hoc** or **App Store** provisioning profile for App ID
   `de.warehouse14.mobile`).
2. Place the files (this dir is gitignored):

   ```
   apps/mobile/ios/certs/dist.p12
   apps/mobile/ios/certs/profile.mobileprovision
   ```

3. `cp credentials.example.json credentials.json` and set the `.p12` password.
4. Build:

   ```bash
   cd apps/mobile
   eas build -p ios --profile preview     # credentialsSource: local → uses YOUR cert
   ```

> ⚠️ `expo prebuild --clean` deletes `ios/`, including `ios/certs/`. Place the
> certs **after** any prebuild and right before `eas build`.

### Pure-local alternative (no EAS, your Team in Xcode)

```bash
cd apps/mobile
npx expo prebuild -p ios          # generates ios/
open ios/*.xcworkspace            # set your Team under Signing & Capabilities,
                                  # then Product → Archive → Distribute → Ad Hoc
```

---

## What still needs Basel (cannot be done from this machine)

- [ ] **Expo login** for the EAS cloud builds (`eas login`).
- [ ] Run `eas build -p android --profile preview` → install the APK on a real Android.
- [ ] Export `.p12` + `.mobileprovision` (App ID `de.warehouse14.mobile`), drop into
      `ios/certs/`, fill `credentials.json`, then `eas build -p ios --profile preview`.
- [ ] Install the iOS dev/EAS build on your physical iPhone and run a real
      barcode **scan** — vision-camera cannot run in Expo Go or on web.
