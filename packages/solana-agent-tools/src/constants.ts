import { PublicKey } from '@solana/web3.js'

/** Wrapped SOL mint id used for read-only price lookups. */
export const SOL_MINT = 'So11111111111111111111111111111111111111112'

/** USDC mint id used as a read-only Jupiter price alias. */
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

/** SPL Token program id for parsed token-account balance reads. */
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
