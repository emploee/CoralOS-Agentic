# Extends the pinned upstream coral-server image with a Node.js runtime, so agents registered with
# runtime = "executable" (see examples/txodds/coral/round.ts) can actually be exec'd by coral-server -
# the stock image (ubuntu:noble + a minimal JRE, no Node at all) can't run them. See CORAL.md's
# "Agent Runtimes" section for why this exists and which agents use it.
#
# Built automatically by `docker compose up -d coral` (docker-compose.yml's coral service points here).
# To rebuild after bumping the base digest: docker compose build coral

FROM ghcr.io/coral-protocol/coral-server:latest@sha256:2acd1701aed63367583b4ff4496d3a4255112f7363b4daae7c3a700acf35c6eb

# NodeSource's setup script needs curl/gnupg only to register the apt repo - purged afterward so the
# image doesn't carry build-only tooling.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get purge -y curl gnupg \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
