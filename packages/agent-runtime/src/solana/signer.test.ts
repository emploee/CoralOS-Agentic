import { describe, it, expect } from 'vitest'
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { keypairSigner, envSigner, resolveSigner, walletProviderFromEnv, signAndSendTransfer } from './signer.js'

function dummyTransaction(feePayer = Keypair.generate().publicKey): Transaction {
  const tx = new Transaction()
  tx.add(SystemProgram.transfer({ fromPubkey: feePayer, toPubkey: Keypair.generate().publicKey, lamports: 1 }))
  tx.feePayer = feePayer
  tx.recentBlockhash = Keypair.generate().publicKey.toBase58() // any 32-byte base58 value is a valid-shaped blockhash for signing
  return tx
}

describe('keypairSigner', () => {
  it('reports the wrapped keypair address', async () => {
    const kp = Keypair.generate()
    const signer = keypairSigner(kp)
    expect(await signer.address()).toBe(kp.publicKey.toBase58())
  })

  it('signs a transaction with the wrapped keypair', async () => {
    const kp = Keypair.generate()
    const signer = keypairSigner(kp)
    const tx = dummyTransaction(kp.publicKey)
    const signed = await signer.signTransaction(tx)
    expect(signed.signatures.some((s) => s.publicKey.equals(kp.publicKey) && s.signature != null)).toBe(true)
  })

  it('signs an arbitrary message', async () => {
    const kp = Keypair.generate()
    const signer = keypairSigner(kp)
    const message = new TextEncoder().encode('hello')
    const sig = await signer.signMessage!(message)
    expect(sig).toBeInstanceOf(Uint8Array)
    expect(sig.length).toBe(64) // ed25519 signature length
  })
})

describe('envSigner', () => {
  it('wraps a keypair loaded from an env var', async () => {
    const kp = Keypair.generate()
    process.env.TEST_SIGNER_KP = bs58.encode(kp.secretKey)
    const signer = envSigner('TEST_SIGNER_KP')
    expect(await signer.address()).toBe(kp.publicKey.toBase58())
    delete process.env.TEST_SIGNER_KP
  })

  it('throws when the env var is unset', () => {
    delete process.env.MISSING_SIGNER_KP
    expect(() => envSigner('MISSING_SIGNER_KP')).toThrow(/not set/)
  })
})

describe('walletProviderFromEnv', () => {
  it('defaults to local when WALLET_PROVIDER is unset', () => {
    expect(walletProviderFromEnv({})).toBe('local')
  })

  it('reads local/privy case-insensitively', () => {
    expect(walletProviderFromEnv({ WALLET_PROVIDER: 'PRIVY' })).toBe('privy')
    expect(walletProviderFromEnv({ WALLET_PROVIDER: 'local' })).toBe('local')
  })

  it('rejects an unknown provider', () => {
    expect(() => walletProviderFromEnv({ WALLET_PROVIDER: 'metamask' })).toThrow(/unknown WALLET_PROVIDER/)
  })
})

describe('resolveSigner', () => {
  it('resolves a local keypair signer by default', async () => {
    const kp = Keypair.generate()
    process.env.TEST_RESOLVE_KP = bs58.encode(kp.secretKey)
    const signer = resolveSigner('TEST_RESOLVE_KP', {})
    expect(await signer.address()).toBe(kp.publicKey.toBase58())
    delete process.env.TEST_RESOLVE_KP
  })

  it('requires Privy env vars when WALLET_PROVIDER=privy', () => {
    expect(() => resolveSigner('TEST_RESOLVE_KP', { WALLET_PROVIDER: 'privy' })).toThrow(/PRIVY_APP_ID/)
  })
})

describe('signAndSendTransfer — pre-flight validation (never touches the network)', () => {
  const signer = keypairSigner(Keypair.generate())
  const recipient = Keypair.generate().publicKey.toBase58()

  it('rejects a non-positive amount', async () => {
    await expect(signAndSendTransfer(signer, recipient, 0)).rejects.toThrow(/Invalid amount/)
    await expect(signAndSendTransfer(signer, recipient, -1)).rejects.toThrow(/Invalid amount/)
  })

  it('rejects an amount over maxAmount before signing or sending', async () => {
    await expect(signAndSendTransfer(signer, recipient, 5, { maxAmount: 1 })).rejects.toThrow(/exceeds budget/)
  })
})
