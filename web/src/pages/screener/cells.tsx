import clsx from 'clsx'
import type { FieldDef, ScreenerRow } from '../../types/screener'
import { Chip, SourceDot, UpsideChip } from '../../components/badges'
import { isNum, num, upsideBg } from '../../lib/format'
import { BAD_FLAGS, fmtField, isNumericType } from '../../lib/screener'
import { SOURCES } from '../../types/api'

/** Colour-scaled fields: tint = green when "good". `sign` flips the scale (negative gap = cheap). */
const SCALE: Record<string, { max: number; sign: 1 | -1 }> = {
  implied_gap: { max: 0.4, sign: -1 },
  fcf_yield: { max: 0.1, sign: 1 },
  rev_growth: { max: 0.5, sign: 1 },
}

export function flagHelp(flag: string, help: Record<string, string> | undefined): string {
  return help?.[flag] ?? help?.[flag.split(':')[0]] ?? flag
}

export function FlagChips({
  flags,
  help,
  max = 3,
  className,
}: {
  flags: string[] | null | undefined
  help?: Record<string, string>
  max?: number
  className?: string
}) {
  const fl = flags ?? []
  if (!fl.length) return <span className="text-faint">—</span>
  const shown = fl.slice(0, max)
  const rest = fl.slice(max)
  return (
    <span className={clsx('inline-flex min-w-0 items-center gap-0.5 overflow-hidden', className)}>
      {shown.map((f) => (
        <Chip key={f} tone={BAD_FLAGS.includes(f.split(':')[0]) ? 'warn' : 'muted'} title={`${f}: ${flagHelp(f, help)}`} className="!px-1 !text-[10px]">
          {f}
        </Chip>
      ))}
      {rest.length > 0 && (
        <span className="text-2xs text-faint" title={rest.map((f) => `${f}: ${flagHelp(f, help)}`).join('\n')}>
          +{rest.length}
        </span>
      )}
    </span>
  )
}

export function CoverageDots({ row }: { row: ScreenerRow }) {
  const n = num(row.n_models)
  if (!n) return <span className="text-faint">—</span>
  return (
    <span className="inline-flex items-center gap-1" title={`${n} DCF Studio model(s): ${SOURCES.filter((s) => row[`has_${s}`]).join(', ')}`}>
      {SOURCES.map((s) => (row[`has_${s}`] ? <SourceDot key={s} source={s} className="h-1.5 w-1.5" /> : null))}
      <span className="num text-muted">{n}</span>
    </span>
  )
}

/** One table / drawer cell for a field. */
export function FieldCell({ field, row, flagsHelp }: { field: FieldDef; row: ScreenerRow; flagsHelp?: Record<string, string> }) {
  const v = row[field.key]
  if (field.type === 'flags') return <FlagChips flags={Array.isArray(v) ? (v as string[]) : null} help={flagsHelp} />
  if (field.key === 'n_models') return <CoverageDots row={row} />
  if (field.key === 'model_upside') return <UpsideChip value={num(v)} title="median latest-model upside vs price" />
  const text = fmtField(field, row)
  if (text === '—') return <span className="text-faint">—</span>
  const sc = SCALE[field.key]
  if (sc && isNum(v)) {
    return (
      <span className="num inline-block rounded px-1" style={{ background: upsideBg(v * sc.sign, sc.max) }}>
        {text}
      </span>
    )
  }
  if (field.key === 'implied_growth' && row.implied_edge) {
    return (
      <span className="num text-muted" title={row.implied_edge === 'below_range' ? 'EV below the value at −50% growth' : 'EV above the value at +100% growth'}>
        {text}
      </span>
    )
  }
  if (field.key === 'days_to_earnings' && isNum(v) && v >= 0 && v <= 7) {
    return (
      <span className="num font-semibold text-accent" title={`earnings ${row.earnings_date ?? ''} ${row.earnings_time ?? ''}`}>
        {text}
      </span>
    )
  }
  if (field.key === 'earnings_date') {
    return (
      <span className="num" title={row.earnings_time ? `time: ${row.earnings_time}` : undefined}>
        {text}
      </span>
    )
  }
  if (field.key === 'pct_change' || field.key === 'mom_3m' || field.key === 'mom_12m') {
    return <span className={clsx('num', isNum(v) && v < 0 ? 'text-neg' : isNum(v) && v > 0 ? 'text-pos' : '')}>{text}</span>
  }
  if (field.key === 'data_age_days' && isNum(v) && v > 135) return <span className="num text-warn">{text}</span>
  if (field.key === 'cashflow_basis' && v === 'TTM-exact') return <span className="text-pos">{text}</span>
  if (field.key === 'dilution' && isNum(v))
    return <span className={clsx('num', v < 0 ? 'text-pos' : v > 0.05 ? 'text-warn' : '')}>{text}</span>
  if (isNumericType(field.type)) return <span className={clsx('num', isNum(v) && v < 0 && 'text-neg')}>{text}</span>
  return <span title={text}>{text}</span>
}
