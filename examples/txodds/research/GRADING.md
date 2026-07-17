# Grading

Was a delivered prediction actually right, once the match finished? `grade.ts` answers this by
polling TxLINE's `/api/scores/snapshot/{fixtureId}` after a round settles and comparing the
sharp-movement seller's `leadingLabel` against the real final result.

## Scope

Only `sharp-movement` deliveries carry a structured `leadingLabel` (`part1` | `x` | `part2`) today -
see `coral-agents/seller-agent/src/service.ts`'s `sharpMovementService`. Other services (`txline`,
`freelance`) still get `actual`/`winner` recorded once their fixture's match ends, they just have no
`prediction`/`correct` to score, since they never made a directional call in the first place.

## Score events schema (from live TxLINE data, 2026-07)

`/api/scores/snapshot/{id}` returns an array of score events, not a single current score. Each event
carries a `seq` (monotonically increasing) and a `statusSoccerId.title` (`LIVE`, `END`, ...). The
highest-`seq` event is the authoritative/most-recent one - this is TxLINE's own convention, not
something inferred from timestamps.

A score event's goal counts are nested per match period:

```json
{
  "scoreSoccer": {
    "Participant1": { "H1": { "Goals": 1 }, "H2": { "Goals": 2 } },
    "Participant2": { "H1": { "Goals": 0 }, "H2": { "Goals": 1 } }
  }
}
```

`grade.ts`'s `PERIOD_ORDER` (`PE`, `ET2`, `ET1`, `H2`, `HT`, `H1`) picks the furthest period actually
present in the event - extra time / penalties outrank second half, which outranks first half.

## Open question: cumulative vs. per-period goals

`grade.ts` currently assumes each period's `Goals` value is the running (cumulative) total up to
that point in the match, not a per-period tally - so `H2.Goals` alone is read as the full-match
score once the match has ended, without adding `H1.Goals` to it. This matched every live World Cup
fixture observed during development (2026-07), but TxLINE's own docs don't state the convention
explicitly. If a graded result ever looks wrong (e.g. a scoreline that's clearly a second-half-only
count), this is the first place to check - the fix would be summing periods instead of taking the
furthest one.

## Match-ended detection

A match only grades once its latest score event's `statusSoccerId.title` is `"END"`
(`MATCH_ENDED_STATUSES`). Anything else (`LIVE`, missing, unrecognized) returns a `pending` outcome,
never a fabricated grade - `needsGrading()` re-checks pending rounds on every pass instead of giving
up after the first miss.

## Where the result lands

`gradeRun()` is pure - `{run, events} -> ScoreOutcome | undefined` - and fully unit-tested against
this schema (see `grade.test.ts`). `gradeRuns()` is the thin, at-most-once-per-fixture-per-pass
runner: lists the run ledger, fetches scores only for rounds `needsGrading()` flags, writes the
outcome back via `writeRun`. `examples/txodds/server/proxy.ts` runs it on an interval
(`GRADE_POLL_MS`, default 5 minutes - matches take 90+ minutes, no need to poll tightly) and exposes
`POST /api/grade` for an on-demand pass. `feed/src/persist.ts`'s `mergeOutcomes()` merges the
persisted `outcome` back onto the in-memory folded rounds the live feed serves, since a grade is
never present in the original Coral thread messages - it's always added later.
