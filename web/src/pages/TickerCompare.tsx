import { useMemo, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { useCompare, useConfig, usePutPrice, useRefreshPrices, useTicker } from '../api/hooks'
import { SOURCES, type Dcf, type DcfReverse, type Source, type VersionSummary } from '../types/api'
import {
  fmtAge,
  fmtDate,
  fmtM,
  fmtMult,
  fmtNum,
  fmtPS,
  fmtPct,
  fmtPctSigned,
  fmtSmart,
  isNum,
  shortVid,
  titleCase,
} from '../lib/format'
import {
  actualRows,
  baseScenario,
  divergence,
  headlineOf,
  projectedRows,
  rowMetric,
  rowTime,
  upsideOf,
  type DivergenceRule,
  type MetricKey,
} from '../lib/derive'
import { SOURCE_LABEL, seriesStyle } from '../lib/sources'
import { tLink, vLink } from '../lib/links'
import { Chip, LegacyBadge, QualityBadge, ReproBadge, SourceBadge, StatusBadge, UpsideChip } from '../components/badges'
import { Card, Empty, ErrorBox, Loading, Spinner, errorMessage } from '../components/ui'
import { FootballField, type FFRow } from '../components/FootballField'
import { OverlayChart, type OverlaySeries } from '../components/OverlayChart'
import { useRunLauncher } from '../components/RunLauncher'

interface Model {
  id: string
  summary: VersionSummary | null
  dcf: Dcf
  source: string
  color: string
  dash?: string
  label: string
  sub: string
}

/* ------------------------------------------------------------------ version picker */

function VersionPicker({
  versions,
  selected,
  onChange,
  onReset,
}: {
  versions: VersionSummary[]
  selected: string[]
  onChange: (ids: string[]) => void
  onReset: () => void
}) {
  const [open, setOpen] = useState(false)
  const sel = new Set(selected)
  const withDcf = versions.filter((v) => v.has_dcf)
  return (
    <div className="relative">
      <button className="btn" onClick={() => setOpen((o) => !o)}>
        Versions ({selected.length}/{withDcf.length}) ▾
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="card absolute right-0 z-30 mt-1 max-h-[60vh] w-[560px] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
              <span className="label">Pick versions to compare</span>
              <button className="btn btn-ghost" onClick={onReset}>
                Latest per source
              </button>
            </div>
            <table className="tbl">
              <tbody>
                {withDcf.map((v) => (
                  <tr key={v.version_id}>
                    <td className="w-6">
                      <input
                        type="checkbox"
                        checked={sel.has(v.version_id)}
                        onChange={() =>
                          onChange(sel.has(v.version_id) ? selected.filter((x) => x !== v.version_id) : [...selected, v.version_id])
                        }
                      />
                    </td>
                    <td>
                      <SourceBadge source={v.source} />
                    </td>
                    <td className="num text-2xs">{fmtDate(v.as_of)}</td>
                    <td className="font-mono text-2xs text-muted" title={v.version_id}>
                      {shortVid(v.version_id)}
                    </td>
                    <td className="n">{fmtPS(headlineOf(v.derived), v.derived?.quote_currency)}</td>
                    <td>
                      <div className="flex gap-1">
                        {v.latest && <Chip tone="pos">latest</Chip>}
                        {v.superseded && <Chip tone="muted">superseded</Chip>}
                        <LegacyBadge origin={v.origin} />
                        {v.status !== 'valid' && <StatusBadge status={v.status} />}
                      </div>
                    </td>
                  </tr>
                ))}
                {withDcf.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-faint">
                      No versions with a model yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ price editor */

function PriceBox({ ticker, quote }: { ticker: string; quote?: { price?: number | null; ts?: string | null; source?: string | null } | null }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')
  const put = usePutPrice(ticker)
  const refresh = useRefreshPrices()
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="label">Compare price</span>
      {editing ? (
        <>
          <input
            className="input w-24"
            autoFocus
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && Number(val) > 0) put.mutate(Number(val), { onSuccess: () => setEditing(false) })
              if (e.key === 'Escape') setEditing(false)
            }}
          />
          <button
            className="btn"
            disabled={!(Number(val) > 0) || put.isPending}
            onClick={() => put.mutate(Number(val), { onSuccess: () => setEditing(false) })}
          >
            Set
          </button>
          <button className="btn btn-ghost" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="num text-sm font-semibold">{fmtPS(quote?.price)}</span>
          {quote?.ts && (
            <span className="text-2xs text-faint" title={`${quote.source ?? ''} ${quote.ts}`}>
              {quote.source === 'manual' ? 'manual · ' : ''}
              {fmtAge(quote.ts)} ago
            </span>
          )}
          <button
            className="btn btn-ghost px-1.5"
            title="Refresh this ticker's price"
            onClick={() => refresh.mutate([ticker])}
            disabled={refresh.isPending}
          >
            {refresh.isPending ? <Spinner /> : '↻'}
          </button>
          <button
            className="btn btn-ghost px-1.5"
            title="Manual price override"
            onClick={() => {
              setVal(quote?.price ? String(quote.price) : '')
              setEditing(true)
            }}
          >
            ✎
          </button>
        </>
      )}
      {(put.error || refresh.error) && <span className="text-neg">{errorMessage(put.error || refresh.error)}</span>}
      {refresh.data && (refresh.data[ticker] as { error?: string } | undefined)?.error && (
        <span className="text-warn">{(refresh.data[ticker] as { error?: string }).error}</span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ metrics table */

interface MetricDef {
  key: string
  label: string
  value: (m: Model) => number | null | undefined
  render: (m: Model) => ReactNode
  rule?: DivergenceRule
  group: string
}

function d(m: Model) {
  return m.summary?.derived ?? m.dcf.derived ?? {}
}

function negCls(v: unknown) {
  return isNum(v) && v < 0 ? 'text-neg' : undefined
}

const METRICS: MetricDef[] = [
  {
    group: 'Value per share',
    key: 'headline',
    label: 'Headline',
    value: (m) => headlineOf(d(m)),
    render: (m) => <b className={negCls(headlineOf(d(m)))}>{fmtPS(headlineOf(d(m)), d(m).quote_currency)}</b>,
    rule: { kind: 'rel', thr: 0.2 },
  },
  ...(['bear', 'base', 'bull', 'pw'] as const).map(
    (k): MetricDef => ({
      group: 'Value per share',
      key: k,
      label: k === 'pw' ? 'Prob-weighted' : titleCase(k),
      value: (m) => d(m).value_ps?.[k],
      render: (m) => <span className={negCls(d(m).value_ps?.[k])}>{fmtPS(d(m).value_ps?.[k], d(m).quote_currency)}</span>,
      rule: { kind: 'rel', thr: 0.2 },
    }),
  ),
  {
    group: 'Value per share',
    key: 'upside',
    label: 'Upside vs price',
    value: (m) => upsideOf(d(m)).value,
    render: (m) => {
      const u = upsideOf(d(m))
      return (
        <span className="inline-flex items-center gap-1">
          <UpsideChip value={u.value} />
          {u.basis === 'model' && <span className="text-2xs text-faint" title="vs model's own price">m</span>}
        </span>
      )
    },
    rule: { kind: 'abs', thr: 0.25 },
  },
  {
    group: 'Value per share',
    key: 'price_model',
    label: 'Model price (as-of)',
    value: (m) => d(m).price_model,
    render: (m) => (
      <span>
        {fmtPS(d(m).price_model, d(m).quote_currency)} <span className="text-2xs text-faint">{fmtDate(d(m).price_ts)}</span>
      </span>
    ),
  },
  {
    group: 'Discounting',
    key: 'wacc',
    label: 'WACC (base)',
    value: (m) => d(m).wacc,
    render: (m) => fmtPct(d(m).wacc, 2),
    rule: { kind: 'abs', thr: 0.01 },
  },
  {
    group: 'Discounting',
    key: 'g',
    label: 'Terminal g',
    value: (m) => d(m).g,
    render: (m) => fmtPct(d(m).g, 2),
    rule: { kind: 'abs', thr: 0.0075 },
  },
  {
    group: 'Discounting',
    key: 'terminal_method',
    label: 'Terminal method',
    value: () => null,
    render: (m) => <span className="text-muted">{d(m).terminal_method?.replace(/_/g, ' ') ?? '—'}</span>,
  },
  {
    group: 'Discounting',
    key: 'tv_pct_ev',
    label: 'TV % of EV',
    value: (m) => d(m).tv_pct_ev,
    render: (m) => fmtPct(d(m).tv_pct_ev),
    rule: { kind: 'abs', thr: 0.15 },
  },
  {
    group: 'Discounting',
    key: 'implied_exit',
    label: 'Implied exit EV/EBITDA',
    value: (m) => d(m).implied_exit_ev_ebitda,
    render: (m) => fmtMult(d(m).implied_exit_ev_ebitda),
    rule: { kind: 'rel', thr: 0.25 },
  },
  {
    group: 'Discounting',
    key: 'ev_ebitda_y1',
    label: 'EV / EBITDA (yr 1)',
    value: (m) => d(m).ev_ebitda_y1,
    render: (m) => fmtMult(d(m).ev_ebitda_y1),
    rule: { kind: 'rel', thr: 0.25 },
  },
  {
    group: 'Operations',
    key: 'rev_cagr',
    label: 'Revenue CAGR',
    value: (m) => d(m).rev_cagr,
    render: (m) => (
      <span>
        {fmtPct(d(m).rev_cagr)}
        {isNum(d(m).horizon_years) && <span className="text-2xs text-faint"> · {d(m).horizon_years}y</span>}
      </span>
    ),
    rule: { kind: 'abs', thr: 0.03 },
  },
  {
    group: 'Operations',
    key: 'term_margin',
    label: 'Terminal EBIT margin',
    value: (m) => d(m).terminal_ebit_margin,
    render: (m) => (
      <span>
        {fmtPct(d(m).terminal_ebit_margin)}
        {d(m).margin_basis && <span className="text-2xs text-faint"> · {d(m).margin_basis}</span>}
      </span>
    ),
    rule: { kind: 'abs', thr: 0.05 },
  },
  {
    group: 'Operations',
    key: 'capex_da',
    label: 'Terminal capex / D&A',
    value: (m) => d(m).terminal_capex_da,
    render: (m) => fmtMult(d(m).terminal_capex_da, 2),
    rule: { kind: 'abs', thr: 0.15 },
  },
  {
    group: 'Operations',
    key: 'yr1_rev',
    label: 'Yr-1 revenue ($M)',
    value: (m) => d(m).yr1_revenue,
    render: (m) => (
      <span>
        {fmtM(d(m).yr1_revenue)} <span className="text-2xs text-faint">{d(m).yr1_period ?? ''}</span>
      </span>
    ),
    rule: { kind: 'rel', thr: 0.05 },
  },
  {
    group: 'Operations',
    key: 'yr1_guide',
    label: 'Yr-1 vs guidance mid',
    value: (m) => d(m).yr1_vs_guide,
    render: (m) =>
      isNum(d(m).yr1_guide_mid) ? (
        <span className="inline-flex items-center gap-1">
          {fmtPctSigned(d(m).yr1_vs_guide)}
          <span className="text-2xs text-faint">mid {fmtM(d(m).yr1_guide_mid)}</span>
          {d(m).yr1_inside === true && <Chip tone="pos">inside</Chip>}
          {d(m).yr1_inside === false && <Chip tone="neg">outside</Chip>}
        </span>
      ) : (
        <span className="text-faint">—</span>
      ),
  },
  {
    group: 'Bridge',
    key: 'ev',
    label: 'EV ($M)',
    value: (m) => d(m).ev,
    render: (m) => <span className={negCls(d(m).ev)}>{fmtM(d(m).ev)}</span>,
    rule: { kind: 'rel', thr: 0.2 },
  },
  {
    group: 'Bridge',
    key: 'equity',
    label: 'Equity ($M)',
    value: (m) => d(m).equity,
    render: (m) => <span className={negCls(d(m).equity)}>{fmtM(d(m).equity)}</span>,
    rule: { kind: 'rel', thr: 0.2 },
  },
  {
    group: 'Bridge',
    key: 'shares',
    label: 'Shares used (M)',
    value: (m) => d(m).shares_used,
    render: (m) => fmtNum(d(m).shares_used, 1),
    rule: { kind: 'rel', thr: 0.05 },
  },
  {
    group: 'Bridge',
    key: 'dilution',
    label: 'Dilution vs diluted',
    value: (m) => d(m).dilution_pct,
    render: (m) => fmtPctSigned(d(m).dilution_pct),
    rule: { kind: 'abs', thr: 0.03 },
  },
  {
    group: 'Quality',
    key: 'checks',
    label: 'Agent checks',
    value: () => null,
    render: (m) => {
      const c = d(m).checks
      if (!c || !c.total) return <span className="text-faint">—</span>
      return (
        <span className="inline-flex items-center gap-1">
          <span className="text-pos">{c.pass ?? 0}✓</span>
          {(c.fail ?? 0) > 0 && <span className="text-neg">{c.fail}✗</span>}
          {(c.warn ?? 0) > 0 && <span className="text-warn">{c.warn}!</span>}
          <span className="text-2xs text-faint">/ {c.total}</span>
        </span>
      )
    },
  },
  {
    group: 'Quality',
    key: 'validation',
    label: 'Validator',
    value: () => null,
    render: (m) => {
      const v = m.summary?.validation
      if (!v) return <span className="text-faint">—</span>
      return (
        <span className="inline-flex items-center gap-1">
          <Chip tone={v.ok ? 'pos' : 'neg'}>{v.ok ? 'ok' : 'fail'}</Chip>
          <span className="text-2xs text-muted">
            {v.fail ?? 0} fail · {v.warn ?? 0} warn
          </span>
          <ReproBadge grade={m.summary?.reproducibility} compact />
        </span>
      )
    },
  },
  {
    group: 'Model',
    key: 'archetype',
    label: 'Archetype',
    value: () => null,
    render: (m) => <span>{d(m).archetype?.replace(/_/g, ' ') ?? '—'}</span>,
  },
  {
    group: 'Model',
    key: 'decisive',
    label: 'Decisive variable',
    value: () => null,
    render: (m) => <span className="whitespace-normal">{d(m).decisive ?? '—'}</span>,
  },
  {
    group: 'Model',
    key: 'as_of',
    label: 'As of',
    value: () => null,
    render: (m) => (
      <span>
        {fmtDate(m.summary?.as_of ?? m.dcf.basis?.as_of)}{' '}
        <span className="text-2xs text-faint">{fmtAge(m.summary?.as_of ?? m.dcf.basis?.as_of)}</span>
      </span>
    ),
  },
  {
    group: 'Model',
    key: 'model',
    label: 'Model / CLI',
    value: () => null,
    render: (m) => {
      const prov = m.dcf.provenance
      const imp = prov?.imported_from
      return (
        <span className="text-2xs">
          {m.summary?.origin === 'import' ? (
            <span title={imp?.notes ?? ''}>
              legacy {imp?.generation ?? ''} {imp?.fidelity ? `· ${imp.fidelity}` : ''}
            </span>
          ) : (
            <span>
              {m.summary?.cli ?? prov?.cli ?? '—'} · {m.summary?.model ?? prov?.model ?? '—'}
              {m.summary?.effort && m.summary.effort !== 'n/a' ? ` · ${m.summary.effort}` : ''}
            </span>
          )}
        </span>
      )
    },
  },
]

function MetricsTable({ models }: { models: Model[] }) {
  let lastGroup = ''
  return (
    <div className="scroll-x">
      <table className="tbl">
        <thead>
          <tr>
            <th className="w-48">Metric</th>
            {models.map((m) => (
              <th key={m.id} className="min-w-[150px] text-right">
                <Link to={vLink(m.id)} className="inline-flex flex-col items-end normal-case tracking-normal hover:opacity-80">
                  <span className="text-xs font-semibold" style={{ color: m.color }}>
                    {m.label}
                  </span>
                  <span className="text-2xs font-normal text-faint">{m.sub}</span>
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((row) => {
            const vals = models.map((m) => {
              const v = row.value(m)
              return isNum(v) ? v : null
            })
            const { flags, spread } = row.rule ? divergence(vals, row.rule) : { flags: vals.map(() => false), spread: null }
            const anyFlag = flags.some(Boolean)
            const header =
              row.group !== lastGroup ? (
                <tr key={`g-${row.group}`}>
                  <td colSpan={models.length + 1} className="bg-sunken/50 pt-2 text-2xs font-semibold uppercase tracking-wide text-muted">
                    {row.group}
                  </td>
                </tr>
              ) : null
            lastGroup = row.group
            return [
              header,
              <tr key={row.key}>
                <td className="whitespace-nowrap text-muted">
                  {row.label}
                  {anyFlag && (
                    <span
                      className="ml-1 text-warn"
                      title={`Models diverge (spread ${row.rule?.kind === 'rel' ? fmtPct(spread) + ' of median' : fmtSmart(spread)})`}
                    >
                      ◆
                    </span>
                  )}
                </td>
                {models.map((m, i) => (
                  <td key={m.id} className={clsx('n', flags[i] && 'bg-warn/15 font-semibold ring-1 ring-inset ring-warn/40')}>
                    {row.render(m)}
                  </td>
                ))}
              </tr>,
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ charts */

const CHARTS: { metric: MetricKey; title: string; fmt: (v: number) => string }[] = [
  { metric: 'revenue', title: 'Revenue ($M) — base', fmt: (v) => fmtM(v) },
  { metric: 'ebit_margin', title: 'EBIT margin — base', fmt: (v) => fmtPct(v) },
  { metric: 'fcff', title: 'FCFF ($M) — base', fmt: (v) => fmtM(v) },
  { metric: 'ebit', title: 'EBIT ($M) — base', fmt: (v) => fmtM(v) },
]

function seriesFor(models: Model[], metric: MetricKey): OverlaySeries[] {
  return models.map((m) => {
    const scn = baseScenario(m.dcf)
    const proj = projectedRows(scn)
    const act = actualRows(m.dcf, scn)
    const pt = (r: (typeof proj)[number]) => ({ t: rowTime(r) ?? 0, v: rowMetric(r, metric), label: r.period })
    return {
      key: m.id,
      name: `${m.label} · ${m.sub}`,
      color: m.color,
      dash: m.dash,
      actual: act.filter((r) => rowTime(r) !== null).map(pt),
      projected: proj.filter((r) => rowTime(r) !== null).map(pt),
    }
  })
}

/* ------------------------------------------------------------------ narratives */

const NARR_FIELDS: { key: string; label: string }[] = [
  { key: 'headline', label: 'Headline' },
  { key: 'decisive_variable', label: 'Decisive variable' },
  { key: 'thesis', label: 'Thesis' },
  { key: 'bear_case', label: 'Bear case' },
  { key: 'bull_case', label: 'Bull case' },
  { key: 'opposing_case', label: 'Strongest opposing case' },
  { key: 'market_implied', label: 'Market implied' },
]

function ReverseSummary({ items, ccy }: { items: DcfReverse[]; ccy?: string | null }) {
  if (!items.length) return <span className="text-faint">—</span>
  return (
    <ul className="space-y-1">
      {items.map((r, i) => (
        <li key={i}>
          <span className="font-medium">{r.variable}</span>:{' '}
          <span className="num font-semibold">
            {r.reachable === false ? 'unreachable' : isNum(r.solved) ? `${fmtSmart(r.unit?.startsWith('%') ? r.solved * 100 : r.solved)}${r.unit ? ' ' + r.unit : ''}` : '—'}
          </span>
          {isNum(r.target_price) && <span className="text-faint"> at {fmtPS(r.target_price, ccy)}</span>}
          {r.anchor?.label && (
            <span className="text-faint">
              {' '}
              (anchor {r.anchor.label}
              {isNum(r.anchor.value) ? `: ${fmtSmart(r.anchor.value)}` : ''})
            </span>
          )}
          {r.commentary && <div className="text-muted">{r.commentary}</div>}
        </li>
      ))}
    </ul>
  )
}

function Narratives({ models }: { models: Model[] }) {
  return (
    <div className="scroll-x">
      <table className="tbl table-fixed" style={{ minWidth: 200 + models.length * 300 }}>
        <thead>
          <tr>
            <th className="w-40">Field</th>
            {models.map((m) => (
              <th key={m.id}>
                <span style={{ color: m.color }}>{m.label}</span> <span className="font-normal text-faint">{m.sub}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {NARR_FIELDS.map((f) => (
            <tr key={f.key}>
              <td className="text-muted">{f.label}</td>
              {models.map((m) => {
                const v = (m.dcf.narrative as Record<string, unknown> | undefined)?.[f.key]
                return (
                  <td key={m.id} className={clsx('whitespace-pre-wrap break-words', f.key === 'headline' && 'font-medium')}>
                    {typeof v === 'string' && v.trim() ? v : <span className="text-faint">—</span>}
                  </td>
                )
              })}
            </tr>
          ))}
          <tr>
            <td className="text-muted">What would change my mind</td>
            {models.map((m) => {
              const t = m.dcf.narrative?.change_my_mind ?? []
              return (
                <td key={m.id}>
                  {t.length ? (
                    <ul className="list-disc space-y-0.5 pl-4">
                      {t.map((x, i) => (
                        <li key={i}>
                          {x?.metric}
                          {x?.threshold && <span className="text-muted"> {x.threshold}</span>}
                          {x?.direction && <span className="text-2xs text-faint"> ({x.direction})</span>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
              )
            })}
          </tr>
          <tr>
            <td className="text-muted">Reverse DCF</td>
            {models.map((m) => (
              <td key={m.id}>
                <ReverseSummary items={(m.dcf.reverse_dcf ?? []) as DcfReverse[]} ccy={d(m).quote_currency} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ page */

export function TickerComparePage() {
  const { ticker = '' } = useParams()
  const T = ticker.toUpperCase()
  const [params, setParams] = useSearchParams()
  const picked = (params.get('v') ?? '').split(',').filter(Boolean)
  const tq = useTicker(T)
  const cq = useCompare(T, picked)
  const cfg = useConfig()
  const { open } = useRunLauncher()

  const models: Model[] = useMemo(() => {
    const seen: Record<string, number> = {}
    const out: Model[] = []
    for (const m of cq.data?.models ?? []) {
      if (!m?.dcf) continue
      const src = m.summary?.source ?? (m.dcf.provenance?.imported_from?.source as string | undefined) ?? m.dcf.provenance?.producer ?? '?'
      const nth = seen[src] ?? 0
      seen[src] = nth + 1
      const st = seriesStyle(src, nth)
      const id = m.summary?.version_id ?? m.dcf.provenance?.version_id ?? `${src}-${nth}`
      const asOf = m.summary?.as_of ?? m.dcf.basis?.as_of
      out.push({
        id,
        summary: m.summary,
        dcf: m.dcf,
        source: src,
        color: st.color,
        dash: st.dash,
        label: SOURCE_LABEL[src] ?? src,
        sub: `${fmtDate(asOf)}${m.summary?.superseded || nth > 0 ? ` · ${shortVid(id)}` : ''}${m.summary?.origin === 'app_edit' ? ' · edit' : ''}`,
      })
    }
    return out
  }, [cq.data])

  const comparePrice = cq.data?.compare_price?.price ?? tq.data?.compare_price?.price ?? null
  const ccy = models[0] ? d(models[0]).quote_currency : 'USD'

  const ffRows: FFRow[] = models.map((m) => ({
    key: m.id,
    label: (
      <span className="inline-flex items-center gap-1.5">
        <SourceBadge source={m.source} />
        <LegacyBadge origin={m.summary?.origin} />
        <QualityBadge quality={m.summary?.quality} />
      </span>
    ),
    sublabel: m.sub,
    href: vLink(m.id),
    color: m.color,
    dashed: !!m.dash,
    bear: d(m).value_ps?.bear,
    base: d(m).value_ps?.base,
    bull: d(m).value_ps?.bull,
    pw: d(m).value_ps?.pw,
    headline: headlineOf(d(m)),
    ownPrice: d(m).price_model,
    upside: upsideOf(d(m)).value,
  }))

  const latestBySource = useMemo(() => {
    const out: Partial<Record<Source, string>> = {}
    for (const v of tq.data?.versions ?? []) if (v.latest && !out[v.source]) out[v.source] = v.version_id
    return out
  }, [tq.data])

  const availableSources = SOURCES.filter((s) => cfg.data?.backends?.[s]?.available !== false)

  const setPicked = (ids: string[]) => {
    const next = new URLSearchParams(params)
    if (ids.length) next.set('v', ids.join(','))
    else next.delete('v')
    setParams(next, { replace: true })
  }

  const currentIds = models.map((m) => m.id)
  const company = tq.data?.company ?? models[0]?.dcf.provenance?.company

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="text-xs text-muted hover:text-fg">
          ← Dashboard
        </Link>
        <h1 className="font-mono text-lg font-semibold">{T}</h1>
        <span className="text-sm text-muted">{company ?? ''}</span>
        <PriceBox ticker={T} quote={cq.data?.compare_price ?? tq.data?.compare_price} />
        <div className="ml-auto flex items-center gap-2">
          {tq.data && <VersionPicker versions={tq.data.versions} selected={currentIds} onChange={setPicked} onReset={() => setPicked([])} />}
          <button
            className="btn"
            onClick={() =>
              open({
                ticker: T,
                mode: 'update',
                sources: availableSources,
                parent_versions: latestBySource,
              })
            }
          >
            Update with agents
          </button>
          <button className="btn btn-primary" onClick={() => open({ ticker: T, mode: 'new' })}>
            New run
          </button>
        </div>
      </div>

      {tq.error && !tq.data && <ErrorBox error={tq.error} title={`Could not load ${T}`} />}
      {cq.isLoading ? (
        <Loading label="Loading models…" />
      ) : cq.error && !cq.data ? (
        <ErrorBox error={cq.error} title="Could not load comparison" />
      ) : models.length === 0 ? (
        <Card>
          <Empty>
            No models with a dcf.json for {T} yet.{' '}
            <button className="link" onClick={() => open({ ticker: T })}>
              Start a run
            </button>
            {(tq.data?.versions.length ?? 0) > 0 && (
              <>
                {' '}
                · {tq.data!.versions.length} version(s) in progress or without a model:{' '}
                {tq.data!.versions.map((v) => (
                  <Link key={v.version_id} to={vLink(v.version_id)} className="link mr-2 font-mono">
                    {shortVid(v.version_id)} ({v.status})
                  </Link>
                ))}
              </>
            )}
          </Empty>
        </Card>
      ) : (
        <>
          {cq.isFetching && <div className="text-2xs text-faint">updating…</div>}
          <Card
            title="Valuation range (bear → bull)"
            actions={
              <span className="text-2xs text-faint">
                ◆ headline · ▍ base · dashed line = compare price · grey tick = model's own price
              </span>
            }
            bodyClassName="px-3 py-2"
          >
            <FootballField rows={ffRows} price={comparePrice} priceLabel="Compare" ccy={ccy} />
          </Card>

          <Card
            title="Canonical metrics"
            actions={<span className="text-2xs text-faint">highlighted = diverges most across models</span>}
          >
            <MetricsTable models={models} />
          </Card>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {CHARTS.map((c) => (
              <Card key={c.metric} bodyClassName="px-3 py-2">
                <OverlayChart series={seriesFor(models, c.metric)} format={c.fmt} title={c.title} />
              </Card>
            ))}
          </div>

          <Card title="Narratives">
            <Narratives models={models} />
          </Card>
        </>
      )}
      {cq.error && cq.data && <div className="text-2xs text-warn">{errorMessage(cq.error)}</div>}
      <div className="text-2xs text-faint">
        <Link to={tLink(T, currentIds)} className="hover:underline" title="Link to this exact set of versions">
          Permalink
        </Link>
      </div>
    </div>
  )
}
