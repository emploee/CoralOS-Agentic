import { useEffect, useState } from 'react'
import { getFeed, type FeedMsg } from '../api'

/** Poll the autonomous buyer⇄seller conversation while `active`. */
export function useFeed(active: boolean) {
  const [messages, setMessages] = useState<FeedMsg[]>([])
  useEffect(() => {
    if (!active) return
    let stop = false
    const tick = async () => {
      try {
        const f = await getFeed()
        if (!stop && f.messages) setMessages(f.messages)
      } catch {
        /* transient — keep polling */
      }
    }
    void tick()
    const id = setInterval(tick, 2500)
    return () => {
      stop = true
      clearInterval(id)
    }
  }, [active])
  return messages
}
