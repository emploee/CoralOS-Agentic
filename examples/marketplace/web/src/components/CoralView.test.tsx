import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { CoralView } from './CoralView'
import type { Bus } from '../types'

afterEach(cleanup)

const bus: Bus = {
  session: 'fixture',
  agents: [
    { name: 'buyer-agent', status: 'running' },
    { name: 'seller-scribe', status: 'running' },
    { name: 'verifier-agent', status: 'running' },
  ],
  threads: [{
    id: 'ec664328-8b62-4fd9-aab4-a125efda13d8',
    name: 'market',
    creator: 'buyer-agent',
    participants: ['buyer-agent', 'seller-scribe', 'verifier-agent'],
    messages: [
      {
        sender: 'buyer-agent',
        text: 'WANT round=1 service=freelance arg=hero-copy budget=0.001',
        threadId: 'ec664328-8b62-4fd9-aab4-a125efda13d8',
        mentions: ['seller-scribe'],
        timestamp: '2026-07-04T12:00:00.000Z',
      },
      {
        sender: 'verifier-agent',
        text: 'VERIFIED round=1 verdict=pass by=verifier-agent',
        threadId: 'ec664328-8b62-4fd9-aab4-a125efda13d8',
        mentions: ['buyer-agent'],
        timestamp: '2026-07-04T12:00:30.000Z',
      },
    ],
  }],
  source: 'live',
}

describe('CoralView — the bus made visible', () => {
  it('renders the thread with its name, id, and participants', () => {
    render(<CoralView bus={bus} />)
    const thread = screen.getByTestId('thread')
    expect(thread.textContent).toContain('market')
    expect(thread.textContent).toContain('ec664328')
    expect(thread.textContent).toContain('buyer-agent · seller-scribe · verifier-agent')
  })

  it('shows @mentions and market verbs on each message', () => {
    render(<CoralView bus={bus} />)
    const mentions = screen.getAllByTestId('mention').map((el) => el.textContent)
    expect(mentions).toContain('@seller-scribe')
    expect(mentions).toContain('@buyer-agent')
    const msgs = screen.getAllByTestId('bus-msg')
    expect(msgs[0].textContent).toContain('WANT')
    expect(msgs[1].textContent).toContain('VERIFIED')
  })

  it('shows the roster with presence', () => {
    render(<CoralView bus={bus} />)
    expect(screen.getByTestId('roster').textContent).toContain('verifier-agent')
  })

  it('renders an empty state without a bus', () => {
    render(<CoralView />)
    expect(screen.getByTestId('bus-empty')).toBeTruthy()
  })
})
