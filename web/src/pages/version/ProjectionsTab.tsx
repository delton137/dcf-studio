import { useMemo, useState } from 'react'
import clsx from 'clsx'
import type { Dcf, DcfComponent, DcfDriverDef, DcfRow, DcfScenario } from '../../types/api'
import { fmtM, fmtNum, fmtPct, fmtPS, fmtSmart, fmtUnit, isNum, num } from '../../lib/format'
import {
  actualRows,
  baseScenario,
  enterpriseDcfComponents,
  projectedRows,
  rowMetric,
  rowTime,
  scenarios,
  type MetricKey,
} from '../../lib/derive'
import { Chip } from '../../components/badges'
import { Card, KV, Segmented } from '../../components/ui'
import { OverlayChart, type OverlaySeries } from '../../components/OverlayChart'

const ROLE_COLOR: Record<string, string> = {
  bear: 'rgb(var(--neg))',
  base: 'rgb(var(--accent))',
  bull: 'rgb(var(--pos))',
  other: 'rgb(var(--muted))',
}

type Line = {
  key: string
  label: string
  get: (r: DcfRow, prev?: DcfRow) => number | null
  fmt: (v: number | null) => string
  strong?: boolean
  muted?: boolean
}

const LINES: Line[] = [
  { key: 'revenue', label: 'Revenue', get: (r) => num(r.revenue), fmt: fmtM, strong: true },
  {
    key: 'growth',
    label: '  growth',
    get: (r, p) => {
      const a = num(r.revenue)
      const b = num(p?.revenue)
      return a !== null && b ? a / b - 1 : null
    },
    fmt: (v) => fmtPct(v),
    muted: true,
  },
  { key: 'ebitda', label: 'EBITDA', get: (r) => num(r.ebitda), fmt: fmtM },
  { key: 'ebit', label: 'EBIT', get: (r) => num(r.ebit), fmt: fmtM },
  { key: 'ebit_margin', label: '  EBIT margin', get: (r) => rowMetric(r, 'ebit_margin'), fmt: (v) => fmtPct(v), muted: true },
  { key: 'taxes', label: 'Taxes', get: (r) => num(r.taxes), fmt: fmtM },
  { key: 'nopat', label: 'NOPAT', get: (r) => num(r.nopat), fmt: fmtM },
  { key: 'da', label: 'D&A', get: (r) => num(r.da), fmt: fmtM },
  { key: 'capex', label: 'Capex', get: (r) => num(r.capex), fmt: fmtM },
  { key: 'delta_nwc', label: 'ΔNWC', get: (r) => num(r.delta_nwc), fmt: fmtM },
  { key: 'other_adj', label: 'Other adj.', get: (r) => num(r.other_adj), fmt: fmtM },
  { key: 'fcff', label: 'FCFF', get: (r) => num(r.fcff), fmt: fmtM, strong: true },
]

function RowsTable({ actual, projected, drivers }: { actual: DcfRow[]; projected: DcfRow[]; drivers: DcfDriverDef[] }) {
  const cols = [...actual.map((r) => ({ r, a: true })), ...projected.map((r) => ({ r, a: false }))]
  // driver rows: declared drivers first, then any other keys present
  const keys: { key: string; label: string; unit?: string }[] = []
  const seen = new Set<string>()
  for (const dd of drivers) {
    if (!dd.key) continue
    if (cols.some((c) => c.r.drivers && dd.key! in c.r.drivers)) {
      keys.push({ key: dd.key, label: dd.label ?? dd.key, unit: dd.unit })
      seen.add(dd.key)
    }
  }
  for (const c of cols)
    for (const k of Object.keys(c.r.drivers ?? {}))
      if (!seen.has(k)) {
        seen.add(k)
        keys.push({ key: k, label: k })
      }
  const present = LINES.filter((l) => cols.some((c, i) => l.get(c.r, cols[i - 1]?.r) !== null))
  if (!cols.length) return <div className="px-3 py-3 text-xs text-faint">No rows.</div>
  return (
    <div className="scroll-x">
      <table className="tbl">
        <thead>
          <tr>
            <th className="sticky left-0 z-[2] min-w-[150px] bg-sunken">$M</th>
            {cols.map((c, i) => (
              <th key={i} className={clsx('n min-w-[72px]', c.a && 'bg-line/40')} title={String(c.r.period_end ?? '')}>
                {c.r.period}
                {c.a ? <span className="ml-0.5 font-normal text-faint">A</span> : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {present.map((l) => (
            <tr key={l.key}>
              <td className={clsx('sticky left-0 z-[1] whitespace-pre bg-panel', l.strong && 'font-semibold', l.muted && 'text-muted')}>{l.label}</td>
              {cols.map((c, i) => {
                const v = l.get(c.r, cols[i - 1]?.r)
                return (
                  <td
                    key={i}
                    className={clsx('n', c.a && 'bg-sunken', l.strong && 'font-semibold', l.muted && 'text-muted', isNum(v) && v < 0 && 'text-neg')}
                  >
                    {l.fmt(v)}
                  </td>
                )
              })}
            </tr>
          ))}
          {keys.length > 0 && (
            <tr>
              <td colSpan={cols.length + 1} className="bg-sunken/50 pt-2 text-2xs font-semibold uppercase tracking-wide text-muted">
                Drivers
              </td>
            </tr>
          )}
          {keys.map((k) => (
            <tr key={`d-${k.key}`}>
              <td className="sticky left-0 z-[1] bg-panel text-muted" title={k.key}>
                {k.label}
                {k.unit ? <span className="text-faint"> ({k.unit})</span> : ''}
              </td>
              {cols.map((c, i) => {
                const v = c.r.drivers?.[k.key]
                return (
                  <td key={i} className={clsx('n', c.a && 'bg-sunken')}>
                    {fmtDriver(v, k.unit)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function fmtDriver(v: unknown, unit?: string): string {
  const n = num(v)
  if (n === null) return '—'
  const u = (unit ?? '').trim()
  if (u.startsWith('%')) return Math.abs(n) > 1.5 ? `${fmtNum(n, 1)}%` : fmtPct(n)
  if (u === '$M' || u === 'M') return fmtM(n)
  return fmtSmart(n)
}

function TerminalBlock({ c }: { c: DcfComponent }) {
  const t = c.terminal
  const r = (c.results ?? {}) as Record<string, unknown>
  const extra = Object.entries(r).filter(([k]) => !['pv_explicit', 'tv', 'pv_tv', 'value'].includes(k))
  return (
    <div className="grid grid-cols-1 gap-4 p-3 md:grid-cols-2">
      <div>
        <div className="label mb-1">Terminal</div>
        {t ? (
          <KV
            rows={[
              ['Method', t.method?.replace(/_/g, ' ') ?? '—'],
              ...(isNum(t.g) ? ([['g', fmtPct(t.g, 2)]] as [string, string][]) : []),
              ...(t.method === 'exit_multiple'
                ? ([['Multiple', `${fmtNum(t.multiple, 1)}× ${t.multiple_metric ?? ''} (${t.metric_period ?? 'last'})`]] as [string, string][])
                : []),
              ...(isNum(t.finite_years) ? ([['Finite years', String(t.finite_years)]] as [string, string][]) : []),
              ['FCF N+1', fmtM(t.fcf_next ?? r.fcf_next)],
              ['NOPAT / D&A / capex / ΔNWC N+1', `${fmtM(t.nopat_next)} / ${fmtM(t.da_next)} / ${fmtM(t.capex_next)} / ${fmtM(t.dnwc_next)}`],
              ...(isNum(t.nwc_pct_of_revenue) ? ([['NWC % revenue', fmtPct(t.nwc_pct_of_revenue)]] as [string, string][]) : []),
              ...(t.floor_at_zero ? ([['Floor at zero', 'yes']] as [string, string][]) : []),
              ...(t.note ? ([['Note', t.note]] as [string, string][]) : []),
            ]}
          />
        ) : (
          <span className="text-xs text-faint">{c.kind === 'fixed' ? `Fixed value ${fmtM(c.fixed_value)}` : '—'}</span>
        )}
      </div>
      <div>
        <div className="label mb-1">Component results ($M)</div>
        <KV
          rows={[
            ['PV explicit', fmtM(r.pv_explicit)],
            ['Terminal value', fmtM(r.tv)],
            ['PV of TV', fmtM(r.pv_tv)],
            ['Value', <b>{fmtM(r.value)}</b>],
            ...extra.map(([k, v]) => [k, isNum(v) ? (Math.abs(v) < 1 ? fmtPct(v, 2) : fmtSmart(v)) : String(v ?? '—')] as [string, string]),
          ]}
        />
        {isNum(c.probability) && <div className="mt-1 text-xs text-muted">rNPV probability of success {fmtPct(c.probability)}</div>}
        {c.note && <div className="mt-1 text-xs text-muted">{c.note}</div>}
      </div>
    </div>
  )
}

function scenarioSeries(dcf: Dcf, metric: MetricKey): OverlaySeries[] {
  return scenarios(dcf).map((s) => {
    const proj = projectedRows(s)
    const act = actualRows(dcf, s)
    const pt = (r: DcfRow) => ({ t: rowTime(r) ?? 0, v: rowMetric(r, metric), label: r.period })
    return {
      key: s.id ?? s.role ?? 'x',
      name: s.label ?? s.id ?? '',
      color: ROLE_COLOR[s.role ?? 'other'] ?? ROLE_COLOR.other,
      actual: act.filter((r) => rowTime(r) !== null).map(pt),
      projected: proj.filter((r) => rowTime(r) !== null).map(pt),
    }
  })
}

export function ProjectionsTab({ dcf }: { dcf: Dcf }) {
  const scns = scenarios(dcf)
  const [sid, setSid] = useState<string>(baseScenario(dcf)?.id ?? scns[0]?.id ?? '')
  const scn = scns.find((s) => s.id === sid) ?? scns[0]
  const ccy = dcf.listing?.quote_currency ?? 'USD'
  const drivers = (dcf.drivers ?? []) as DcfDriverDef[]
  const comps = (scn?.components ?? []) as DcfComponent[]
  const entComps = enterpriseDcfComponents(scn)
  const single = entComps.length === 1 && comps.length === 1
  const revSeries = useMemo(() => scenarioSeries(dcf, 'revenue'), [dcf])
  const fcfSeries = useMemo(() => scenarioSeries(dcf, 'fcff'), [dcf])
  const marginSeries = useMemo(() => scenarioSeries(dcf, 'ebit_margin'), [dcf])

  if (!scn) return <div className="text-xs text-faint">No scenarios.</div>
  const disc = scn.discounting
  const wb = disc?.wacc_build

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          options={scns.map((s) => ({ id: s.id ?? '', label: s.label ?? s.id ?? '' }))}
          value={scn.id ?? ''}
          onChange={setSid}
        />
        <span className="num text-xs text-muted">
          WACC {fmtPct(disc?.wacc, 2)} · {disc?.convention ?? 'end'}-period · stub {fmtNum(disc?.stub_fraction ?? 1, 2)}
          {isNum(disc?.stub_fcff) && ` (stub FCFF ${fmtM(disc?.stub_fcff)})`} · TV {disc?.tv_timing?.replace('_', ' ') ?? 'end last'}
          {scn.tax && ` · tax ${fmtPct(scn.tax.rate)} ${scn.tax.guard ? '(loss guard)' : ''}`}
          {' · '}value/share <b className="text-fg">{fmtPS(scn.results?.value_per_share, ccy)}</b>
        </span>
      </div>
      {wb && Object.values(wb).some((v) => v != null) && (
        <div className="text-2xs text-muted">
          WACC build: rf {fmtPct(wb.risk_free, 2)} · β {fmtNum(wb.beta, 2)} · ERP {fmtPct(wb.erp, 2)}
          {isNum(wb.country_risk) && ` · CRP ${fmtPct(wb.country_risk, 2)}`}
          {isNum(wb.size_premium) && ` · size ${fmtPct(wb.size_premium, 2)}`} · ke {fmtPct(wb.cost_of_equity, 2)} · kd{' '}
          {fmtPct(wb.pre_tax_cost_of_debt, 2)} · t {fmtPct(wb.tax_rate, 1)} · E/D {fmtPct(wb.weight_equity, 0)}/{fmtPct(wb.weight_debt, 0)}
          {wb.note && ` · ${wb.note}`}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card bodyClassName="px-3 py-2">
          <OverlayChart series={revSeries} format={(v) => fmtM(v)} title="Revenue ($M) by scenario" height={200} />
        </Card>
        <Card bodyClassName="px-3 py-2">
          <OverlayChart series={marginSeries} format={(v) => fmtPct(v)} title="EBIT margin" height={200} />
        </Card>
        <Card bodyClassName="px-3 py-2">
          <OverlayChart series={fcfSeries} format={(v) => fmtM(v)} title="FCFF ($M)" height={200} />
        </Card>
      </div>

      {!single && entComps.length > 1 && (
        <Card title={`Consolidated (${entComps.length} enterprise components)`}>
          <RowsTable actual={actualRows(dcf, scn)} projected={projectedRows(scn)} drivers={[]} />
        </Card>
      )}

      {comps.map((c) => (
        <Card
          key={c.id}
          title={
            <span className="flex items-center gap-2 normal-case tracking-normal">
              <span className="text-xs font-semibold text-fg">{c.label ?? c.id}</span>
              <Chip tone="muted">{c.kind ?? 'dcf'}</Chip>
              {c.level === 'equity' && <Chip tone="accent">equity-level</Chip>}
              {isNum(c.discounting?.wacc) && <span className="text-2xs text-muted">WACC {fmtPct(c.discounting!.wacc, 2)}</span>}
              {isNum(c.probability) && <span className="text-2xs text-muted">p(success) {fmtPct(c.probability)}</span>}
            </span>
          }
        >
          {(c.rows?.length ?? 0) > 0 && (
            <RowsTable
              actual={
                single
                  ? actualRows(dcf, scn)
                  : ((c.rows ?? []) as DcfRow[]).filter((r) => r.is_actual)
              }
              projected={((c.rows ?? []) as DcfRow[]).filter((r) => !r.is_actual)}
              drivers={drivers}
            />
          )}
          <TerminalBlock c={c} />
        </Card>
      ))}

      {comps.length === 0 && (scn.consolidated_rows?.length ?? 0) > 0 && (
        <Card title="Consolidated rows">
          <RowsTable actual={actualRows(dcf, scn)} projected={projectedRows(scn)} drivers={drivers} />
        </Card>
      )}
      <ScenarioResultsKV scn={scn} />
    </div>
  )
}

function ScenarioResultsKV({ scn }: { scn: DcfScenario }) {
  const r = (scn.results ?? {}) as Record<string, unknown>
  const entries = Object.entries(r)
  if (!entries.length) return null
  return (
    <Card title="Scenario results (raw)" bodyClassName="p-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs md:grid-cols-4">
        {entries.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-line/50 py-0.5">
            <span className="text-muted">{k}</span>
            <span className="num">{typeof v === 'number' ? fmtSmart(v) : typeof v === 'boolean' ? String(v) : fmtUnit(v)}</span>
          </div>
        ))}
      </div>
    </Card>
  )
}
