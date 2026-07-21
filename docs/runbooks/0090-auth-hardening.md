# 0090 — Production auth hardening (security review 2026-07-21)

The security review surfaced two live production weaknesses that are **gated on
the owner's go-live decision** because flipping them carelessly locks out the
running shop. The code/mechanism for both is shipped and OFF by default; this
runbook is the safe cutover sequence.

## The two live weaknesses

1. **The legacy `0000` owner PIN still logs in.** The weak-PIN blacklist was only
   enforced when *setting* a PIN, so the historical `0000` owner seed can still
   *log in*. Because the prod mTLS gate is bypassed (see #2), the pin-login door
   is reachable from the open internet, so `curl -d '{"pin":"0000"}'` against the
   prod `/api/auth/pin-login` becomes an owner session. Verified live.
2. **mTLS device attestation is bypassed in prod.** `TEST_DEVICE_FINGERPRINT` +
   `ALLOW_TEST_DEVICE_FINGERPRINT_IN_PROD=true` make every uncerted request
   resolve to one seeded device, so per-device attestation is effectively off.
   This is intentional today (Cloudflare Access mTLS is not yet provisioned for
   the Schorndorf shop) — the boot guard `assertNoTestDeviceFingerprintInProd`
   enforces the explicit opt-in.

Not breached: the data is still test data. Both MUST be closed before real
customer/owner data exists.

## Cutover A — close the `0000` door (low risk, do first)

The owner app is Google-only and the cashier is Google-first, so a PIN is a
*fallback + step-up* credential, not the primary door. Sequence:

1. **Set a strong owner PIN.** Sign in (Google), then
   `POST /api/auth/pin/set { "newPin": "<not in the blacklist>" }`. Repeat for
   any cashier who uses the PIN fallback. (The blacklist already rejects weak
   values on *set*, so this cannot re-introduce a weak PIN.)
2. **Confirm** no one still relies on a blacklisted PIN for step-up or the
   cashier fallback.
3. **Flip the flag:** set `ENFORCE_PIN_BLACKLIST_ON_LOGIN=true` in
   `/opt/warehouse14/.env` and recreate the api. From then on a blacklisted PIN
   is refused with a plain `Invalid PIN` — the `0000` door is closed. No data is
   mutated; no mTLS change; the DB PIN lockout + the 5/min/IP cap stay intact.
4. **Verify:** `curl -d '{"pin":"0000"}' …/api/auth/pin-login` → `401 Invalid PIN`.

## Cutover B — enforce mTLS device attestation (higher risk, do at go-live)

**Do NOT flip this before certs exist — it locks out the live till.**

1. Provision Cloudflare Access mTLS so `cf-client-cert-sha256` arrives on every
   request from the shop devices.
2. Issue a client cert per real device; write each leaf's SHA-256 into
   `devices.cert_serial` with `status='active'` and a future `cert_expires_at`.
3. Confirm each device authenticates WITH its cert (header present, row matches).
4. **Only then** unset both `TEST_DEVICE_FINGERPRINT` and
   `ALLOW_TEST_DEVICE_FINGERPRINT_IN_PROD`. Now an uncerted request 403s.
5. **Verify** the till + owner app + storefront all still work (they present real
   certs), and that a request without a cert is refused.

If step 4 is done before steps 1–3, `extractCertFingerprint` returns `null` in
prod and every device-gated request 403s — the whole shop locks out. That is the
exact failure the boot guard protects against.
