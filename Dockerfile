# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22.14.0
ARG VITE_WORKER_RUNNER_URL=
ARG VITE_DEFAULT_WS_ID=primary-workspace
ARG VITE_SITE_BASE_URL=
ARG VITE_APP_VERSION=docker-production
ARG VITE_GIT_SHA=unknown
ARG VITE_BUILD_TIME=
ARG VITE_GITHUB_APP_INSTALL_URL=

FROM node:${NODE_VERSION}-bookworm-slim AS app-base
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci

FROM app-base AS app-dev
RUN npm install --global netlify-cli
COPY docker/dev-netlify.sh /usr/local/bin/dev-netlify.sh
RUN chmod +x /usr/local/bin/dev-netlify.sh
CMD ["/usr/local/bin/dev-netlify.sh"]

FROM app-base AS site-builder
ARG VITE_WORKER_RUNNER_URL
ARG VITE_DEFAULT_WS_ID
ARG VITE_SITE_BASE_URL
ARG VITE_APP_VERSION
ARG VITE_GIT_SHA
ARG VITE_BUILD_TIME
ARG VITE_GITHUB_APP_INSTALL_URL
ENV VITE_WORKER_RUNNER_URL=${VITE_WORKER_RUNNER_URL}
ENV VITE_DEFAULT_WS_ID=${VITE_DEFAULT_WS_ID}
ENV VITE_SITE_BASE_URL=${VITE_SITE_BASE_URL}
ENV VITE_APP_VERSION=${VITE_APP_VERSION}
ENV VITE_GIT_SHA=${VITE_GIT_SHA}
ENV VITE_BUILD_TIME=${VITE_BUILD_TIME}
ENV VITE_GITHUB_APP_INSTALL_URL=${VITE_GITHUB_APP_INSTALL_URL}
COPY . .
RUN npm run release:checklist && npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS site-production
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 --from=site-builder /workspace/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]

FROM node:${NODE_VERSION}-bookworm-slim AS worker-base
WORKDIR /workspace/worker
COPY worker/package.json worker/package-lock.json ./
RUN npm ci

FROM worker-base AS worker-dev
COPY docker/dev-worker.sh /usr/local/bin/dev-worker.sh
RUN chmod +x /usr/local/bin/dev-worker.sh
CMD ["/usr/local/bin/dev-worker.sh"]

FROM node:${NODE_VERSION}-bookworm-slim AS sql-proxy
WORKDIR /workspace/docker/sql-proxy
COPY docker/sql-proxy/package.json ./
RUN npm install --omit=dev
COPY docker/sql-proxy/server.mjs ./server.mjs
CMD ["node", "server.mjs"]
