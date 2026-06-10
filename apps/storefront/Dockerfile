# ──────────────────────────────────────────────────────────────────────────
# warehouse14 storefront — private internal deployment image.
#
# Next.js 14 standalone build. The storefront is npm-isolated (NOT in the pnpm
# workspace, no @warehouse14/* imports), so the build context is just this dir.
#
# Wiring model (fully private — the browser never touches production):
#   • Server-side data  → INTERNAL_API_URL (runtime env, e.g. http://api:3001
#     on the warehouse14_default Docker network). Read at request time because
#     the catalog pages render dynamically.
#   • Browser-side photos → a same-origin proxy route (/api/photos/<id>/<variant>)
#     that streams from INTERNAL_API_URL. So photo bytes ride the internal
#     network too; nothing in the page points at api.warehouse14.de.
#
# NEXT_PUBLIC_DATA_SOURCE is the ONLY public env baked at build (it is inlined).
# The api base is deliberately NOT baked — it is resolved at runtime.
# ──────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Public data source is inlined at build (NEXT_PUBLIC_*). The api URL is NOT.
ENV NEXT_PUBLIC_DATA_SOURCE=live
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PRIVATE_WORKER_THREADS=false
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Run unprivileged.
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs
# Standalone output: a minimal server + only the traced node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
