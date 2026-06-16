# Warehouse14 Companion — Trusted iOS Connection Plan

## A. Core decision

Stand up a **private Root CA persisted on the mother POS** and have the hub issue a **leaf cert signed by that CA** for the stable mDNS hostname `warehouse14.local`, with SANs covering both `DNS:warehouse14.local` and the LAN `IP:` (≤398-day validity, `serverAuth` EKU, SHA-256). The hub advertises `warehouse14.local:8714` over mDNS so the name actually resolves, serves HTTPS on `:8714` with the leaf, and exposes a **downloadable `.mobileconfig`** that installs the *CA root* (not the leaf). The iPhone installs that profile once, flips the one **Certificate Trust Settings** toggle (unavoidable on a non-MDM device), and from then on `https://warehouse14.local:8714` is a fully trusted secure context — camera + zxing barcode scanning work in Safari and the Home-Screen web app. This is the only path iOS accepts; everything else (raw HTTP, self-signed leaf on a raw IP) leaves `navigator.mediaDevices` undefined.

## B. What the mother POS must generate / serve

- **Persisted Root CA** — new files alongside the existing TLS pair in the app data dir: `companion-ca.pem` (cert) + `companion-ca.key` (0600). Generate once with `rcgen` (`IsCa = Ca`, `KeyUsage = keyCertSign|crlSign`, long validity ~10y), reuse across restarts. This replaces the current self-signed-leaf model in `companion.rs` (`load_or_create_tls_identity`).
- **CA-signed leaf** — issue `companion-tls.pem` / `.key` **signed by the CA** (not `self_signed`). SANs: `DNS:warehouse14.local`, `DNS:localhost`, and `IP:<LAN-IPv4>` only if `is_private_lan_v4`. Set `serverAuth` EKU, `basicConstraints CA:FALSE`, **validity ≤397 days** (was 10y — must shrink for the leaf). Re-issue automatically when the cert is within ~30 days of expiry or the LAN IP changes.
- **HTTPS on :8714 with the leaf** — keep the existing axum-server + rustls path; serve the **full chain** (leaf + CA) so iOS can build it. TLS is now the primary path, not best-effort fallback (see Risks for the HTTP-fallback handling).
- **`.mobileconfig` generator** — build the XML plist from research Finding 2: one `com.apple.security.root` certificate payload, `PayloadContent` = base64(DER of the CA cert), stable `PayloadIdentifier` (`de.warehouse14.ca.cert`) + per-build `PayloadUUID`. Serve at `GET /trust/warehouse14-ca.mobileconfig` with `Content-Type: application/x-apple-aspen-config`.
- **Onboarding page + QR** — a `GET /trust` HTML page on the hub that walks the user through install (download profile → trust toggle → open app → grant camera), plus the pairing QR. The QR now encodes `https://warehouse14.local:8714` (the `.local` name, not the raw IP).

## C. The one-time iPhone setup (exact taps)

Must be done in **Safari** (third-party browsers can't trigger the profile installer). Open the QR / `https://<LAN-IP>:8714/trust` on first run (IP is fine here — it's just serving the profile download, not the camera origin).

1. Tap **Download CA profile** → Safari shows "This website is trying to download a configuration profile" → **Allow**.
2. **Settings → General → VPN & Device Management → Profile Downloaded → Install** → passcode → **Install** → **Install**.
3. **Settings → General → About → Certificate Trust Settings → Enable Full Trust for "Warehouse14 Local CA"** → confirm. **← Unavoidable on a non-MDM device.** Without it the cert is installed but untrusted and the camera stays blocked.
4. Open **`https://warehouse14.local:8714`** (the QR's main link) → page loads with a valid lock = real secure context.
5. Start the scanner → iOS prompts for **camera** → **Allow**.

Non-MDM unavoidables: the manual **Install** taps (step 2) and the **trust toggle** (step 3) cannot be automated or pre-trusted without MDM/Apple Configurator. Profile signing only changes the install-screen badge, never removes these steps.

## D. Addressing

- **mDNS advertise** — fix `mdns.rs` to publish the **stable** name/port the cert uses: register `_https._tcp.local.` (or `_http._tcp.local.`) with `host_name = "warehouse14.local."`, `port = 8714`, real LAN IP. Today it publishes `w14pos-<pid>.local.` on port 0 — that name has **no relation** to the cert SAN, so `warehouse14.local` resolves to nothing. Use `addr_auto` + **pin to the Wi-Fi NIC** (`enable_interface("en0")`, disable the rest) so it never advertises a VPN/Ethernet/utun address the phone can't reach. Subscribe to `DaemonEvent::NameChange` — if the name collides and changes, the SAN won't match, so log/alert.
- **Cert SAN must match the literal address bar** — both `DNS:warehouse14.local` and `IP:<reserved>` in one leaf, so either path validates.
- **IP fallback** — recommend a **DHCP reservation** for the Mac's Wi-Fi MAC (router config, documented in the onboarding page). The QR carries the `.local` URL; if `.local` resolution fails (unicast `.local` interception, stale Bonjour cache), the user/app falls back to `https://<reserved-IP>:8714`, which validates against the IP SAN. Both paths still need AP client-isolation off.

## E. Phased rollout

**P0 — CA + signed leaf + HTTPS chain (start now).** *Files: `apps/tauri-pos/src-tauri/src/commands/companion.rs`.*
- Add CA generate/persist (`companion-ca.{pem,key}`); change leaf issuance from `self_signed` to **CA-signed**; add `serverAuth` EKU; **drop leaf validity to ≤397 days**; serve the full chain on `:8714`.
- Add near-expiry / IP-change re-issue of the leaf (CA stays put).
- Deliverable: `https://warehouse14.local:8714` presents a CA-chained leaf; manual `curl --cacert companion-ca.pem` validates.

**P1 — mDNS publishes the real name + `.mobileconfig` + `/trust` page.** *Files: `mdns.rs`, `companion.rs`, new `companion-web/trust.html`.*
- `mdns.rs`: publish `warehouse14.local.` / port 8714 / Wi-Fi NIC pinned; keep peer-discovery service if still needed but as a separate registration.
- `companion.rs`: route `GET /trust/warehouse14-ca.mobileconfig` (CA payload) + `GET /trust` onboarding HTML; QR now encodes the `.local` URL.
- Deliverable: phone resolves `warehouse14.local`, downloads + installs the CA, reaches a valid HTTPS origin.

**P2 — POS pairing UI surfaces trust state + onboarding.** *Files: `apps/tauri-pos/src/screens/secondary/GeraeteKoppeln.tsx`.*
- Extend the TS `CompanionInfo` interface to include the **`secure`** and **`tlsFingerprint`** fields the Rust side already returns (currently omitted, lines 26–36). Show an https/http badge, the SHA-256 fingerprint to eyeball, a **"CA installieren"** button/QR to `/trust`, and the DHCP-reservation hint.
- Deliverable: operator sees secure vs insecure, can drive the iPhone trust flow from the POS.

**P3 — iOS camera/scanner hardening (web SPA).** *Files: `apps/tauri-pos/src-tauri/companion-web/app.js`.*
- Remove the stale "hub serves http:// no TLS" comment (lines ~3083–3084); keep the `window.isSecureContext` guard as the real gate.
- Decode with **`@zxing/library`** (native `BarcodeDetector` is unusable on iOS); request `facingMode:{ideal:'environment'}`, set `<video> playsinline`.
- Standalone gotchas: keep the scanner on **one stable URL** (no hash/route change while camera live), `stream.getTracks().forEach(t=>t.stop())` before any navigation; expect a separate camera grant in the Home-Screen app vs Safari.
- Deliverable: live camera + barcode scanning verified on Basel's iPhone in both Safari and the installed web app.

## F. Risks / gotchas + mitigations

- **Manual trust toggle is easy to miss** → the single most common failure. Mitigation: the `/trust` page calls it out explicitly with the exact path (Settings → General → About → Certificate Trust Settings); the POS shows an "iPhone vertraut noch nicht" state until the hub sees a successful TLS handshake from that device.
- **AP / Wi-Fi client isolation** silently kills both mDNS *and* the IP fallback (L2 blocked). Mitigation: document "client isolation OFF for the POS VLAN" as a hard prerequisite in onboarding; HealthDot can flag "phone can't reach hub" so it's diagnosable.
- **Leaf expiry (≤398 days)** → cert silently goes invalid, camera breaks ~a year later. Mitigation: auto re-issue from the long-lived CA on near-expiry/boot; the CA itself is long-lived so **the phone never re-installs anything** on leaf rotation.
- **CA rotation** → if the CA is ever regenerated, every phone must re-install + re-toggle. Mitigation: persist the CA durably (back it up with the pairing store); only regenerate deliberately.
- **Profile signing** → unsigned shows a red "Unsigned" banner (still installs fine). Mitigation: ship unsigned for the single in-shop phone; optionally sign later with an Apple Developer ID for a green "Verified" badge — does not change TLS behavior.
- **`.local` unicast interception / stale Bonjour cache** → name won't resolve. Mitigation: DHCP-reserved IP fallback in the SAN + QR/secondary link.
- **mDNS name collision** (`DaemonEvent::NameChange`) → advertised name drifts off the SAN. Mitigation: subscribe and log/alert; the name is fixed/unique enough (`warehouse14.local`) that this is rare.
- **HTTP fallback re-introduces an insecure origin** → if TLS fails to arm, the hub would serve plain HTTP and the camera silently dies. Mitigation: when serving HTTP, the SPA's `isSecureContext` guard already degrades to the file-picker; surface a clear "kein sicherer Kontext — Kamera gesperrt" banner rather than a silent fail.

## G. What stays unchanged for Android

Android (Chrome) is far more permissive and the existing flow already works. Keep it working with **near-zero effort**:
- The CA-signed leaf is strictly *better* than today's self-signed leaf — Android users can still tap-through/accept, or (cleaner) install the same CA via Android's "Install a certificate → CA certificate" if desired, but **not required**.
- The QR moving to `https://warehouse14.local:8714` is fine on Android (Chrome resolves `.local` via mDNS on modern Android; the IP fallback covers older devices).
- No change to the axum router, pairing, proxy, cart-bridge, or role SPA — those are transport-agnostic. The only shared change Android inherits is the better cert + stable name, both of which are improvements, not regressions.
- Minimal effort: verify one Android scan still reaches the hub over the new `.local` URL; if `.local` ever fails on an old Android, the IP-SAN fallback already handles it.

---

**Start P0 immediately** in `apps/tauri-pos/src-tauri/src/commands/companion.rs`: add the persisted Root CA, switch leaf issuance to CA-signed with `serverAuth` EKU and ≤397-day validity, and serve the full chain on `:8714`. Everything else layers on top.

Key files to touch: `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src-tauri/src/commands/companion.rs` (CA + leaf + HTTPS + `.mobileconfig` + `/trust` routes), `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src-tauri/src/commands/mdns.rs` (publish `warehouse14.local:8714`, pin Wi-Fi NIC), `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src/screens/secondary/GeraeteKoppeln.tsx` (surface `secure`/`tlsFingerprint` + trust onboarding), `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src-tauri/companion-web/app.js` (zxing decode + iOS secure-context/standalone hardening), and new `/Users/basel/Desktop/warehouse14/apps/tauri-pos/src-tauri/companion-web/trust.html`.
