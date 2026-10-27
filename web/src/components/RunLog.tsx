import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { useRunEvents } from '../api/hooks'
import type { RunEvent } from '../types/api'
import { fmtTime } from '../lib/format'
import { Chip, StatusBadge } from './badges'
import { Empty, Segmented, Spinner, Toggle } from './ui'
import { Markdown } from './Markdown'

type Filter = 'all' | 'prose' | 'tools'

function attemptLabel(a: number) {
  return a === 0 ? 'Main turn' : `Validation fix #${a}`
}

const ToolResult = memo(function ToolResult({ ev, expandAll }: { ev: RunEvent; expandAll: boolean }) {
  const [open, setOpen] = useState(false)
  const text = ev.text ?? ''
  const lines = text.split('\n')
  const preview = lines[0]?.slice(0, 160) ?? ''
  const multi = lines.length > 1 || (lines[0]?.length ?? 0) > 160
  const isOpen = open || expandAll
  return (
    <div
      className={clsx(
        'ml-4 border-l-2 pl-2',
        ev.ok === false ? 'border-neg/60' : 'border-pos/40',
      )}
    >
      <button
        className={clsx('flex w-full min-w-0 items-start gap-1 text-left font-mono text-[11px]', ev.ok === false ? 'text-neg' : 'text-muted')}
        onClick={() => setOpen((o) => !o)}
        disabled={!multi}
      >
        {multi && <span className={clsx('mt-px inline-block shrink-0 transition-transform', isOpen && 'rotate-90')}>▸</span>}
        <span className={clsx('min-w-0', !isOpen && 'truncate')}>{isOpen ? '' : preview || '(empty output)'}</span>
        {multi && !isOpen && <span className="shrink-0 text-faint">· {lines.length} lines</span>}
      </button>
      {isOpen && (
        <pre className="mt-0.5 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-sunken p-2 font-mono text-[11px] leading-snug text-fg/90">
          {text}
        </pre>
      )}
    </div>
  )
})

const ToolCall = memo(function ToolCall({ ev, expandAll }: { ev: RunEvent; expandAll: boolean }) {
  const [open, setOpen] = useState(false)
  const lines = (ev.text ?? '').split('\n')
  const long = lines.length > 8
  const shown = long && !open && !expandAll ? lines.slice(0, 8).join('\n') : ev.text
  return (
    <div className="flex min-w-0 items-start gap-1.5 pt-1">
      <Chip tone="neutral" className="shrink-0 font-mono">
        {ev.tool ?? 'tool'}
      </Chip>
      <div className="min-w-0">
        <code className="block whitespace-pre-wrap break-all font-mono text-[11px] text-fg/90">{shown}</code>
        {long && !expandAll && (
          <button className="text-2xs text-muted hover:text-fg" onClick={() => setOpen((o) => !o)}>
            {open ? 'collapse' : `… ${lines.length - 8} more lines`}
          </button>
        )}
      </div>
    </div>
  )
})

const Thinking = memo(function Thinking({ ev }: { ev: RunEvent }) {
  const [open, setOpen] = useState(false)
  const text = ev.text ?? ''
  const long = text.length > 280
  return (
    <div className="text-xs italic text-faint">
      <span className="mr-1 not-italic text-2xs uppercase tracking-wide">thinking</span>
      {long && !open ? text.slice(0, 280) + '… ' : text}
      {long && (
        <button className="not-italic text-muted hover:text-fg" onClick={() => setOpen((o) => !o)}>
          {open ? ' less' : 'more'}
        </button>
      )}
    </div>
  )
})

const EventRow = memo(function EventRow({ ev, expandAll }: { ev: RunEvent; expandAll: boolean }) {
  switch (ev.kind) {
    case 'status':
      return (
        <div className="my-2 flex items-center gap-2 text-2xs uppercase tracking-wide">
          <div className="h-px flex-1 bg-line" />
          <span className={clsx('font-semibold', ev.ok === true ? 'text-pos' : ev.ok === false ? 'text-neg' : 'text-muted')}>
            {ev.text}
          </span>
          <span className="text-faint">{fmtTime(ev.ts)}</span>
          <div className="h-px flex-1 bg-line" />
        </div>
      )
    case 'system':
      return <div className="font-mono text-[11px] text-faint">{ev.text}</div>
    case 'text':
      return (
        <div className="py-0.5 text-[13px] leading-relaxed text-fg">
          <Markdown className="prose-p:my-1 prose-ul:my-1 prose-pre:my-1">{ev.text ?? ''}</Markdown>
        </div>
      )
    case 'thinking':
      return <Thinking ev={ev} />
    case 'tool':
      return <ToolCall ev={ev} expandAll={expandAll} />
    case 'tool_result':
      return <ToolResult ev={ev} expandAll={expandAll} />
    case 'error':
      return (
        <div className="my-1 whitespace-pre-wrap break-words rounded border border-neg/40 bg-neg/5 px-2 py-1 font-mono text-[11px] text-neg">
          {ev.text}
        </div>
      )
    case 'result':
      return (
        <div
          className={clsx(
            'my-2 rounded border px-3 py-2',
            ev.ok === false ? 'border-neg/40 bg-neg/5' : 'border-pos/30 bg-pos/5',
          )}
        >
          <div className={clsx('label mb-1', ev.ok === false ? 'text-neg' : 'text-pos')}>Result</div>
          <Markdown className="prose-p:my-1 prose-ul:my-1 text-xs">{ev.text ?? ''}</Markdown>
        </div>
      )
    default:
      return <div className="font-mono text-[11px] text-muted">{ev.text}</div>
  }
})

export function RunLog({ vid, maxHeight = '70vh' }: { vid: string; maxHeight?: string }) {
  const { events, state, endStatus } = useRunEvents(vid)
  const [follow, setFollow] = useState(true)
  const [filter, setFilter] = useState<Filter>('all')
  const [expandAll, setExpandAll] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const visible = useMemo(
    () =>
      events.filter((e) => {
        if (filter === 'all') return true
        if (filter === 'prose') return ['text', 'status', 'result', 'error'].includes(e.kind)
        return ['tool', 'tool_result', 'status', 'error'].includes(e.kind)
      }),
    [events, filter],
  )

  const groups = useMemo(() => {
    const out: { attempt: number; events: RunEvent[] }[] = []
    for (const e of visible) {
      const a = e.attempt ?? 0
      const last = out[out.length - 1]
      if (last && last.attempt === a) last.events.push(e)
      else out.push({ attempt: a, events: [e] })
    }
    return out
  }, [visible])

  useLayoutEffect(() => {
    if (!follow || !box.current) return
    box.current.scrollTop = box.current.scrollHeight
  }, [visible.length, follow])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30
      setFollow(atBottom)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  const toolCount = events.filter((e) => e.kind === 'tool').length

  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
        <span className="label">Live log</span>
        {state === 'open' && (
          <span className="flex items-center gap-1 text-2xs text-pos">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pos" /> streaming
          </span>
        )}
        {state === 'connecting' && (
          <span className="flex items-center gap-1 text-2xs text-muted">
            <Spinner /> connecting
          </span>
        )}
        {state === 'error' && <span className="text-2xs text-warn">reconnecting…</span>}
        {state === 'ended' && (
          <span className="flex items-center gap-1 text-2xs text-muted">
            ended {endStatus && <StatusBadge status={endStatus} />}
          </span>
        )}
        <span className="num text-2xs text-faint">
          {events.length} events · {toolCount} tool calls
        </span>
        <div className="ml-auto flex items-center gap-3">
          <Segmented
            size="xs"
            options={[
              { id: 'all', label: 'All' },
              { id: 'prose', label: 'Prose' },
              { id: 'tools', label: 'Tools' },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <Toggle checked={expandAll} onChange={setExpandAll} label="expand output" />
          <Toggle checked={follow} onChange={setFollow} label="follow" />
        </div>
      </div>
      <div ref={box} className="overflow-y-auto px-3 py-2" style={{ maxHeight }}>
        {events.length === 0 ? (
          state === 'ended' ? (
            <Empty>No events were logged for this version.</Empty>
          ) : (
            <Empty>Waiting for events…</Empty>
          )
        ) : (
          groups.map((g, gi) => (
            <div key={gi} className="mb-2">
              {(gi === 0 || groups[gi - 1].attempt !== g.attempt) && (
                <div
                  className={clsx(
                    'sticky top-0 z-[1] -mx-3 mb-1 border-y border-line bg-sunken/95 px-3 py-0.5 text-2xs font-semibold uppercase tracking-wide backdrop-blur',
                    g.attempt === 0 ? 'text-muted' : 'text-warn',
                  )}
                >
                  {attemptLabel(g.attempt)}
                </div>
              )}
              <div className="space-y-0.5">
                {g.events.map((e) => (
                  <EventRow key={e.seq} ev={e} expandAll={expandAll} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
