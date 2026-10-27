/* Screener helpers: screen <-> URL encoding, field formatting, filter descriptions.
 * Money in $M; percent fields are fractions (0.15 = 15%) except `pct_change`
 * (percentage points) and `rule_of_40` (points). */
import type { FieldDef, Screen, ScreenFilter, ScreenParams, ScreenerRow, SortKey } from '../types/screener'
import { DASH, fmtDate, fmtInt, fmtMult, fmtNum, fmtPS, fmtPct, isNum, num } from './format'

export const DEFAULT_COLS = [
  'symbol',
  'name',
  'sector',
  'market_cap',
  'price',
  'rev_growth',
  'op_margin',
  'fcf_margin',
  'fcf_yield',
  'ev_ebit',
  'pe',
  'peg',
  'implied_growth',
  'implied_gap',
  'rule_of_40',
  'dilution',
  'days_to_earnings',
  'n_models',
  'model_upside',
  'flags',
]

export const DEFAULT_SORT: SortKey[] = [{ f: 'market_cap', dir: 'desc' }]

export const DEFAULT_SCREEN: Screen = { universe: 'us1b', filters: [], sort: DEFAULT_SORT }

/** Data-quality flags that make the screening metrics unreliable (server BAD_FLAGS). */
export const BAD_FLAGS = ['financial', 'stale_period', 'shares_scale', 'no_fundamentals', 'ev_nonpositive']

export const MAX_BATCH = 200 // enrich / refine / "select all matched"
export const AGENT_ROWS = 150 // shortlist agent sees the top N rows

/* ------------------------------------------------------------------ URL encoding */

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

export function encodeScreen(s: Screen): string {
  return b64urlEncode(JSON.stringify(s))
}

/** Decode `?s=`; returns null for missing or malformed input (never throws). */
export function decodeScreen(raw: string | null): Screen | null {
  if (!raw) return null
  try {
    const j = JSON.parse(b64urlDecode(raw)) as Partial<Screen>
    if (!j || typeof j !== 'object') return null
    return normalizeScreen(j)
  } catch {
    return null
  }
}

/** Fill defaults and drop malformed parts so a hand-edited / old URL can't crash the page. */
export function normalizeScreen(j: Partial<Screen>): Screen {
  const filters = Array.isArray(j.filters)
    ? j.filters.filter((f): f is ScreenFilter => !!f && typeof f === 'object' && typeof f.f === 'string' && typeof f.op === 'string')
    : []
  const sort = Array.isArray(j.sort)
    ? j.sort
        .filter((k): k is SortKey => !!k && typeof k === 'object' && typeof k.f === 'string')
        .map((k) => ({ f: k.f, dir: k.dir === 'asc' ? ('asc' as const) : ('desc' as const) }))
    : DEFAULT_SORT
  const out: Screen = {
    universe: typeof j.universe === 'string' && j.universe ? j.universe : 'us1b',
    filters,
    sort: sort.length ? sort : DEFAULT_SORT,
  }
  if (typeof j.name === 'string' && j.name) out.name = j.name
  if (j.params && typeof j.params === 'object') {
    const p: Partial<ScreenParams> = {}
    for (const k of ['r', 'g_t', 'target_margin'] as const) if (isNum(j.params[k])) p[k] = j.params[k]
    if (Object.keys(p).length) out.params = p
  }
  if (Array.isArray(j.cols)) {
    const cols = j.cols.filter((c): c is string => typeof c === 'string')
    if (cols.length) out.cols = cols
  }
  return out
}

/** The part of a screen the server cares about (no `cols`). */
export function queryPart(s: Screen): Omit<Screen, 'cols'> {
  const out: Omit<Screen, 'cols'> = { universe: s.universe, filters: s.filters, sort: s.sort }
  if (s.name) out.name = s.name
  if (s.params && Object.keys(s.params).length) out.params = s.params
  return out
}

/** Same slug rule as the server (screens.py `_slug`, universes.py `slugify`). */
export function slugify(name: string, fallback = 'list'): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || fallback
  )
}

/* ------------------------------------------------------------------ formatting */

/** $M value -> compact $: $950M, $12.3B, $1.25T. */
export function fmtMoneyM(v: unknown): string {
  const n = num(v)
  if (n === null) return DASH
  const a = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}T`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}B`
  if (a >= 100) return `${sign}$${a.toFixed(0)}M`
  return `${sign}$${a.toFixed(1)}M`
}

/** Raw USD (SEC fundamentals) -> $M with separators. */
export function fmtRawUsdM(v: unknown): string {
  const n = num(v)
  if (n === null) return DASH
  const m = n / 1e6
  const a = Math.abs(m)
  const body = a >= 100 ? fmtNum(a, 0) : a >= 1 ? fmtNum(a, 1) : fmtNum(a, 2)
  return (m < 0 ? '−' : '') + body
}

/** Percentage points (pct_change): +0.52% */
export function fmtPctPt(v: unknown, digits = 2): string {
  const n = num(v)
  if (n === null) return DASH
  return (n < 0 ? '−' : n > 0 ? '+' : '') + Math.abs(n).toFixed(digits) + '%'
}

export function fmtImplied(row: ScreenerRow): string {
  if (row.implied_edge === 'below_range') return '<−50%'
  if (row.implied_edge === 'above_range') return '>100%'
  return fmtPct(row.implied_growth, 1)
}

/** Plain-text value of a field (used in tables, the drawer and tooltips). */
export function fmtField(f: Pick<FieldDef, 'key' | 'type'>, row: ScreenerRow): string {
  const v = row[f.key]
  if (f.key === 'implied_growth') return fmtImplied(row)
  if (v === null || v === undefined || v === '') return DASH
  switch (f.type) {
    case 'price':
      return fmtPS(v)
    case 'pctpt':
      return fmtPctPt(v)
    case 'money':
      return fmtMoneyM(v)
    case 'mult':
      return fmtMult(v, 1)
    case 'pct':
      return fmtPct(v, 1)
    case 'num':
      return fmtNum(v, f.key === 'rule_of_40' ? 0 : 2)
    case 'int':
      return fmtInt(v)
    case 'date':
      return fmtDate(v)
    case 'flags':
      return Array.isArray(v) ? (v.length ? v.join(', ') : DASH) : String(v)
    default:
      return typeof v === 'string' ? v : String(v)
  }
}

export function isNumericType(t: string): boolean {
  return ['price', 'pctpt', 'money', 'mult', 'pct', 'num', 'int'].includes(t)
}

/** Fields where a lower value is "better" (first click sorts ascending). */
const ASC_FIRST = new Set([
  'ev',
  'ev_sales',
  'ev_ebit',
  'ev_ebitda',
  'pe',
  'peg',
  'implied_growth',
  'implied_gap',
  'implied_rev_cagr',
  'sbc_pct',
  'dilution',
  'days_to_earnings',
  'earnings_date',
  'data_age_days',
  'model_age_days',
])

export function defaultDir(f: FieldDef | undefined): 'asc' | 'desc' {
  if (!f) return 'desc'
  if (!isNumericType(f.type) && f.type !== 'date') return 'asc'
  return ASC_FIRST.has(f.key) ? 'asc' : 'desc'
}

/** Short column headers (full label + description go in the tooltip). */
export const SHORT_LABEL: Record<string, string> = {
  market_cap: 'Mkt cap',
  pct_change: 'Day %',
  net_cash_pct: 'Net cash %',
  implied_growth: 'Impl. g',
  implied_gap: 'Impl. gap',
  implied_rev_cagr: 'Impl. rev CAGR',
  revenue: 'Revenue',
  rev_growth: 'Rev growth',
  op_margin: 'Op. margin',
  fcf_margin: 'FCF margin',
  fcf_yield: 'FCF yield',
  rule_of_40: 'R40',
  sbc_pct: 'SBC %',
  dilution: 'Dilution',
  earnings_date: 'Earnings',
  days_to_earnings: 'Days→ER',
  eps_forecast: 'EPS est.',
  pct_below_high: '↓ 52w high',
  mom_3m: '3m ret',
  mom_12m: '12m ret',
  n_models: 'Models',
  model_upside: 'Model ↑',
  model_age_days: 'Model age',
  revenue_basis: 'Rev basis',
  cashflow_basis: 'CF basis',
  data_age_days: 'Data age',
}

/** Column width in px by key / type. */
export function colWidth(f: FieldDef): number {
  const byKey: Record<string, number> = {
    symbol: 92,
    name: 200,
    sector: 132,
    industry: 180,
    country: 100,
    flags: 170,
    peg: 90,
    n_models: 74,
    earnings_date: 92,
    implied_growth: 70,
    implied_gap: 76,
    rev_growth: 86,
    op_margin: 82,
    fcf_margin: 84,
    implied_rev_cagr: 92,
    pct_below_high: 82,
    revenue_basis: 72,
    cashflow_basis: 82,
    model_upside: 74,
  }
  if (byKey[f.key]) return byKey[f.key]
  switch (f.type) {
    case 'money':
      return 80
    case 'price':
      return 78
    case 'date':
      return 90
    case 'text':
      return 100
    default:
      return 70
  }
}

/* ------------------------------------------------------------------ filters */

export const OP_LABEL: Record<string, string> = {
  '>=': '≥',
  '<=': '≤',
  '>': '>',
  '<': '<',
  '==': '=',
  between: 'between',
  in: 'in',
  not_in: 'not in',
  is_null: 'is empty',
  not_null: 'has value',
  is_true: 'is true',
  is_false: 'is false',
  has_flag: 'has flag',
  no_flag: 'without',
  contains: 'contains',
}

export function opsFor(type: string): string[] {
  if (isNumericType(type)) return ['>=', '<=', 'between', '>', '<', '==', 'not_null', 'is_null']
  if (type === 'date') return ['>=', '<=', 'between', 'not_null', 'is_null']
  if (type === 'flags') return ['no_flag', 'has_flag']
  return ['contains', 'in', 'not_in', '==', 'not_null', 'is_null']
}

export const NO_VALUE_OPS = new Set(['is_null', 'not_null', 'is_true', 'is_false'])

/** Money input unit for a value in $M. */
export type MoneyUnit = 'M' | 'B'

/** Server value -> the number shown in an input (percent fields as %, money in the unit). */
export function toInput(type: string, v: unknown, unit: MoneyUnit = 'M'): string {
  const n = num(v)
  if (n === null) return typeof v === 'string' ? v : ''
  if (type === 'pct') return String(Number((n * 100).toPrecision(10)))
  if (type === 'money') return String(Number((unit === 'B' ? n / 1000 : n).toPrecision(10)))
  return String(n)
}

/** Input text -> server value; null when not a number (for numeric types). */
export function fromInput(type: string, s: string, unit: MoneyUnit = 'M'): number | string | null {
  const t = s.trim().replace(/,/g, '').replace(/%$/, '').replace(/^\$/, '')
  if (type === 'date' || type === 'text') return t || null
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  if (type === 'pct') return Number((n / 100).toPrecision(12))
  if (type === 'money') return unit === 'B' ? n * 1000 : n
  return n
}

/** Short display of a filter value. */
export function fmtFilterValue(type: string, v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => (x === null ? '…' : fmtFilterValue(type, x))).join(type === 'flags' || typeof v[0] === 'string' ? ', ' : ' – ')
  const n = num(v)
  if (n === null) return v === null || v === undefined ? '…' : String(v)
  switch (type) {
    case 'pct': {
      const p = n * 100
      return `${Number(p.toPrecision(6))}%`
    }
    case 'money':
      return Math.abs(n) >= 1000 ? `$${Number((n / 1000).toPrecision(6))}B` : `$${Number(n.toPrecision(6))}M`
    case 'mult':
      return `${n}×`
    case 'price':
      return `$${n}`
    case 'pctpt':
      return `${n}%`
    default:
      return String(n)
  }
}

export function describeFilter(flt: ScreenFilter, field: FieldDef | undefined): { label: string; op: string; value: string } {
  const type = field?.type ?? 'num'
  const label = field?.label ?? flt.f
  if (flt.op === 'no_flag' || flt.op === 'has_flag') {
    const vals = Array.isArray(flt.v) ? flt.v : [flt.v]
    return {
      label: 'Flags',
      op: flt.op === 'no_flag' ? 'without' : 'has',
      value: vals.length > 3 ? `${vals.slice(0, 2).join(', ')} +${vals.length - 2}` : vals.join(', '),
    }
  }
  if (NO_VALUE_OPS.has(flt.op)) return { label, op: OP_LABEL[flt.op] ?? flt.op, value: '' }
  return { label, op: OP_LABEL[flt.op] ?? flt.op, value: fmtFilterValue(type, flt.v) }
}

/** Universe id -> display name. */
export function universeLabel(
  id: string,
  builtin: { id: string; name: string }[] = [],
  lists: { slug: string; name: string }[] = [],
): string {
  const b = builtin.find((x) => x.id === id)
  if (b) return b.name
  if (id.startsWith('list:')) {
    const slug = id.slice(5)
    return lists.find((l) => l.slug === slug)?.name ?? slug
  }
  if (id.startsWith('sector:')) return id.slice(7)
  if (id.startsWith('industry:')) return id.slice(9)
  return id
}

/** Median of the finite numbers in xs, or null. */
export function median(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter(isNum).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}
