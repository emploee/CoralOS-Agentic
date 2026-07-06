# Build from repo root:
#   docker build -f coral-agents/seller-agent/Dockerfile -t seller-agent:0.1.0 .

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json ./
COPY packages ./packages
COPY coral-agents ./coral-agents
COPY examples ./examples
RUN npm install --no-audit --no-fund --ignore-scripts
RUN npm run build:packages
RUN npm run build -w seller-agent

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/coral-agents/seller-agent/dist ./dist
COPY --from=builder /app/coral-agents/seller-agent/package.json ./package.json

CMD ["node", "dist/index.js"]
