# NeoSpace Docker Image — static SPA behind nginx-unprivileged

# Base images are pinned by digest (the tag is only a readable hint). Dependabot's docker
# ecosystem (.github/dependabot.yml) proposes bumps; to refresh by hand:
#   docker buildx imagetools inspect node:22-alpine   (use the top-level index digest)
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run postinstall && npm run generate

# 1.28 is the current stable branch (1.27 mainline has ended)
FROM nginxinc/nginx-unprivileged:1.28-alpine@sha256:7377697a821c131a924a7105fafbe7414db4e9fcc77a6f08f776f33f141ec3f8

COPY --from=builder /app/.output/public /usr/share/nginx/html
COPY docker/nginx-default.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
