import { useState } from 'react'
import { AutonomousTab } from './components/AutonomousTab'
import { CheckoutTab } from './components/CheckoutTab'

export default function App() {
  const [tab, setTab] = useState<'auto' | 'checkout'>('auto')
  return (
    <div className="app">
      <header>
        <h1>sol_coralOS</h1>
        <p className="sub">An agent economy on Solana — one seller, two front doors.</p>
      </header>

      <nav className="tabs">
        <button className={tab === 'auto' ? 'on' : ''} onClick={() => setTab('auto')}>
          Autonomous
        </button>
        <button className={tab === 'checkout' ? 'on' : ''} onClick={() => setTab('checkout')}>
          Checkout
        </button>
      </nav>

      {tab === 'auto' ? <AutonomousTab /> : <CheckoutTab />}

      <footer className="foot">
        Devnet · payments settle on-chain · CoralOS coordinates the agents
      </footer>
    </div>
  )
}
