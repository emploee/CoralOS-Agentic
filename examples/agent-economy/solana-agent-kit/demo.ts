import { PublicKey } from '@solana/web3.js'
import {
  SolanaAgentKit,
  executeAction,
  type Action,
  type Plugin,
} from 'solana-agent-kit'
import {
  SOL_MINT,
  TOKEN_PROGRAM_ID,
  createReadOnlyWallet,
  createReadonlySolanaPlugin,
  createSolanaAgentTools,
  type ReadonlySolanaConnection,
} from '@pay/solana-agent-tools'

const DEVNET_RPC = 'https://api.devnet.solana.com'
const DEMO_WALLET = process.env.WALLET ?? '11111111111111111111111111111111'
const PYTH_SOL_USD = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'
const useMock = process.argv.includes('--mock')

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function mockConnection(): ReadonlySolanaConnection {
  return {
    async getBalance(pubkey) {
      if (pubkey.toBase58() !== DEMO_WALLET) throw new Error(`unexpected balance lookup ${pubkey.toBase58()}`)
      return 1_230_000_000
    },
    async getParsedTokenAccountsByOwner(owner, filter) {
      if (filter.programId.toBase58() !== TOKEN_PROGRAM_ID.toBase58()) {
        throw new Error(`unexpected token program ${filter.programId.toBase58()}`)
      }
      return {
        value: [{
          pubkey: new PublicKey(SOL_MINT),
          account: {
            data: {
              parsed: {
                info: {
                  mint: SOL_MINT,
                  owner: owner.toBase58(),
                  tokenAmount: {
                    amount: '42000000',
                    decimals: 9,
                    uiAmount: 0.042,
                    uiAmountString: '0.042',
                  },
                },
              },
            },
          },
        }],
      }
    },
  }
}

const mockFetch: typeof fetch = async (input) => {
  const href = input instanceof Request ? input.url : String(input)
  if (href.includes('price/v3')) {
    return json({ [SOL_MINT]: { usdPrice: 123.45, decimals: 9, blockId: 42 } })
  }
  if (href.includes('hermes.pyth.network') || href.includes('/updates/price/latest')) {
    return json({
      parsed: [{
        id: PYTH_SOL_USD,
        price: { price: '12345000000', conf: '1000000', expo: -8, publish_time: 1710000000 },
      }],
    })
  }
  return new Response(`unexpected mock fetch ${href}`, { status: 404 })
}

function getAction(agent: SolanaAgentKit, name: string): Action {
  const action = agent.actions.find((candidate) => candidate.name === name)
  if (!action) throw new Error(`missing action ${name}`)
  return action
}

function summarizeTokenBalances(result: Record<string, unknown>): Record<string, unknown> {
  const balances = Array.isArray(result.balances) ? result.balances : []
  return {
    ...result,
    balanceCount: balances.length,
    balances: balances.slice(0, 5),
    truncated: balances.length > 5,
  }
}

const tools = createSolanaAgentTools(useMock
  ? { connection: mockConnection(), fetch: mockFetch }
  : { rpcUrl: process.env.SOLANA_RPC_URL ?? DEVNET_RPC })

const agent = new SolanaAgentKit(
  createReadOnlyWallet(DEMO_WALLET),
  process.env.SOLANA_RPC_URL ?? DEVNET_RPC,
  { signOnly: true },
).use(createReadonlySolanaPlugin(tools) as unknown as Plugin)

const balance = await executeAction(
  getAction(agent, 'solana.read_wallet_balance'),
  agent,
  { address: DEMO_WALLET },
)
const tokenBalances = await executeAction(
  getAction(agent, 'solana.read_token_balances'),
  agent,
  { owner: DEMO_WALLET },
)
const jupiterPrice = await executeAction(
  getAction(agent, 'solana.fetch_token_price'),
  agent,
  { id: 'SOL' },
)
const pythPrice = await executeAction(
  getAction(agent, 'solana.fetch_pyth_price'),
  agent,
  { priceFeedId: PYTH_SOL_USD },
)
const transferIntent = await executeAction(
  getAction(agent, 'solana.simulate_transfer_intent'),
  agent,
  {
    service: 'sak.readonly-demo',
    buyer: DEMO_WALLET,
    recipient: DEMO_WALLET,
    amountSol: 0.0001,
    awardedPriceSol: 0.0001,
    policy: {
      maxSolPerRound: 0.001,
      maxSolPerSession: 0.01,
      allowedServices: ['sak.readonly-demo'],
      expectedPayout: DEMO_WALLET,
    },
  },
)

const decision = {
  mode: useMock ? 'mock-smoke' : 'live-read-devnet',
  plugin: 'pay-readonly-solana-tools',
  agentActions: agent.actions.map((action) => action.name),
  observations: {
    balance,
    tokenBalances: summarizeTokenBalances(tokenBalances),
    jupiterPrice,
    pythPrice,
  },
  decision: {
    summary: 'Agent has enough read-only context to reason, but not enough authority to move funds.',
    nextStep: 'Escalate any real payment to the repo payment rail flow: policy, approval, ledger receipt, UI surface.',
    transferIntent,
  },
}

if ((transferIntent as { executable?: unknown }).executable !== false) {
  throw new Error('read-only transfer intent unexpectedly became executable')
}

console.log(JSON.stringify(decision, null, 2))
