export type PatchTask = {
  id: string
  title: string
  description: string
  language: 'typescript' | 'javascript'
  baseCommit: string
  testCommand: string
  allowedPaths: string[]
  budgetSol: number
  deadlineSeconds: number
}

export type SolverBid = {
  seller: string
  priceSol: number
  etaSeconds: number
  reputation: number
  successRate: number
  specialization: number
}

export type ScoredBid = SolverBid & {
  score: number
  breakdown: {
    price: number
    reputation: number
    successRate: number
    specialization: number
    deadlineFit: number
  }
}

export type PatchFile = {
  path: string
  beforeSha256: string
  contentBase64: string
}

export type PatchDelivery = {
  schema: 'patchbond.delivery.v1'
  taskId: string
  taskSha256: string
  seller: string
  files: PatchFile[]
  summary: string
}

export type VerificationProof = {
  schema: 'patchbond.proof.v1'
  taskId: string
  taskSha256: string
  deliverySha256: string
  verifier: string
  verdict: 'pass' | 'fail'
  testsPassed: number
  testsFailed: number
  durationMs: number
  reason: string
  depositTx?: string
  settlementTx?: string
}
