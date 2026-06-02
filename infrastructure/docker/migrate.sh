#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Production DB migrator — applies the hand-written SQL migrations in order via
# psql, exactly like the manual dev process (the drizzle `_journal.json` is
# intentionally empty; these multi-statement files self-manage their own
# transactions with explicit COMMIT). Idempotent: each applied file is recorded
# in `_w14_schema_migrations`, so re-runs only apply what's new.
#
#   DATABASE_URL — a privileged (migrator/superuser) connection. Migrations
#                  0001-0003 create extensions + roles + grants.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required (migrator credential)}"
DIR="${MIGRATIONS_DIR:-/migrations}"

# Some migrations CREATE SQL functions whose bodies reference signatures Postgres
# resolves only at call time (e.g. pgcrypto hmac with a text key). Defer body
# validation to runtime so a fresh apply matches the dev schema.
export PGOPTIONS="-c check_function_bodies=off"

echo "[migrate] tracking table"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
  "CREATE TABLE IF NOT EXISTS _w14_schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());"

applied=0
skipped=0
for f in $(ls -1 "$DIR"/*.sql | sort); do
  base="$(basename "$f")"
  exists="$(psql "$DATABASE_URL" -tAc "SELECT 1 FROM _w14_schema_migrations WHERE filename = '$base'")"
  if [ "$exists" = "1" ]; then
    skipped=$((skipped + 1))
    continue
  fi
  echo "[migrate] applying $base"
  # No -1: each file controls its own transaction (explicit COMMIT). ON_ERROR_STOP
  # aborts the whole run on any failure so a half-migration never gets recorded.
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c \
    "INSERT INTO _w14_schema_migrations (filename) VALUES ('$base');"
  applied=$((applied + 1))
done

echo "[migrate] done — applied $applied, already-current $skipped"
