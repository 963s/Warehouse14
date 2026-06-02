# syntax=docker/dockerfile:1.7
# ──────────────────────────────────────────────────────────────────────────
# Warehouse14 DB migrate — a tiny psql-only one-shot that applies the
# hand-written SQL migrations in order (see migrate.sh). Build context = repo
# root:  docker build -f infrastructure/docker/migrate.Dockerfile -t warehouse14-migrate .
# ──────────────────────────────────────────────────────────────────────────
FROM postgres:17-alpine
RUN apk add --no-cache bash
COPY packages/db/migrations /migrations
COPY infrastructure/docker/migrate.sh /usr/local/bin/migrate.sh
RUN chmod +x /usr/local/bin/migrate.sh
ENV MIGRATIONS_DIR=/migrations
ENTRYPOINT []
CMD ["/usr/local/bin/migrate.sh"]
