/**
 * CoralMcpAgent — full MCP participant in CoralOS sessions.
 *
 * Mirrors exactly what coral_agent.py does in Python:
 *   connect → list_tools → loop(wait_for_mention → handler → send_message)
 *
 * Usage:
 *   const agent = new CoralMcpAgent({ connectionUrl: process.env.CORAL_CONNECTION_URL!, agentName: "my-ts-agent" })
 *   await agent.connect()
 *   await agent.runLoop(async (mention) => {
 *     // do work based on mention
 *     return `response to ${mention.sender}`
 *   })
 *
 * CoralOS docs (this file is the client for them):
 *   MCP interface           https://docs.coralos.ai/concepts/mcp
 *   Threads & mentions      https://docs.coralos.ai/concepts/threads
 *   Coordination (wait_*)   https://docs.coralos.ai/concepts/coordination
 *   Writing agents          https://docs.coralos.ai/guides/writing-agents
 * A whole-kit walkthrough of how this is wired in lives in /CORAL.md.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

export interface CoralMention {
  id?: string
  threadId?: string
  sender?: string
  text: string
}

export interface CoralMcpConfig {
  connectionUrl: string
  agentName: string
  version?: string
}

export class CoralMcpAgent {
  private client: Client | null = null
  private toolNames: { waitForMention: string; waitForAgent: string; sendMessage: string; createThread: string; closeThread: string } | null = null
  /** Mentions returned together by CoralOS are drained one-by-one on subsequent waits. */
  private pendingMentions: CoralMention[] = []
  private config: CoralMcpConfig
  /** Set by createThread() - lets closeThread() default to "whatever this agent last opened" on shutdown. */
  private lastThreadId: string | null = null

  constructor(config: CoralMcpConfig) {
    this.config = config
  }

  /**
   * Connect to CoralOS and discover tools. Must call before waitForMention/sendMessage.
   * @see https://docs.coralos.ai/concepts/mcp — the MCP interface + Streamable-HTTP transport.
   */
  async connect(): Promise<void> {
    this.client = new Client(
      {
        name: this.config.agentName,
        version: this.config.version ?? "1.0.0",
      },
      { capabilities: {} },
    )

    const transport = new StreamableHTTPClientTransport(
      new URL(this.config.connectionUrl),
    )

    await this.client.connect(transport)

    const toolsResult = await this.client.listTools()
    const names = toolsResult.tools.map((t) => t.name)
    console.error(`[coral-mcp] tools: ${names.join(", ")}`)

    this.toolNames = {
      waitForMention:
        names.find((n) => n.includes("wait_for_mention")) ??
        "coral_wait_for_mention",
      waitForAgent:
        names.find((n) => n.includes("wait_for_agent")) ??
        "coral_wait_for_agent",
      sendMessage:
        names.find((n) => n.endsWith("send_message")) ?? "coral_send_message",
      createThread:
        names.find((n) => n.includes("create_thread")) ?? "coral_create_thread",
      closeThread:
        names.find((n) => n.includes("close_thread")) ?? "coral_close_thread",
    }

    console.error(
      `[coral-mcp] using: wait=${this.toolNames.waitForMention} send=${this.toolNames.sendMessage}`,
    )
  }

  /**
   * Block until a mention arrives. Returns null on timeout (empty/null response).
   * maxWaitMs default 30 000 matches the Python agent.
   * @see https://docs.coralos.ai/concepts/coordination — server-side blocking waits.
   * @see https://docs.coralos.ai/concepts/threads — mentions are thread-scoped.
   */
  async waitForMention(maxWaitMs = 30_000): Promise<CoralMention | null> {
    const pending = this.pendingMentions.shift()
    if (pending) return pending
    if (!this.client || !this.toolNames) throw new Error("Not connected — call connect() first")

    const result = await this.client.callTool({
      name: this.toolNames.waitForMention,
      arguments: { maxWaitMs, currentUnixTime: Date.now() },
    })

    // Extract text from content array
    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join(" ")
      .trim()

    if (!text || text === "null" || text === "{}" || text === "[]") {
      return null
    }

    const mentions = parseMentions(text)
    const mention = mentions.shift()
    if (!mention?.text) return null
    this.pendingMentions.push(...mentions)
    return mention
  }

  /**
   * Like {@link waitForMention}, but only returns a mention in `threadId`; mentions in other threads
   * that arrive during the wait are skipped. Useful when one agent juggles several threads at once —
   * e.g. a broker that opens a quote thread with each seller and must correlate the replies.
   *
   * Returns null if no matching mention arrives before `maxWaitMs` elapses.
   * @see https://docs.coralos.ai/concepts/threads — one thread per conversation is how you correlate.
   */
  async waitForMentionInThread(threadId: string, maxWaitMs = 30_000): Promise<CoralMention | null> {
    const deadline = Date.now() + maxWaitMs
    while (Date.now() < deadline) {
      const remaining = Math.max(1000, Math.min(15_000, deadline - Date.now()))
      const mention = await this.waitForMention(remaining)
      if (mention && mention.threadId === threadId) return mention
    }
    return null
  }

  /**
   * Block until a message from a specific agent arrives (CoralOS `coral_wait_for_agent`).
   * Use this instead of a fixed `setTimeout` to wait for a counterparty (e.g. the seller)
   * to come online before sending it work. Returns null on timeout.
   *
   * Maps to `WaitForAgentMessageInput { agentName, maxWaitMs, currentUnixTime }` — see
   * coral-server `mcp/tools/WaitForMessageTools.kt`. `maxWaitMs` is server-capped at 60000.
   * @see https://docs.coralos.ai/concepts/coordination — presence + blocking coordination.
   */
  async waitForAgent(agentName: string, maxWaitMs = 30_000): Promise<CoralMention | null> {
    if (!this.client || !this.toolNames) throw new Error("Not connected — call connect() first")

    const result = await this.client.callTool({
      name: this.toolNames.waitForAgent,
      arguments: { agentName, maxWaitMs, currentUnixTime: Date.now() },
    })

    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join(" ")
      .trim()

    if (!text || text === "null" || text === "{}" || text === "[]") return null

    const mention = parseMention(text)
    if (!mention.text) return null
    return mention
  }

  /**
   * Send a message into a CoralOS thread. threadId and mentions are required by the API.
   * @see https://docs.coralos.ai/concepts/threads — thread messaging + @mentions.
   */
  async sendMessage(
    content: string,
    threadId: string,
    mentions: string[] = [],
  ): Promise<void> {
    if (!this.client || !this.toolNames) throw new Error("Not connected")

    await this.client.callTool({
      name: this.toolNames.sendMessage,
      arguments: { threadId, content, mentions },
    })
  }

  /**
   * Create a new CoralOS thread and return its ID.
   * @see https://docs.coralos.ai/concepts/threads — threads group participants + messages.
   */
  async createThread(threadName: string, participantNames: string[]): Promise<string> {
    if (!this.client || !this.toolNames) throw new Error("Not connected")

    const result = await this.client.callTool({
      name: this.toolNames.createThread,
      arguments: { threadName, participantNames },
    })

    const text = (result.content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join(" ")
      .trim()

    try {
      const data = JSON.parse(text) as Record<string, unknown>
      // CoralOS wraps: {"thread":{"id":"...","name":"...",...}}
      const thread = data.thread as Record<string, unknown> | undefined
      const id = (thread?.id as string) ?? (data.threadId as string) ?? (data.id as string) ?? text
      this.lastThreadId = id
      return id
    } catch {
      this.lastThreadId = text
      return text
    }
  }

  /**
   * Close a CoralOS thread — defaults to the last one this agent created, so a graceful shutdown
   * can call closeThread() with no argument and mark "done trading" rather than leaving the thread
   * looking abandoned to anything inspecting session state after the process exits. Best-effort:
   * swallows errors (a failed close should never block shutdown), and is a no-op if this agent never
   * created a thread (pure responders like seller-agent/verifier-agent - they never call this).
   * @see https://docs.coralos.ai/concepts/threads — threads group participants + messages.
   */
  async closeThread(threadId?: string): Promise<void> {
    const id = threadId ?? this.lastThreadId
    if (!id || !this.client || !this.toolNames) return
    try {
      await this.client.callTool({ name: this.toolNames.closeThread, arguments: { threadId: id } })
      if (id === this.lastThreadId) this.lastThreadId = null
    } catch (e) {
      console.error(`[coral-mcp] closeThread(${id}) failed (non-fatal): ${e}`)
    }
  }

  /**
   * Run the standard CoralOS loop:
   *   wait_for_mention → handler(mention) → send_message(response)
   *
   * Runs until signal is aborted or an unrecoverable error occurs.
   */
  async runLoop(
    handler: (mention: CoralMention) => Promise<string>,
    signal?: AbortSignal,
  ): Promise<void> {
    while (!signal?.aborted) {
      try {
        const mention = await this.waitForMention(30_000)

        if (!mention) {
          // Timeout — CoralOS returned empty, keep waiting
          continue
        }

        console.error(
          `[coral-mcp] mention from ${mention.sender ?? "unknown"} thread=${mention.threadId}`,
        )

        const response = await handler(mention)

        if (!mention.threadId) {
          console.error('[coral-mcp] mention has no threadId — cannot reply')
          continue
        }
        await this.sendMessage(
          response,
          mention.threadId,
          mention.sender ? [mention.sender] : [],
        )

        console.error(`[coral-mcp] responded: ${response.slice(0, 120)}`)
      } catch (e) {
        if (signal?.aborted) break
        console.error(`[coral-mcp] loop error: ${e} — retrying in 2s`)
        await new Promise((r) => setTimeout(r, 2_000))
      }
    }
  }

  async disconnect(): Promise<void> {
    await this.client?.close()
    this.client = null
    this.toolNames = null
  }
}

/**
 * Parse every mention in a CoralOS response. The server may coalesce concurrent messages into one
 * `messages` array; callers must not discard entries after the first.
 */
export function parseMentions(raw: string): CoralMention[] {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>
    if (data.status === "Timeout reached" || data.status === "timeout") return []
    if (Array.isArray(data.messages) && data.messages.length > 0) {
      return data.messages
        .map((value) => {
          const message = value as Record<string, unknown>
          return parseMention(JSON.stringify({
            ...message,
            threadId: message.threadId ?? message.thread_id ?? data.threadId ?? data.thread_id,
          }))
        })
        .filter((mention) => mention.text.length > 0)
    }
  } catch {
    // The single-mention parser handles non-JSON responses.
  }
  const mention = parseMention(raw)
  return mention.text ? [mention] : []
}

/**
 * Parse the JSON blob returned by coral_wait_for_mention.
 * Extracts threadId, sender, and the actual message text (not the JSON wrapper).
 */
export function parseMention(raw: string): CoralMention {
  let id: string | undefined
  let threadId: string | undefined
  let sender: string | undefined
  let messageText = raw // fallback to raw if not JSON

  try {
    const data: Record<string, unknown> = JSON.parse(raw)

    // Timeout response — caller should treat as null
    if (data.status === "Timeout reached" || data.status === "timeout") {
      return { threadId: undefined, sender: undefined, text: "" }
    }

    id = (data.id as string) ?? (data.messageId as string) ?? (data.message_id as string) ?? undefined
    threadId = (data.threadId as string) ?? (data.thread_id as string) ?? undefined
    sender =
      (data.senderName as string) ?? (data.sender as string) ??
      (data.senderId as string) ?? (data.from as string) ?? undefined

    // Nested messages list — current CoralOS format
    if (Array.isArray(data.messages) && data.messages.length > 0) {
      const m0 = data.messages[0] as Record<string, unknown>
      id = id ?? (m0.id as string) ?? (m0.messageId as string) ?? (m0.message_id as string) ?? undefined
      threadId = threadId ?? (m0.threadId as string) ?? (m0.thread_id as string) ?? undefined
      sender = sender ?? (m0.senderName as string) ?? (m0.sender as string) ??
        (m0.senderId as string) ?? undefined
      // Extract the actual message content
      messageText = (m0.text as string) ?? (m0.content as string) ?? raw
    }

    // Single message under "message" key
    if (data.message && typeof data.message === "object") {
      const m = data.message as Record<string, unknown>
      id = id ?? (m.id as string) ?? (m.messageId as string) ?? (m.message_id as string) ?? undefined
      threadId = threadId ?? (m.threadId as string) ?? (m.thread_id as string) ?? undefined
      sender = sender ?? (m.senderName as string) ?? (m.sender as string) ??
        (m.senderId as string) ?? undefined
      messageText = (m.text as string) ?? (m.content as string) ?? raw
    }

    // Flat message (text/content at top level)
    if (!messageText || messageText === raw) {
      messageText = (data.text as string) ?? (data.content as string) ?? raw
    }
  } catch {
    // Not JSON — use raw as message text
  }

  return { id, threadId, sender, text: messageText }
}
