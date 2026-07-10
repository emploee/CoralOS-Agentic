/**
 * Small scoring/ranking helpers shared by any agent that must pick the best of several options
 * (a buyer ranking bids, a signal agent ranking candidate moves) and later grade its own past
 * calls. Pure and provider-free so the ranking/grading logic is fully unit-testable, independent
 * of whatever produced the scores.
 */

export interface ScoredOption<T> {
  option: T
  score: number
  reason: string
}

/** Rank options by score, descending. Ties keep input order (stable sort). */
export function rank<T>(options: ScoredOption<T>[]): ScoredOption<T>[] {
  return [...options].sort((a, b) => b.score - a.score)
}

/** The best-scoring option, or undefined if `options` is empty. */
export function best<T>(options: ScoredOption<T>[]): ScoredOption<T> | undefined {
  return rank(options)[0]
}

export type DecisionOutcome = 'correct' | 'incorrect' | 'unproven'

export interface DecisionEvaluation {
  outcome: DecisionOutcome
  score: number
  reason: string
}

/**
 * Lightweight self-evaluation: compare a past directional call (e.g. "odds will keep shortening")
 * against what was actually observed later. A decision earns 'correct' only from a later observed
 * fact, never from its own stated confidence — mirrors the reference architecture's
 * `evaluate_decision` and the sharp-movement-detector's `correct_so_far` prediction tracking.
 */
export function evaluateDirectionalCall(
  predictedDirection: 'up' | 'down',
  observedBefore: number,
  observedAfter: number,
): DecisionEvaluation {
  if (observedAfter === observedBefore) {
    return { outcome: 'unproven', score: 0, reason: 'no further movement observed yet' }
  }
  const actualDirection = observedAfter > observedBefore ? 'up' : 'down'
  const correct = actualDirection === predictedDirection
  return {
    outcome: correct ? 'correct' : 'incorrect',
    score: correct ? 1 : 0,
    reason: `predicted ${predictedDirection}, observed ${actualDirection} (${observedBefore} -> ${observedAfter})`,
  }
}
