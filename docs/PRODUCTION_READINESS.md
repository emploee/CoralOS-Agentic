# Production Readiness

This document records the repository's current operational readiness. It does not declare the system ready for mainnet custody, hosted public use, or real-user funds.

## Current Position

| Area | Status |
|---|---|
| Devnet demo flows | Implemented. |
| Deterministic CI/readiness checks | Implemented for critical local flows. |
| Mainnet custody | Not approved. |
| Hosted production auth/RBAC | Not implemented. |
| Live provider payment rails beyond devnet Solana flows | Not implemented unless explicitly marked in package docs. |
| Production storage/backup/restore | Not implemented. |

## Critical Local Journeys

| Journey | Evidence |
|---|---|
| Single-agent TxODDS oracle | `npm run dev`; proxy writes runs with delivery hashes, settlement txs, and proof receipts. |
| Coral marketplace | `npm run marketplace`; feed folds Coral state into rounds, run ledger, reputation, threads, and receipts. |
| Marketplace visualizer | Unit tests plus Playwright e2e against recorded Coral state. |
| Payment rail procurement | `@pay/payment-runtime` tests and `PAYMENT_*` folding into ledger receipts. |
| Read-only Solana tools | `@pay/solana-agent-tools` tests and Solana Agent Kit mock smoke. |
| Agent Desk | Browser mode through `npm run desk`; static JS/config smoke in readiness gate. |
| Agent economy examples | Typecheck/build smoke for autonomous, bridge, quickstart, and dashboard. |
| Escrow programs | CI `cargo check --workspace` for escrow and arbiter. |

## Readiness Gate

Run:

```sh
npm run e2e:local
```

The gate:

- installs the root npm workspace if needed;
- builds the workspace runtime packages;
- starts the marketplace feed against a temporary recorded Coral extended-state fixture;
- asserts `/api/health`, `/api/feed`, `/api/threads`, and `/api/runs`;
- verifies a settled round with verifier pass and a proof receipt;
- verifies `proof_receipts.json` in the run ledger;
- verifies `proof.json` and copies it to `.artifacts/readiness/proof.json`;
- checks TxODDS Agent Desk static JavaScript and Tauri JSON configs.

The gate does not require Docker, devnet, wallets, or LLM keys.

The live devnet smoke path is intentionally separate:

```sh
npm run e2e:devnet
```

It requires Docker/CoralOS, funded devnet wallets, `ARBITER_KEYPAIR_B58`, and TxLINE access. It builds the workspace and launches the CoralOS devnet round through the same demo path as `npm run demo:coral`.

`npm run coral:console:e2e` starts the repo's `coral` Docker service and verifies that Coral Console is served from the Coral Server `/ui/console` entrypoint. `npm run dev` runs the same probe in allow-skip mode before launching the local TxODDS stack.

## CI Coverage

Expected CI coverage includes:

- root workspace install from a fresh checkout;
- `npm run build`, `npm run typecheck`, `npm test`, and `npm run e2e:local`;
- `npm run coral:console:e2e` as a live Docker/CoralOS smoke outside the deterministic CI gate;
- marketplace Playwright e2e against recorded Coral state;
- Solana Agent Kit mock smoke on Node 22;
- agent-economy dashboard production build;
- `examples/txodds-agent-desk`: static UI and config smoke through readiness e2e;
- `examples/txodds/escrow`: Rust `cargo check --workspace`.

## Production Checklist

| Area | Current answer | Status |
|---|---|---|
| Product scope | Local/devnet reference system for paid agent services. | Demo-ready only. |
| Service levels | No public SLO or SLA. | Requires owner. |
| Architecture | Documented in README, CORAL, package READMEs, and example READMEs. | Covered for repo. |
| Source control | CI gates exist. Branch protection, CODEOWNERS, signed commits, and release tags are external settings. | Requires repo/org setup. |
| Local development | Setup scripts, examples, and `.env` flow exist. | Covered. |
| Code quality | TypeScript strict packages, tests, protocol parsers, policy checks, devnet guard. | Covered for demo. |
| API contracts | Internal APIs are documented in READMEs. | OpenAPI or equivalent needed for hosted production. |
| Data/storage | JSON run ledger is replayable. | Production DB/backup/retention not defined. |
| Performance | No capacity or load testing. | Needs production plan. |
| Containers | Agent Dockerfiles exist. | Resource limits/scanning not configured here. |
| CI/CD | Broad CI and readiness e2e exist. | Release promotion/signing/SBOM not implemented. |
| Security | Devnet guard, gitignored secrets, policy checks, verifier gate. | Full threat model and security review needed. |
| Supply chain | No SBOM/SLSA provenance gate. | Needs production policy. |
| Privacy/legal | No customer PII model defined. | Needs product owner. |
| Reliability | Replay/degraded states exist. | No paging, SLO alerts, or chaos testing. |
| Observability | Ledger/transcripts exist. | No OpenTelemetry/log aggregation. |
| Testing | Functional demo gates exist. | Load/security/restore tests missing. |
| Deployment | No production deploy pipeline. | Needs target and rollback plan. |
| Incident response | No on-call or severity model. | Needs owner. |
| Backup/restore | Local ledger only. | Needs backend and restore drill. |
| Cost controls | Devnet costs negligible; provider usage controlled by env/policy. | Needs launch budget. |
| Admin/support | Agent Desk is local and unauthenticated. | Auth/RBAC required before hosting. |
| Abuse/fraud | Spend caps and devnet guard exist. | Hosted abuse controls missing. |
| LLM | Provider abstraction, fallbacks, verifier checks, harness isolation, auditable `LLM_USED` traces with hashes and `affectedFunds=false`. | Formal eval set missing. |
| Desktop | Tauri shell has no custom IPC. | Signed builds/platform validation needed. |
| Vendor risk | CoralOS, Solana RPC/devnet, TxODDS, LLM providers, and payment providers are dependencies. | SLA/incident ownership needed. |

## Required Before Mainnet or Hosted Users

- Assign support, incident response, and release approval owners.
- Define SLOs for proxy, feed, desk, and settlement flows.
- Select production run-ledger storage and test restore.
- Define secret injection and rotation for wallets, RPC keys, provider keys, and arbiter keys.
- Promote scaffold rails only after live-provider verification and failure handling are implemented.
- Define spend limits, kill switches, and operator approvals.
- Add auth, authorization, and audit logging for admin/desk/feed operations.
- Complete threat modeling for prompt injection, proof replay, malicious sellers, and compromised agents.
- Define deployment target, rollback plan, artifact signing, and SBOM policy.
- Add telemetry, alerts, and runbooks.

## Open Blockers

1. Mainnet remains disabled by policy; keep `assertDevnet` unless a separate launch review approves otherwise.
2. Pay.sh, x402, USDC, embedded-wallet, and payout rails are scaffolds except where package docs explicitly state otherwise.
3. No hosted auth/RBAC protects desk or feed endpoints.
4. No production database, backup, restore, or retention policy exists for run ledgers.
5. No formal SLOs, incident response process, or on-call rotation exists.
6. No SBOM/artifact-signing/supply-chain provenance gate exists.
7. No load, abuse, or security test suite exists beyond functional checks.

## Operating Rule

The repository may claim starter/devnet demo readiness when CI and `npm run e2e:local` pass, with live-devnet behavior covered by `npm run e2e:devnet` in an environment that has funded wallets and CoralOS. It must not claim production readiness for real users or real funds until the blockers above have owners, mitigations, and tested evidence.
