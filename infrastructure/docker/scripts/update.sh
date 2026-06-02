#!/usr/bin/env bash
# Pull the latest published images + restart. The `migrate` one-shot runs any
# new migrations before api/worker come up. Zero-downtime is not required for a
# single shop, but api/worker only restart after migrate exits 0.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[update] logging in to GHCR (if needed)…"
# Requires: echo "$GHCR_PAT" | docker login ghcr.io -u <user> --password-stdin  (once)

docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker image prune -f >/dev/null 2>&1 || true
echo "[update] done. Status:"
docker compose -f docker-compose.prod.yml ps
