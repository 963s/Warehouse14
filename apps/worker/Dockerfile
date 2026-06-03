# syntax=docker/dockerfile:1.7
# ──────────────────────────────────────────────────────────────────────────
# Warehouse14 Worker — the always-on background processor (LBMA prices, TSE
# checks, AI intake, eBay sync, appointments, GDPR cleanup). Build context =
# repo root:  docker build -f apps/worker/Dockerfile -t warehouse14-worker .
# ──────────────────────────────────────────────────────────────────────────

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
# db first (audit↔db cycle — see api-cloud/Dockerfile).
RUN pnpm --filter @warehouse14/db build
RUN pnpm --filter "@warehouse14/worker..." build
RUN pnpm --filter=@warehouse14/worker deploy --prod /app

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production METRICS_PORT=3100 NODE_OPTIONS=--enable-source-maps
WORKDIR /app
COPY --from=build /app ./
# Some source package.json files ship 0600 — unreadable by the non-root `node`
# user, which silently breaks ESM `exports` resolution. Make all readable.
RUN chmod -R go+rX /app
EXPOSE 3100
USER node
# The worker binds its /health to 127.0.0.1:METRICS_PORT (same container).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.METRICS_PORT||3100)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
