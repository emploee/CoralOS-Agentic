// Agent pillar — capability grants, safety gates, tool contracts, and a bounded LLM tool-calling
// loop. The shared substrate a coral-agent adopts to move from "a script that replies" to a
// capability-scoped, budget-bounded, audited agent loop.

export { grantCapabilities, hasCapability, requireCapability, type Capability, type CapabilityGrant } from './capability.js'
export {
  BudgetGuard, BudgetExceededError, StepCounter, StepCapExceededError, wrapUntrusted, DEFAULT_DEVNET_BUDGET,
  type BudgetLimits, type BudgetResource,
} from './safety.js'
export { idempotencyKey, type Tool, type ToolCallOutcome, type ToolCallRecord } from './tools.js'
export { rank, best, evaluateDirectionalCall, type ScoredOption, type DecisionEvaluation, type DecisionOutcome } from './evaluation.js'
export { runToolLoop, toolResult, type ToolLoopConfig, type ToolLoopOutcome } from './loop.js'
