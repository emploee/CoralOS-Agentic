/**
 * Tools for the verifier's bounded acceptance-judgment loop (see verify.ts's checkDelivery). By the
 * time this loop runs, checkDelivery's deterministic hash/JSON/error-field checks have already
 * passed, so inspect_payload_structure's isJson/hasErrorField fields will always read true/false
 * here - its value is an auditable "confirm your own read" step, not a new gate.
 */
import type { Tool, VerifyRequest } from '@pay/agent-runtime'

export interface InspectPayloadStructureOutput {
  isJson: boolean
  topLevelKeys: string[]
  hasErrorField: boolean
  byteLength: number
}

export function inspectPayloadStructureTool(payload: string): Tool<Record<string, never>, InspectPayloadStructureOutput> {
  return {
    name: 'inspect_payload_structure',
    description: 'Inspect the delivered payload\'s structure before judging. Call this before submit_verdict.',
    async execute() {
      let isJson = true
      let topLevelKeys: string[] = []
      let hasErrorField = false
      try {
        const data = JSON.parse(payload)
        if (data && typeof data === 'object') {
          topLevelKeys = Object.keys(data)
          hasErrorField = 'error' in data
        }
      } catch {
        isJson = false
      }
      return { isJson, topLevelKeys, hasErrorField, byteLength: payload.length }
    },
  }
}

export interface SubmitVerdictInput {
  pass: boolean
  reason: string
}

/** Forced final tool - the loop terminates only when the model calls this. */
export const submitVerdictTool: Tool<SubmitVerdictInput, SubmitVerdictInput> = {
  name: 'submit_verdict',
  description: 'Submit the final verdict: {pass, reason}. Ends the loop.',
  async execute(input) {
    return input
  },
}

/**
 * Known top-level delivery shapes, keyed by the payload's own declared `service` field (not the
 * order's `service`, since e.g. a "txline" order can deliver txline-edge/-odds/-fixtures shapes) -
 * see coral-agents/seller-agent/src/service.ts's payload builders.
 */
const KNOWN_SHAPES: Record<string, string[]> = {
  'txline-edge': ['teams', 'market', 'analysis'],
  'txline-odds': ['fixtureId', 'odds'],
  'txline-fixtures': ['count', 'fixtures'],
  'sharp-movement': ['fixtureId', 'magnitude', 'confidence', 'analysis'],
  freelance: ['result'],
}

export type ScrutinyLevel = 'low' | 'high'

/**
 * How much scrutiny a delivery warrants, generalizing the txline-fixture fast path that used to be
 * the only special case: a payload matching a known, well-formed delivery shape gets a tighter loop
 * budget ('low'); anything unrecognized gets today's full budget plus an extra push toward calling
 * inspect_payload_structure before deciding ('high').
 */
export function assessScrutiny(req: Pick<VerifyRequest, 'payload'>): ScrutinyLevel {
  try {
    const data = JSON.parse(req.payload)
    if (!data || typeof data !== 'object') return 'high'
    const declaredService = String((data as Record<string, unknown>).service ?? '')
    const expected = KNOWN_SHAPES[declaredService]
    if (!expected) return 'high'
    const keys = Object.keys(data)
    return expected.every((k) => keys.includes(k)) ? 'low' : 'high'
  } catch {
    return 'high'
  }
}
