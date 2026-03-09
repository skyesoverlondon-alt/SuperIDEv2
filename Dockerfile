# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22.14.0

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
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS site-production
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=site-builder /workspace/dist /usr/share/nginx/html
EXPOSE 8080
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
