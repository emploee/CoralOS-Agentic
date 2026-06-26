import { useState } from 'react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useWallet } from '@solana/wallet-adapter-react'
import { useCheckout } from '../hooks/useCheckout'

const SERVICES = [
  { id: 'jupiter', name: 'Live SOL→USDC price', desc: 'a Jupiter swap quote' },
  { id: 'coingecko', name: 'Crypto spot price', desc: 'a CoinGecko price' },
  { id: 'inference', name: 'AI completion', desc: 'an LLM answer' },
]

export function CheckoutTab() {
  const { connected } = useWallet()
  const buy = useCheckout()
  const [service, setService] = useState('jupiter')
  const [steps, setSteps] = useState<string[]>([])
  const [result, setResult] = useState('')
  const [sig, setSig] = useState('')
  const [busy, setBusy] = useState(false)

  async function pay() {
    setBusy(true)
    setSteps([])
    setResult('')
    setSig('')
    try {
      const r = await buy(service, (s) => setSteps((p) => [...p, s]))
      setResult(r.data)
      setSig(r.sig)
    } catch (e) {
      setSteps((p) => [...p, `Error: ${(e as Error).message}`])
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <p>
        You are the buyer. Connect Phantom (on Devnet), pick a service, and pay the same seller the
        autonomous agent uses — one click, settled on-chain.
      </p>

      <WalletMultiButton />

      <div className="services">
        {SERVICES.map((s) => (
          <label key={s.id} className={service === s.id ? 'svc on' : 'svc'}>
            <input type="radio" name="svc" checked={service === s.id} onChange={() => setService(s.id)} />
            <span>
              <b>{s.name}</b>
              <br />
              <span className="muted">{s.desc}</span>
            </span>
          </label>
        ))}
      </div>

      <button className="primary" onClick={pay} disabled={!connected || busy}>
        {busy ? 'Working…' : connected ? 'Buy with Phantom' : 'Connect a wallet first'}
      </button>

      {steps.length > 0 && (
        <ol className="timeline">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}

      {result && (
        <div>
          <pre className="result">{result}</pre>
          {sig && (
            <a
              className="muted"
              href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
            >
              View the payment on Solana Explorer →
            </a>
          )}
        </div>
      )}
    </section>
  )
}
