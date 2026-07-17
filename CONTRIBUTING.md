# Contributing

Contributions are welcome. The `main` branch is the integration branch — target all PRs at `main`.

## Repo Layout

| Directory | Language | Typical changes |
|-----------|----------|-----------------|
| `packages/agent-runtime/` | TypeScript | The runtime: Solana Pay + devnet guard, CoralOS MCP client, the market protocol (incl. VERIFY/VERIFIED), the run ledger + reputation, the policy choke point |
| `packages/harness-runtime/` | TypeScript | The harness adapter SDK (`in-process` / `claude-code` / any CLI as sellers) |
| `examples/txodds/` | TypeScript | The World Cup Oracle — the edge transform, the proxy (+ run grading), the web app, the CoralOS round launcher, the feed server, the research watcher |
| `examples/txodds/escrow/` | Rust (Anchor) | The escrow + arbiter settlement contracts |
| `coral-agents/` | TypeScript | The per-session agents: buyer, seller (+ personas), verifier, echo |

## Prerequisites

- Node.js 20+
- A funded devnet wallet to run the live demo (see the root README). **The default demo
  needs no Docker**; the multi-agent CoralOS round needs Docker (coral-server).

## Development Commands

```sh
# build the runtimes first — dependents use their dist via file: deps
cd packages/agent-runtime && npm install && npm run build && npm run typecheck && npm test
cd packages/harness-runtime && npm install && npm run build && npm test   # after agent-runtime

# typecheck + test what you changed, e.g.
cd examples/txodds && npm install && npm run typecheck && npm test
cd examples/txodds/feed && npm install && npm test
```

## PR Workflow

1. Open an issue or comment on an existing one to discuss your change.
2. Fork the repo and create a feature branch from `main`.
3. Make your change. Add tests for new behavior.
4. Run lint and typecheck locally before pushing.
5. Use [conventional commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, etc.).
6. Open a PR against `main`.

## Code Style

- **TypeScript:** run `npm run typecheck && npm test` in `packages/agent-runtime/` (and the package you changed) before committing.
- **Documentation:** READMEs should explain *why* a module exists, not just *what* it does.

## Security

See [SECURITY.md](./SECURITY.md) for the security policy and vulnerability reporting process.
