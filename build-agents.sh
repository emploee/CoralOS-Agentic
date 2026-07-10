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
  echo "    seller-agent:0.1.0 done (the seller-worldcup persona reuses this image)"
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

build_signal() {
  echo "==> Building signal-agent:0.1.0"
  docker build -f "$ROOT/coral-agents/signal-agent/Dockerfile" -t signal-agent:0.1.0 "$ROOT"
  echo "    signal-agent:0.1.0 done (run as a host process today — see coral-agents/signal-agent/README.md)"
}

case "${1:-all}" in
  seller)   build_seller ;;
  buyer)    build_buyer ;;
  verifier) build_verifier ;;
  claude)   build_seller; build_claude_seller ;;
  signal)   build_signal ;;
  all)
    build_seller
    build_buyer
    build_verifier
    echo ""
    echo "Agent images built. Run a CoralOS round:"
    echo "  docker compose up -d coral"
    echo "  cd examples/txodds && npm run coral        # World Cup oracle round"
    echo "  cd examples/marketplace && npm run freelancer   # verifier-gated freelancer market"
    echo "Optional Claude Code seller: bash build-agents.sh claude"
    echo "Research market signal detector (runs as a host process, see coral-agents/signal-agent): npm run signal:watch"
    ;;
  *) echo "Usage: bash build-agents.sh [seller|buyer|verifier|claude|signal|all]"; exit 1 ;;
esac
