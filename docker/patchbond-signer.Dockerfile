# Policy-limited PatchBond devnet signer. The raw buyer key is mounted only at runtime
# through a Docker secret; CoralOS and all market agents receive only SIGNER_URL.
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages ./packages
COPY coral-agents ./coral-agents
COPY examples ./examples
RUN npm ci --no-audit --no-fund --ignore-scripts
RUN npm run build -w @patchbond/core && npm run build -w @patchbond/demo

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/patchbond-core ./packages/patchbond-core
COPY --from=builder /app/examples/patchbond/package.json ./examples/patchbond/package.json
COPY --from=builder /app/examples/patchbond/dist ./examples/patchbond/dist
USER node
EXPOSE 8899
CMD ["node", "examples/patchbond/dist/signer-server.js"]
