import { useMemo } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtDate, isNum } from '../lib/format'

export interface SeriesPoint {
  t: number
  v: number | null
  label?: string
}

export interface OverlaySeries {
  key: string
  name: string
  color: string
  dash?: string
  actual: SeriesPoint[]
  projected: SeriesPoint[]
}

type Row = Record<string, number | string | null> & { t: number }

/**
 * Line chart over real period-end dates (x is time, not index — fiscal years differ
 * between companies/models). Historicals are dashed, projections solid.
 */
export function OverlayChart({
  series,
  format,
  height = 220,
  title,
}: {
  series: OverlaySeries[]
  format: (v: number) => string
  height?: number
  title?: string
}) {
  const { data, ticks, bounds, domain, hasNeg, empty } = useMemo(() => {
    const rows = new Map<number, Row>()
    const put = (t: number, key: string, v: number | null, label?: string) => {
      let r = rows.get(t)
      if (!r) {
        r = { t }
        rows.set(t, r)
      }
      r[key] = v
      if (label) r[`${key}__lbl`] = label
    }
    let n = 0
    let neg = false
    for (const s of series) {
      for (const p of s.actual) {
        if (!isNum(p.v)) continue
        put(p.t, `${s.key}__a`, p.v, p.label)
        n++
        if (p.v < 0) neg = true
      }
      const proj = s.projected.filter((p) => isNum(p.v))
      // join the dashed history to the first projected point
      if (s.actual.some((p) => isNum(p.v)) && proj.length) put(proj[0].t, `${s.key}__a`, proj[0].v, proj[0].label)
      for (const p of proj) {
        put(p.t, `${s.key}__p`, p.v, p.label)
        n++
        if ((p.v as number) < 0) neg = true
      }
    }
    const data = [...rows.values()].sort((a, b) => a.t - b.t)
    const ts = data.map((d) => d.t)
    const y0 = ts.length ? new Date(ts[0]).getUTCFullYear() : 0
    const y1 = ts.length ? new Date(ts[ts.length - 1]).getUTCFullYear() : 0
    const step = y1 - y0 > 14 ? 2 : 1
    // Year bands: gridlines on Jan 1, labels mid-year, so a point dated 2026-12-31
    // sits in the "2026" band and one dated 2027-01-31 (e.g. FY2027) in "2027".
    const lo = Date.UTC(y0, 0, 1)
    const hi = Date.UTC(y1 + 1, 0, 1)
    const ticks: number[] = []
    const bounds: number[] = []
    for (let y = y0 - 1; y <= y1 + 1; y++) {
      const mid = Date.UTC(y, 6, 1)
      const jan = Date.UTC(y, 0, 1)
      if ((y - y0) % step === 0 && mid >= lo && mid <= hi) ticks.push(mid)
      if (jan > lo && jan < hi) bounds.push(jan)
    }
    return { data, ticks, bounds, domain: [lo, hi] as [number, number], hasNeg: neg, empty: n === 0 }
  }, [series])

  if (empty) return <div className="flex items-center justify-center text-xs text-faint" style={{ height }}>No data</div>

  const names = new Map(series.map((s) => [s.key, s]))

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-muted">
        {title && <span className="label mr-1">{title}</span>}
        {series.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            <svg width="16" height="6">
              <line x1="0" x2="16" y1="3" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dash} />
            </svg>
            {s.name}
          </span>
        ))}
        <span className="inline-flex items-center gap-1 text-faint">
          <svg width="16" height="6">
            <line x1="0" x2="16" y1="3" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
          </svg>
          actual
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="2 3" vertical={false} />
          {bounds.map((b) => (
            <ReferenceLine key={b} x={b} stroke="rgb(var(--line))" strokeDasharray="2 3" />
          ))}
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={domain}
            allowDataOverflow
            ticks={ticks}
            tickFormatter={(t: number) => String(new Date(t).getUTCFullYear())}
            tickLine={false}
            axisLine={{ stroke: 'rgb(var(--line))' }}
          />
          <YAxis tickFormatter={(v: number) => format(v)} width={60} tickLine={false} axisLine={false} />
          {hasNeg && <ReferenceLine y={0} stroke="rgb(var(--muted))" strokeWidth={1} />}
          <Tooltip
            isAnimationActive={false}
            content={(p) => {
              const payload = (p.payload ?? []) as unknown as readonly { payload?: Row }[]
              if (!p.active || !payload.length) return null
              const row = payload[0]?.payload
              if (!row) return null
              const items: { s: OverlaySeries; v: number; lbl?: string; actual: boolean }[] = []
              for (const s of series) {
                const pv = row[`${s.key}__p`]
                const av = row[`${s.key}__a`]
                if (isNum(pv)) items.push({ s, v: pv, lbl: row[`${s.key}__p__lbl`] as string, actual: false })
                else if (isNum(av)) items.push({ s, v: av, lbl: row[`${s.key}__a__lbl`] as string, actual: true })
              }
              if (!items.length) return null
              return (
                <div className="rounded border border-line bg-panel px-2 py-1.5 text-2xs shadow-lg">
                  <div className="mb-0.5 font-semibold text-muted">{fmtDate(new Date(row.t).toISOString())}</div>
                  {items.map((it) => (
                    <div key={it.s.key} className="flex items-center gap-2">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: names.get(it.s.key)?.color }} />
                      <span className="max-w-[180px] truncate">{it.s.name}</span>
                      <span className="text-faint">{it.lbl}{it.actual ? ' (A)' : ''}</span>
                      <span className="num ml-auto pl-2 font-semibold">{format(it.v)}</span>
                    </div>
                  ))}
                </div>
              )
            }}
          />
          {series.map((s) => [
            <Line
              key={`${s.key}-a`}
              dataKey={`${s.key}__a`}
              stroke={s.color}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              strokeOpacity={0.8}
              dot={false}
              connectNulls
              isAnimationActive={false}
              legendType="none"
            />,
            <Line
              key={`${s.key}-p`}
              dataKey={`${s.key}__p`}
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dash}
              dot={{ r: 2, strokeWidth: 0, fill: s.color }}
              activeDot={{ r: 3.5 }}
              connectNulls
              isAnimationActive={false}
            />,
          ])}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
