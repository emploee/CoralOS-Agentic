# Human front door — builds the React UI, then serves it alongside the puppet bridge.
# NOTE: the build context is examples/agent-economy (set in docker-compose.yml), so this
# stage can see ../web. The React build is baked into the image at /app/web.

# 1) Build the React app → /web/dist
# (no lockfile — the repo gitignores locks; package.json `overrides` pin the React types)
FROM node:20-slim AS web
WORKDIR /web
COPY web/package.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

# 2) Bridge runtime — serves /app/web (the React build) + the order/autonomous API
FROM node:20-slim
WORKDIR /app
COPY bridge/package.json ./
RUN npm install --omit=optional
COPY bridge/ .
COPY --from=web /web/dist ./web
EXPOSE 3010
CMD ["npx", "tsx", "server.ts"]
