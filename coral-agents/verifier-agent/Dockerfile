# Build from repo root:
#   docker build -f coral-agents/verifier-agent/Dockerfile -t verifier-agent:0.1.0 .

FROM node:20-alpine AS builder
WORKDIR /app

# Mirror repo layout so "file:../../packages/agent-runtime" resolves correctly
COPY packages/agent-runtime/package.json packages/agent-runtime/package-lock.json* ./packages/agent-runtime/
RUN cd packages/agent-runtime && npm install --ignore-scripts
COPY packages/agent-runtime/tsconfig.json ./packages/agent-runtime/
COPY packages/agent-runtime/src/ ./packages/agent-runtime/src/
RUN cd packages/agent-runtime && npx tsc

# --install-links copies the SDK into node_modules instead of symlinking
COPY coral-agents/verifier-agent/package.json coral-agents/verifier-agent/package-lock.json* ./coral-agents/verifier-agent/
RUN cd coral-agents/verifier-agent && npm install --ignore-scripts --install-links
COPY coral-agents/verifier-agent/tsconfig.json ./coral-agents/verifier-agent/
COPY coral-agents/verifier-agent/src/ ./coral-agents/verifier-agent/src/
RUN cd coral-agents/verifier-agent && npx tsc

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/coral-agents/verifier-agent/dist ./dist
COPY --from=builder /app/coral-agents/verifier-agent/node_modules ./node_modules

CMD ["node", "dist/index.js"]
