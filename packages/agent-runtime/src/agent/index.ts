// Agent pillar — small scoring/ranking helpers shared by any agent that must pick the best of
// several options and later grade its own past calls.

export { rank, best, evaluateDirectionalCall, type ScoredOption, type DecisionEvaluation, type DecisionOutcome } from './evaluation.js'
