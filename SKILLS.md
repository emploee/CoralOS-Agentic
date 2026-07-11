# Skills

Optional Claude Code skill sets for extending this repository.

## Solana Dev Skill

```sh
npx skills add https://github.com/solana-foundation/solana-dev-skill --global --yes
```

Adds Solana knowledge: `@solana/kit`, Anchor/Pinocchio programs, LiteSVM/Mollusk/Surfpool testing, Codama client generation, Token-2022, Solana Pay, and a security checklist.

Used in this repo for the escrow program (`examples/txodds/escrow/`) — `init` not `init_if_needed`, per-order PDA seeds, `has_one`, `close = buyer`, checked math.

## Solana Agent Commerce Skill

Local builder skill at `skills/solana-agent-commerce/` for extending the market with paid services, seller personas, payment rails, verifier gates, x402 endpoints, and agent-commerce examples.
