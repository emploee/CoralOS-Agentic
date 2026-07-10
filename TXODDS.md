# TxODDS Integration

This repository includes a TxODDS TxLINE integration used by the default paid service. The integration reads World Cup and International Friendlies data from TxLINE, derives a fair-line analysis, and can bind that analysis to devnet Solana settlement.

> **The free TxLINE guest tier is scoped to the World Cup 2026 tournament window.** It is a promotional grant tied to that event, not a standing free API — do not build against it assuming indefinite availability. See `examples/txodds/README.md` and `examples/txodds/WORLDCUP_API.md` for details.

## Data Source

| Item | Value |
|---|---|
| API host | `https://txline-dev.txodds.com` |
| Auth flow | `POST /auth/guest/start` plus activated `X-Api-Token` |
| Subscription script | `examples/txodds/server/mint.ts` |
| Client | `examples/txodds/agent/txline.ts` |
| Proxy | `examples/txodds/server/proxy.ts` |
| Free-tier competitions | World Cup and International Friendlies |
| Devnet program observed in example | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` |

The browser never receives the TxLINE token. The proxy owns API access and exposes local JSON endpoints to the UI and examples.

## Endpoints Used

| TxLINE endpoint | Use in repository |
|---|---|
| `GET /api/fixtures/snapshot` | Fixture list, competition metadata, team names, start time. |
| `GET /api/odds/snapshot/{fixtureId}` | Verified odds markets and de-margined `Pct` probabilities. |
| `GET /api/scores/snapshot/{fixtureId}` | Score event data; client support exists, proxy/UI exposure is limited. |

The odds endpoint is a path segment endpoint, not a query parameter endpoint.

## Local Proxy API

| Endpoint | Description |
|---|---|
| `GET /api/board` | Fixtures with verified live odds, prepared for the UI. |
| `GET /api/fixtures` | Raw fixture passthrough. |
| `GET /api/odds?fixtureId=<id>` | Odds passthrough for a fixture. |
| `GET /api/edge?fixtureId=<id>` | TxLINE odds plus `analyzeEdge()` output. |
| `GET /api/settle?fixtureId=<id>&amount=<sol>` | Devnet escrow/arbiter settlement path. |
| `GET /api/pay-intent` | Solana Pay transfer intent. |
| `GET /api/pay-verify` | Reference-bound transfer verification. |
| `GET /api/pay-sh-edge` | Simulated Pay.sh procurement plus edge delivery. |
| `GET /api/runs` / `GET /api/run?runId=<id>` | Persisted run ledger records. |
| `GET /api/grade-runs` | Grade persisted reads against resolved score data where available. |

## Correctness Notes

The implementation uses the following TxODDS-specific corrections:

1. Use `txline-dev.txodds.com`; the older `oracle-dev.txodds.com` host is not used.
2. Subscribe with treasury mint `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG`.
3. Use the legacy `subscribe(1, 4)` path because `subscribe_v2` is present in the IDL but not deployed on devnet.
4. Fetch odds from `/api/odds/snapshot/{fixtureId}`.

## Service Mapping

The default service is implemented in:

| File | Responsibility |
|---|---|
| `examples/txodds/agent/txline.ts` | TxLINE client and auth/API calls. |
| `examples/txodds/agent/edge.ts` | Verified odds to fair-line analysis. |
| `examples/txodds/agent/service.ts` | `deliverService()` wrapper for paid delivery. |
| `examples/txodds/server/proxy.ts` | API proxy, settlement endpoints, run persistence. |
| `examples/txodds/research/watcher.ts` | Polls `/api/board` and queues events when odds move. |
| `examples/marketplace/research.ts` | Consumes watcher jobs as event-driven `WANT` messages. |

## Settlement Binding

The paid read is bound to settlement through a `reference` derived from order/delivery data. The run ledger records the delivered payload, the content hash, and related transaction signatures so the paid artifact can be inspected later.

Devnet escrow programs used by the examples:

| Program | ID |
|---|---|
| Escrow | `R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet` |
| Arbiter | `FJtuVXsyXuRKqgJBEPAXmktkd13CqStapgevzGwYktXd` |

## Run

```sh
npm run setup
npm run dev
```

For CoralOS market execution:

```sh
docker compose up -d coral
bash build-agents.sh
npm run demo:coral
```

For event-driven research:

```sh
npm run dev
npm run research:watch
npm run research
```

Use devnet wallets only unless a separate production review changes the policy.
