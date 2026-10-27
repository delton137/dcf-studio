import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { useRefreshScreener, useScreenerSectors, useScreenerStatus, useUniverses } from '../../api/hooks'
import type { FieldDef, JobStatus, ScreenParams } from '../../types/screener'
import { fmtAge, fmtDateTime, fmtInt, isNum } from '../../lib/format'
import { DEFAULT_COLS } from '../../lib/screener'
import { ErrorBox, Spinner } from '../../components/ui'
import { Popover } from './FilterBuilder'

/* ------------------------------------------------------------------ universe */

export function UniversePicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const u = useUniverses()
  const sec = useScreenerSectors()
  const bySector = useMemo(() => {
    const m = new Map<string, { name: string; count: number }[]>()
    for (const i of sec.data?.industries ?? []) {
      if (i.name === '—') continue
      const sector = i.sector === '—' ? 'No sector' : i.sector
      const a = m.get(sector) ?? []
      a.push(i)
      m.set(sector, a)
    }
    for (const a of m.values()) a.sort((x, y) => x.name.localeCompare(y.name))
    return m
  }, [sec.data])
  const builtin = u.data?.builtin ?? [
    { id: 'us1b', name: 'US filers ≥ $1B', desc: '' },
    { id: 'all', name: 'All US listings', desc: '' },
    { id: 'models', name: 'My DCF models', desc: '' },
  ]
  const known =
    builtin.some((b) => b.id === value) ||
    (u.data?.lists ?? []).some((l) => `list:${l.slug}` === value) ||
    (sec.data?.sectors ?? []).some((s) => `sector:${s.name}` === value) ||
    (sec.data?.industries ?? []).some((s) => `industry:${s.name}` === value)
  return (
    <select
      className="input max-w-[260px] font-medium"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={builtin.find((b) => b.id === value)?.desc || 'Universe: the set of stocks the filters run over'}
    >
      {!known && <option value={value}>{value}</option>}
      <optgroup label="Universe">
        {builtin.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </optgroup>
      {(u.data?.lists ?? []).length > 0 && (
        <optgroup label="Lists">
          {(u.data?.lists ?? []).map((l) => (
            <option key={l.slug} value={`list:${l.slug}`}>
              {l.name} ({l.count}){l.kind === 'agent' ? ' · agent' : ''}
            </option>
          ))}
        </optgroup>
      )}
      {(sec.data?.sectors ?? []).length > 0 && (
        <optgroup label="Sectors">
          {/* "—" is the server's bucket for listings without a sector; `sector:—` cannot match them */}
          {(sec.data?.sectors ?? []).filter((s) => s.name !== '—').map((s) => (
            <option key={s.name} value={`sector:${s.name}`}>
              {s.name} ({fmtInt(s.count)})
            </option>
          ))}
        </optgroup>
      )}
      {[...bySector.entries()].map(([sector, inds]) => (
        <optgroup key={sector} label={`${sector} — industries`}>
          {inds.map((i) => (
            <option key={i.name} value={`industry:${i.name}`}>
              {i.name} ({fmtInt(i.count)})
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}

/* ------------------------------------------------------------------ reverse-DCF params */

function PctInput({
  label,
  title,
  value,
  isDefault,
  onCommit,
}: {
  label: string
  title: string
  value: number
  isDefault: boolean
  onCommit: (v: number | null) => void
}) {
  const fmt = (v: number) => String(Number((v * 100).toPrecision(6)))
  const [text, setText] = useState(fmt(value))
  useEffect(() => setText(fmt(value)), [value])
  const commit = () => {
    const n = Number(text.trim().replace('%', ''))
    if (text.trim() === '' || !Number.isFinite(n)) {
      setText(fmt(value))
      return
    }
    const v = Number((n / 100).toPrecision(10))
    if (v !== value) onCommit(v)
  }
  return (
    <label className="flex items-center gap-1" title={title}>
      <span className="text-muted">{label}</span>
      <input
        className={clsx('input num w-12 px-1 py-0.5 text-right', !isDefault && 'border-accent text-accent')}
        value={text}
        inputMode="decimal"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
      <span className="text-faint">%</span>
    </label>
  )
}

export function ParamsEditor({
  params,
  defaults,
  onChange,
}: {
  params: Partial<ScreenParams> | undefined
  defaults: ScreenParams | undefined
  onChange: (p: Partial<ScreenParams> | undefined) => void
}) {
  const d = defaults ?? { r: 0.1, g_t: 0.025, target_margin: 0.15 }
  const eff = { r: params?.r ?? d.r, g_t: params?.g_t ?? d.g_t, target_margin: params?.target_margin ?? d.target_margin }
  const custom = !!params && Object.keys(params).length > 0
  const set = (k: 'r' | 'g_t' | 'target_margin', v: number | null) => {
    const next: Partial<ScreenParams> = { ...(params ?? {}) }
    if (v === null || v === d[k]) delete next[k]
    else next[k] = v
    onChange(Object.keys(next).length ? next : undefined)
  }
  return (
    <div className="flex items-center gap-2 rounded border border-line bg-panel px-2 py-0.5 text-2xs" title="Reverse-DCF-lite parameters (changing them recomputes implied growth for every row)">
      <span className="label">Reverse DCF</span>
      <PctInput label="r" title="Discount rate" value={eff.r} isDefault={params?.r === undefined} onCommit={(v) => set('r', v)} />
      <PctInput label="g_T" title="Terminal growth" value={eff.g_t} isDefault={params?.g_t === undefined} onCommit={(v) => set('g_t', v)} />
      <PctInput
        label="tgt FCF m."
        title="Target FCF margin by year 10 (cash-burners: implied revenue CAGR)"
        value={eff.target_margin}
        isDefault={params?.target_margin === undefined}
        onCommit={(v) => set('target_margin', v)}
      />
      {custom && (
        <button className="text-faint hover:text-fg" title="Reset to defaults" onClick={() => onChange(undefined)}>
          ↺
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ data status / refresh */

/** server/screener/refresh.py STAGES (the status' `done` counter is only set at start/end). */
const STAGES = ['listings', 'tickers', 'frames', 'fundamentals', 'earnings', 'table']

export function DataStatus() {
  const st = useScreenerStatus()
  const refresh = useRefreshScreener()
  const [menu, setMenu] = useState(false)
  const s = st.data
  const running = s?.state === 'running'
  const pct =
    running && isNum(s?.frames_total) && s!.frames_total! > 0 && s?.stage === 'frames'
      ? Math.round((100 * (s!.frames_done ?? 0)) / s!.frames_total!)
      : null
  const stale = s?.table_asof ? (Date.now() - new Date(s.table_asof).getTime()) / 3600000 > 24 : false
  return (
    <div className="flex items-center gap-1.5 text-2xs">
      {running ? (
        <span className="flex items-center gap-1.5 rounded border border-accent/40 bg-accent/5 px-2 py-0.5 text-accent" title={s?.detail ?? ''}>
          <Spinner className="border-accent/30 border-t-accent" />
          <span className="font-medium">Refreshing: {s?.stage ?? '…'}</span>
          {s?.stage && STAGES.includes(s.stage) && (
            <span className="num text-muted">
              {STAGES.indexOf(s.stage) + 1}/{STAGES.length}
            </span>
          )}
          {s?.stage === 'frames' && isNum(s?.frames_total) && (
            <span className="num">
              frames {s!.frames_done ?? 0}/{s!.frames_total}
              {pct !== null ? ` (${pct}%)` : ''}
            </span>
          )}
          {s?.detail && <span className="max-w-[220px] truncate text-muted">{s.detail}</span>}
        </span>
      ) : (
        <span
          className={clsx('num', stale ? 'text-warn' : 'text-muted')}
          title={`table as of ${fmtDateTime(s?.table_asof)}${s?.last_ok ? `\nlast successful refresh ${fmtDateTime(s.last_ok)}` : ''}${s?.detail ? `\n${s.detail}` : ''}`}
        >
          data {s?.table_asof ? `${fmtAge(s.table_asof)} old` : '—'} · {fmtInt(s?.table_rows)} listings
        </span>
      )}
      {s?.state === 'error' && (
        <span className="max-w-[260px] truncate rounded bg-neg/10 px-1.5 py-0.5 text-neg" title={s.error ?? ''}>
          refresh failed: {s.error}
        </span>
      )}
      <Popover
        open={menu}
        onClose={() => setMenu(false)}
        align="right"
        width="w-[280px]"
        anchor={
          <button className="btn px-2 py-0.5" disabled={running || refresh.isPending} onClick={() => setMenu(true)}>
            {refresh.isPending && <Spinner />}
            Refresh data ▾
          </button>
        }
      >
        <div className="space-y-1 p-2 text-xs">
          <button
            className="block w-full rounded px-2 py-1 text-left hover:bg-sunken"
            onClick={() => {
              refresh.mutate(false)
              setMenu(false)
            }}
          >
            <div className="font-medium">Refresh</div>
            <div className="text-2xs text-muted">Rebuild the table: Nasdaq listings &amp; prices (reused if &lt; 6 h old), SEC XBRL frames, earnings calendar</div>
          </button>
          <button
            className="block w-full rounded px-2 py-1 text-left hover:bg-sunken"
            onClick={() => {
              refresh.mutate(true)
              setMenu(false)
            }}
          >
            <div className="font-medium">Force refresh</div>
            <div className="text-2xs text-muted">Same, but re-fetch Nasdaq listings &amp; prices now even if cached</div>
          </button>
        </div>
      </Popover>
      {refresh.error ? <ErrorBox error={refresh.error} title="Refresh" className="py-0.5" /> : null}
      {refresh.data && !refresh.data.started && !running && <span className="text-warn">a refresh is already running</span>}
    </div>
  )
}

/* ------------------------------------------------------------------ job progress (enrich / refine) */

export function JobProgress({ name, job }: { name: string; job: JobStatus | undefined }) {
  if (!job) return null
  const running = job.state === 'running'
  const errs = job.errors ?? []
  if (!running && !errs.length && !job.finished_at) return null
  return (
    <span
      className={clsx('num inline-flex items-center gap-1 text-2xs', running ? 'text-accent' : errs.length ? 'text-warn' : 'text-muted')}
      title={errs.length ? `${errs.length} error(s):\n${errs.join('\n')}` : job.finished_at ? `finished ${fmtDateTime(job.finished_at)}` : ''}
    >
      {running && <Spinner className="border-accent/30 border-t-accent" />}
      {name} {running ? `${job.done ?? 0}/${job.total ?? '?'}` : `done ${fmtAge(job.finished_at)} ago`}
      {errs.length > 0 && ` · ${errs.length} err`}
    </span>
  )
}

/* ------------------------------------------------------------------ column chooser */

export function ColumnChooser({
  fields,
  groups,
  cols,
  onChange,
}: {
  fields: FieldDef[]
  groups: string[]
  cols: string[]
  onChange: (cols: string[] | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const set = new Set(cols)
  const toggle = (k: string) => {
    if (k === 'symbol') return
    const next = set.has(k) ? cols.filter((c) => c !== k) : [...cols, k]
    onChange(next)
  }
  const isDefault = cols.length === DEFAULT_COLS.length && DEFAULT_COLS.every((c) => set.has(c))
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="right"
      width="w-[520px]"
      anchor={
        <button className="btn px-2 py-0.5" onClick={() => setOpen((o) => !o)}>
          Columns ({cols.length}) ▾
        </button>
      }
    >
      <div className="p-3 text-xs">
        <div className="mb-2 flex items-center gap-2">
          <span className="label">Visible columns</span>
          <button className="ml-auto text-2xs text-accent hover:underline disabled:text-faint disabled:no-underline" disabled={isDefault} onClick={() => onChange(undefined)}>
            Reset to defaults
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {groups.map((g) => (
            <div key={g}>
              <div className="mb-0.5 flex items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-faint">{g}</span>
                <button
                  className="text-[10px] text-faint hover:text-fg"
                  onClick={() => {
                    const keys = fields.filter((f) => f.group === g).map((f) => f.key)
                    const all = keys.every((k) => set.has(k))
                    onChange(all ? cols.filter((c) => !keys.includes(c) || c === 'symbol') : [...cols, ...keys.filter((k) => !set.has(k))])
                  }}
                >
                  all/none
                </button>
              </div>
              {fields
                .filter((f) => f.group === g)
                .map((f) => (
                  <label key={f.key} className={clsx('flex items-center gap-1.5 py-px', f.key === 'symbol' ? 'opacity-60' : 'cursor-pointer')} title={f.desc}>
                    <input type="checkbox" checked={set.has(f.key)} disabled={f.key === 'symbol'} onChange={() => toggle(f.key)} />
                    {f.label}
                  </label>
                ))}
            </div>
          ))}
        </div>
      </div>
    </Popover>
  )
}
