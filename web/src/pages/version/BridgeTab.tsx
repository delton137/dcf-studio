import { useState } from 'react'
import clsx from 'clsx'
import type { Dcf, DcfBridgeItem } from '../../types/api'
import { fmtDate, fmtM, fmtNum, fmtPS, fmtPct, fmtSignedPS, isNum, num } from '../../lib/format'
import { baseScenario, bridgeIncluded, bridgePerShare, scenarioEv, scenarios } from '../../lib/derive'
import { Chip } from '../../components/badges'
import { Card, Empty, KV, Segmented, useWidth } from '../../components/ui'

interface Step {
  label: string
  value: number
  total?: boolean
  muted?: boolean
}

function Waterfall({ steps }: { steps: Step[] }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  let cum = 0
  const bars = steps.map((s) => {
    if (s.total) {
      cum = s.value
      return { ...s, from: 0, to: s.value }
    }
    const from = cum
    cum += s.value
    return { ...s, from, to: cum }
  })
  const all = bars.flatMap((b) => [b.from, b.to])
  const lo = Math.min(0, ...all)
  const hi = Math.max(0, ...all)
  const w = Math.max(100, width)
  const x = (v: number) => ((v - lo) / (hi - lo || 1)) * w
  return (
    <div className="text-xs">
      {bars.map((b, i) => (
        <div key={i} className="flex items-center border-b border-line/40 py-0.5">
          <div className={clsx('w-64 shrink-0 truncate pr-2', b.total ? 'font-semibold' : b.muted ? 'text-faint' : 'text-muted')} title={b.label}>
            {b.label}
          </div>
          <div className="min-w-0 flex-1" ref={i === 0 ? ref : undefined}>
            {width > 0 && (
              <svg width={w} height={16} className="block">
                <line x1={x(0)} x2={x(0)} y1={0} y2={16} style={{ stroke: 'rgb(var(--line))' }} />
                <rect
                  x={Math.min(x(b.from), x(b.to))}
                  y={3}
                  width={Math.max(1.5, Math.abs(x(b.to) - x(b.from)))}
                  height={10}
                  rx={1.5}
                  style={{
                    fill: b.total ? 'rgb(var(--fg) / 0.75)' : b.value >= 0 ? 'rgb(var(--pos) / 0.7)' : 'rgb(var(--neg) / 0.7)',
                    opacity: b.muted ? 0.4 : 1,
                  }}
                />
              </svg>
            )}
          </div>
          <div className={clsx('num w-28 shrink-0 text-right', b.total && 'font-semibold', !b.total && b.value < 0 && 'text-neg')}>
            {b.total ? fmtM(b.value) : (b.value >= 0 ? '+' : '') + fmtM(b.value)}
          </div>
        </div>
      ))}
    </div>
  )
}

export function BridgeTab({ dcf }: { dcf: Dcf }) {
  const scns = scenarios(dcf)
  const [sid, setSid] = useState(baseScenario(dcf)?.id ?? scns[0]?.id ?? '')
  const scn = scns.find((s) => s.id === sid) ?? scns[0]
  const items = (dcf.bridge ?? []) as DcfBridgeItem[]
  const ccy = dcf.listing?.quote_currency ?? 'USD'
  const rep = dcf.basis?.reporting_currency ?? 'USD'
  if (!scn) return <Empty>No scenarios.</Empty>
  const r = (scn.results ?? {}) as Record<string, unknown>
  const ev = scenarioEv(scn)
  const equity = num(r.equity)
  const steps: Step[] = []
  if (isNum(ev)) steps.push({ label: `Enterprise value${num(r.ev) === null ? ' (legacy)' : ''}`, value: ev, total: true })
  let sum = ev ?? 0
  for (const it of items) {
    const inc = bridgeIncluded(it, scn)
    const v = num(it.equity_effect)
    if (v === null) continue
    if (inc) {
      steps.push({ label: it.label ?? it.id ?? '', value: v })
      sum += v
    }
  }
  const eqc = num(r.equity_components)
  if (eqc) {
    steps.push({ label: 'Equity-level components', value: eqc })
    sum += eqc
  }
  const proc = num(r.issuance_proceeds)
  if (proc) {
    steps.push({ label: 'Issuance proceeds', value: proc })
    sum += proc
  }
  if (isNum(equity) && isNum(ev) && Math.abs(equity - sum) > Math.max(0.5, Math.abs(equity) * 1e-4)) {
    steps.push({ label: 'Other / unexplained', value: equity - sum, muted: true })
  }
  if (isNum(equity)) steps.push({ label: 'Equity value', value: equity, total: true })

  const sh = scn.shares
  const fx = num(dcf.market?.fx_spot) ?? 1
  const opl = num(dcf.listing?.ordinary_per_listed_unit) ?? 1
  const sharesUsed = num(r.shares_used) ?? num(sh?.used)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented options={scns.map((s) => ({ id: s.id ?? '', label: s.label ?? s.id ?? '' }))} value={scn.id ?? ''} onChange={setSid} />
        <span className="num text-xs text-muted">
          bridge total {fmtM(r.bridge_total)} · value/share <b className="text-fg">{fmtPS(r.value_per_share, ccy)}</b>
          {r.floored === true && <Chip tone="warn" className="ml-1">floored</Chip>}
        </span>
      </div>

      <Card title={`EV → equity (${rep} M)`} bodyClassName="p-3">
        {steps.length ? <Waterfall steps={steps} /> : <Empty>No EV / equity results.</Empty>}
        {isNum(equity) && sharesUsed ? (
          <div className="num mt-2 text-xs text-muted">
            {fmtM(equity)} {rep !== ccy ? `× fx ${fmtNum(fx, 4)} ` : ''}÷ {fmtNum(sharesUsed / opl, 2)}M {opl !== 1 ? 'listed units' : 'shares'} ={' '}
            <b className="text-fg">{fmtPS((equity * fx) / (sharesUsed / opl), ccy)}</b>
            {isNum(r.value_per_share_raw) && Math.abs((r.value_per_share_raw as number) - (equity * fx * opl) / sharesUsed) > 0.01 && (
              <span> (stated raw {fmtPS(r.value_per_share_raw, ccy)})</span>
            )}
          </div>
        ) : null}
      </Card>

      <Card title="Bridge items">
        {items.length ? (
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Kind</th>
                  <th className="n">Effect ($M)</th>
                  <th className="n">Per share</th>
                  <th>In {scn.label ?? scn.id}</th>
                  <th>Default</th>
                  <th>Rationale</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const inc = bridgeIncluded(it, scn)
                  const ps = bridgePerShare(dcf, it, scn)
                  return (
                    <tr key={it.id} className={clsx(!inc && 'opacity-60', it.debatable && 'bg-warn/5')}>
                      <td>
                        <span className="font-medium">{it.label}</span>
                        {it.debatable && (
                          <Chip tone="warn" className="ml-1.5">
                            debatable
                          </Chip>
                        )}
                      </td>
                      <td className="text-muted">{it.kind?.replace(/_/g, ' ')}</td>
                      <td className={clsx('n', (it.equity_effect ?? 0) < 0 && 'text-neg')}>{fmtM(it.equity_effect)}</td>
                      <td className="n">{fmtSignedPS(ps, ccy)}</td>
                      <td>{inc ? <Chip tone="pos">included</Chip> : <Chip tone="muted">excluded</Chip>}</td>
                      <td className="text-2xs text-muted">{it.included === false ? 'excluded' : 'included'}</td>
                      <td className="max-w-[420px] text-muted">{it.rationale ?? ''}</td>
                      <td className="text-faint">{it.source_id ?? ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No bridge items.</Empty>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title="Shares" bodyClassName="p-3">
          <KV
            rows={[
              ['Used (M ordinary)', <b>{fmtNum(sh?.used, 2)}</b>],
              ['Method', sh?.method?.replace(/_/g, ' ') ?? '—'],
              ['Market diluted / basic', `${fmtNum(dcf.market?.shares_diluted, 2)} / ${fmtNum(dcf.market?.shares_basic, 2)}`],
              ['Dilution vs diluted', isNum(sh?.used) && dcf.market?.shares_diluted ? fmtPct(sh!.used! / dcf.market.shares_diluted - 1) : '—'],
              ...(isNum(sh?.new_shares) ? ([['New shares (M)', fmtNum(sh!.new_shares, 2)]] as [string, string][]) : []),
              ...(isNum(sh?.issuance_price) ? ([['Issuance price', `${fmtPS(sh!.issuance_price, ccy)} (discount ${fmtPct(sh!.issue_discount ?? 0)})`]] as [string, string][]) : []),
              ...(sh?.proceeds ? ([['Proceeds ($M)', `${fmtM(sh.proceeds)}${sh.proceeds_in_bridge ? ' (in bridge)' : ''}`]] as [string, string][]) : []),
              ...(sh?.price_sensitive ? ([['Price sensitive', 'yes']] as [string, string][]) : []),
              ...(sh?.note ? ([['Note', sh.note]] as [string, string][]) : []),
            ]}
          />
          {(sh?.path?.length ?? 0) > 0 && (
            <div className="mt-2">
              <div className="label mb-1">Share path</div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                {sh!.path!.map((p, i) => (
                  <span key={i} className="num">
                    <span className="text-faint">{fmtDate(p?.period_end)}</span> {fmtNum(p?.value, 1)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
        <Card title="Excluded instruments">
          {(sh?.excluded_instruments?.length ?? 0) > 0 ? (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th className="n">Shares (M)</th>
                  <th className="n">Impact / share if vested</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {sh!.excluded_instruments!.map((e, i) => (
                  <tr key={i}>
                    <td>{e?.label}</td>
                    <td className="n">{fmtNum(e?.shares, 2)}</td>
                    <td className="n">{fmtSignedPS(e?.per_share_impact_if_vested, ccy)}</td>
                    <td className="text-muted">{e?.note ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty className="py-3">None.</Empty>
          )}
          {(dcf.historicals?.share_count_series?.length ?? 0) > 0 && (
            <div className="border-t border-line p-3">
              <div className="label mb-1">Share count history</div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                {dcf.historicals!.share_count_series!.map((p, i) => (
                  <span key={i} className="num" title={p?.kind ?? ''}>
                    <span className="text-faint">{fmtDate(p?.date)}</span> {fmtNum(p?.shares, 1)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
