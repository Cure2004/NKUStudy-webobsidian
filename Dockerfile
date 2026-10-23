# Pinned multi-platform Node index; build tools run natively, runtime deps on target.
ARG NODE_IMAGE=node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
COPY desktop/package.json ./desktop/
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY server/tsconfig.json ./server/
COPY server/src ./server/src
COPY web ./web
RUN npm run build

# Intentionally target-platform install: no ARM node_modules cross this boundary.
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache git=2.54.0-r0 git-lfs=3.7.1-r2 && git lfs install --system
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
COPY desktop/package.json ./desktop/
RUN npm ci --ignore-scripts --omit=dev --workspace server --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/public ./server/public
COPY --chmod=0755 scripts/4b/container-entrypoint.sh /usr/local/bin/nkustudy-entrypoint
ARG SOURCE_REVISION
ARG LOCK_SHA256
ARG SOURCE_MANIFEST_SHA256
LABEL org.opencontainers.image.source="https://github.com/tobittjessica987-debug/NKUStudy-webobsidian" \
      org.opencontainers.image.revision=$SOURCE_REVISION \
      org.nkustudy.lock-sha256=$LOCK_SHA256 \
      org.nkustudy.source-manifest-sha256=$SOURCE_MANIFEST_SHA256
ENV PORT=8787 HOST=0.0.0.0 DATA_DIR=/data VAULT_PATH=/vault ALLOWED_ROOTS=/vault \
    NODE_OPTIONS=--max-old-space-size=256 HOME=/tmp
USER 1000:1000
EXPOSE 8787
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/nkustudy-entrypoint"]
CMD []
