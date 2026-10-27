import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ccySymbol, fmtPS, isNum, niceTicks } from '../lib/format'
import { UpsideChip } from './badges'
import { useWidth } from './ui'

export interface FFRow {
  key: string
  label: ReactNode
  sublabel?: ReactNode
  href?: string
  color: string
  dashed?: boolean
  bear?: number | null
  base?: number | null
  bull?: number | null
  pw?: number | null
  headline?: number | null
  ownPrice?: number | null
  /** upside shown in the right column; defaults to headline vs price */
  upside?: number | null
}

const ROW_H = 30

/**
 * Football field: one horizontal bear→bull bar per model, a tick for base, a diamond
 * for the headline / probability-weighted value, a dashed line for the common
 * compare price and a faint tick for the model's own as-of price.
 */
export function FootballField({
  rows,
  price,
  priceLabel = 'Price',
  ccy,
  labelWidth = 190,
}: {
  rows: FFRow[]
  price?: number | null
  priceLabel?: string
  ccy?: string | null
  labelWidth?: number
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const vals: number[] = []
  for (const r of rows) for (const v of [r.bear, r.base, r.bull, r.pw, r.headline, r.ownPrice]) if (isNum(v)) vals.push(v)
  if (isNum(price)) vals.push(price)
  if (!rows.length || !vals.length) return <div className="px-3 py-4 text-xs text-faint">No scenario values to chart.</div>

  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.06
  lo -= pad
  hi += pad
  if (lo > 0 && Math.min(...vals) / Math.max(...vals) < 0.35) lo = 0
  const plotW = Math.max(120, width - 8)
  const x = (v: number) => ((v - lo) / (hi - lo)) * plotW
  const ticks = niceTicks(lo, hi, Math.max(3, Math.floor(plotW / 90)))
  const tickFmt = (v: number) => {
    const span = hi - lo
    const d = span > 40 ? 0 : span > 4 ? 1 : 2
    return (v < 0 ? '−' : '') + ccySymbol(ccy) + Math.abs(v).toFixed(d)
  }

  return (
    <div className="text-xs">
      <div className="flex">
        <div style={{ width: labelWidth }} className="shrink-0" />
        <div className="relative min-w-0 flex-1" ref={ref} />
        <div className="w-32 shrink-0" />
      </div>
      {rows.map((r) => {
        const pts = [r.bear, r.bull].filter(isNum)
        const a = pts.length === 2 ? Math.min(...pts) : null
        const b = pts.length === 2 ? Math.max(...pts) : null
        const hl = isNum(r.headline) ? r.headline : isNum(r.pw) ? r.pw : null
        const tip = [
          `bear ${fmtPS(r.bear, ccy)}`,
          `base ${fmtPS(r.base, ccy)}`,
          `bull ${fmtPS(r.bull, ccy)}`,
          isNum(r.pw) ? `pw ${fmtPS(r.pw, ccy)}` : null,
          `headline ${fmtPS(r.headline, ccy)}`,
          isNum(r.ownPrice) ? `model price ${fmtPS(r.ownPrice, ccy)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')
        const upside = r.upside !== undefined ? r.upside : isNum(hl) && isNum(price) && price ? hl / price - 1 : null
        const label = (
          <div className="min-w-0">
            <div className="truncate">{r.label}</div>
            {r.sublabel && <div className="truncate text-2xs text-faint">{r.sublabel}</div>}
          </div>
        )
        return (
          <div key={r.key} className="flex items-center border-b border-line/50 last:border-b-0">
            <div style={{ width: labelWidth }} className="shrink-0 py-1 pr-2">
              {r.href ? (
                <Link to={r.href} className="block hover:opacity-80">
                  {label}
                </Link>
              ) : (
                label
              )}
            </div>
            <div className="min-w-0 flex-1">
              {width > 0 && (
                <svg width={plotW} height={ROW_H} className="block overflow-visible">
                  <title>{tip}</title>
                  {ticks.map((t) => (
                    <line key={t} x1={x(t)} x2={x(t)} y1={0} y2={ROW_H} style={{ stroke: 'rgb(var(--line))' }} strokeWidth={1} />
                  ))}
                  {lo < 0 && hi > 0 && (
                    <line x1={x(0)} x2={x(0)} y1={0} y2={ROW_H} style={{ stroke: 'rgb(var(--muted))' }} strokeWidth={1} />
                  )}
                  {a !== null && b !== null && (
                    <rect
                      x={x(a)}
                      y={ROW_H / 2 - 6}
                      width={Math.max(2, x(b) - x(a))}
                      height={12}
                      rx={2}
                      style={{ fill: r.color, fillOpacity: 0.22, stroke: r.color }}
                      strokeWidth={1.25}
                      strokeDasharray={r.dashed ? '4 2' : undefined}
                    />
                  )}
                  {isNum(r.bear) && (
                    <text x={x(r.bear) - 3} y={ROW_H / 2 + 3.5} textAnchor="end" style={{ fill: 'rgb(var(--muted))', fontSize: 10 }} className="num">
                      {tickFmt(r.bear)}
                    </text>
                  )}
                  {isNum(r.bull) && (
                    <text x={x(r.bull) + 3} y={ROW_H / 2 + 3.5} textAnchor="start" style={{ fill: 'rgb(var(--muted))', fontSize: 10 }} className="num">
                      {tickFmt(r.bull)}
                    </text>
                  )}
                  {isNum(r.ownPrice) && (
                    <line
                      x1={x(r.ownPrice)}
                      x2={x(r.ownPrice)}
                      y1={3}
                      y2={9}
                      style={{ stroke: 'rgb(var(--faint))' }}
                      strokeWidth={2}
                    >
                      <title>{`model's own price ${fmtPS(r.ownPrice, ccy)}`}</title>
                    </line>
                  )}
                  {isNum(r.base) && (
                    <line
                      x1={x(r.base)}
                      x2={x(r.base)}
                      y1={ROW_H / 2 - 9}
                      y2={ROW_H / 2 + 9}
                      style={{ stroke: 'rgb(var(--fg))' }}
                      strokeWidth={2}
                    />
                  )}
                  {isNum(hl) && (
                    <rect
                      x={x(hl) - 4.5}
                      y={ROW_H / 2 - 4.5}
                      width={9}
                      height={9}
                      transform={`rotate(45 ${x(hl)} ${ROW_H / 2})`}
                      style={{ fill: r.color, stroke: 'rgb(var(--panel))' }}
                      strokeWidth={1.5}
                    />
                  )}
                  {isNum(price) && (
                    <line
                      x1={x(price)}
                      x2={x(price)}
                      y1={0}
                      y2={ROW_H}
                      style={{ stroke: 'rgb(var(--accent))' }}
                      strokeWidth={1.5}
                      strokeDasharray="3 2"
                    />
                  )}
                </svg>
              )}
            </div>
            <div className="num flex w-32 shrink-0 items-center justify-end gap-1.5 whitespace-nowrap pl-2">
              <span className="font-semibold">{fmtPS(hl, ccy)}</span>
              <UpsideChip value={upside} />
            </div>
          </div>
        )
      })}
      {/* axis */}
      <div className="flex">
        <div style={{ width: labelWidth }} className="shrink-0 pt-1 text-2xs text-faint">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-0.5 bg-fg" /> base
          </span>
          <span className="ml-2 inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rotate-45 bg-muted" /> headline
          </span>
        </div>
        <div className="min-w-0 flex-1">
          {width > 0 && (
            <svg width={plotW} height={22} className="block overflow-visible">
              {ticks.map((t) => (
                <text key={t} x={x(t)} y={12} textAnchor="middle" style={{ fill: 'rgb(var(--muted))', fontSize: 10 }} className="num">
                  {tickFmt(t)}
                </text>
              ))}
              {isNum(price) && (
                <text x={x(price)} y={21} textAnchor="middle" style={{ fill: 'rgb(var(--accent))', fontSize: 10, fontWeight: 600 }}>
                  {priceLabel} {fmtPS(price, ccy)}
                </text>
              )}
            </svg>
          )}
        </div>
        <div className="w-32 shrink-0" />
      </div>
    </div>
  )
}
