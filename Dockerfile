# One Dockerfile, three Cloud Run services: web, api, tts.
#   docker build --platform linux/amd64 --target <web|api|tts> -t <image> .
# Each target only builds the stages it needs. Every service listens on 0.0.0.0:$PORT.

FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Downloads the Kokoro model once, at build time. Only the tts target copies it.
FROM prod-deps AS voice-model
COPY server ./server
COPY scripts ./scripts
RUN npm run voice:prepare

FROM node:22-bookworm-slim AS runtime-base
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY package*.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY server ./server
COPY shared ./shared
# SQLite conversations default to /app/.cache/chat; the node user must be able to create it.
RUN mkdir -p .cache && chown node:node .cache
USER node
EXPOSE 8080

FROM runtime-base AS web
COPY --from=frontend /app/dist ./dist
CMD ["node", "server/web-service.mjs"]

FROM runtime-base AS api
# The database migration job runs this image with `npm run db:migrate`
# (scripts/migrate-database.mjs, #23, #30), so the api image carries scripts/.
COPY scripts ./scripts
CMD ["node", "server/api-service.mjs"]

FROM runtime-base AS tts
COPY --chown=node:node --from=voice-model /app/.cache /app/.cache
CMD ["node", "server/tts-service.mjs"]
