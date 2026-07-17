import { describe, it, expect } from 'vitest'
import { gradeRun } from './grade.js'
import type { RunRecord } from '@pay/agent-runtime'

const run = (overrides: Partial<RunRecord> = {}): RunRecord => ({
  runId: 's/round-1',
  session: 's',
  round: 1,
  status: 'delivered',
  want: { service: 'sharp-movement', arg: '18241006', budgetSol: 0.001 },
  bids: [],
  txs: [],
  updatedAt: '2026-07-14T00:00:00.000Z',
  ...overrides,
})

const scoreEvent = (over: Record<string, unknown> = {}) => ({
  fixtureId: 18241006,
  seq: 1,
  statusSoccerId: { title: 'END' },
  scoreSoccer: { Participant1: { H2: { Goals: 2 } }, Participant2: { H2: { Goals: 1 } } },
  ...over,
})

describe('gradeRun', () => {
  it('is undefined for a non-numeric fixture arg - nothing to grade', () => {
    expect(gradeRun(run({ want: { service: 'txline', arg: 'fixtures', budgetSol: 0.001 } }), [scoreEvent()])).toBeUndefined()
  })

  it('is undefined when there are no score events at all - match has not started', () => {
    expect(gradeRun(run(), [])).toBeUndefined()
    expect(gradeRun(run(), undefined)).toBeUndefined()
  })

  it('is pending while the match is still in progress', () => {
    const outcome = gradeRun(run(), [scoreEvent({ statusSoccerId: { title: 'LIVE' } })])
    expect(outcome).toMatchObject({ status: 'pending' })
    expect((outcome as { reason: string }).reason).toContain('not finished')
  })

  it('is pending when the match ended but the score shape is unrecognized', () => {
    const outcome = gradeRun(run(), [scoreEvent({ scoreSoccer: {} })])
    expect(outcome).toMatchObject({ status: 'pending', reason: 'match ended but score shape unrecognized' })
  })

  it('grades a finished match with no prediction to score - just records the actual result', () => {
    const outcome = gradeRun(run(), [scoreEvent()])
    expect(outcome).toMatchObject({ status: 'graded', actual: { home: 2, away: 1, winner: 'home' } })
    expect((outcome as { prediction?: unknown }).prediction).toBeUndefined()
  })

  it('marks a sharp-movement prediction correct when the leading label matches the winner', () => {
    const delivered = run({ delivery: { raw: '', sha256: '', data: { leadingLabel: 'part1' } } })
    const outcome = gradeRun(delivered, [scoreEvent()])
    expect(outcome).toMatchObject({ status: 'graded', prediction: 'home', correct: true })
  })

  it('marks a sharp-movement prediction incorrect when the leading label misses the winner', () => {
    const delivered = run({ delivery: { raw: '', sha256: '', data: { leadingLabel: 'part2' } } })
    const outcome = gradeRun(delivered, [scoreEvent()])
    expect(outcome).toMatchObject({ status: 'graded', prediction: 'away', correct: false })
  })

  it('scores a draw correctly on equal goals', () => {
    const delivered = run({ delivery: { raw: '', sha256: '', data: { leadingLabel: 'x' } } })
    const outcome = gradeRun(delivered, [scoreEvent({
      scoreSoccer: { Participant1: { H2: { Goals: 1 } }, Participant2: { H2: { Goals: 1 } } },
    })])
    expect(outcome).toMatchObject({ status: 'graded', actual: { winner: 'draw' }, prediction: 'draw', correct: true })
  })

  it('picks the highest-seq event as authoritative', () => {
    const outcome = gradeRun(run(), [
      scoreEvent({ seq: 1, scoreSoccer: { Participant1: { H1: { Goals: 0 } }, Participant2: { H1: { Goals: 0 } } }, statusSoccerId: { title: 'LIVE' } }),
      scoreEvent({ seq: 2 }),
    ])
    expect(outcome).toMatchObject({ status: 'graded', actual: { home: 2, away: 1 } })
  })
})
