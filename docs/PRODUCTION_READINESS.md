# Production Readiness

This document records operational readiness. The system is not approved for mainnet custody, hosted public use, or real-user funds.

## Current Position

| Area | Status |
|---|---|
| Devnet demo flows | Implemented. |
| CI checks | Build/typecheck/test and escrow `cargo check`. |
| Mainnet custody | Not approved. |
| Hosted production auth/RBAC | Not implemented. |
| Production storage/backup/restore | Not implemented. |

## Deterministic Checks

```sh
npm run build
npm run typecheck
npm test
```

No Docker, devnet, wallets, or LLM keys required.

## Live Devnet Smoke

```sh
npm run e2e:devnet
```

Requires Docker/CoralOS, funded devnet wallets, `ARBITER_KEYPAIR_B58`, and TxLINE access.

## Payment Rail Maturity

Three rails ship: **Solana Pay**, **escrow**, and **x402**. All others (spl-usdc, allowance, embedded-wallet, payout, pay-sh) were removed — see `PAYMENT_RAIL_INTEGRATION.md`.

### Promotion Checklist

A rail is promoted when it clears every step:

1. `quote`/`requestPayment`/`verifyPayment` (and `release`/`refund` where applicable) do real work — no caller-supplied signature trusted without independent on-chain verification.
2. Chain calls route through `@pay/agent-runtime`'s `WalletSigner`/`solanaConnection` — one devnet guard and one signer abstraction for every rail.
3. No hardcoded on-chain addresses. Rail-specific values (mints, program IDs) are required caller-supplied parameters.
4. Failure-mode tests exist: policy refusal, missing signature/recipient/reference, wrong amount.
5. Proof receipts carry `txSignature`, `reference`, `recipient` for independent audit.
6. Third-party API dependencies are stated explicitly in code doc-comments and README status tables.
7. Anchor/on-chain changes are `cargo check --workspace` clean. Deployment to devnet is a separate confirmed step.

See `packages/payment-runtime/README.md` for the per-rail status table.

## Production Checklist

| Area | Status |
|---|---|
| Product scope | Local/devnet reference system. Demo-ready only. |
| Service levels | No SLO/SLA. Requires owner. |
| Architecture | Documented in README, CORAL, package READMEs. |
| Source control | CI gates exist. Branch protection/CODEOWNERS/signed commits are external. |
| Local development | Setup scripts, examples, `.env` flow exist. |
| Code quality | TypeScript strict, tests, protocol parsers, policy checks, devnet guard. |
| API contracts | Internal APIs documented in READMEs. OpenAPI needed for hosted production. |
| Data/storage | JSON run ledger, replayable. Production DB/backup not defined. |
| Containers | Agent Dockerfiles exist. Resource limits/scanning not configured. |
| CI/CD | Build/typecheck/test and `cargo check`. Release promotion/signing/SBOM not implemented. |
| Security | Devnet guard, gitignored secrets, policy checks, verifier gate. Threat model needed. |
| Observability | Ledger/transcripts exist. No OpenTelemetry/log aggregation. |
| LLM | Provider abstraction, fallbacks, verifier checks, auditable traces. Formal eval set missing. |

## Required Before Mainnet or Hosted Users

1. Assign support, incident response, and release approval owners.
2. Define SLOs for proxy, feed, and settlement flows.
3. Select production run-ledger storage and test restore.
4. Define secret injection and rotation for wallets, RPC keys, provider keys, arbiter keys.
5. Define spend limits, kill switches, and operator approvals.
6. Add auth, authorization, and audit logging for admin/feed operations.
7. Complete threat modeling for prompt injection, proof replay, malicious sellers, compromised agents.
8. Define deployment target, rollback plan, artifact signing, SBOM policy.
9. Add telemetry, alerts, and runbooks.

## Open Blockers

1. Mainnet disabled by policy — keep `assertDevnet` unless a separate launch review approves.
2. No hosted auth/RBAC for feed endpoints.
3. No production database, backup, restore, or retention policy.
4. No formal SLOs, incident response, or on-call rotation.
5. No SBOM/artifact-signing/supply-chain gate.
6. No load, abuse, or security test suite beyond functional checks.
7. Full live Docker swarm round blocked on `TXLINE_API_KEY` (third-party enrollment).

## Operating Rule

The repository may claim starter/devnet demo readiness when CI passes. It must not claim production readiness for real users or real funds until the blockers above have owners, mitigations, and tested evidence.
