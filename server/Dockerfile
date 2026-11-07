# GymTime API image. Build context: the repository root (npm workspaces).
#
#   docker build -f server/Dockerfile -t gymtime-server .
#
# Configuration comes only from environment variables (see
# .env.production.example); no .env file is baked into the image.
FROM node:24-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY . .
# Installs every workspace (the postinstall generates the Prisma client).
RUN npm ci
RUN npm run build -w shared -w server

# Production dependencies only (a fresh install is faster and more reliable
# than pruning). The server postinstall regenerates the Prisma client; the
# schema engine used by `migrate deploy` comes with the `prisma` package.
FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY simulator/package.json simulator/
COPY cli/package.json cli/
COPY server/package.json server/
COPY server/prisma server/prisma
COPY server/prisma.config.ts server/
RUN npm ci --omit=dev -w shared -w server

FROM node:24-alpine AS runtime
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/shared/package.json ./shared/package.json
COPY --from=build --chown=node:node /app/shared/dist ./shared/dist
COPY --from=build --chown=node:node /app/server/package.json ./server/package.json
COPY --from=build --chown=node:node /app/server/dist ./server/dist
COPY --from=build --chown=node:node /app/server/prisma ./server/prisma
COPY --from=build --chown=node:node /app/server/prisma.config.ts ./server/prisma.config.ts
COPY --chown=node:node server/docker-entrypoint.sh ./server/docker-entrypoint.sh
RUN chmod +x ./server/docker-entrypoint.sh
USER node
WORKDIR /app/server
EXPOSE 3000
# The server listens on PORT (3000 by default).
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--", "./docker-entrypoint.sh"]
