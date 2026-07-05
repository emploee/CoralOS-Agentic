# Skills - Solana Dev

An optional Claude Code skill set that adds commands and knowledge for Solana development, handy if
you fork or extend the escrow contract.

## Solana Dev Skill

```sh
npx skills add https://github.com/solana-foundation/solana-dev-skill --global --yes
```

Installed via the [`skills`](https://github.com/vercel-labs/skills) CLI. Adds Solana knowledge and
tooling: `@solana/kit`, Anchor and Pinocchio programs, LiteSVM/Mollusk/Surfpool testing, Codama
client generation, Token-2022, Solana Pay, and a security checklist.

Where it helped in this repo: the escrow program (`examples/txodds/escrow/`) was written and
security-reviewed against the skill's checklist (`init` not `init_if_needed`, per-order PDA seeds,
`has_one`, `close = buyer`, checked math), built, deployed to devnet, and tested. That's the worked
example of what this skill is for.

The skill is what you'd reach for to take a fork further: accept USDC (Token-2022), add an arbiter to
the escrow, or generate typed clients with Codama.

## Solana Agent Commerce Skill

This repo also includes `skills/solana-agent-commerce/`, a local builder skill for extending the
market with paid services, seller personas, payment rails, verifier gates, Pay.sh procurement, x402
endpoints, USDC settlement, and agent-commerce examples.
