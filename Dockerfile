# 国内镜像源（可用 --build-arg 覆盖为其它源或官方源）。
# APK_MIRROR: 替换 Alpine 的 dl-cdn 主机名；NPM_REGISTRY: npm 包源。
ARG APK_MIRROR=mirrors.aliyun.com
ARG NPM_REGISTRY=https://registry.npmmirror.com

# ---- Build stage: install deps, build web + server ----
FROM node:22-alpine AS build
ARG APK_MIRROR
ARG NPM_REGISTRY
WORKDIR /app
# 用国内源替换 Alpine 官方源，避免 apk 拉包超时。
RUN sed -i "s#dl-cdn.alpinelinux.org#${APK_MIRROR}#g" /etc/apk/repositories
RUN npm config set registry ${NPM_REGISTRY}
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm install
COPY . .
RUN npm run build

# ---- Runtime stage ----
FROM node:22-alpine AS runtime
ARG APK_MIRROR
ARG NPM_REGISTRY
WORKDIR /app
ENV NODE_ENV=production

# 用国内源替换 Alpine 官方源。
RUN sed -i "s#dl-cdn.alpinelinux.org#${APK_MIRROR}#g" /etc/apk/repositories
# git + git-lfs are required for vault sync
RUN apk add --no-cache git git-lfs && git lfs install --system

# Install production deps for the server workspace only
RUN npm config set registry ${NPM_REGISTRY}
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
RUN npm install --omit=dev --workspace server

# Copy built artifacts
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/public ./server/public

ENV PORT=8787 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    VAULT_PATH=/vault \
    ALLOWED_ROOTS=/vault \
    NODE_OPTIONS=--max-old-space-size=4096

VOLUME ["/vault", "/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1

CMD ["node", "server/dist/index.js"]
