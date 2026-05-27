#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Local-dev initdb: create the warehouse14_migrator role.
#
# Postgres runs every file in /docker-entrypoint-initdb.d/ exactly once, on a
# fresh data volume. To re-run after the volume already exists:
#
#     docker compose down -v
#     docker compose up -d
#
# Production parallel: scripts/bootstrap-oracle.sh on the Oracle VM (ADR-0012 §9).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Connect as the superuser the docker-compose POSTGRES_USER created.
psql --variable=ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<-EOSQL
  -- Migrator role: CREATEROLE so it can create warehouse14_app + warehouse14_security
  -- inside migration 0003_roles.sql.
  CREATE ROLE warehouse14_migrator
    LOGIN
    NOINHERIT
    CREATEROLE
    PASSWORD 'warehouse14_migrator_dev_pw';

  -- Ownership and write access on the public schema, so migrations can create
  -- objects whose default privileges land per ADR-0008 §3.
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
EOSQL

echo "[initdb] warehouse14_migrator role created."
