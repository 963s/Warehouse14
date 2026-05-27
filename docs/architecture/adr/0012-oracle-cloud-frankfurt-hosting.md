# ADR-0012 — Oracle Cloud Frankfurt (Ampere A1 ARM64) hosting with a fully Dockerized, multi-arch stack

- **Status:** Proposed (pending Basel review)
- **Date:** 2026-05-23
- **Deciders:** Basel, Claude
- **Supersedes (provider only):** ADR-0005 — the EU-residency *principle* and the Cloudflare R2 + AWS Glacier choices remain valid; the Hetzner provider choice is replaced.
- **Related:** ADR-0008 (schema imposes role separation + backup requirements), ADR-0014 (Live Ops transport — uses the proxy and network design defined here), `docs/memory.md` §2 #29, §4 (hosting table).

## Context

Basel owns a Frankfurt-region Oracle Cloud VM under the **Always Free** plan. Specs (confirmed 2026-05-23):

| Property            | Value                              |
|---------------------|------------------------------------|
| Plan                | Oracle Always Free                 |
| Architecture        | Ampere A1 — **ARM64**              |
| vCPU                | 4                                  |
| RAM                 | 24 GB                              |
| Region              | Frankfurt (DSGVO ✓, ~10ms RTT from Weil am Rhein) |
| Block storage       | up to 200 GB included              |
| Network egress      | 10 TB/month included               |
| Cost                | €0/month (Always Free SLA)         |

The constraint set this ADR must satisfy:

1. **ARM64-native production.** Every image and every native module must execute on `linux/arm64`.
2. **x86_64 / Apple Silicon dev parity.** The same compose stack must spin up locally on Basel's Mac without modification — multi-arch images are mandatory.
3. **Single-VM colocation (V1).** Postgres + Redis + API + workers + reverse proxy + observability + WAL streaming all run on one VM. No external dependencies for the hot path.
4. **Scalability seams must be visible.** When throughput demands separation (Phase 2+), the compose layout must split cleanly without rewriting service interfaces — i.e., services already talk to each other by hostname over a network, not by `localhost` or unix sockets.
5. **GoBD / DSGVO discipline.** Backups encrypted in transit and at rest, 10-year retention, automated restore drills.
6. **No managed Postgres available.** Always Free excludes Oracle's managed PG; we self-host PG 17 in a container.
7. **Defense in depth at the network layer.** No service may listen on Oracle's public network interface. All ingress goes through controlled tunnels (Cloudflare + Tailscale — detailed in ADR-0014).

## Decision

### 1. Container topology — one VM, eight services, three networks

| Service           | Image (base)                                        | Purpose                                                  | Network attachment           |
|-------------------|-----------------------------------------------------|----------------------------------------------------------|------------------------------|
| `postgres`        | `postgres:17-alpine` (arm64-native)                 | Primary DB, pgcrypto, custom triggers                    | `internal` only              |
| `redis`           | `redis:7-alpine`                                    | BullMQ queue + SSE pub/sub fan-out                       | `internal` only              |
| `api`             | `warehouse14/api:${VERSION}` (multi-arch)           | Fastify + better-auth + Drizzle                          | `internal` + `proxy`         |
| `worker`          | `warehouse14/worker:${VERSION}` (multi-arch)        | BullMQ consumer (TSE retries, KYC OCR, LBMA price feed)  | `internal` only              |
| `caddy`           | `caddy:2-alpine`                                    | Reverse proxy, mTLS termination, HTTP/2 + SSE pass-through | `proxy` + `tunnel`         |
| `step-ca`         | `smallstep/step-ca:latest`                          | Internal CA for device client certs                      | `tailscale` only             |
| `cloudflared`     | `cloudflare/cloudflared:latest`                     | Cloudflare Tunnel client (no public IP on Oracle)        | `tunnel` only                |
| `prometheus`      | `prom/prometheus:latest`                            | Metrics scraper                                          | `internal` + `monitoring`    |
| `grafana`         | `grafana/grafana:latest`                            | Dashboards (reachable only via Tailscale)                | `monitoring` + `tailscale`   |
| `node-exporter`   | `prom/node-exporter:latest`                         | Host metrics                                             | `monitoring` only            |
| `postgres-exporter`| `prometheuscommunity/postgres-exporter:latest`     | PG metrics                                               | `monitoring` only            |
| `redis-exporter`  | `oliver006/redis_exporter:latest`                   | Redis metrics                                            | `monitoring` only            |
| `cadvisor`        | `gcr.io/cadvisor/cadvisor:latest`                   | Per-container metrics                                    | `monitoring` only            |
| `wal-g-sidecar`   | `warehouse14/wal-g:${VERSION}` (multi-arch)         | Continuous WAL ship + nightly base backup to R2          | `internal` only              |

Three Docker networks, no cross-talk except what is explicitly granted:

- **`internal`** — application services and the DB. Only services that need DB access live here.
- **`proxy`** — only Caddy and the upstream services it routes to.
- **`tunnel`** — only Caddy and cloudflared.
- **`monitoring`** — Prometheus + exporters. Prometheus reaches into `internal` via a read-only scrape config.
- **`tailscale`** — host networking via the Tailscale daemon on the VM. step-ca, grafana, and the SSH endpoint live here.

The VM exposes **zero ports** on its public interface. The only ingress paths are Cloudflare Tunnel (outbound-initiated from cloudflared) and Tailscale (outbound-initiated WireGuard). This is the foundation that ADR-0014's mTLS layer builds on.

### 2. Multi-arch build pipeline

Every image we own (`api`, `worker`, `wal-g-sidecar`) is built for both `linux/amd64` (local dev on Intel Macs + GitHub Actions x86 runners) and `linux/arm64` (Apple Silicon dev + Oracle production):

```yaml
# .github/workflows/build-images.yml (sketch)
- uses: docker/setup-qemu-action@v3       # fallback for arm64 emulation
- uses: docker/setup-buildx-action@v3
- uses: docker/build-push-action@v6
  with:
    platforms: linux/amd64,linux/arm64
    push: true
    tags: ghcr.io/warehouse14/api:${{ github.ref_name }}
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

**ARM-native runners (preferred).** GitHub now offers free `ubuntu-24.04-arm` runners; we use them in the matrix and fall back to QEMU only when an ARM runner is queue-blocked. ARM-native builds are ~6× faster than QEMU for native-module-heavy images.

**Native module discipline.** The Dockerfile for `api` and `worker` explicitly invokes a build stage that compiles `better-sqlite3`, `argon2`, and any other native dep against the target arch using prebuilt binaries where available, falling back to source compile:

```dockerfile
# Dockerfile.api (sketch)
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    corepack enable && pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build --filter=@warehouse14/api

FROM gcr.io/distroless/nodejs20-debian12:nonroot AS runtime
WORKDIR /app
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
USER nonroot
CMD ["dist/index.js"]
```

Distroless runtime: no shell, no package manager, no busybox — attack surface is the Node.js binary and our compiled code, nothing else. Both arches of `distroless/nodejs20` are published by Google.

**Image registry.** GitHub Container Registry (`ghcr.io`) — free for private repos, supports OCI multi-arch manifests natively, integrates with GitHub Actions tokens.

### 3. Reverse proxy: Caddy

Caddy is the right tool here:

- **HTTP/2 + SSE pass-through** out of the box — long-lived event streams require no special config.
- **mTLS termination** with `client_authentication trust_pool` against an `inline_pool` of the step-ca root CA. Validated client cert's CN becomes a forwarded header into the API.
- **Single-file Caddyfile** — auditable in a code review.
- **Graceful reload** without dropping connections (matches our zero-downtime deploys).
- **ARM64-native image** — official.

Caddyfile sketch (`infrastructure/docker/caddy/Caddyfile`):

```caddyfile
{
    # No automatic HTTPS at the public edge — Cloudflare Tunnel terminates TLS upstream.
    # Inside the tunnel we speak HTTP/2 cleartext to Caddy.
    auto_https off
    servers {
        protocols h1 h2c
    }
}

# Public-ish API (browsers via storefront, bearer-token auth, no mTLS).
http://api.internal {
    handle /api/public/* {
        reverse_proxy api:3000
    }
    handle /api/* {
        # Anything not /api/public/* on this host is rejected here — mTLS surface is a different host.
        respond 404
    }
}

# mTLS-protected admin + live ops surface.
https://live.internal {
    tls /etc/caddy/server.crt /etc/caddy/server.key {
        client_auth {
            mode require_and_verify
            trust_pool inline {
                trust_cert_file /etc/caddy/step-ca-root.crt
            }
        }
    }

    @cert_present `{tls_client_subject_dn} != ""`

    handle @cert_present {
        # Forward the client cert subject DN to the API as a header it can trust.
        # Caddy already validated the cert against step-ca; the API uses the DN as device identity.
        reverse_proxy api:3000 {
            header_up X-Client-Cert-DN {tls_client_subject_dn}
            header_up X-Client-Cert-Serial {tls_client_serial}
            flush_interval -1   # critical for SSE — disable buffering
        }
    }
}
```

The `flush_interval -1` line is the difference between SSE working and SSE silently buffering for 60 seconds.

### 4. Postgres tuning — 8 GB RAM, 2 vCPU, single-shop workload

`infrastructure/docker/postgres/postgresql.conf` (production-relevant lines):

```conf
shared_buffers = 2GB                # 25% of allocated RAM
effective_cache_size = 6GB          # 75% of allocated RAM (tells planner about OS page cache)
maintenance_work_mem = 512MB        # for VACUUM, CREATE INDEX
work_mem = 16MB                     # per-sort/hash; conservative for many concurrent connections
max_connections = 100               # paired with pgbouncer-in-the-API for connection multiplexing
wal_level = replica                 # required for WAL-G streaming
max_wal_senders = 3                 # one for WAL-G + headroom
archive_mode = on
archive_command = 'wal-g wal-push %p'
checkpoint_completion_target = 0.9
random_page_cost = 1.1              # SSD-backed Oracle block storage
effective_io_concurrency = 200      # SSD
log_min_duration_statement = 1000   # log queries > 1s for tuning visibility
log_lock_waits = on                 # surfacing the ledger_events FOR UPDATE contention if it ever bites
shared_preload_libraries = 'pg_stat_statements'
```

`pg_hba.conf` allows connections only from the `internal` Docker network (`172.20.0.0/16` typically) and rejects everything else. The migrator role connects only from the GitHub Actions runner's IP allowlist, via a short-lived port-forward over Tailscale during deploys.

### 5. Backup strategy — WAL-G to R2 (hot) and Glacier (legal cold)

| Tier               | Mechanism                                            | Frequency                  | Retention               | Encryption |
|--------------------|------------------------------------------------------|----------------------------|-------------------------|------------|
| WAL stream         | `wal-g wal-push` from `archive_command`              | continuous (every WAL segment) | 7 days on R2        | libsodium AEAD, key in Oracle Vault |
| Base backup        | `wal-g backup-push` from cron in the sidecar         | nightly 03:00 Europe/Berlin | 7 days on R2 (rolling) | libsodium |
| Weekly cold archive| `wal-g backup-push --permanent` + lifecycle policy   | weekly Sun 04:00           | 10 years on S3 Glacier Deep Archive | libsodium + S3 SSE-KMS |
| Logical dump       | `pg_dump -Fc` from sidecar (parallel-safe alternative path) | nightly 03:30      | 7 days on R2            | libsodium |

**Two parallel backup paths** (WAL-G + pg_dump) — the failure modes are different (WAL-G can break if PG WAL format changes across major versions; pg_dump can break on schema features WAL-G doesn't care about). Belt and braces.

**Restore drill in CI** — `.github/workflows/backup-verify.yml` runs weekly:

```
1. Spin up a throwaway Postgres container.
2. wal-g backup-fetch LATEST + wal-g wal-fetch up to PITR target (random point in last 24h).
3. Run packages/db/scripts/verify-chain.ts → asserts the ledger_events hash chain still validates end-to-end.
4. Run packages/db/scripts/verify-row-counts.ts → counts agree with the production snapshot from yesterday (per logical_replication or pg_dump comparison).
5. If anything fails: page Basel.
```

A backup that has never been restored is not a backup. This is the line.

### 6. Observability — Prometheus + Grafana + Alertmanager

```
infrastructure/docker/
├── prometheus/
│   ├── prometheus.yml              # scrape configs, retention 30d
│   └── rules/
│       ├── api.yml                 # rate of 5xx, p99 latency, queue depth
│       ├── postgres.yml            # connections, locks, replication lag, archive lag
│       ├── redis.yml               # memory, evictions, ops/sec
│       └── system.yml              # CPU, mem, disk, network on the host
├── grafana/
│   ├── provisioning/
│   │   ├── datasources/prometheus.yml
│   │   └── dashboards/             # provisioned as code
│   └── dashboards/
│       ├── warehouse14-api.json
│       ├── warehouse14-postgres.json
│       ├── warehouse14-business.json   # transactions/day, KYC throughput, TSE state mix
│       └── warehouse14-system.json
└── alertmanager/
    └── alertmanager.yml            # email via Postmark + Telegram webhook for urgent
```

Critical alerts (defined as code, version-controlled):

- `wal_g_archive_lag > 5 minutes` — backup pipeline is failing
- `postgres_replication_lag > 30 seconds` — not applicable to single-VM, becomes live after we add replicas
- `ledger_events_insert_failures > 0` — should never happen, alert immediately
- `tse_queue_depth > 50` — Fiskaly TSE is degraded, cashier sales will start blocking
- `disk_used_percent > 80` — manual intervention needed
- `api_p99_latency > 2s for 5 minutes` — perf regression or DB lock storm

Grafana is reachable **only via Tailscale** (`grafana.warehouse14.tailnet.ts.net`). Never via Cloudflare. Basel logs in with WebAuthn from any device on the tailnet.

### 7. Secrets management — three-tier model

| Tier                            | Mechanism                              | Examples                                                |
|---------------------------------|----------------------------------------|---------------------------------------------------------|
| **Local dev**                   | `.env` files (gitignored)              | DB password, OpenAI key, Mollie test key                |
| **CI (GitHub Actions)**         | GitHub Actions Secrets                 | GHCR push token, SSH deploy key, Tailscale auth key     |
| **Production on Oracle**        | Docker secrets, sourced from Oracle Vault via `oci-cli` at boot | All API keys, DB passwords, WAL-G encryption key, step-ca password |

The Oracle Vault → Docker secrets flow runs once at host boot (`scripts/load-secrets-from-vault.sh`). Secrets land on a `tmpfs` mount at `/run/warehouse14/secrets/` — memory-only, vanish on reboot, never on disk. Docker secrets mount them into containers read-only.

No secret is ever in a Docker image. No secret is ever in `docker-compose.yml`. CI pre-flight asserts both of these via a `grep` against the compose file and a `docker image inspect` scan.

### 8. Deployment workflow — GHA → GHCR → SSH → docker compose pull

```
git tag v0.1.2 + git push --tags
        │
        ▼
GitHub Actions:
  1. Run tests + typecheck + lint
  2. docker buildx build --platform linux/amd64,linux/arm64 → push to ghcr.io/warehouse14/*:v0.1.2
        │
        ▼
GitHub Actions deploy job (only on protected tag):
  3. ssh -J <bastion> oracle.warehouse14.tailnet  (Tailscale SSH, no public port 22)
  4. cd /opt/warehouse14 && export VERSION=v0.1.2 && docker compose pull && docker compose up -d
  5. Wait 30s for healthchecks. If unhealthy → rollback to previous tag.
  6. Run smoke test: curl https://api.warehouse14.de/api/public/health → expect {"status":"ok","version":"v0.1.2"}
        │
        ▼
Slack / Telegram notification to Basel.
```

**Zero downtime via Caddy's graceful upstream switching.** When `docker compose up -d api` recreates the container, Caddy detects the new container, drains old connections, routes new ones. The 30-second healthcheck window covers PG migrations that must run before the new API starts.

**Migrations run as part of `api` startup**, but with the `warehouse14_migrator` role (not `warehouse14_app`). The API binary refuses to start serving traffic until migrations complete successfully. If migrations fail, the old container keeps serving.

### 9. Bootstrap script — one-shot VM provisioning

`scripts/bootstrap-oracle.sh` brings a freshly-provisioned Ampere A1 instance to "ready to receive a deploy" in one run:

```
1. Lock down SSH — disable password auth, allow only Basel's key + Tailscale SSH.
2. Configure UFW — default deny, only allow Tailscale interface + Docker bridges.
3. Install Docker CE + docker compose plugin (apt repo, ARM-native packages).
4. Install Tailscale, run `tailscale up --ssh --hostname=oracle.warehouse14`.
5. Install cloudflared, register tunnel with Cloudflare account, store credentials in tmpfs.
6. Install fail2ban + auditd + unattended-upgrades.
7. Create /opt/warehouse14/ tree, clone repo at the configured tag.
8. Pull initial images.
9. Run `docker compose up -d` (will exit if .env or secrets missing — surfaces config gaps loudly).
10. Print a health-check summary.
```

The script is **idempotent** — re-running it on an already-provisioned VM is safe and produces the same end state. This is the discipline that prevents drift between Basel's manual changes and what's documented.

### 10. Resource budget (24 GB RAM / 4 vCPU)

| Service             | RAM      | vCPU       | Justification                                              |
|---------------------|----------|------------|------------------------------------------------------------|
| postgres            | 8 GB     | 2          | shared_buffers + page cache + work_mem headroom            |
| api                 | 4 GB     | 1          | Node.js heap up to 3 GB, headroom for V8 GC and modules    |
| worker              | 2 GB     | 0.5        | BullMQ + occasional OCR / LBMA / PDF generation            |
| redis               | 1 GB     | 0.25       | small ops, low memory pressure                             |
| caddy               | 256 MB   | 0.25       | tiny footprint                                             |
| cloudflared         | 256 MB   | 0.25       | tunnel client                                              |
| step-ca             | 256 MB   | 0.1        | cert issuance, near-idle most of the time                  |
| prometheus          | 1.5 GB   | 0.25       | 30d retention, ~5k active series                           |
| grafana             | 512 MB   | 0.1        | dashboards                                                 |
| exporters (node + pg + redis + cAdvisor) | 512 MB | 0.15 | metric scrape targets               |
| wal-g sidecar       | 512 MB   | 0.1        | continuous WAL ship, occasional base backup                |
| OS + Docker daemon  | 3 GB     | rest       | kernel buffers, Docker overhead                            |
| **Total budgeted**  | **~21.8 GB** | **~4** | **leaves ~2 GB headroom in RAM**                       |

The 2 GB headroom is the safety margin. If we ever start swapping, the alert fires before the user notices.

### 11. Disk layout (200 GB block volume)

```
/                        (system, 20 GB)
/var/lib/docker          (Docker storage driver, 30 GB)
/var/lib/warehouse14/pg  (Postgres data, 80 GB — sized for 5y of single-shop volume)
/var/lib/warehouse14/redis (Redis AOF, 5 GB)
/var/lib/warehouse14/wal-staging (WAL-G upload buffer, 20 GB — burst tolerance)
/var/lib/warehouse14/logs (rotated, 20 GB cap)
/var/lib/warehouse14/grafana (Grafana SQLite + dashboards, 5 GB)
/var/lib/warehouse14/prometheus (TSDB, 20 GB — paired with 30d retention)
```

ZFS or XFS? **XFS** — Linux-native, mature on ARM, simpler than ZFS for a one-VM setup. ZFS is the right answer when we add replicas (snapshots-as-replication-primitive) — deferred.

### 12. Scalability seams — what to do when one VM is no longer enough

The compose layout is designed so that splitting the stack later is mechanical, not architectural:

| Trigger                                                  | Action                                                                                     |
|----------------------------------------------------------|--------------------------------------------------------------------------------------------|
| Postgres CPU > 70% sustained                             | Move `postgres` to its own VM (Hetzner Cloud, Oracle paid tier, or wherever). Update `postgres` hostname in the API config. Set up streaming replication to a read replica for reports. |
| API p99 > 500ms during business hours                    | Run 2x `api` instances behind Caddy upstream. Caddy already does upstream balancing.       |
| Worker queue lag > 30s                                   | Scale `worker` horizontally — BullMQ is multi-consumer-safe.                               |
| Storefront traffic shifts the public surface             | Move `api` (public surface) to a separate compose profile on its own VM; keep `worker` and live ops on the primary. |
| Multi-shop demand                                        | Introduce `shop_id` (memory.md Known limits #5), shard `ledger_events` by `shop_id`, deploy a per-shop `api` cluster. |

In every case the API code does not change because every service talks to every other service by **DNS hostname**, never by `localhost`. This is the invariant the V1 compose enforces from day one.

## Consequences

**Positive:**
- €0/month infra cost on the V1 production target.
- DSGVO + EU data residency satisfied by Frankfurt region + Oracle's stated EU-only data flow.
- Multi-arch build pipeline means a Mac dev can `docker compose up` and get a bit-identical environment to production minus the architecture itself — and CI tests both arches.
- No public IP exposure on Oracle. Attack surface is the cloudflared + Tailscale daemons, both audited Go programs run by their respective vendors.
- Backup strategy passes the "auditor asks for the August 2027 state of the chain" test in any month after Phase 1 go-live.
- Observability is comprehensive enough that "is anything wrong?" is a glance at one Grafana dashboard.

**Negative:**
- ARM64 means we cannot use the rare native-only library that ships x86_64-only binaries. So far the stack has none. If a future requirement (e.g. a German Kassenterminal SDK) is x86-only, we either compile from source under QEMU, run it on a separate x86 worker VM, or pick a different vendor.
- Always Free SLA is "best effort." Oracle reserves the right to reclaim the VM if it's idle (their definition of idle is fuzzy). Mitigation: a small synthetic load keeps the CPU above the reclaim threshold; documented in `infrastructure/scripts/keepalive.sh`.
- Self-hosted everything = self-restore-test everything. The CI restore drill is non-negotiable.

**Mitigations:**
- The keepalive cron makes a real /api/public/health call every 15 minutes; this also doubles as an uptime probe.
- The restore drill in CI catches WAL-G or backup config regressions within a week.
- A documented "what-if-Oracle-yanks-the-VM" playbook (`docs/runbooks/oracle-reclaim.md`) lays out the 60-minute path to bring the same compose stack up on Hetzner CX31 ARM (€8/mo paid tier) using the most recent backup from R2. Tested once before go-live.

## Alternatives considered

- **Hetzner Cloud CX22/CX31 ARM** — paid €4–8/mo, simpler SLA, no reclaim risk. Rejected for V1 because Basel already owns Oracle credits and the SLA risk is low at single-shop scale. Documented as Phase-1.5 escape hatch.
- **Render / Railway / Fly.io managed runtime** — rejected. Outside EU jurisdiction by default; managed runtimes hide Postgres tuning that we need control of for the ledger trigger.
- **Kubernetes (k3s or microk8s)** — rejected for V1. Adds operational complexity not justified by single-VM scale. The "scalability seam" §12 above covers the future case better than premature k8s.
- **PostgreSQL Patroni cluster (HA from day 1)** — rejected. HA at single-shop scale is over-engineering; a 4-minute restore from WAL-G is well within the shop's tolerance for a once-a-year incident.
- **Cloudflare Tunnel for the entire SSH path** — partially adopted (Tunnel for HTTP). For SSH we use Tailscale SSH which is simpler and gives us identity-aware ssh logs.
- **Caddy vs Traefik vs nginx** — Caddy chosen for SSE-friendliness, single-file config, and zero-config TLS (even if Cloudflare terminates TLS upstream, mTLS at Caddy still needs cert plumbing; Caddy makes it short). nginx config for the same setup is ~3× longer. Traefik's label-based config conflicts with our explicit compose discipline.

## Known limits & deferred decisions

1. **Oracle Always Free reclaim risk.** Mitigated by keepalive + documented Hetzner failover, but a possibility. If it bites once, we migrate paid.
2. **No automated DR-region failover.** A multi-region Postgres replica is Phase 2+. V1 RTO is "restore from R2 in 30 minutes."
3. **Backups encryption key rotation.** Same key for the lifetime of V1. Rotation procedure documented but not automated.
4. **Single block volume.** When `pg` outgrows 80 GB we attach a second volume and `pg_basebackup` over to it; downtime ~15 min, scheduled outside business hours.
5. **No Web Application Firewall on the public API.** Cloudflare provides basic DDoS shielding; per-route WAF rules are Phase 2+ if we see specific abuse.
6. **Monitoring metrics retention is 30 days.** Long-term analytics is the Steuerberater's job from DATEV exports, not Prometheus.

## References

- Oracle Always Free Ampere A1 documentation — https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm
- WAL-G — https://github.com/wal-g/wal-g
- step-ca — https://smallstep.com/docs/step-ca/
- Caddy v2 mTLS — https://caddyserver.com/docs/caddyfile/directives/tls#client_auth
- ADR-0005 — original Hetzner choice, now superseded for the provider only
- ADR-0008 — schema architecture; the `warehouse14_app` / `warehouse14_migrator` role split is enforced by this hosting setup
- ADR-0014 — Live Ops transport built on the network design here
- `docs/memory.md` §2 #29, §4 (hosting table)
