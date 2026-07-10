import { describe, it, expect } from 'vitest'
import { rank, best, evaluateDirectionalCall } from './evaluation.js'

describe('rank / best', () => {
  it('ranks options by score, descending', () => {
    const ranked = rank([
      { option: 'a', score: 1, reason: 'low' },
      { option: 'b', score: 3, reason: 'high' },
      { option: 'c', score: 2, reason: 'mid' },
    ])
    expect(ranked.map((r) => r.option)).toEqual(['b', 'c', 'a'])
  })

  it('best returns the top-ranked option', () => {
    const top = best([
      { option: 'cheap', score: 0.4, reason: 'low price' },
      { option: 'reputable', score: 0.9, reason: 'high reputation' },
    ])
    expect(top?.option).toBe('reputable')
  })

  it('best returns undefined for an empty list', () => {
    expect(best([])).toBeUndefined()
  })

  it('ties keep input order (stable sort)', () => {
    const ranked = rank([
      { option: 'first', score: 1, reason: '' },
      { option: 'second', score: 1, reason: '' },
    ])
    expect(ranked.map((r) => r.option)).toEqual(['first', 'second'])
  })
})

describe('evaluateDirectionalCall', () => {
  it('marks a call correct when the observed direction matches the prediction', () => {
    const result = evaluateDirectionalCall('down', 2.0, 1.9)
    expect(result.outcome).toBe('correct')
    expect(result.score).toBe(1)
  })

  it('marks a call incorrect when the observed direction reverses', () => {
    const result = evaluateDirectionalCall('down', 2.0, 2.1)
    expect(result.outcome).toBe('incorrect')
    expect(result.score).toBe(0)
  })

  it('is unproven when nothing has moved yet', () => {
    const result = evaluateDirectionalCall('up', 2.0, 2.0)
    expect(result.outcome).toBe('unproven')
  })
})
