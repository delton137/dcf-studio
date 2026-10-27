/* Client-side helpers over dcf.json payloads: scenario lookup, consolidated rows,
 * time series for charts, divergence highlighting and version diffs. */
import type {
  Dcf,
  DcfBridgeItem,
  DcfComponent,
  DcfInput,
  DcfRow,
  DcfScenario,
  Derived,
} from '../types/api'
import { isNum, num, parseDate } from './format'

const ROLE_ORDER: Record<string, number> = { bear: 0, base: 1, bull: 2, other: 3 }

export function scenarios(dcf: Dcf | null | undefined): DcfScenario[] {
  const s = (dcf?.scenarios ?? []).filter(Boolean) as DcfScenario[]
  return [...s].sort((a, b) => (ROLE_ORDER[a.role ?? 'other'] ?? 3) - (ROLE_ORDER[b.role ?? 'other'] ?? 3))
}

export function scenarioByRole(dcf: Dcf | null | undefined, role: string): DcfScenario | undefined {
  return (dcf?.scenarios ?? []).find((s) => s?.role === role) as DcfScenario | undefined
}

export function baseScenario(dcf: Dcf | null | undefined): DcfScenario | undefined {
  return scenarioByRole(dcf, 'base') ?? (dcf?.scenarios?.[0] as DcfScenario | undefined)
}

export function scenarioVps(s: DcfScenario | undefined): number | null {
  return num(s?.results?.value_per_share)
}

export const ROW_FIELDS = ['revenue', 'ebitda', 'ebit', 'taxes', 'nopat', 'da', 'capex', 'delta_nwc', 'other_adj', 'fcff'] as const
export type RowField = (typeof ROW_FIELDS)[number]

function rowKey(r: DcfRow): string {
  return String(r.period_end ?? r.period ?? '')
}

function sortRows(rows: DcfRow[]): DcfRow[] {
  return [...rows].sort((a, b) => rowKey(a).localeCompare(rowKey(b)))
}

export function enterpriseDcfComponents(s: DcfScenario | undefined): DcfComponent[] {
  return ((s?.components ?? []) as DcfComponent[]).filter(
    (c) => c && (c.kind ?? 'dcf') === 'dcf' && (c.level ?? 'enterprise') === 'enterprise' && (c.rows?.length ?? 0) > 0,
  )
}

/** Base-style consolidated projection rows: consolidated_rows if present, else enterprise DCF components summed by period_end. */
export function projectedRows(s: DcfScenario | undefined): DcfRow[] {
  if (!s) return []
  const cons = ((s.consolidated_rows ?? []) as DcfRow[]).filter((r) => r && !r.is_actual)
  if (cons.length) return sortRows(cons)
  const comps = enterpriseDcfComponents(s)
  if (!comps.length) return []
  if (comps.length === 1) return sortRows(((comps[0].rows ?? []) as DcfRow[]).filter((r) => r && !r.is_actual))
  const byKey = new Map<string, DcfRow>()
  for (const c of comps) {
    for (const r of (c.rows ?? []) as DcfRow[]) {
      if (!r || r.is_actual) continue
      const k = rowKey(r)
      const cur = byKey.get(k)
      if (!cur) {
        byKey.set(k, { ...r, drivers: {} })
        continue
      }
      for (const f of ROW_FIELDS) {
        const a = num(cur[f])
        const b = num(r[f])
        if (a !== null || b !== null) (cur as Record<string, unknown>)[f] = (a ?? 0) + (b ?? 0)
      }
    }
  }
  return sortRows([...byKey.values()])
}

/** Actual (historical) rows: historicals.rows + is_actual rows in the scenario's components, de-duplicated by period_end. */
export function actualRows(dcf: Dcf | null | undefined, s?: DcfScenario): DcfRow[] {
  const out = new Map<string, DcfRow>()
  for (const r of (dcf?.historicals?.rows ?? []) as DcfRow[]) {
    if (r && r.is_actual !== false) out.set(rowKey(r), r)
  }
  const scn = s ?? baseScenario(dcf)
  const extra = [
    ...((scn?.consolidated_rows ?? []) as DcfRow[]),
    ...(enterpriseDcfComponents(scn).length === 1 ? ((enterpriseDcfComponents(scn)[0].rows ?? []) as DcfRow[]) : []),
  ]
  for (const r of extra) {
    if (r?.is_actual && !out.has(rowKey(r))) out.set(rowKey(r), r)
  }
  const proj = projectedRows(scn)
  const firstProj = proj.length ? rowKey(proj[0]) : null
  return sortRows([...out.values()].filter((r) => !firstProj || rowKey(r) < firstProj))
}

export type MetricKey = 'revenue' | 'ebit' | 'ebitda' | 'ebit_margin' | 'fcff' | 'fcff_margin'

export function rowMetric(r: DcfRow, m: MetricKey): number | null {
  switch (m) {
    case 'ebit_margin': {
      const e = num(r.ebit)
      const rev = num(r.revenue)
      return e !== null && rev ? e / rev : null
    }
    case 'fcff_margin': {
      const f = num(r.fcff)
      const rev = num(r.revenue)
      return f !== null && rev ? f / rev : null
    }
    default:
      return num(r[m])
  }
}

export function rowTime(r: DcfRow): number | null {
  const d = parseDate(r.period_end)
  return d ? d.getTime() : null
}

/* ------------------------------------------------------------------ prices / upside */

export function headlineOf(d: Derived | null | undefined): number | null {
  return num(d?.value_ps?.headline) ?? num(d?.value_ps?.pw) ?? num(d?.value_ps?.base)
}

/** Upside vs the app's common compare price, falling back to the model's own price. */
export function upsideOf(d: Derived | null | undefined): { value: number | null; basis: 'compare' | 'model' | null } {
  if (isNum(d?.upside_compare)) return { value: d!.upside_compare as number, basis: 'compare' }
  if (isNum(d?.upside_model)) return { value: d!.upside_model as number, basis: 'model' }
  return { value: null, basis: null }
}

export function refPrice(d: Derived | null | undefined, comparePrice?: number | null): number | null {
  return num(comparePrice) ?? num(d?.compare_price) ?? num(d?.price_model)
}

/* ------------------------------------------------------------------ bridge */

export function bridgeIncluded(item: DcfBridgeItem, s?: DcfScenario): boolean {
  const ov = s?.bridge_overrides as Record<string, boolean | undefined> | undefined
  if (ov && item.id && typeof ov[item.id] === 'boolean') return ov[item.id] as boolean
  return item.included !== false
}

/** Per listed-unit impact (quote currency) of a bridge item's equity effect. */
export function bridgePerShare(dcf: Dcf, item: DcfBridgeItem, s?: DcfScenario): number | null {
  const eff = num(item.equity_effect)
  const scn = s ?? baseScenario(dcf)
  const shares = num(scn?.results?.shares_used) ?? num(scn?.shares?.used)
  if (eff === null || !shares) return null
  const fx = num(dcf.market?.fx_spot) ?? 1
  const opl = num(dcf.listing?.ordinary_per_listed_unit) ?? 1
  return (eff * fx * opl) / shares
}

/* ------------------------------------------------------------------ divergence */

export type DivergenceRule = { kind: 'rel'; thr: number } | { kind: 'abs'; thr: number }

/**
 * For a row of values across models, flag the cells that diverge most:
 * if the spread (relative to |median|, or absolute) exceeds the threshold,
 * the cell(s) farthest from the median are highlighted.
 */
export function divergence(values: (number | null | undefined)[], rule: DivergenceRule = { kind: 'rel', thr: 0.2 }): {
  flags: boolean[]
  spread: number | null
} {
  const idx = values.map((v, i) => [v, i] as const).filter(([v]) => isNum(v)) as [number, number][]
  const flags = values.map(() => false)
  if (idx.length < 2) return { flags, spread: null }
  const sorted = idx.map(([v]) => v).sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  const range = sorted[sorted.length - 1] - sorted[0]
  const spread = rule.kind === 'rel' ? range / Math.max(Math.abs(med), 1e-9) : range
  if (spread <= rule.thr) return { flags, spread }
  const devs = idx.map(([v, i]) => [Math.abs(v - med), i] as const)
  const maxDev = Math.max(...devs.map(([d]) => d))
  for (const [d, i] of devs) if (d >= maxDev * 0.999) flags[i] = true
  return { flags, spread }
}

/* ------------------------------------------------------------------ diffs */

export type DiffStatus = 'changed' | 'added' | 'removed'

export interface DiffEntry {
  key: string
  label: string
  unit?: string
  old: unknown
  new: unknown
  status: DiffStatus
  group?: string
}

export function valuesEqual(a: unknown, b: unknown): boolean {
  if (isNum(a) && isNum(b)) {
    const scale = Math.max(Math.abs(a), Math.abs(b), 1e-12)
    return Math.abs(a - b) / scale < 1e-9
  }
  if (a === b) return true
  if (a == null && b == null) return true
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

function diffById<T>(
  oldItems: T[],
  newItems: T[],
  id: (t: T) => string | undefined,
  value: (t: T) => unknown,
  label: (t: T) => string,
  unit?: (t: T) => string | undefined,
  group?: (t: T) => string | undefined,
): DiffEntry[] {
  const out: DiffEntry[] = []
  const om = new Map<string, T>()
  for (const o of oldItems) {
    const k = id(o)
    if (k) om.set(k, o)
  }
  const seen = new Set<string>()
  for (const n of newItems) {
    const k = id(n)
    if (!k) continue
    seen.add(k)
    const o = om.get(k)
    if (!o) out.push({ key: k, label: label(n), unit: unit?.(n), old: undefined, new: value(n), status: 'added', group: group?.(n) })
    else if (!valuesEqual(value(o), value(n)))
      out.push({ key: k, label: label(n), unit: unit?.(n), old: value(o), new: value(n), status: 'changed', group: group?.(n) })
  }
  for (const [k, o] of om) {
    if (!seen.has(k)) out.push({ key: k, label: label(o), unit: unit?.(o), old: value(o), new: undefined, status: 'removed', group: group?.(o) })
  }
  return out
}

export interface ScenarioDiff {
  id: string
  label: string
  role: string
  oldVps: number | null
  newVps: number | null
  oldWacc: number | null
  newWacc: number | null
  oldG: number | null
  newG: number | null
  oldProb: number | null
  newProb: number | null
  oldEv: number | null
  newEv: number | null
}

function mainTerminalG(s: DcfScenario | undefined): number | null {
  const c = ((s?.components ?? []) as DcfComponent[]).find((c) => (c.kind ?? 'dcf') !== 'fixed' && c.terminal)
  return num(c?.terminal?.g)
}

export interface DcfDiff {
  meta: DiffEntry[]
  inputs: DiffEntry[]
  assumptions: DiffEntry[]
  bridge: DiffEntry[]
  scenarios: ScenarioDiff[]
}

export function diffDcf(oldD: Dcf | null | undefined, newD: Dcf | null | undefined): DcfDiff {
  const o = oldD ?? {}
  const n = newD ?? {}
  const meta: DiffEntry[] = []
  const pushMeta = (key: string, label: string, a: unknown, b: unknown, unit?: string) => {
    if (!valuesEqual(a, b)) meta.push({ key, label, old: a, new: b, unit, status: 'changed' })
  }
  pushMeta('as_of', 'As of', o.basis?.as_of, n.basis?.as_of)
  pushMeta('latest_period', 'Latest period', o.basis?.latest_period, n.basis?.latest_period)
  pushMeta('valuation_date', 'Valuation date', o.basis?.valuation_date, n.basis?.valuation_date)
  pushMeta('price', 'Model price', o.market?.price, n.market?.price, '$')
  pushMeta('shares_diluted', 'Diluted shares (M)', o.market?.shares_diluted, n.market?.shares_diluted)
  pushMeta('headline_method', 'Headline method', o.headline?.method, n.headline?.method)
  pushMeta('headline', 'Headline value/share', o.headline?.value_per_share, n.headline?.value_per_share, '$')
  pushMeta('archetype', 'Archetype', o.archetype?.kind, n.archetype?.kind)
  pushMeta('decisive', 'Decisive variable', o.archetype?.decisive?.label, n.archetype?.decisive?.label)
  pushMeta('narrative', 'Narrative headline', o.narrative?.headline, n.narrative?.headline)

  const inputs = diffById<DcfInput>(
    (o.inputs ?? []) as DcfInput[],
    (n.inputs ?? []) as DcfInput[],
    (i) => i.key,
    (i) => i.value,
    (i) => i.label ?? i.key ?? '',
    (i) => i.unit,
    (i) => i.group,
  )
  const assumptions = diffById(
    o.assumptions ?? [],
    n.assumptions ?? [],
    (a) => (a.id ? `${a.id}${a.scenario_id ? '@' + a.scenario_id : ''}` : undefined),
    (a) => a.value,
    (a) => `${a.label ?? a.id}${a.scenario_id ? ` (${a.scenario_id})` : ''}`,
    (a) => a.unit,
    (a) => a.status,
  )
  const bridge = diffById(
    (o.bridge ?? []) as DcfBridgeItem[],
    (n.bridge ?? []) as DcfBridgeItem[],
    (b) => b.id,
    (b) => ({ effect: b.equity_effect, included: b.included !== false }),
    (b) => b.label ?? b.id ?? '',
  )
  const ids = new Set<string>()
  for (const s of [...scenarios(o), ...scenarios(n)]) if (s.id) ids.add(s.id)
  const scen: ScenarioDiff[] = []
  for (const id of ids) {
    const so = (o.scenarios ?? []).find((s) => s?.id === id) as DcfScenario | undefined
    const sn = (n.scenarios ?? []).find((s) => s?.id === id) as DcfScenario | undefined
    scen.push({
      id,
      label: sn?.label ?? so?.label ?? id,
      role: sn?.role ?? so?.role ?? 'other',
      oldVps: scenarioVps(so),
      newVps: scenarioVps(sn),
      oldWacc: num(so?.discounting?.wacc),
      newWacc: num(sn?.discounting?.wacc),
      oldG: mainTerminalG(so),
      newG: mainTerminalG(sn),
      oldProb: num(so?.probability),
      newProb: num(sn?.probability),
      oldEv: num(so?.results?.ev),
      newEv: num(sn?.results?.ev),
    })
  }
  scen.sort((a, b) => (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3))
  return { meta, inputs, assumptions, bridge, scenarios: scen }
}

/* ------------------------------------------------------------------ misc */

export function mainTerminal(s: DcfScenario | undefined) {
  const c = ((s?.components ?? []) as DcfComponent[]).find((c) => (c.kind ?? 'dcf') !== 'fixed' && c.terminal)
  return c?.terminal ?? undefined
}

export function hasExitMultiple(dcf: Dcf | null | undefined): boolean {
  return (dcf?.scenarios ?? []).some((s) =>
    ((s?.components ?? []) as DcfComponent[]).some((c) => c?.terminal?.method === 'exit_multiple'),
  )
}

export function quoteCcy(dcf: Dcf | null | undefined, d?: Derived | null): string {
  return (d?.quote_currency as string | undefined) ?? dcf?.listing?.quote_currency ?? 'USD'
}

/** Scenario EV with the legacy fallback (some Grok imports store a negative EV under results.ev_legacy). */
export function scenarioEv(s: DcfScenario | undefined): number | null {
  const r = s?.results as Record<string, unknown> | undefined
  return num(r?.ev) ?? num(r?.ev_legacy)
}
