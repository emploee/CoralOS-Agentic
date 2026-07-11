# Solana CoralOS Agent Commerce — convenience recipes.
# Full prerequisites: README.md "Before Running the Live Devnet Demos".

# `just` defaults to looking for `sh` on Windows, which native PowerShell doesn't have. Recipes here
# are plain command invocations (no bash-specific syntax), so running them through PowerShell instead
# works unchanged — this only affects Windows; other platforms keep using sh.
set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

# List available recipes
default:
    @just --list

# One-time setup: install workspace deps, generate devnet wallets into .env
setup:
    npm run setup

# Run the single-agent TxODDS demo, zero Docker required: a real LLM-driven analysis step plus real
# automatic escrow settlement on devnet. NOT the multi-agent negotiation demo — that's `just txodds` —
# this is one agent (the seller's analysis step) plus a human driving the web UI. The UI's "agentic
# mode" button is present but will fail without Docker/CoralOS running; it calls the same
# round-launching function `just txodds` does.
# Needs: a funded buyer wallet for settlement (npm run setup). Docker optional, only for Coral Console.
dev:
    npm run dev

# Run the TxODDS multi-agent demo end-to-end: preflights .env, builds the workspace + agents, builds
# Docker agent images, starts CoralOS, and drives one live round (WANT -> BID -> AWARD -> ESCROW ->
# DELIVERED -> VERIFIED -> RELEASED) to a settled, verified release. The arbiter wallet has no
# auto-top-up here (unlike `just dev`) — fund it manually if it's near zero.
# Needs: Docker running, funded buyer + arbiter wallets, a fresh TXLINE_API_KEY.
txodds:
    npm run e2e:devnet
