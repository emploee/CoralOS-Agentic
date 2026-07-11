import type { RawMessage } from './foldRounds.js'

/**
 * Extract structure from a CoralOS session's *extended state* — WITHOUT flattening it away.
 *
 * Shape (verified against real devnet output, see tests/coral-session.json):
 *   { agents: [ { name, status:{type} } ],
 *     threads: [ { id, name, creatorName, participants, messages: [
 *       { threadId, senderName, text, mentionNames, timestamp } ] } ] }
 *
 * `collectMessages` keeps the thread id + mentions + timestamp on each message (a superset of the
 * `{sender, text}` the fold needs) so the UI's bus view and the run ledger's transcript can show
 * the actual Coral mechanics — who mentioned whom, on which thread, when.
 *
 * Kept defensive about alternative key names so a coral-server version bump degrades gracefully.
 */

/** One Coral message with its bus context. Assignable to RawMessage — the fold ignores the rest. */
export interface BusMessage extends RawMessage {
  threadId?: string
  mentions?: string[]
  timestamp?: string
}

export interface BusThread {
  id: string
  name?: string
  creator?: string
  participants: string[]
  messages: BusMessage[]
}

export interface SessionAgent {
  name: string
  /** coral-server's status.type, e.g. "running". */
  status?: string
}

type Rec = Record<string, unknown>

const threadsOf = (state: unknown): Rec[] => {
  const root = state as Rec
  return ((root?.threads ?? (root?.session as Rec)?.threads) as Rec[] | undefined) ?? []
}

function toBusMessage(m: Rec): BusMessage | null {
  const sender = (m.senderName ?? m.sender ?? m.senderId ?? 'unknown') as string
  const text = (m.text ?? m.content ?? '') as string
  if (!text) return null
  const threadId = (m.threadId ?? m.thread_id) as string | undefined
  const mentions = (m.mentionNames ?? m.mentions) as string[] | undefined
  const timestamp = (m.timestamp ?? m.createdAt) as string | undefined
  return {
    sender, text,
    ...(threadId ? { threadId } : {}),
    ...(Array.isArray(mentions) && mentions.length ? { mentions } : {}),
    ...(timestamp ? { timestamp } : {}),
  }
}

/** Every message across every thread, in coral's order — with its bus context attached. */
export function collectMessages(state: unknown): BusMessage[] {
  const out: BusMessage[] = []
  for (const thread of threadsOf(state)) {
    for (const m of ((thread.messages as Rec[]) ?? [])) {
      const msg = toBusMessage(m)
      if (msg) out.push(msg)
    }
  }
  return out
}

/** The session's threads with participants — the bus view's data. */
export function collectThreads(state: unknown): BusThread[] {
  return threadsOf(state).map((t) => ({
    id: (t.id ?? '') as string,
    ...(t.name ? { name: t.name as string } : {}),
    ...(t.creatorName ? { creator: t.creatorName as string } : {}),
    participants: ((t.participants as string[]) ?? []),
    messages: (((t.messages as Rec[]) ?? []).map(toBusMessage).filter(Boolean) as BusMessage[]),
  }))
}

/** The session's agent roster (name + running status). */
export function collectAgents(state: unknown): SessionAgent[] {
  const root = state as Rec
  const agents = ((root?.agents ?? (root?.session as Rec)?.agents) as Rec[] | undefined) ?? []
  return agents.map((a) => ({
    name: (a.name ?? (a.registryAgentIdentifier as Rec)?.name ?? 'unknown') as string,
    ...(((a.status as Rec)?.type) ? { status: (a.status as Rec).type as string } : {}),
  }))
}
