# syntax=docker/dockerfile:1
# Everything is plain JS/TS with no native modules, so the build stages run on
# the build machine's arch and their output is copied into any target arch.

# ── web UI (all dev deps live here only) ──
FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts ./
COPY web ./web
COPY server ./server
RUN npm run build

# ── production deps only ──
FROM --platform=$BUILDPLATFORM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund \
 && find node_modules \( -name "*.md" -o -name "*.map" -o -name "*.d.ts" -o -name "*.d.cts" -o -name "*.d.mts" -o -name "LICENSE*" -o -name "CHANGELOG*" \) -type f -delete

# ── runtime: Node runs the TypeScript server directly (type stripping) ──
FROM node:24-alpine
# The package managers aren't needed at runtime.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
 && mkdir /data && chown node:node /data
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data WEB_DIST=/app/dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=web /app/dist ./dist
COPY package.json ./
COPY server ./server
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.ts"]
