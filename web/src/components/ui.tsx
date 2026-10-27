import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError } from '../api/client'

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={clsx('inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-muted/40 border-t-fg', className)}
      aria-label="loading"
    />
  )
}

export function Loading({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={clsx('flex items-center gap-2 px-3 py-6 text-xs text-muted', className)}>
      <Spinner /> {label}
    </div>
  )
}

export function errorMessage(err: unknown): string {
  if (!err) return ''
  if (err instanceof ApiError) return err.status ? `${err.status}: ${err.message}` : err.message
  if (err instanceof Error) return err.message
  return String(err)
}

export function ErrorBox({ error, title = 'Error', className }: { error: unknown; title?: string; className?: string }) {
  if (!error) return null
  return (
    <div className={clsx('rounded border border-neg/40 bg-neg/5 px-3 py-2 text-xs text-neg', className)}>
      <span className="font-semibold">{title}: </span>
      <span className="whitespace-pre-wrap break-words">{errorMessage(error)}</span>
    </div>
  )
}

export function Empty({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('px-3 py-6 text-center text-xs text-faint', className)}>{children}</div>
}

/** Render loading / error states for a query, else children(data). */
export function QueryView<T>({
  q,
  children,
  loadingLabel,
}: {
  q: { data: T | undefined; isLoading: boolean; error: unknown }
  children: (data: T) => ReactNode
  loadingLabel?: string
}) {
  if (q.isLoading) return <Loading label={loadingLabel} />
  if (q.error && q.data === undefined) return <ErrorBox error={q.error} />
  if (q.data === undefined) return <Empty>No data</Empty>
  return <>{children(q.data)}</>
}

export function Card({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={clsx('card', className)}>
      {(title || actions) && (
        <header className="card-h">
          <div className="flex min-w-0 items-center gap-2">{title}</div>
          {actions && <div className="flex items-center gap-1.5 normal-case tracking-normal">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

export function KV({ rows, className }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={clsx('grid grid-cols-[minmax(110px,max-content)_1fr] gap-x-4 gap-y-1 text-xs', className)}>
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Stat({
  label,
  value,
  sub,
  className,
  valueClassName,
  style,
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  className?: string
  valueClassName?: string
  style?: React.CSSProperties
}) {
  return (
    <div className={clsx('min-w-[96px] rounded border border-line bg-panel px-2.5 py-1.5', className)} style={style}>
      <div className="label">{label}</div>
      <div className={clsx('num text-base font-semibold leading-6', valueClassName)}>{value}</div>
      {sub !== undefined && <div className="num text-2xs text-muted">{sub}</div>}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
  title,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label?: ReactNode
  title?: string
}) {
  return (
    <label
      className={clsx('inline-flex cursor-pointer select-none items-center gap-1.5 text-xs', disabled && 'cursor-not-allowed opacity-50')}
      title={title}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative h-4 w-7 shrink-0 rounded-full border transition-colors',
          checked ? 'border-accent bg-accent' : 'border-line bg-sunken',
        )}
      >
        <span
          className={clsx(
            'absolute top-[1px] h-3 w-3 rounded-full bg-white shadow transition-all',
            checked ? 'left-[13px]' : 'left-[1px]',
          )}
        />
      </button>
      {label}
    </label>
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { id: T; label: ReactNode; hidden?: boolean }[]
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={clsx('flex gap-0.5 overflow-x-auto border-b border-line', className)}>
      {tabs
        .filter((t) => !t.hidden)
        .map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={clsx(
              '-mb-px whitespace-nowrap border-b-2 px-3 py-1.5 text-xs font-medium transition-colors',
              value === t.id ? 'border-fg text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
    </div>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'sm',
}: {
  options: { id: T; label: ReactNode; title?: string }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'xs'
}) {
  return (
    <div className="inline-flex rounded border border-line bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={clsx(
            'rounded-[3px] font-medium transition-colors',
            size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-px text-2xs',
            value === o.id ? 'bg-panel text-fg shadow-sm' : 'text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Re-render every `ms` (for elapsed clocks / ages). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** Measure an element's width (ResizeObserver) through a callback ref. */
export function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [w, setW] = useState(0)
  const ro = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: T | null) => {
    ro.current?.disconnect()
    ro.current = null
    if (!el) return
    setW(el.getBoundingClientRect().width)
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setW(e.contentRect.width)
    })
    obs.observe(el)
    ro.current = obs
  }, [])
  return [ref, w]
}

export function Collapsible({
  title,
  children,
  defaultOpen = false,
  className,
}: {
  title: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={className}>
      <button className="flex items-center gap-1 text-xs text-muted hover:text-fg" onClick={() => setOpen((o) => !o)}>
        <span className={clsx('inline-block transition-transform', open && 'rotate-90')}>▸</span>
        {title}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  )
}

export function Dash() {
  return <span className="text-faint">—</span>
}

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('font-mono text-[11px]', className)}>{children}</span>
}
