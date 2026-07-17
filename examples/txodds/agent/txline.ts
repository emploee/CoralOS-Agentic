/**
 * TxLineClient — a small, dependency-free client for TxODDS' **TxLINE** oracle.
 *
 * Scope: the *data-access* half of TxLINE (fixtures / odds / scores for the free World Cup &
 * International Friendlies tier). The one-time on-chain subscription that mints the API token is an
 * operator setup step (see ../README.md "One-time setup"), deliberately kept out of the agent's hot
 * path so the runtime stays devnet-pure: the agent only ever holds the resulting `TXLINE_API_KEY`.
 *
 * Verified against the live devnet deployment (2026-06):
 *   - devnet API host:  https://txline-dev.txodds.com   (NOT the repo's stale `oracle-dev.txodds.com`)
 *   - devnet program:   6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J
 *   - free tier:        service level 1 — World Cup & Int Friendlies (on-chain price 0)
 *
 * Every data call needs BOTH a public guest JWT (Authorization: Bearer) and the activated API token
 * (X-Api-Token). The client fetches the guest JWT lazily and caches it.
 */

const DEVNET_BASE = 'https://txline-dev.txodds.com'

export interface TxLineOptions {
  /** API base. Defaults to `TXLINE_BASE_URL` env, else the devnet host. */
  baseUrl?: string
  /** Activated API token from the one-time subscribe+activate. Defaults to `TXLINE_API_KEY`. */
  apiToken?: string
}

/** A fixture as returned by `/api/fixtures/snapshot`. */
export interface Fixture {
  FixtureId: number
  CompetitionId: number
  Competition: string
  Participant1: string
  Participant2: string
  Participant1IsHome: boolean
  StartTime: string
}

export class TxLineClient {
  private readonly baseUrl: string
  private readonly apiToken: string | undefined
  private jwt: string | undefined

  constructor(opts: TxLineOptions = {}) {
    this.baseUrl = opts.baseUrl || process.env.TXLINE_BASE_URL || DEVNET_BASE
    this.apiToken = opts.apiToken ?? process.env.TXLINE_API_KEY
  }

  /** Public guest JWT — required on every call alongside the activated API token. Cached. */
  private async guestJwt(): Promise<string> {
    if (this.jwt) return this.jwt
    const res = await fetch(`${this.baseUrl}/auth/guest/start`, { method: 'POST' })
    if (!res.ok) throw new Error(`txline guest auth failed: ${res.status}`)
    this.jwt = ((await res.json()) as { token: string }).token
    return this.jwt
  }

  private async get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    if (!this.apiToken) {
      throw new Error('TXLINE_API_KEY not set — run the one-time subscribe+activate (see ../README.md)')
    }
    const jwt = await this.guestJwt()
    const qs = params
      ? '?' + new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
      : ''
    const res = await fetch(`${this.baseUrl}${path}${qs}`, {
      headers: { Authorization: `Bearer ${jwt}`, 'X-Api-Token': this.apiToken },
    })
    if (!res.ok) throw new Error(`txline ${path} -> ${res.status}: ${(await res.text()).slice(0, 140)}`)
    return (await res.json()) as T
  }

  /** Upcoming fixtures. Omit `competitionId` for the whole subscribed bundle. */
  fixtures(competitionId?: number): Promise<Fixture[]> {
    return this.get<Fixture[]>('/api/fixtures/snapshot', competitionId ? { competitionId } : undefined)
  }

  /** De-margined StablePrice odds snapshot for one fixture (verified: fixtureId is a path segment). */
  odds(fixtureId: number): Promise<unknown> {
    return this.get<unknown>(`/api/odds/snapshot/${fixtureId}`)
  }

  /** Score events snapshot for one fixture. */
  scores(fixtureId: number): Promise<unknown> {
    return this.get<unknown>(`/api/scores/snapshot/${fixtureId}`)
  }
}

/** International Friendlies — the highest-volume free-tier competition (verified in the catalog). */
export const FRIENDLIES_COMPETITION_ID = 430
