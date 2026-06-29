# 0078 — KYC-Volume + Storefront-Publish-Fix (live applied 2026-06-29)

Two production defects surfaced while the owner tested the admin app.

## A) KYC document upload → 500 `EACCES: mkdir '/data/kyc'`

**Symptom.** Every identity-document (Ausweis/KYC) upload returned 500. The api
log showed `EACCES: permission denied, mkdir '/data/kyc'` from
`writeKycImage` (`apps/api-cloud/src/lib/kyc-store.ts`).

**Root cause.** `kyc-store.ts` writes encrypted `.enc` shards under
`env.KYC_PHOTOS_DIR` (default `/data/kyc`). Unlike `/data/photos` (a mounted,
world-writable named volume), `/data/kyc` had **no volume** — so the api
(running as `uid=1000 node`) tried to `mkdir` inside `/data`, which is
`root:root 0755`. Permission denied. It would also have been **ephemeral**
(lost on container recreate) — unacceptable for legally-retained ID images.

**Fix (in `infrastructure/docker/docker-compose.prod.yml`).** Added a dedicated
persistent volume `kycdata → /data/kyc` on both `api` and `worker` (the
GDPR-cleanup job prunes shards there), set `KYC_PHOTOS_DIR: /data/kyc`
explicitly, and declared `kycdata` (named `warehouse14-kycdata`).

Applied live:
```bash
# repo compose == server compose (verified by diff), so copy + recreate:
cat infrastructure/docker/docker-compose.prod.yml | ssh myserver 'cat > ~/dc.new \
  && sudo cp /opt/warehouse14/docker-compose.prod.yml /opt/warehouse14/docker-compose.prod.yml.bak-prekyc \
  && sudo cp ~/dc.new /opt/warehouse14/docker-compose.prod.yml'
ssh myserver 'cd /opt/warehouse14 && sudo docker compose -f docker-compose.prod.yml up -d --no-deps api worker'
# the fresh named volume is root-owned → chown to node so it can write:
ssh myserver 'cd /opt/warehouse14 && sudo docker compose -f docker-compose.prod.yml exec -T -u root api chown -R node:node /data/kyc'
```
Verified: `/data/kyc` is `node node`, writable by the container; `/health` 200.

KYC images stay AES-256 encrypted at rest; the encryption key is the
`KYC_IMAGE_ENCRYPTION_KEY` set in `.env` (never logged).

## B) Published products never reached the storefront

**Symptom.** Owner sets a product available + taps the channel switches, but it
never appears on warehouse14.de or the customer store app.

**Root cause.** The storefront API serves only
`WHERE is_published_to_web = TRUE AND status = 'AVAILABLE'`
(`apps/api-cloud/src/routes/storefront-catalog.ts`). The admin product detail
(`apps/mobile/src/app/product/[id].tsx` → `PublishPanel`) exposed only
`listedOnStorefront` (shop-counter flag) and `listedOnEbay` — **never
`isPublishedToWeb`**. So no admin action could publish a product to the web.

**Fix (mobile).** Added an **„Im Online-Shop"** switch bound to
`isPublishedToWeb` (server + api-client already supported it), with an honest
hint that it only shows once the status is „Verfügbar". Relabeled the old
„Online" switch to „eBay" to remove the ambiguity. Ships in the next app build.

Storefront cache: `Cache-Control: max-age=60, stale-while-revalidate=300`,
`cf-cache-status: DYNAMIC` — a freshly-published item shows within ≤60 s (or
instantly on hard refresh). No change needed.

## Rollback
`sudo cp /opt/warehouse14/docker-compose.prod.yml.bak-prekyc /opt/warehouse14/docker-compose.prod.yml && docker compose up -d --no-deps api worker`
(the `kycdata` volume persists and is harmless if unmounted).

## Deferred audit findings (P2/P1 — follow-up, not yet fixed)
The 2026-06-29 latent-bug audit confirmed 9 issues. Fixed this session: storefront
publish toggle, KYC volume, the two truthless channel toggles, dashboard badges,
WhatsApp-bot gate, durable /data Dockerfile perms. **Still open:**
- **P1 — tauri-pos document capture 500s**: `Dokumente.tsx` posts to the R2 presign
  route, but prod `R2_BUCKET` is empty → `getR2Client()` throws 500. Repoint it at the
  working local route `POST /api/photos/upload` (product photos already use it). Cashier
  app only — not in the admin build.
- **P2 — SOLD-but-published PDP 404**: `storefront-catalog.ts` detail keeps
  `AND status='AVAILABLE'`, so a sold item's public page hard-404s (bad SEO). Return a
  200 „verkauft" state or 410 Gone instead.
- **P2 — ProductListRow under-declares 7 stamp/collector fields** the list route already
  returns (typed-away Briefmarken data). Add them to the api-client type.
- **P2 — category facet ignores `hidden_from_storefront`**: `?category=<hidden-slug>` can
  surface internal-only products. Exclude hidden categories in the descendant CTE.
