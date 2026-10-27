import clsx from 'clsx'
import type { DcfGrid } from '../types/api'
import { fmtM, fmtPS, fmtPct, fmtSmart, isNum, upsideBg, upsideFg } from '../lib/format'

function looksLikeRate(key: string | undefined, values: number[]): boolean {
  if (!values.length || values.some((v) => Math.abs(v) > 1)) return false
  return /wacc|(^|[._])g($|[._])|growth|margin|rate|yield|ke|kd|erp|pct|share/i.test(key ?? '') || values.every((v) => Math.abs(v) < 0.5)
}

export function fmtAxisValue(key: string | undefined, values: number[], v: number): string {
  if (looksLikeRate(key, values)) {
    const fine = values.some((x) => Math.abs(Math.round(x * 1000) - x * 1000) > 1e-6)
    return fmtPct(v, fine ? 2 : 1)
  }
  return fmtSmart(v)
}

/** Locate the base cell: a z value equal to the scenario's value/share, else the axis values matching base WACC/g. */
export function findBaseCell(
  grid: DcfGrid,
  baseValue: number | null,
  axisHints: Record<string, number | null | undefined> = {},
): [number, number] | null {
  const z = (grid.z ?? []) as (number | null | undefined)[][]
  if (isNum(baseValue)) {
    let best: [number, number] | null = null
    let bestErr = Infinity
    z.forEach((row, i) =>
      (row ?? []).forEach((v, j) => {
        if (!isNum(v)) return
        const err = Math.abs(v - baseValue) / Math.max(Math.abs(baseValue), 1e-9)
        if (err < bestErr) {
          bestErr = err
          best = [i, j]
        }
      }),
    )
    if (best && bestErr < 0.002) return best
  }
  const xv = (grid.x?.values ?? []) as number[]
  const yv = (grid.y?.values ?? []) as number[]
  const hint = (key?: string) => {
    if (!key) return null
    const k = key.toLowerCase()
    for (const [h, val] of Object.entries(axisHints)) if (isNum(val) && k.includes(h)) return val
    return null
  }
  const hx = hint(grid.x?.key)
  const hy = hint(grid.y?.key)
  if (hx === null || hy === null) return null
  const jx = xv.findIndex((v) => Math.abs(v - hx) < 1e-6)
  const iy = yv.findIndex((v) => Math.abs(v - hy) < 1e-6)
  return jx >= 0 && iy >= 0 ? [iy, jx] : null
}

export function Heatmap({
  grid,
  price,
  baseCell,
  ccy,
}: {
  grid: DcfGrid
  price?: number | null
  baseCell?: [number, number] | null
  ccy?: string | null
}) {
  const xv = (grid.x?.values ?? []).filter(isNum) as number[]
  const yv = (grid.y?.values ?? []).filter(isNum) as number[]
  const z = (grid.z ?? []) as (number | null | undefined)[][]
  const output = grid.output ?? 'value_ps'
  const flat = z.flat().filter(isNum) as number[]
  const zmin = flat.length ? Math.min(...flat) : 0
  const zmax = flat.length ? Math.max(...flat) : 1
  const baseVal = baseCell ? z[baseCell[0]]?.[baseCell[1]] : null
  const ref = output === 'value_ps' ? (isNum(price) && price > 0 ? price : isNum(baseVal) && baseVal !== 0 ? baseVal : null) : null

  const fmtCell = (v: unknown) =>
    output === 'value_ps' ? fmtPS(v, ccy) : output === 'upside' ? fmtPct(v) : output === 'ev' ? fmtM(v) : fmtSmart(v)

  const cellStyle = (v: unknown): React.CSSProperties => {
    if (!isNum(v)) return {}
    if (output === 'upside') return { background: upsideBg(v), color: upsideFg(v) }
    if (ref !== null) {
      const u = v / ref - 1
      return { background: upsideBg(u), color: v < 0 ? 'rgb(var(--neg))' : undefined }
    }
    const t = zmax > zmin ? (v - zmin) / (zmax - zmin) : 0.5
    return { background: `rgb(var(--accent) / ${(0.05 + t * 0.35).toFixed(3)})` }
  }

  return (
    <div className="scroll-x">
      <table className="border-collapse text-xs">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left text-2xs font-semibold text-muted">
              <span className="whitespace-nowrap">
                {grid.y?.label ?? grid.y?.key} ↓ / {grid.x?.label ?? grid.x?.key} →
              </span>
            </th>
            {xv.map((v, j) => (
              <th
                key={j}
                className={clsx('num px-2 py-1 text-right text-2xs font-semibold text-muted', baseCell?.[1] === j && 'text-fg underline')}
              >
                {fmtAxisValue(grid.x?.key, xv, v)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {yv.map((yval, i) => (
            <tr key={i}>
              <th className={clsx('num px-2 py-1 text-right text-2xs font-semibold text-muted', baseCell?.[0] === i && 'text-fg underline')}>
                {fmtAxisValue(grid.y?.key, yv, yval)}
              </th>
              {xv.map((_, j) => {
                const v = z[i]?.[j]
                const isBase = baseCell?.[0] === i && baseCell?.[1] === j
                return (
                  <td
                    key={j}
                    className={clsx(
                      'num min-w-[64px] border border-panel px-2 py-1 text-right',
                      isBase && 'font-bold outline outline-2 -outline-offset-2 outline-fg',
                    )}
                    style={cellStyle(v)}
                    title={isNum(v) && ref ? `${fmtCell(v)} (${fmtPct(v / ref - 1)} vs ${fmtPS(ref, ccy)})` : undefined}
                  >
                    {fmtCell(v)}
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
