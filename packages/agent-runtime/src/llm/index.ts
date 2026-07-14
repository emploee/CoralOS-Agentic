// LLM pillar — provider-agnostic completion (Groq is the kit's recommended free default; LLM_PROVIDER also accepts venice/openai/anthropic).

export { complete, pickProvider, llmRuntimeInfo, logLlmStartup, parseJsonReply } from './complete.js'
export type { LlmProvider, CompleteOpts, LlmRuntimeInfo } from './complete.js'
export { estimateLlmCostSol } from './pricing.js'
