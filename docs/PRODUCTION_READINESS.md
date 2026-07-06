# Production Readiness

This document applies the production-readiness checklist supplied during the audit to this repo. It is
not a declaration that the kit is mainnet-production ready. The current production stance is:

- **Devnet-ready demo infrastructure:** yes.
- **Deterministic CI/readiness gates for the core flows:** yes.
- **Mainnet custody or real provider payments:** no.
- **External launch with user funds:** blocked until the open risks below are closed.

## Critical Journeys

These are the user-visible flows that must stay healthy:

| Journey | Evidence |
|---|---|
| Single-agent TxODDS oracle | `npm run dev`; proxy persists runs with delivery hashes, escrow txs, and proof receipts. |
| Coral marketplace | `npm run marketplace`; feed folds Coral session state into rounds, the run ledger, reputation, threads, and proof receipts. |
| Marketplace visualizer | `examples/marketplace/web` unit tests and Playwright e2e against recorded Coral state. |
| Payment rail procurement | `@pay/payment-runtime` tests plus `PAYMENT_*` folding into `proofReceipts` and `proof_receipts.json`. |
| Agent desk | `npm run desk` for browser mode; CI parses UI JS and Tauri configs. |
| Agent economy front doors | Typecheck/build smoke for autonomous, bridge, quickstart, and web dashboard. |
| Escrow programs | CI `cargo check --workspace` on escrow + arbiter. |

## Automated Gate

Run the readiness e2e locally:

```sh
npm run readiness:e2e
```

What it proves, without Docker/devnet/LLM keys:

- Builds `@pay/agent-runtime`, because local `file:` dependents import its `dist`.
- Starts the real marketplace feed against a temporary Coral extended-state fixture.
- Asserts `/api/health`, `/api/feed`, `/api/threads`, and `/api/runs`.
- Verifies a settled round with verifier pass and a Pay.sh proof receipt.
- Verifies `proof_receipts.json` is written to the run ledger.
- Checks the TxODDS Agent Desk static JS parses and the Tauri JSON configs are valid.

This complements, rather than replaces, the existing package tests and Playwright e2e.

## CI Coverage

The GitHub Actions workflow blocks PRs/pushes on:

- `packages/agent-runtime`: typecheck, tests.
- `packages/harness-runtime`: runtime build, typecheck, tests.
- `packages/payment-runtime`: runtime build, typecheck, tests.
- `examples/txodds`: typecheck, tests.
- `examples/marketplace`: launcher typecheck, feed typecheck/tests, web typecheck/tests, Playwright e2e.
- `examples/agent-economy`: autonomous/quickstart/bridge typechecks and web production build smoke.
- `coral-agents`: buyer/seller/verifier/broker/echo checks.
- `examples/txodds-agent-desk`: static UI and config smoke.
- `scripts/readiness-e2e.mjs`: production-readiness e2e gate.
- `examples/txodds/escrow`: Rust `cargo check --workspace`.

## Production Checklist Status

| Area | Current answer | Status |
|---|---|---|
| Product and launch reality | Starter kit for paid agent services; default product is TxODDS oracle, not the final product. | Demo-ready |
| Service levels | No public SLA/SLO promised. Devnet demos should degrade clearly when upstreams are down. | Needs launch owner |
| Architecture | Documented in `README.md`, `CORAL.md`, package READMEs, and example READMEs. Coral coordinates; agents hold keys; Solana settles. | Covered for repo |
| Source control | CI gates are present. Branch protection, CODEOWNERS, signed commits, and release tags are GitHub-org settings. | External setting |
| Local development | `npm run setup`, `npm run dev`, example scripts, and `.env.example` cover local setup. Secrets are gitignored. | Covered |
| Code quality | TypeScript strict packages, tests, protocol parsers, policy choke points, and devnet guard. | Covered for demo |
| API contracts | Internal HTTP APIs are documented in READMEs. No OpenAPI contract yet. | Needs production API spec |
| Data/storage | Run ledger is JSON-on-disk, replayable, and proof-receipt aware. No production DB/backup plan. | Demo-ready only |
| Caching/performance | TxODDS proxy has short board caching. No capacity testing or cache SLO. | Needs launch work |
| Async/events | Coral thread messages are replayable; watcher queue is simple in-memory demo state. | Demo-ready only |
| Containers/runtime | Coral agents have Dockerfiles; desk Tauri shell is no-IPC. Resource limits/scanning not configured here. | Needs deployment platform |
| Cloud/IaC | No cloud production deployment in this repo. | Out of repo |
| CI/CD | Broad CI exists plus readiness e2e. No artifact signing/SBOM/release promotion. | CI covered, release hardening needed |
| Security | Devnet guard, gitignored secrets, policy checks, verifier gate. No full threat model or pen test. | Needs security review |
| Supply chain | Lockfiles are generated locally and ignored by repo policy. No SBOM/SLSA provenance. | Needs production policy |
| Privacy/legal | No customer PII model in repo; LLM/provider data flow documented at a high level. | Needs product owner |
| Reliability/resilience | Deterministic replay and degraded UI states exist. No paging, SLO alerts, or chaos testing. | Needs operations plan |
| Observability | Ledger/transcripts/reputation are audit artifacts; no OpenTelemetry/log aggregation. | Needs production observability |
| Testing | Unit/integration/e2e/readiness gates cover critical demo journeys. Load/security/restore tests not present. | Demo gate covered |
| Deployment/rollback | No production deploy pipeline. Devnet examples are run manually. | Needs deployment plan |
| Incident response | No on-call, severity model, or runbooks beyond troubleshooting docs. | Needs owner |
| Backup/restore | Ledger is local disk; replay tested. No backup/restore drill. | Needs production storage plan |
| Cost/FinOps | Devnet costs are negligible; LLM/provider costs bounded by env/policy only. | Needs launch budget |
| Multi-tenancy | Not a multi-tenant app today. | Not applicable until hosted |
| Admin/support | Agent Desk is an operator console, not a secured admin system. | Needs auth/RBAC before hosting |
| Abuse/fraud | Spend caps and devnet guard exist; no bot/rate-limit/fraud controls. | Needs production controls |
| Notifications/webhooks | Not a notification product. | Not applicable |
| Analytics/reporting | Reputation and runs are product/audit metrics; no analytics pipeline. | Optional |
| AI/LLM | Provider abstraction, fallbacks, verifier checks, and harness isolation exist. Prompt/version evals are not formalized. | Needs eval set |
| Desktop/client | Desk has no IPC/fs/shell permissions beyond Tauri default; Tauri build still needs platform validation. | Needs signed build |
| Vendor risk | CoralOS, Solana devnet/RPC, TxODDS, LLM providers, Pay.sh/x402 are critical vendors. No vendor SLA map. | Needs launch owner |
| Docs/ownership | Broad docs exist. Concrete production owner/on-call owner is not assigned in repo. | Needs organization decision |

## Must-Answer Before Mainnet Or Real Users

- Who owns support, incident response, and launch approval?
- What SLOs are promised for proxy, marketplace feed, desk, and settlement flows?
- What is the production storage backend for the run ledger, and how is restore tested?
- How are wallets, RPC keys, provider keys, and arbiter keys injected and rotated?
- Which payment rails are live-provider backed, and how are provider failures handled?
- What are the spend limits, kill switches, and operator approvals for real money?
- How are admin/desk actions authenticated, authorized, and audited?
- What is the threat model for prompt injection, payment proof replay, malicious sellers, and compromised agents?
- What deployment target, rollback plan, artifact signing, and SBOM policy are used?
- What telemetry pages a human, and what is the runbook?

## Open Production Blockers

1. Mainnet remains disabled by policy; `assertDevnet` must stay on unless a separate launch review says otherwise.
2. Pay.sh/x402/USDC/embedded-wallet/payout rails are scaffolds except where explicitly marked live in `packages/payment-runtime/README.md`.
3. No hosted auth/RBAC layer protects the desk or feed.
4. No production database, backup, restore, or retention policy exists for run ledgers.
5. No formal SLOs, incident response process, or on-call rotation exists.
6. No SBOM/artifact-signing/supply-chain provenance gate exists.
7. No load, abuse, or security test suite exists beyond functional checks.

## Operating Rule

The repo may claim **devnet demo readiness** when CI and `npm run readiness:e2e` are green. It may not
claim **production readiness for real users or real funds** until the open production blockers have
named owners, mitigations, and tested evidence.
