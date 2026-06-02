# Warehouse14 — Server Deployment (Oracle Ubuntu / arm64)

The always-on backend: **Postgres + Redis + API + Worker**, fronted by a
**Cloudflare Tunnel** (TLS + mTLS for `api.warehouse14.de`). Images are built by
GitHub CI and pulled from **GHCR**. The desktop apps (POS, Owner Desktop) talk to
the API over the Cloudflare hostname.

Validated: the migrate image applies all 44 SQL migrations as the migrator role
(68 tables, seeded settings, idempotent) and the app role reads correctly.

---

## One-time server setup

```bash
# 1. Install Docker (Ubuntu arm64)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # re-login

# 2. Put this folder on the server, e.g. /opt/warehouse14, then:
cd /opt/warehouse14
cp .env.production.example .env
nano .env                       # fill passwords + secrets (see below)
chmod +x scripts/*.sh postgres/prod-initdb.d/*.sh

# 3. Log in to GHCR so compose can pull the images
echo "<GITHUB_PAT_with_read:packages>" | docker login ghcr.io -u <github-user> --password-stdin

# 4. Bring it up (migrate runs first, then api + worker + cloudflared)
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f api
```

## `.env` — what to fill (see `.env.production.example`)
- **Passwords**: `POSTGRES_SUPERUSER_PASSWORD`, `MIGRATOR_PASSWORD`, `APP_PASSWORD`
  (`openssl rand -hex 24` each). Set ONCE before the first `up` — they're baked
  into the DB on the first run (fresh volume).
- **Secrets**: `AUTH_SECRET`, `WAREHOUSE14_PII_KEY` (`openssl rand -hex 32`).
- **Cloudflare**: `CLOUDFLARE_TUNNEL_TOKEN` (from Zero Trust → Tunnels).
- **R2**: the four `R2_*` keys (media + exports).
- Optional: Anthropic / Stripe / eBay / WhatsApp / Fiskaly — empty = off.

## Cloudflare Tunnel (the mTLS front door)
1. Cloudflare Zero Trust → **Tunnels** → create one → copy the token → `.env`.
2. Add a **Public Hostname**: `api.warehouse14.de` → `http://api:3001`.
3. **Access → Applications**: protect that hostname with **mutual TLS** and
   issue per-device client certs (the API trusts the `Cf-Client-Cert-Sha256`
   header it injects). This is the device-identity (mTLS) the POS depends on.

## Updates (the whole point)
Push to `main`/tag → CI builds + pushes new images to GHCR → on the server:
```bash
./scripts/update.sh        # docker compose pull && up -d  (migrate runs first)
```
The desktop apps update themselves separately (GitHub Releases + the in-app
updater notifies on open).

## Backups
```bash
./scripts/backup.sh        # gzipped pg_dump, keeps the last 14
# cron:  0 2 * * *  /opt/warehouse14/scripts/backup.sh
```
Restore: `gunzip -c backup.sql.gz | docker exec -i warehouse14-postgres psql -U warehouse14 -d warehouse14`.

## Notes
- The DB + Redis are NOT published to the host — only the internal docker
  network reaches them. Only Cloudflare (api:3001) is exposed, with mTLS.
- Server arch is **arm64** (Oracle Ampere) — CI builds `linux/arm64` images.
- First boot: the `migrate` service applies all migrations, then api/worker
  start (they `depend_on` migrate completing successfully).
