/* Number/date formatting. Every formatter accepts anything and returns '—' for
 * missing or non-finite input, so views never crash on sparse imported models. */

export const DASH = '—'

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function num(v: unknown): number | null {
  if (isNum(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

const CCY: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: 'CN¥',
  HKD: 'HK$',
  CAD: 'C$',
  AUD: 'A$',
  NZD: 'NZ$',
  CHF: 'CHF ',
  KRW: '₩',
  INR: '₹',
  TWD: 'NT$',
  SGD: 'S$',
  SEK: 'SEK ',
  NOK: 'NOK ',
  DKK: 'DKK ',
  BRL: 'R$',
  MXN: 'MX$',
  ILS: '₪',
  ZAR: 'R ',
}

export function ccySymbol(ccy?: string | null): string {
  if (!ccy) return '$'
  return CCY[ccy] ?? `${ccy} `
}

const nf = (min: number, max: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: min, maximumFractionDigits: max })
const NF0 = nf(0, 0)
const NF1 = nf(1, 1)
const NF2 = nf(2, 2)

/** Money per share: currency symbol + 2 decimals. */
export function fmtPS(v: unknown, ccy?: string | null): string {
  const n = num(v)
  if (n === null) return DASH
  const s = ccySymbol(ccy)
  return (n < 0 ? '−' : '') + s + NF2.format(Math.abs(n))
}

/** Millions: thousands separators, no decimals when |v| >= 100, else 1 decimal. */
export function fmtM(v: unknown): string {
  const n = num(v)
  if (n === null) return DASH
  const a = Math.abs(n)
  const body = a >= 100 ? NF0.format(a) : NF1.format(a)
  return (n < 0 ? '−' : '') + body
}

/** Generic number with given decimals (thousands separators). */
export function fmtNum(v: unknown, digits = 2): string {
  const n = num(v)
  if (n === null) return DASH
  const s = nf(digits, digits).format(Math.abs(n))
  return (n < 0 ? '−' : '') + s
}

/** Adaptive number: keeps ~4 significant digits. */
export function fmtSmart(v: unknown): string {
  const n = num(v)
  if (n === null) return DASH
  const a = Math.abs(n)
  if (a >= 1000) return fmtNum(n, 0)
  if (a >= 100) return fmtNum(n, 1)
  if (a >= 1) return fmtNum(n, 2)
  if (a === 0) return '0'
  return fmtNum(n, 3)
}

export function fmtPct(v: unknown, digits = 1): string {
  const n = num(v)
  if (n === null) return DASH
  return (n < 0 ? '−' : '') + nf(digits, digits).format(Math.abs(n) * 100) + '%'
}

export function fmtPctSigned(v: unknown, digits = 1): string {
  const n = num(v)
  if (n === null) return DASH
  const s = nf(digits, digits).format(Math.abs(n) * 100) + '%'
  if (Math.abs(n) < 0.5 * 10 ** -(digits + 2)) return s
  return (n < 0 ? '−' : '+') + s
}

/** Percentage points (for shifts): +0.50pp */
export function fmtPP(v: unknown, digits = 2): string {
  const n = num(v)
  if (n === null) return DASH
  return (n < 0 ? '−' : n > 0 ? '+' : '') + nf(digits, digits).format(Math.abs(n) * 100) + 'pp'
}

export function fmtMult(v: unknown, digits = 1): string {
  const n = num(v)
  if (n === null) return DASH
  return (n < 0 ? '−' : '') + nf(digits, digits).format(Math.abs(n)) + '×'
}

export function fmtSignedPS(v: unknown, ccy?: string | null): string {
  const n = num(v)
  if (n === null) return DASH
  return (n < 0 ? '−' : n > 0 ? '+' : '') + ccySymbol(ccy) + NF2.format(Math.abs(n))
}

export function fmtInt(v: unknown): string {
  const n = num(v)
  if (n === null) return DASH
  return NF0.format(n)
}

export function fmtTokens(v: unknown): string {
  const n = num(v)
  if (n === null) return DASH
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'k'
  return String(Math.round(n))
}

export function fmtUsd(v: unknown): string {
  const n = num(v)
  if (n === null) return DASH
  return '$' + (n >= 100 ? NF0.format(n) : NF2.format(n))
}

export function fmtBytes(v: unknown): string {
  const n = num(v)
  if (n === null) return DASH
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !v) return null
  // plain dates are treated as UTC midnight so they don't shift across time zones
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00Z') : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function fmtDate(v: unknown): string {
  const d = parseDate(v)
  if (!d) return typeof v === 'string' && v ? v : DASH
  return d.toISOString().slice(0, 10)
}

export function fmtDateTime(v: unknown): string {
  const d = parseDate(v)
  if (!d) return DASH
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtTime(v: unknown): string {
  const d = parseDate(v)
  if (!d) return DASH
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Age relative to now: 3m, 5h, 2d, 4mo, 1.2y */
export function fmtAge(v: unknown, now = Date.now()): string {
  const d = parseDate(v)
  if (!d) return DASH
  const s = Math.max(0, (now - d.getTime()) / 1000)
  if (s < 60) return `${Math.round(s)}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  if (s < 86400) return `${Math.round(s / 3600)}h`
  const days = s / 86400
  if (days < 60) return `${Math.round(days)}d`
  if (days < 365) return `${Math.round(days / 30.4)}mo`
  return `${(days / 365).toFixed(1)}y`
}

export function ageDays(v: unknown, now = Date.now()): number | null {
  const d = parseDate(v)
  return d ? (now - d.getTime()) / 86400000 : null
}

export function fmtDuration(seconds: unknown): string {
  const n = num(seconds)
  if (n === null) return DASH
  const s = Math.max(0, Math.round(n))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m) return `${m}m ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}

export function durationBetween(a: unknown, b: unknown, now = Date.now()): number | null {
  const da = parseDate(a)
  if (!da) return null
  const db = parseDate(b)
  return ((db ? db.getTime() : now) - da.getTime()) / 1000
}

/** Format a value according to a unit string from the model ("%", "%/yr", "$", "$M", "x", "M" ...). */
export function isPctUnit(unit?: string | null): boolean {
  return !!unit && unit.trim().startsWith('%')
}

export function fmtUnit(v: unknown, unit?: string | null, ccy?: string | null): string {
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return DASH
  if (Array.isArray(v) || typeof v === 'object') return JSON.stringify(v)
  const n = num(v)
  if (n === null) return DASH
  const u = (unit ?? '').trim()
  if (isPctUnit(u)) return fmtPct(n, Math.abs(n) < 0.001 && n !== 0 ? 2 : 1) + (u.length > 1 ? u.slice(1) : '')
  if (u === 'x' || u === '×') return fmtMult(n, 2)
  if (u === '$' || u === ccy || u === ccySymbol(ccy).trim()) return fmtPS(n, ccy ?? 'USD')
  if (u === '$M' || u === 'M' || u.endsWith('M')) return `${fmtM(n)} ${u}`
  return `${fmtSmart(n)}${u ? ' ' + u : ''}`
}

export function fmtAny(v: unknown): string {
  if (v === null || v === undefined) return DASH
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (isNum(v)) return fmtSmart(v)
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export function titleCase(s?: string | null): string {
  if (!s) return DASH
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Compact display of a version id. Ids are opaque (e.g. `MU_20261001-092946_claude`);
 * this only pulls out an embedded timestamp for display when there is one. */
export function shortVid(vid?: string | null): string {
  if (!vid) return DASH
  const m = /(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(vid)
  if (!m) return vid
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`
}

/* --------------------------------------------------------------- colour scales */

/** Background tint for an upside value: green positive, red negative, alpha by magnitude. */
export function upsideBg(u: unknown, maxAbs = 0.6): string | undefined {
  const n = num(u)
  if (n === null) return undefined
  const a = Math.min(Math.abs(n) / maxAbs, 1)
  const alpha = 0.06 + a * 0.34
  return n >= 0 ? `rgb(var(--pos) / ${alpha.toFixed(3)})` : `rgb(var(--neg) / ${alpha.toFixed(3)})`
}

export function upsideFg(u: unknown): string | undefined {
  const n = num(u)
  if (n === null) return undefined
  return n >= 0 ? 'rgb(var(--pos))' : 'rgb(var(--neg))'
}

/** "Nice" axis ticks. */
export function niceTicks(min: number, max: number, count = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) {
    const d = Math.abs(min) || 1
    min -= d * 0.5
    max += d * 0.5
  }
  const span = max - min
  const raw = span / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const start = Math.ceil(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)))
  return out
}
