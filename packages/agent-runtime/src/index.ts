// @pay/agent-runtime — the agent economy's entire runtime surface, one module per pillar.
//
//   coral/   CoralOS MCP client + agent entrypoint   (coordination)
//   solana/  devnet guard + Solana Pay primitives    (settlement)
//   llm/     provider-agnostic completion shim
//   market/  the marketplace wire format (pure)
//   ledger/  durable run folders for paid rounds     (audit trail)
//   policy/  the fund-moving choke point (pure)      (spend caps, bindings, gates)

export * from './coral/index.js'
export * from './solana/index.js'
export * from './llm/index.js'
export * from './market/index.js'
export * from './ledger/index.js'
export * from './policy/index.js'
