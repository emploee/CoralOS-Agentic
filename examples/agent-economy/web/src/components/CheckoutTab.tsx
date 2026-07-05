import { useState } from 'react'
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui'
import { useWallet } from '@solana/wallet-adapter-react'
import { useCheckout } from '../hooks/useCheckout'
import { SessionHeader } from './SessionHeader'

const SERVICES = [
  { id: 'jupiter', name: 'Live SOL→USDC price', desc: 'a Jupiter swap quote' },
  { id: 'coingecko', name: 'Crypto spot price', desc: 'a CoinGecko price' },
  { id: 'news', name: 'Crypto headlines', desc: 'top news (needs NEWS_API_KEY)' },
  { id: 'inference', name: 'AI completion', desc: 'an LLM answer (needs ANTHROPIC_API_KEY)' },
]

// Services that take a free-text input, and whether it's required.
const TEXT: Record<string, { required: boolean; placeholder: string; preset: string }> = {
  inference: { required: true, placeholder: 'Ask the AI anything…', preset: 'Write a haiku about Solana.' },
  news: { required: false, placeholder: 'Topic (optional) — e.g. solana, bitcoin', preset: '' },
}

export function CheckoutTab() {
  const { connected } = useWallet()
  const buy = useCheckout()
  const [service, setService] = useState('jupiter')
  const [text, setText] = useState('')
  const [steps, setSteps] = useState<string[]>([])
  const [result, setResult] = useState('')
  const [sig, setSig] = useState('')
  const [busy, setBusy] = useState(false)

  const textCfg = TEXT[service]

  function pick(id: string) {
    setService(id)
    setText(TEXT[id]?.preset ?? '')
  }

  async function pay() {
    setBusy(true)
    setSteps([])
    setResult('')
    setSig('')
    try {
      const r = await buy(service, textCfg ? text : '', (s) => setSteps((p) => [...p, s]))
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
        You are the buyer. Connect a wallet (on Devnet), pick a service, and pay the same seller the
        autonomous agent uses — one click, settled on-chain. Behind the button you become a session
        participant: the bridge posts <em>as</em> <code>user-proxy</code> through Coral's{' '}
        <b>puppet API</b>, and the seller's reply is read back from the session state.
      </p>

      <SessionHeader kind="checkout" />
      <WalletMultiButton />

      <div className="services">
        {SERVICES.map((s) => (
          <label key={s.id} className={service === s.id ? 'svc on' : 'svc'}>
            <input type="radio" name="svc" checked={service === s.id} onChange={() => pick(s.id)} />
            <span>
              <b>{s.name}</b>
              <br />
              <span className="muted">{s.desc}</span>
            </span>
          </label>
        ))}
      </div>

      {textCfg && (
        <textarea
          className="prompt"
          rows={service === 'inference' ? 3 : 2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={textCfg.placeholder}
        />
      )}

      <button
        className="primary"
        onClick={pay}
        disabled={!connected || busy || (textCfg?.required && !text.trim())}
      >
        {busy ? 'Working…' : connected ? 'Buy' : 'Connect a wallet first'}
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
