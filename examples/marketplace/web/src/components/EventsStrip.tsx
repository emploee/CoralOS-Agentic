import type { WatcherEvent } from '../types'

/** The research trigger, visible: queued odds events waiting to become paid WANTs. */
export function EventsStrip({ events }: { events: WatcherEvent[] }) {
  if (events.length === 0) return null
  return (
    <div className="events" data-testid="events">
      <span className="events-label">watcher queue:</span>
      {events.map((e, i) => (
        <span key={i} className="event" data-kind={e.kind}>
          {e.kind === 'odds-move' ? '▲' : '●'} {e.note}
        </span>
      ))}
    </div>
  )
}
