import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import {
  useDebounced,
  useDeleteWhatif,
  usePromoteWhatif,
  useSaveWhatif,
  useWhatIf,
  useWhatifs,
} from '../../api/hooks'
import { ApiError } from '../../api/client'
import type { Dcf, DcfBridgeItem, DcfInput, Derived, Knobs, SavedWhatIf, VersionResponse } from '../../types/api'
import {
  fmtAny,
  fmtDateTime,
  fmtM,
  fmtMult,
  fmtNum,
  fmtPP,
  fmtPS,
  fmtPct,
  fmtPctSigned,
  fmtSignedPS,
  isNum,
  isPctUnit,
} from '../../lib/format'
import {
  baseScenario,
  bridgeIncluded,
  bridgePerShare,
  hasExitMultiple,
  headlineOf,
  mainTerminal,
  refPrice,
  scenarios,
  valuesEqual,
} from '../../lib/derive'
import { vLink } from '../../lib/links'
import { Chip, UpsideChip } from '../../components/badges'
import { Card, Empty, ErrorBox, Segmented, Spinner, Toggle, errorMessage } from '../../components/ui'
import { FootballField } from '../../components/FootballField'

/* ------------------------------------------------------------------ UI knob state */

interface UiKnobs {
  waccMode: 'shift' | 'abs'
  waccShift: number
  waccAbs: number | null
  gMode: 'shift' | 'abs'
  gShift: number
  gAbs: number | null
  exitMultiple: number | null
  bridge: Record<string, boolean>
  sharesMult: number
  revGrowthShift: number
  ebitMarginShift: number
  capexMult: number
  taxRate: number | null
}

const DEFAULT_UI: UiKnobs = {
  waccMode: 'shift',
  waccShift: 0,
  waccAbs: null,
  gMode: 'shift',
  gShift: 0,
  gAbs: null,
  exitMultiple: null,
  bridge: {},
  sharesMult: 1,
  revGrowthShift: 0,
  ebitMarginShift: 0,
  capexMult: 1,
  taxRate: null,
}

const eps = 1e-9

function uiToKnobs(u: UiKnobs): Knobs {
  const k: Knobs = {}
  if (u.waccMode === 'shift' && Math.abs(u.waccShift) > eps) k.wacc_shift = u.waccShift
  if (u.waccMode === 'abs' && isNum(u.waccAbs)) k.wacc = u.waccAbs
  if (u.gMode === 'shift' && Math.abs(u.gShift) > eps) k.g_shift = u.gShift
  if (u.gMode === 'abs' && isNum(u.gAbs)) k.g = u.gAbs
  if (isNum(u.exitMultiple)) k.exit_multiple = u.exitMultiple
  if (Object.keys(u.bridge).length) k.bridge = { ...u.bridge }
  if (Math.abs(u.sharesMult - 1) > eps) k.shares_mult = u.sharesMult
  if (Math.abs(u.revGrowthShift) > eps) k.rev_growth_shift = u.revGrowthShift
  if (Math.abs(u.ebitMarginShift) > eps) k.ebit_margin_shift = u.ebitMarginShift
  if (Math.abs(u.capexMult - 1) > eps) k.capex_intensity_mult = u.capexMult
  if (isNum(u.taxRate)) k.tax_rate = u.taxRate
  return k
}

function knobsToUi(k: Knobs | undefined): { ui: UiKnobs; dropped: string[] } {
  const u: UiKnobs = { ...DEFAULT_UI, bridge: {} }
  const dropped: string[] = []
  if (!k) return { ui: u, dropped }
  if (isNum(k.wacc_shift)) u.waccShift = k.wacc_shift
  if (k.wacc !== undefined) {
    if (isNum(k.wacc)) {
      u.waccMode = 'abs'
      u.waccAbs = k.wacc
    } else dropped.push('wacc (per-scenario)')
  }
  if (isNum(k.g_shift)) u.gShift = k.g_shift
  if (k.g !== undefined) {
    if (isNum(k.g)) {
      u.gMode = 'abs'
      u.gAbs = k.g
    } else dropped.push('g (per-scenario)')
  }
  if (isNum(k.exit_multiple)) u.exitMultiple = k.exit_multiple
  if (k.bridge && typeof k.bridge === 'object') u.bridge = { ...k.bridge }
  if (isNum(k.shares_mult)) u.sharesMult = k.shares_mult
  if (isNum(k.rev_growth_shift)) u.revGrowthShift = k.rev_growth_shift
  if (isNum(k.ebit_margin_shift)) u.ebitMarginShift = k.ebit_margin_shift
  if (isNum(k.capex_intensity_mult)) u.capexMult = k.capex_intensity_mult
  if (isNum(k.tax_rate)) u.taxRate = k.tax_rate
  return { ui: u, dropped }
}

/* ------------------------------------------------------------------ controls */

function decimalsOf(step: number): number {
  if (!isNum(step) || step <= 0) return 2
  const s = step.toString()
  if (s.includes('e-')) return Number(s.split('e-')[1])
  return s.includes('.') ? s.split('.')[1].length : 0
}

function snap(v: number, step: number | undefined, min?: number | null): number {
  if (!isNum(step) || step <= 0) return v
  const base = isNum(min) ? min : 0
  const n = Math.round((v - base) / step) * step + base
  return Number(n.toFixed(Math.min(10, decimalsOf(step) + 2)))
}

function NumInput({
  value,
  onChange,
  scale = 1,
  decimals = 2,
  disabled,
  className,
}: {
  value: number | null
  onChange: (v: number) => void
  scale?: number
  decimals?: number
  disabled?: boolean
  className?: string
}) {
  const fmt = (v: number | null) => (isNum(v) ? Number((v * scale).toFixed(decimals)).toString() : '')
  const [s, setS] = useState(fmt(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setS(fmt(value))
  }, [value, focused])
  return (
    <input
      className={clsx('input num w-[72px] px-1.5 text-right', className)}
      value={s}
      disabled={disabled}
      inputMode="decimal"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      onChange={(e) => {
        setS(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(n / scale)
      }}
    />
  )
}

function SliderRow({
  label,
  hint,
  value,
  defaultValue,
  min,
  max,
  step,
  pct,
  unit,
  onChange,
  disabled,
  highlight,
  format,
  extra,
}: {
  label: ReactNode
  hint?: string
  value: number
  defaultValue: number
  min: number
  max: number
  step: number
  pct?: boolean
  unit?: string
  onChange: (v: number) => void
  disabled?: boolean
  highlight?: boolean
  format?: (v: number) => string
  extra?: ReactNode
}) {
  const changed = Math.abs(value - defaultValue) > eps
  const scale = pct ? 100 : 1
  const dec = Math.max(0, decimalsOf(step * scale))
  return (
    <div
      className={clsx(
        'rounded px-2 py-1.5',
        highlight ? 'bg-accent/5 ring-1 ring-inset ring-accent/40' : changed ? 'bg-warn/5' : '',
        disabled && 'opacity-50',
      )}
      title={hint}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-xs leading-tight">{label}</div>
        {extra}
        {format && <span className="num w-20 text-right text-2xs text-muted">{format(value)}</span>}
        <NumInput value={value} onChange={(v) => onChange(v)} scale={scale} decimals={dec + 1} disabled={disabled} />
        <span className="w-8 text-2xs text-faint">{pct ? '%' : unit ?? ''}</span>
        <button
          className={clsx('w-4 text-xs', changed ? 'text-muted hover:text-fg' : 'invisible')}
          title="Reset"
          onClick={() => onChange(defaultValue)}
          disabled={disabled}
        >
          ↺
        </button>
      </div>
      <input
        type="range"
        className="mt-0.5 w-full"
        min={Math.min(min, value)}
        max={Math.max(max, value)}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(snap(Number(e.target.value), step, min))}
      />
    </div>
  )
}

function InputControl({
  input,
  value,
  onChange,
}: {
  input: DcfInput
  value: unknown
  onChange: (v: unknown) => void
}) {
  const def = input.value
  const changed = !valuesEqual(value, def)
  const pct = isPctUnit(input.unit)
  const label = (
    <span className="inline-flex items-center gap-1">
      {input.decisive && <span className="text-accent" title="Decisive driver">★</span>}
      <span className={clsx(input.decisive && 'font-semibold')}>{input.label ?? input.key}</span>
      {input.expected_sign && input.expected_sign !== '?' && (
        <span className="text-2xs text-faint" title={`Raising this should ${input.expected_sign === '+' ? 'raise' : 'lower'} value`}>
          ({input.expected_sign})
        </span>
      )}
      {input.scope && !(input.scope.length === 1 && input.scope[0] === 'all') && (
        <span className="text-2xs text-faint">[{input.scope.join(',')}]</span>
      )}
    </span>
  )
  const hint = [input.key, input.description].filter(Boolean).join(' — ')

  if (input.type === 'bool') {
    return (
      <div className={clsx('flex items-center gap-2 rounded px-2 py-1.5', input.decisive && 'bg-accent/5 ring-1 ring-inset ring-accent/40', changed && !input.decisive && 'bg-warn/5')} title={hint}>
        <div className="min-w-0 flex-1 text-xs leading-tight">{label}</div>
        <Toggle checked={!!value} onChange={onChange} />
        <button className={clsx('w-4 text-xs', changed ? 'text-muted hover:text-fg' : 'invisible')} onClick={() => onChange(def)} title="Reset">
          ↺
        </button>
      </div>
    )
  }
  if (input.type === 'enum') {
    return (
      <div className={clsx('flex items-center gap-2 rounded px-2 py-1.5', input.decisive && 'bg-accent/5 ring-1 ring-inset ring-accent/40', changed && !input.decisive && 'bg-warn/5')} title={hint}>
        <div className="min-w-0 flex-1 text-xs leading-tight">{label}</div>
        <select className="input" value={String(value)} onChange={(e) => {
          const opt = (input.options ?? []).find((o) => String(o) === e.target.value)
          onChange(opt ?? e.target.value)
        }}>
          {(input.options ?? []).map((o) => (
            <option key={String(o)} value={String(o)}>
              {fmtAny(o)}
            </option>
          ))}
        </select>
        <button className={clsx('w-4 text-xs', changed ? 'text-muted hover:text-fg' : 'invisible')} onClick={() => onChange(def)} title="Reset">
          ↺
        </button>
      </div>
    )
  }
  const v = isNum(value) ? value : isNum(def) ? def : 0
  const d = isNum(def) ? def : 0
  const min = isNum(input.min) ? input.min : Math.min(v, d) - Math.abs(d || 1) * 0.5
  const max = isNum(input.max) ? input.max : Math.max(v, d) + Math.abs(d || 1) * 0.5
  const step = isNum(input.step) && input.step > 0 ? input.step : input.type === 'int' ? 1 : (max - min) / 100
  return (
    <SliderRow
      label={label}
      hint={hint}
      value={v}
      defaultValue={d}
      min={min}
      max={max}
      step={step}
      pct={pct}
      unit={pct ? undefined : input.unit}
      highlight={!!input.decisive}
      onChange={(n) => onChange(input.type === 'int' ? Math.round(n) : n)}
    />
  )
}

/* ------------------------------------------------------------------ results */

function MetricDelta({ label, a, b, fmt }: { label: string; a: unknown; b: unknown; fmt: (v: unknown) => string }) {
  const changed = isNum(a) && isNum(b) ? Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a)) : a !== b
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line/50 py-0.5 text-xs">
      <span className="text-muted">{label}</span>
      <span className="num">
        {changed ? (
          <>
            <span className="text-faint">{fmt(a)}</span> → <b>{fmt(b)}</b>
          </>
        ) : (
          <span className="text-muted">{fmt(b)}</span>
        )}
      </span>
    </div>
  )
}

function Results({
  dcf,
  orig,
  res,
  loading,
  error,
  changed,
  layers,
  grade,
  anchored,
  warnings,
  newDcf,
  comparePrice,
}: {
  dcf: Dcf
  orig: Derived
  res: Derived | null
  loading: boolean
  error: unknown
  changed: boolean
  layers: string[]
  grade?: string | null
  anchored?: boolean
  warnings: string[]
  newDcf: Dcf | null
  comparePrice: number | null
}) {
  const ccy = orig.quote_currency ?? dcf.listing?.quote_currency ?? 'USD'
  const cur = res ?? orig
  const price = refPrice(orig, comparePrice)
  const hlA = headlineOf(orig)
  const hlB = headlineOf(cur)
  const dHl = isNum(hlA) && isNum(hlB) ? hlB - hlA : null
  const scnA = scenarios(dcf)
  const scnB = newDcf ? scenarios(newDcf) : scnA
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-stretch gap-2">
        <div className="min-w-[220px] flex-1 rounded border border-line bg-panel px-3 py-2">
          <div className="label flex items-center gap-2">
            Headline value / share {loading && <Spinner />}
          </div>
          <div className="num mt-0.5 flex items-baseline gap-2">
            <span className="text-sm text-faint line-through decoration-faint/50">{changed ? fmtPS(hlA, ccy) : ''}</span>
            <span className={clsx('text-2xl font-semibold', isNum(hlB) && hlB < 0 && 'text-neg')}>{fmtPS(hlB, ccy)}</span>
            {changed && isNum(dHl) && (
              <span className={clsx('text-sm font-semibold', dHl > 0 ? 'text-pos' : dHl < 0 ? 'text-neg' : 'text-muted')}>
                {fmtSignedPS(dHl, ccy)} ({isNum(hlA) && hlA ? fmtPctSigned(dHl / Math.abs(hlA)) : '—'})
              </span>
            )}
          </div>
        </div>
        <div className="rounded border border-line bg-panel px-3 py-2">
          <div className="label">Upside vs {comparePrice ? 'compare' : 'model'} price</div>
          <div className="mt-1 flex items-center gap-2">
            <UpsideChip value={isNum(hlB) && isNum(price) && price ? hlB / price - 1 : null} className="text-sm" />
            <span className="num text-2xs text-muted">{fmtPS(price, ccy)}</span>
          </div>
        </div>
        <div className="rounded border border-line bg-panel px-3 py-2 text-2xs text-muted">
          <div className="label">Engine</div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {changed ? (
              layers.length ? (
                layers.map((l) => (
                  <Chip key={l} tone={l === 'B' ? 'pos' : 'accent'} title={l === 'B' ? "model's own build(overrides)" : 'dcfkit overlay'}>
                    Layer {l}
                  </Chip>
                ))
              ) : (
                <span>—</span>
              )
            ) : (
              <span>original</span>
            )}
            {grade && <Chip tone={grade === 'exact' ? 'muted' : 'warn'}>grade {grade}</Chip>}
            {anchored && <Chip tone="warn">anchored deltas</Chip>}
          </div>
        </div>
      </div>

      {error ? <ErrorBox error={error} title="Recompute failed" /> : null}
      {warnings.length > 0 && (
        <div className="space-y-1">
          {warnings.map((w, i) => (
            <div key={i} className="rounded border border-warn/40 bg-warn/5 px-2 py-1 text-xs text-warn">
              {w}
            </div>
          ))}
        </div>
      )}

      <Card title="Scenarios">
        <table className="tbl">
          <thead>
            <tr>
              <th>Scenario</th>
              <th className="n">Prob.</th>
              <th className="n">Original</th>
              <th className="n">What-if</th>
              <th className="n">Δ</th>
              <th className="n">Δ %</th>
              <th className="n">Upside</th>
            </tr>
          </thead>
          <tbody>
            {scnA.map((a) => {
              const b = scnB.find((x) => x.id === a.id) ?? a
              const va = a.results?.value_per_share
              const vb = b.results?.value_per_share
              const dv = isNum(va) && isNum(vb) ? vb - va : null
              return (
                <tr key={a.id}>
                  <td className="font-medium">{a.label ?? a.id}</td>
                  <td className="n text-muted">{fmtPct(a.probability, 0)}</td>
                  <td className="n text-muted">{fmtPS(va, ccy)}</td>
                  <td className={clsx('n font-semibold', isNum(vb) && vb < 0 && 'text-neg')}>{fmtPS(vb, ccy)}</td>
                  <td className={clsx('n', isNum(dv) && Math.abs(dv) > 0.005 && (dv > 0 ? 'text-pos' : 'text-neg'))}>{changed ? fmtSignedPS(dv, ccy) : ''}</td>
                  <td className="n">{changed && isNum(dv) && isNum(va) && va ? fmtPctSigned(dv / Math.abs(va)) : ''}</td>
                  <td className="n">
                    <UpsideChip value={isNum(vb) && isNum(price) && price ? vb / price - 1 : null} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>

      <Card title="Range" bodyClassName="px-3 py-2">
        <FootballField
          labelWidth={110}
          ccy={ccy}
          price={price}
          priceLabel={comparePrice ? 'Compare' : 'Price'}
          rows={[
            {
              key: 'orig',
              label: <span className="text-muted">Original</span>,
              color: 'rgb(var(--muted))',
              bear: orig.value_ps?.bear,
              base: orig.value_ps?.base,
              bull: orig.value_ps?.bull,
              pw: orig.value_ps?.pw,
              headline: headlineOf(orig),
            },
            {
              key: 'new',
              label: <span className="font-semibold text-accent">What-if</span>,
              color: 'rgb(var(--accent))',
              bear: cur.value_ps?.bear,
              base: cur.value_ps?.base,
              bull: cur.value_ps?.bull,
              pw: cur.value_ps?.pw,
              headline: headlineOf(cur),
            },
          ]}
        />
      </Card>

      <Card title="Base-case metrics" bodyClassName="grid grid-cols-1 gap-x-6 px-3 py-2 md:grid-cols-2">
        <MetricDelta label="EV ($M)" a={orig.ev} b={cur.ev} fmt={fmtM} />
        <MetricDelta label="Equity ($M)" a={orig.equity} b={cur.equity} fmt={fmtM} />
        <MetricDelta label="WACC" a={orig.wacc} b={cur.wacc} fmt={(v) => fmtPct(v, 2)} />
        <MetricDelta label="Terminal g" a={orig.g} b={cur.g} fmt={(v) => fmtPct(v, 2)} />
        <MetricDelta label="TV % EV" a={orig.tv_pct_ev} b={cur.tv_pct_ev} fmt={(v) => fmtPct(v)} />
        <MetricDelta label="Implied exit EV/EBITDA" a={orig.implied_exit_ev_ebitda} b={cur.implied_exit_ev_ebitda} fmt={(v) => fmtMult(v)} />
        <MetricDelta label="Revenue CAGR" a={orig.rev_cagr} b={cur.rev_cagr} fmt={(v) => fmtPct(v)} />
        <MetricDelta label="Terminal EBIT margin" a={orig.terminal_ebit_margin} b={cur.terminal_ebit_margin} fmt={(v) => fmtPct(v)} />
        <MetricDelta label="Terminal capex / D&A" a={orig.terminal_capex_da} b={cur.terminal_capex_da} fmt={(v) => fmtMult(v, 2)} />
        <MetricDelta label="Shares used (M)" a={orig.shares_used} b={cur.shares_used} fmt={(v) => fmtNum(v, 1)} />
      </Card>
    </div>
  )
}

/* ------------------------------------------------------------------ saved what-ifs */

function SavedList({
  vid,
  ticker,
  knobs,
  overrides,
  changed,
  onApply,
  ccy,
}: {
  vid: string
  ticker?: string
  knobs: Knobs
  overrides: Record<string, unknown>
  changed: boolean
  onApply: (w: SavedWhatIf) => void
  ccy: string
}) {
  const q = useWhatifs(vid)
  const save = useSaveWhatif(vid)
  const del = useDeleteWhatif(vid)
  const promote = usePromoteWhatif(vid, ticker)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const body = { name: name.trim(), knobs, overrides, note: note.trim() || undefined }
  const promoteErr =
    promote.error instanceof ApiError && (promote.error.status === 404 || promote.error.status === 405)
      ? 'Promote is not available on this server yet (needs a backend restart).'
      : promote.error
        ? errorMessage(promote.error)
        : null

  return (
    <Card title="Saved what-ifs">
      <div className="space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input w-48" placeholder="Name (e.g. Bear margins)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input min-w-[160px] flex-1" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button
            className="btn"
            disabled={!changed || !name.trim() || save.isPending}
            onClick={() => save.mutate(body, { onSuccess: () => setName('') })}
            title={changed ? 'Save the current knobs/overrides' : 'Change a control first'}
          >
            {save.isPending && <Spinner />}Save what-if
          </button>
          <button
            className="btn"
            disabled={!changed || !name.trim() || promote.isPending}
            onClick={() => promote.mutate(body)}
            title="Create a new app_edit version of this model with these changes (validated)"
          >
            {promote.isPending && <Spinner />}Promote to version
          </button>
        </div>
        <ErrorBox error={save.error} title="Save failed" />
        {promoteErr && <ErrorBox error={promoteErr} title="Promote" />}
        {promote.data && (
          <div className="rounded border border-pos/30 bg-pos/5 px-2 py-1 text-xs">
            Created{' '}
            <Link className="link font-mono" to={vLink(promote.data.version_id)}>
              {promote.data.version_id}
            </Link>
            {promote.data.validation && (
              <span className="ml-2 text-muted">validation: {promote.data.validation.ok ? 'ok' : 'failed'}</span>
            )}
          </div>
        )}
      </div>
      {q.isLoading ? null : q.error ? (
        <ErrorBox error={q.error} className="m-2" />
      ) : (q.data ?? []).length === 0 ? (
        <Empty className="py-3">No saved what-ifs.</Empty>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Name</th>
              <th className="n">Headline</th>
              <th>Changes</th>
              <th>Saved</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((w) => {
              const parts = [
                ...Object.entries(w.knobs ?? {}).map(([k, v]) => `${k}=${fmtAny(v)}`),
                ...Object.entries(w.overrides ?? {}).map(([k, v]) => `${k}=${fmtAny(v)}`),
              ]
              return (
                <tr key={w.slug}>
                  <td>
                    <div className="font-medium">{w.name}</div>
                    {w.note && <div className="text-2xs text-muted">{w.note}</div>}
                  </td>
                  <td className="n font-semibold">{fmtPS(headlineOf(w.derived), w.derived?.quote_currency ?? ccy)}</td>
                  <td className="max-w-[260px] truncate font-mono text-2xs text-muted" title={parts.join('\n')}>
                    {(w.layers ?? []).map((l) => `[${l}]`).join('')} {parts.join(', ')}
                  </td>
                  <td className="text-2xs text-faint">{fmtDateTime(w.created_at)}</td>
                  <td className="whitespace-nowrap text-right">
                    <button className="btn btn-ghost" onClick={() => onApply(w)}>
                      Apply
                    </button>
                    <button
                      className="btn btn-ghost text-neg"
                      disabled={del.isPending}
                      onClick={() => {
                        if (window.confirm(`Delete saved what-if "${w.name}"?`)) del.mutate(w.slug)
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <ErrorBox error={del.error} className="m-2" />
    </Card>
  )
}

/* ------------------------------------------------------------------ main */

function Section({ title, children, note }: { title: ReactNode; children: ReactNode; note?: ReactNode }) {
  return (
    <div className="border-b border-line pb-2 last:border-b-0">
      <div className="flex items-baseline justify-between px-2 pb-1 pt-2">
        <div className="label">{title}</div>
        {note && <div className="text-2xs text-faint">{note}</div>}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

export function WhatIfTab({ vid, data, dcf }: { vid: string; data: VersionResponse; dcf: Dcf }) {
  const summary = data.summary
  const repro = summary?.reproducibility ?? data.validation?.reproduction?.grade ?? null
  const hasPy = !!summary?.has_model_py
  const inputs = (dcf.inputs ?? []) as DcfInput[]
  const bridgeItems = (dcf.bridge ?? []) as DcfBridgeItem[]
  const base = baseScenario(dcf)
  const baseWacc = base?.discounting?.wacc ?? 0.09
  const baseG = mainTerminal(base)?.g ?? 0.025
  const exitDefault = (() => {
    for (const s of dcf.scenarios ?? [])
      for (const c of s?.components ?? []) if (c?.terminal?.method === 'exit_multiple' && isNum(c.terminal.multiple)) return c.terminal.multiple
    return null
  })()
  const opDisabled = repro === 'none'
  const orig: Derived = dcf.derived ?? summary?.derived ?? {}
  const ccy = orig.quote_currency ?? dcf.listing?.quote_currency ?? 'USD'
  const comparePrice = isNum(orig.compare_price) ? orig.compare_price : null

  const [ui, setUi] = useState<UiKnobs>({ ...DEFAULT_UI, bridge: {} })
  const [overrides, setOverrides] = useState<Record<string, unknown>>({})
  const [applyNote, setApplyNote] = useState<string | null>(null)
  const set = <K extends keyof UiKnobs>(k: K, v: UiKnobs[K]) => setUi((u) => ({ ...u, [k]: v }))

  const knobs = useMemo(() => uiToKnobs(ui), [ui])
  const changed = Object.keys(knobs).length > 0 || Object.keys(overrides).length > 0
  const body = useMemo(() => (changed ? { knobs, overrides } : null), [changed, knobs, overrides])
  const debounced = useDebounced(body, 300)
  const q = useWhatIf(vid, debounced)
  const pending = JSON.stringify(body) !== JSON.stringify(debounced)
  const res = changed && q.data && !q.isError ? q.data : null

  const groups = useMemo(() => {
    const m = new Map<string, DcfInput[]>()
    for (const i of inputs) {
      const g = i.group ?? 'drivers'
      if (!m.has(g)) m.set(g, [])
      m.get(g)!.push(i)
    }
    // decisive groups first
    return [...m.entries()].sort(([, a], [, b]) => Number(b.some((i) => i.decisive)) - Number(a.some((i) => i.decisive)))
  }, [inputs])

  const resetAll = () => {
    setUi({ ...DEFAULT_UI, bridge: {} })
    setOverrides({})
    setApplyNote(null)
  }

  const apply = (w: SavedWhatIf) => {
    const { ui: u, dropped } = knobsToUi(w.knobs)
    setUi(u)
    setOverrides({ ...(w.overrides ?? {}) })
    setApplyNote(dropped.length ? `Applied "${w.name}" — not representable in the controls: ${dropped.join(', ')}` : `Applied "${w.name}"`)
  }

  const setOverride = (key: string, v: unknown, def: unknown) =>
    setOverrides((o) => {
      const n = { ...o }
      if (valuesEqual(v, def)) delete n[key]
      else n[key] = v
      return n
    })

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(380px,460px)_1fr]">
      {/* controls */}
      <div className="space-y-3">
        <Card
          title="Controls"
          actions={
            <button className="btn btn-ghost" onClick={resetAll} disabled={!changed}>
              Reset all
            </button>
          }
          bodyClassName="max-h-[calc(100vh-180px)] overflow-y-auto px-1 pb-1"
        >
          {applyNote && <div className="mx-2 mt-2 rounded bg-sunken px-2 py-1 text-2xs text-muted">{applyNote}</div>}

          {/* Layer B */}
          {hasPy && inputs.length > 0 ? (
            groups.map(([g, list]) => (
              <Section key={g} title={`Model inputs · ${g}`} note={g === groups[0][0] ? 'Layer B — model.build(overrides)' : undefined}>
                {list.map((inp) => (
                  <InputControl
                    key={inp.key}
                    input={inp}
                    value={inp.key && inp.key in overrides ? overrides[inp.key] : inp.value}
                    onChange={(v) => inp.key && setOverride(inp.key, v, inp.value)}
                  />
                ))}
              </Section>
            ))
          ) : (
            <div className="mx-2 mt-2 rounded border border-line bg-sunken px-2 py-1.5 text-2xs text-muted">
              {!hasPy
                ? 'No model.py for this version: model-specific inputs (Layer B) are unavailable — use the overlay knobs below.'
                : 'This model declares no inputs[].'}
            </div>
          )}

          {/* Layer A: discounting */}
          <Section title="Discounting (Layer A, exact)" note={opDisabled ? 'disabled: not reproducible' : undefined}>
            <SliderRow
              label={
                <span className="inline-flex items-center gap-2">
                  WACC
                  <Segmented
                    size="xs"
                    options={[
                      { id: 'shift', label: 'shift' },
                      { id: 'abs', label: 'absolute' },
                    ]}
                    value={ui.waccMode}
                    onChange={(m) => setUi((u) => ({ ...u, waccMode: m, waccAbs: m === 'abs' ? u.waccAbs ?? baseWacc : u.waccAbs }))}
                  />
                </span>
              }
              hint={ui.waccMode === 'shift' ? 'Added to every scenario WACC' : 'Absolute WACC for every scenario'}
              value={ui.waccMode === 'shift' ? ui.waccShift : ui.waccAbs ?? baseWacc}
              defaultValue={ui.waccMode === 'shift' ? 0 : baseWacc}
              min={ui.waccMode === 'shift' ? -0.03 : 0.04}
              max={ui.waccMode === 'shift' ? 0.03 : 0.2}
              step={0.0025}
              pct
              format={(v) => (ui.waccMode === 'shift' ? fmtPP(v) : `base ${fmtPct(baseWacc, 2)}`)}
              onChange={(v) => (ui.waccMode === 'shift' ? set('waccShift', v) : set('waccAbs', Math.abs(v - baseWacc) < eps ? null : v))}
              disabled={opDisabled}
            />
            <SliderRow
              label={
                <span className="inline-flex items-center gap-2">
                  Terminal g
                  <Segmented
                    size="xs"
                    options={[
                      { id: 'shift', label: 'shift' },
                      { id: 'abs', label: 'absolute' },
                    ]}
                    value={ui.gMode}
                    onChange={(m) => setUi((u) => ({ ...u, gMode: m, gAbs: m === 'abs' ? u.gAbs ?? baseG : u.gAbs }))}
                  />
                </span>
              }
              value={ui.gMode === 'shift' ? ui.gShift : ui.gAbs ?? baseG}
              defaultValue={ui.gMode === 'shift' ? 0 : baseG}
              min={ui.gMode === 'shift' ? -0.02 : -0.01}
              max={ui.gMode === 'shift' ? 0.02 : 0.05}
              step={0.0025}
              pct
              format={(v) => (ui.gMode === 'shift' ? fmtPP(v) : `base ${fmtPct(baseG, 2)}`)}
              onChange={(v) => (ui.gMode === 'shift' ? set('gShift', v) : set('gAbs', Math.abs(v - baseG) < eps ? null : v))}
              disabled={opDisabled}
            />
            {hasExitMultiple(dcf) && (
              <SliderRow
                label="Exit multiple"
                value={ui.exitMultiple ?? exitDefault ?? 10}
                defaultValue={exitDefault ?? 10}
                min={2}
                max={40}
                step={0.5}
                unit="×"
                onChange={(v) => set('exitMultiple', Math.abs(v - (exitDefault ?? 10)) < eps ? null : v)}
                disabled={opDisabled}
              />
            )}
          </Section>

          {/* Layer A: bridge & shares */}
          <Section title="Bridge & shares (Layer A, exact)">
            {bridgeItems.length === 0 && <div className="px-2 text-2xs text-faint">No bridge items.</div>}
            {bridgeItems.map((it) => {
              if (!it.id) return null
              const def = bridgeIncluded(it, base)
              const cur = it.id in ui.bridge ? ui.bridge[it.id] : def
              const ps = bridgePerShare(dcf, it, base)
              return (
                <div
                  key={it.id}
                  className={clsx('flex items-center gap-2 rounded px-2 py-1', it.debatable && 'bg-warn/5 ring-1 ring-inset ring-warn/30')}
                  title={it.rationale ?? undefined}
                >
                  <Toggle
                    checked={cur}
                    onChange={(v) =>
                      setUi((u) => {
                        const b = { ...u.bridge }
                        if (v === def) delete b[it.id!]
                        else b[it.id!] = v
                        return { ...u, bridge: b }
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {it.label}
                    {it.debatable && <Chip tone="warn" className="ml-1">debatable</Chip>}
                  </span>
                  <span className={clsx('num text-2xs', (it.equity_effect ?? 0) < 0 ? 'text-neg' : 'text-pos')}>{fmtM(it.equity_effect)}</span>
                  <span className="num w-16 text-right text-2xs text-muted" title="per share">
                    {fmtSignedPS(ps, ccy)}
                  </span>
                </div>
              )
            })}
            <SliderRow
              label="Share count multiplier"
              value={ui.sharesMult}
              defaultValue={1}
              min={0.8}
              max={1.3}
              step={0.01}
              unit="×"
              format={(v) => fmtPctSigned(v - 1)}
              onChange={(v) => set('sharesMult', v)}
            />
          </Section>

          {/* Layer A: generic overlay */}
          <Section title="Generic overlay (approximate)" note={opDisabled ? 'disabled: not reproducible' : 'applied from year 2'}>
            {opDisabled && (
              <div className="mx-2 mb-1 rounded bg-sunken px-2 py-1 text-2xs text-muted">
                The engine cannot reproduce this model (reproducibility “none”), so WACC / g / operating overlays are disabled. Bridge and
                share-count knobs still work.
              </div>
            )}
            <SliderRow
              label="Revenue growth shift"
              value={ui.revGrowthShift}
              defaultValue={0}
              min={-0.1}
              max={0.1}
              step={0.005}
              pct
              format={(v) => fmtPP(v, 1)}
              onChange={(v) => set('revGrowthShift', v)}
              disabled={opDisabled}
            />
            <SliderRow
              label="EBIT margin shift"
              value={ui.ebitMarginShift}
              defaultValue={0}
              min={-0.1}
              max={0.1}
              step={0.005}
              pct
              format={(v) => fmtPP(v, 1)}
              onChange={(v) => set('ebitMarginShift', v)}
              disabled={opDisabled}
            />
            <SliderRow
              label="Capex intensity ×"
              value={ui.capexMult}
              defaultValue={1}
              min={0.5}
              max={1.5}
              step={0.05}
              unit="×"
              format={(v) => fmtPctSigned(v - 1, 0)}
              onChange={(v) => set('capexMult', v)}
              disabled={opDisabled}
            />
            <div className={clsx('flex items-center gap-2 px-2 pt-1', opDisabled && 'opacity-50')}>
              <Toggle
                checked={isNum(ui.taxRate)}
                disabled={opDisabled}
                onChange={(v) => set('taxRate', v ? base?.tax?.rate ?? 0.21 : null)}
                label={<span className="text-xs">Override tax rate</span>}
              />
            </div>
            {isNum(ui.taxRate) && (
              <SliderRow
                label="Tax rate"
                value={ui.taxRate}
                defaultValue={base?.tax?.rate ?? 0.21}
                min={0}
                max={0.4}
                step={0.01}
                pct
                onChange={(v) => set('taxRate', v)}
                disabled={opDisabled}
              />
            )}
          </Section>
        </Card>
      </div>

      {/* results */}
      <div className="space-y-3 lg:sticky lg:top-14 lg:self-start">
        {!changed && (
          <div className="rounded border border-line bg-sunken px-3 py-1.5 text-xs text-muted">
            Adjust a control to recompute live (debounced). Values below are the model's own.
          </div>
        )}
        {changed && (
          <div className="flex flex-wrap items-center gap-1 text-2xs text-muted">
            <span className="label mr-1">Sending</span>
            {Object.entries(knobs).map(([k, v]) => (
              <Chip key={k} tone="accent">
                {k}={typeof v === 'object' ? JSON.stringify(v) : fmtAny(v)}
              </Chip>
            ))}
            {Object.entries(overrides).map(([k, v]) => (
              <Chip key={k} tone="pos">
                {k}={fmtAny(v)}
              </Chip>
            ))}
          </div>
        )}
        <Results
          dcf={dcf}
          orig={orig}
          res={res?.derived ?? null}
          newDcf={res?.dcf ?? null}
          loading={changed && (pending || q.isFetching)}
          error={changed ? q.error : null}
          changed={changed}
          layers={res?.layers ?? []}
          grade={res?.grade}
          anchored={res?.anchored}
          warnings={res?.warnings ?? []}
          comparePrice={comparePrice}
        />
        <SavedList vid={vid} ticker={summary?.ticker} knobs={knobs} overrides={overrides} changed={changed} onApply={apply} ccy={ccy} />
      </div>
    </div>
  )
}
