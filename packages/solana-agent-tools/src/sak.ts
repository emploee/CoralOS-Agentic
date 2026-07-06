import { z } from 'zod'
import {
  createSolanaAgentTools,
  type ReadonlySolanaAgentTools,
  type TransferIntentInput,
} from './tools.js'

export interface SdkActionExample {
  input: Record<string, unknown>
  output: Record<string, unknown>
  explanation: string
}

export interface SdkAction {
  name: string
  similes: string[]
  description: string
  examples: SdkActionExample[][]
  schema: z.ZodType
  handler(agent: unknown, input: Record<string, unknown>): Promise<Record<string, unknown>>
}

export interface ReadonlySolanaToolsPlugin {
  name: 'pay-readonly-solana-tools'
  methods: ReadonlySolanaAgentTools
  actions: SdkAction[]
  initialize(agent: unknown): void
}

const addressSchema = z.object({ address: z.string().min(32) })
const ownerSchema = z.object({ owner: z.string().min(32) })
const priceSchema = z.object({ id: z.string().min(2) })
const pythSchema = z.object({ priceFeedId: z.string().min(64) })
const transferIntentSchema = z.object({
  service: z.string().min(1),
  buyer: z.string().min(32),
  recipient: z.string().min(32),
  amountSol: z.number().positive(),
  round: z.number().int().nonnegative().optional(),
  reference: z.string().min(32).optional(),
  awardedPriceSol: z.number().positive().optional(),
  spentSol: z.number().nonnegative().optional(),
  lastDepositAt: z.number().nonnegative().optional(),
  now: z.number().nonnegative().optional(),
  policy: z.object({
    maxSolPerRound: z.number().positive().optional(),
    maxSolPerSession: z.number().positive().optional(),
    allowedServices: z.array(z.string()).optional(),
    expectedPayout: z.string().optional(),
    minIntervalMs: z.number().nonnegative().optional(),
    requireVerifier: z.boolean().optional(),
  }).optional(),
})

function actionResult(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>
}

export function createReadonlySolanaActions(tools: ReadonlySolanaAgentTools): SdkAction[] {
  return [
    {
      name: 'solana.read_wallet_balance',
      similes: ['check devnet SOL balance', 'read wallet balance'],
      description: 'Read a wallet SOL balance on the guarded devnet RPC. This tool cannot sign or send.',
      examples: [[{
        input: { address: '11111111111111111111111111111111' },
        output: { address: '11111111111111111111111111111111', sol: 0 },
        explanation: 'Use this before deciding whether an agent can afford a devnet order.',
      }]],
      schema: addressSchema,
      handler: async (_agent, input) => actionResult(
        await tools.readWalletBalance(addressSchema.parse(input).address),
      ),
    },
    {
      name: 'solana.read_token_balances',
      similes: ['list token balances', 'read SPL token accounts'],
      description: 'Read parsed SPL token balances for an owner. This is read-only account inspection.',
      examples: [[{
        input: { owner: '11111111111111111111111111111111' },
        output: { balances: [] },
        explanation: 'Use this to enrich an agent decision with portfolio context.',
      }]],
      schema: ownerSchema,
      handler: async (_agent, input) => ({ balances: await tools.readTokenBalances(ownerSchema.parse(input).owner) }),
    },
    {
      name: 'solana.fetch_token_price',
      similes: ['get token USD price', 'fetch Jupiter price'],
      description: 'Fetch a USD token price from Jupiter Price API V3. No trade or swap is possible.',
      examples: [[{
        input: { id: 'SOL' },
        output: { id: 'So11111111111111111111111111111111111111112', usdPrice: 150 },
        explanation: 'Use this as read-only market context for a bid or policy explanation.',
      }]],
      schema: priceSchema,
      handler: async (_agent, input) => actionResult(
        await tools.fetchTokenPrice(priceSchema.parse(input).id),
      ),
    },
    {
      name: 'solana.fetch_pyth_price',
      similes: ['get Pyth oracle price', 'fetch Hermes price'],
      description: 'Fetch a Pyth Hermes price feed value. This reads oracle data and never updates on-chain.',
      examples: [[{
        input: { priceFeedId: 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d' },
        output: { price: 1, provider: 'pyth-hermes' },
        explanation: 'Use this when the agent needs oracle context without settlement authority.',
      }]],
      schema: pythSchema,
      handler: async (_agent, input) => actionResult(
        await tools.fetchPythPrice(pythSchema.parse(input).priceFeedId),
      ),
    },
    {
      name: 'solana.simulate_transfer_intent',
      similes: ['dry-run transfer', 'simulate payment intent'],
      description:
        'Build a non-executable devnet SOL transfer intent and run the repo policy gate. It never signs or broadcasts.',
      examples: [[{
        input: {
          service: 'txline.edge',
          buyer: '11111111111111111111111111111111',
          recipient: '11111111111111111111111111111111',
          amountSol: 0.0001,
        },
        output: { executable: false, policyDecision: { ok: true } },
        explanation: 'Use this to explain what a future payment would require before any signing surface appears.',
      }]],
      schema: transferIntentSchema,
      handler: async (_agent, input) => actionResult(
        await tools.simulateTransferIntent(transferIntentSchema.parse(input) as TransferIntentInput),
      ),
    },
  ]
}

export function createReadonlySolanaPlugin(
  tools: ReadonlySolanaAgentTools = createSolanaAgentTools(),
): ReadonlySolanaToolsPlugin {
  return {
    name: 'pay-readonly-solana-tools',
    methods: tools,
    actions: createReadonlySolanaActions(tools),
    initialize() {
      // No-op by design: this plugin does not claim signing authority from Solana Agent Kit.
    },
  }
}
