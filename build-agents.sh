#!/usr/bin/env bash
# Build the two agent images coral-server launches for the CoralOS round (from repo root so they bundle
# packages/). Run once before `docker compose up` — only needed if you change the agents; the demo ships
# against the pre-built images.
#
# Usage: bash build-agents.sh           (build both)
#        bash build-agents.sh seller    (seller-agent only)
#        bash build-agents.sh buyer     (buyer-agent only)

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

build_seller() {
  echo "==> Building seller-agent:0.1.0"
  docker build -f "$ROOT/coral-agents/seller-agent/Dockerfile" -t seller-agent:0.1.0 "$ROOT"
  echo "    seller-agent:0.1.0 done"
}

build_buyer() {
  echo "==> Building buyer-agent:0.1.0"
  docker build -f "$ROOT/coral-agents/buyer-agent/Dockerfile" -t buyer-agent:0.1.0 "$ROOT"
  echo "    buyer-agent:0.1.0 done"
}

build_verifier() {
  echo "==> Building verifier-agent:0.1.0"
  docker build -f "$ROOT/coral-agents/verifier-agent/Dockerfile" -t verifier-agent:0.1.0 "$ROOT"
  echo "    verifier-agent:0.1.0 done (gates release in the freelancer market)"
}

build_claude_seller() {
  echo "==> Building seller-agent-claude:0.1.0 (base seller image + Claude Code CLI)"
  docker build -f "$ROOT/coral-agents/seller-agent/Dockerfile.claude" -t seller-agent-claude:0.1.0 "$ROOT"
  echo "    seller-agent-claude:0.1.0 done (the HARNESS=claude-code seller)"
}

case "${1:-all}" in
  seller)   build_seller ;;
  buyer)    build_buyer ;;
  verifier) build_verifier ;;
  claude)   build_seller; build_claude_seller ;;
  all)
    build_seller
    build_buyer
    build_verifier
    echo ""
    echo "Agent images built. Run a CoralOS round:"
    echo "  docker compose up -d coral"
    echo "  npm run demo:coral        # World Cup oracle round"
    echo "Optional Claude Code seller: bash build-agents.sh claude"
    ;;
  *) echo "Usage: bash build-agents.sh [seller|buyer|verifier|claude|all]"; exit 1 ;;
esac
