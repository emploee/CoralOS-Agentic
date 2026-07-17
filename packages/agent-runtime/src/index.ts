// @pay/agent-runtime — the agent economy's entire runtime surface, one module per pillar.
//
//   coral/   CoralOS MCP client + agent entrypoint   (coordination)
//   solana/  devnet guard + Solana Pay primitives    (settlement)
//   market/  the marketplace wire format (pure)
//   ledger/  durable run folders for paid rounds     (audit trail)
//   policy/  the fund-moving choke point (pure)      (spend caps, bindings, gates)
//   agent/   scoring/ranking helpers for picking the best of several options

export * from './coral/index.js'
export * from './solana/index.js'
export * from './market/index.js'
export * from './ledger/index.js'
export * from './policy/index.js'
export * from './agent/index.js'
