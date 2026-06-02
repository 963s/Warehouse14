#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Production initdb — runs ONCE on a fresh data volume, BEFORE any migration.
#
# The migrations are written to run AS warehouse14_migrator (their
# `ALTER DEFAULT PRIVILEGES FOR ROLE warehouse14_migrator` is what grants the
# app role its table access — so the migrator MUST own the objects). But the
# migrator role can't create extensions or SET ROLE to roles it doesn't yet
# belong to. So as superuser we pre-create:
#   • the extensions (migration 0001's IF NOT EXISTS then no-ops them),
#   • the three roles with the SAME attributes 0003 would use (guarded there),
#   • and grant the migrator SET on app + security (so migrations can
#     `SET ROLE warehouse14_security` to own SECURITY DEFINER objects).
#
# Passwords come from the environment (compose .env), never hardcoded:
#   MIGRATOR_PASSWORD · APP_PASSWORD
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

: "${MIGRATOR_PASSWORD:?MIGRATOR_PASSWORD is required}"
: "${APP_PASSWORD:?APP_PASSWORD is required}"

psql --variable=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  -- Extensions (superuser-only) — migration 0001 then no-ops them.
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE EXTENSION IF NOT EXISTS citext;
  CREATE EXTENSION IF NOT EXISTS btree_gist;
  CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

  -- Roles (attributes mirror migration 0003; its IF NOT EXISTS guards no-op).
  CREATE ROLE warehouse14_migrator LOGIN NOINHERIT CREATEROLE PASSWORD '${MIGRATOR_PASSWORD}';
  CREATE ROLE warehouse14_security NOLOGIN NOINHERIT;
  CREATE ROLE warehouse14_app LOGIN NOINHERIT PASSWORD '${APP_PASSWORD}';

  -- All three need CREATE on public: migrations SET ROLE to security/app to
  -- create objects they should OWN (SECURITY DEFINER triggers, etc.). The
  -- migrations' own GRANT/REVOKE statements then tighten runtime privileges.
  GRANT ALL ON SCHEMA public TO warehouse14_migrator, warehouse14_security, warehouse14_app;

  -- Membership lets the migrator SET ROLE to these AND act as owner of the
  -- objects they own (INHERIT TRUE) — migrations create SECURITY DEFINER
  -- functions as warehouse14_security, then ALTER/COMMENT them as the migrator.
  GRANT warehouse14_security TO warehouse14_migrator WITH SET TRUE, INHERIT TRUE;
  GRANT warehouse14_app      TO warehouse14_migrator WITH SET TRUE, INHERIT TRUE;
EOSQL

echo "[initdb] extensions + warehouse14_{migrator,security,app} roles ready."
