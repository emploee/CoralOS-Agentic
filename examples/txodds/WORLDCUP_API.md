# TxLINE World Cup API Notes

This file documents the TxLINE API surface used by `examples/txodds`. The implementation intentionally derives local features from TxLINE fixture, odds, and score snapshots rather than adding unrelated data providers.

## Access Model

| Item | Detail |
|---|---|
| Host | `https://txline-dev.txodds.com` |
| Guest auth | `POST /auth/guest/start` |
| API token | Activated `X-Api-Token` from the Solana subscription flow. |
| Token storage | Server-side only, in the proxy process. |
| Client | `agent/txline.ts` |
| Proxy | `server/proxy.ts` |

The browser does not store the guest JWT or `X-Api-Token`.

## Snapshot Endpoints

| Capability | Endpoint | Returned data | Current use |
|---|---|---|---|
| Fixtures | `GET /api/fixtures/snapshot` | Fixture id, competition, participants, home/away flag, start time. | Proxy `/api/fixtures`, UI board. |
| Odds | `GET /api/odds/snapshot/{fixtureId}` | Markets, bookmaker, `SuperOddsType`, price names, de-margined `Pct`. | Proxy `/api/odds`, `/api/board`, `/api/edge`. |
| Scores | `GET /api/scores/snapshot/{fixtureId}` | Score events. | Client support and run grading paths. |

Properties:

- the API is snapshot-based, so movement detection is implemented by polling and diffing;
- `Pct` is already de-margined;
- free-tier data covers World Cup and International Friendlies.

## Implemented Derivations

| Derivation | Source | Implementation |
|---|---|---|
| Board | Fixtures plus odds snapshots. | `server/proxy.ts` exposes `/api/board`. |
| Edge analysis | One fixture's verified odds snapshot. | `agent/edge.ts` and `/api/edge`. |
| Settlement reference | Order/delivery data. | Proxy and agent settlement clients. |
| Event queue | Repeated board snapshots. | `research/watcher.ts` and `research/detect.ts`. |
| Run grading | Persisted run plus score data when available. | `/api/grade-runs`. |

## Candidate Technical Extensions

These extensions remain inside the TxLINE API surface:

| Extension | API dependency | Implementation notes |
|---|---|---|
| Additional markets | Existing odds snapshot. | Render more `SuperOddsType` values instead of only 1X2. |
| Competition filter | Existing fixtures snapshot. | Group by `Competition` or `CompetitionId`; International Friendlies uses competition id `430`. |
| Line movement history | Repeated odds snapshots. | Store a bounded in-memory ring per fixture/outcome. |
| Score display | Existing scores snapshot. | Gate UI display on non-empty score data. |
| Research triggers | Repeated board snapshots. | Use `MOVE_PCT` threshold and verified-odds availability. |

## Constraints

- Do not present fallback data as live TxLINE data.
- Do not add unverified odds from unrelated providers to the TxLINE example.
- Keep TxLINE credentials server-side.
- Keep settlement on devnet unless the repository policy changes through a separate review.
- Treat API responses as untrusted input and validate before using them in paid delivery or grading.

## Related Files

| File | Role |
|---|---|
| `agent/txline.ts` | TxLINE API client. |
| `agent/edge.ts` | Fair-line transform and LLM/fallback analysis. |
| `agent/service.ts` | Paid service wrapper. |
| `server/proxy.ts` | Local proxy, settlement, run persistence, grading. |
| `research/detect.ts` | Pure event detector. |
| `research/watcher.ts` | Polling event queue. |
