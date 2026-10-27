import { useMemo, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import type { FieldDef, ScreenFilter, SectorsResponse } from '../../types/screener'
import {
  BAD_FLAGS,
  NO_VALUE_OPS,
  OP_LABEL,
  describeFilter,
  fromInput,
  isNumericType,
  opsFor,
  toInput,
  type MoneyUnit,
} from '../../lib/screener'
import { num } from '../../lib/format'

/* ------------------------------------------------------------------ popover shell */

export function Popover({
  open,
  onClose,
  anchor,
  children,
  align = 'left',
  width = 'w-[340px]',
}: {
  open: boolean
  onClose: () => void
  anchor: ReactNode
  children: ReactNode
  align?: 'left' | 'right'
  width?: string
}) {
  return (
    <div className="relative">
      {anchor}
      {open && (
        <>
          <div className="fixed inset-0 z-30" onMouseDown={onClose} />
          <div
            className={clsx('card absolute z-40 mt-1 shadow-xl', align === 'right' ? 'right-0' : 'left-0', width)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                onClose()
              }
            }}
          >
            {children}
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ value editor */

const CHOICES: Record<string, string[]> = {
  revenue_basis: ['TTM', 'FY'],
  cashflow_basis: ['FY+Q1', 'FY', 'TTM-exact'],
}

function defaultOp(f: FieldDef): string {
  if (f.type === 'flags') return 'no_flag'
  if (f.key === 'sector' || f.key === 'industry' || CHOICES[f.key]) return 'in'
  return opsFor(f.type)[0]
}

function suffix(type: string): string {
  if (type === 'pct' || type === 'pctpt') return '%'
  if (type === 'mult') return '×'
  return ''
}

function FilterEditor({
  field,
  initial,
  flags,
  sectors,
  onApply,
  onCancel,
}: {
  field: FieldDef
  initial?: ScreenFilter
  flags: Record<string, string>
  sectors?: SectorsResponse
  onApply: (f: ScreenFilter) => void
  onCancel: () => void
}) {
  const type = field.type
  const [op, setOp] = useState<string>(initial?.op ?? defaultOp(field))
  const iv = initial?.v
  const startUnit: MoneyUnit = type === 'money' && Math.abs(num(Array.isArray(iv) ? iv[0] ?? iv[1] : iv) ?? 1000) >= 1000 ? 'B' : 'M'
  const [unit, setUnit] = useState<MoneyUnit>(startUnit)
  const [a, setA] = useState(() =>
    Array.isArray(iv)
      ? initial?.op === 'between'
        ? toInput(type, iv[0], startUnit)
        : iv.join(', ')
      : toInput(type, iv, startUnit),
  )
  const [b, setB] = useState(() => (Array.isArray(iv) && initial?.op === 'between' ? toInput(type, iv[1], startUnit) : ''))
  const [multi, setMulti] = useState<string[]>(() =>
    Array.isArray(iv) && initial?.op !== 'between' ? iv.map(String) : type === 'flags' && !initial ? BAD_FLAGS : [],
  )
  const [search, setSearch] = useState('')

  const options: { value: string; label: string; help?: string }[] | null = useMemo(() => {
    if (type === 'flags') return Object.entries(flags).map(([k, h]) => ({ value: k, label: k, help: h }))
    if (field.key === 'sector') return (sectors?.sectors ?? []).map((s) => ({ value: s.name, label: `${s.name} (${s.count})` }))
    if (field.key === 'industry')
      return (sectors?.industries ?? [])
        .slice()
        .sort((x, y) => x.name.localeCompare(y.name))
        .map((s) => ({ value: s.name, label: `${s.name} (${s.count})`, help: s.sector }))
    if (CHOICES[field.key]) return CHOICES[field.key].map((c) => ({ value: c, label: c }))
    return null
  }, [type, flags, field.key, sectors])

  const multiOp = op === 'in' || op === 'not_in' || op === 'has_flag' || op === 'no_flag'
  const useChoices = !!options && multiOp

  const build = (): ScreenFilter | null => {
    if (NO_VALUE_OPS.has(op)) return { f: field.key, op }
    if (useChoices) return multi.length ? { f: field.key, op, v: multi } : null
    if (multiOp) {
      const vals = a
        .split(/[,\s]+/)
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => (field.key === 'symbol' ? x.toUpperCase() : x))
      return vals.length ? { f: field.key, op, v: vals } : null
    }
    if (op === 'between') {
      const lo = fromInput(type, a, unit)
      const hi = fromInput(type, b, unit)
      if (lo === null && hi === null) return null
      return { f: field.key, op, v: [lo, hi] }
    }
    const v = fromInput(isNumericType(type) ? type : type === 'date' ? 'date' : 'text', a, unit)
    if (v === null) return null
    return { f: field.key, op, v }
  }
  const built = build()

  const inputCls = 'input w-full num'
  const valueInput = (val: string, set: (s: string) => void, placeholder?: string, autoFocus?: boolean) =>
    type === 'date' ? (
      <input type="date" className={inputCls} value={val} onChange={(e) => set(e.target.value)} autoFocus={autoFocus} />
    ) : (
      <div className="flex items-center gap-1">
        {type === 'price' && <span className="text-muted">$</span>}
        <input
          className={inputCls}
          value={val}
          placeholder={placeholder}
          autoFocus={autoFocus}
          inputMode={isNumericType(type) ? 'decimal' : undefined}
          onChange={(e) => set(e.target.value)}
        />
        {suffix(type) && <span className="text-muted">{suffix(type)}</span>}
      </div>
    )

  const shownOptions = (options ?? []).filter((o) => !search || o.label.toLowerCase().includes(search.toLowerCase()))

  return (
    <form
      className="space-y-2 p-3 text-xs"
      onSubmit={(e) => {
        e.preventDefault()
        if (built) onApply(built)
      }}
    >
      <div>
        <div className="font-semibold">{field.label}</div>
        {field.desc && <div className="text-2xs text-muted">{field.desc}</div>}
        {type === 'pct' && <div className="text-2xs text-faint">Enter percent (15 = 15%).</div>}
      </div>
      <div className="flex items-center gap-1.5">
        <select className="input" value={op} onChange={(e) => setOp(e.target.value)}>
          {(type === 'flags' ? ['no_flag', 'has_flag'] : opsFor(type)).map((o) => (
            <option key={o} value={o}>
              {type === 'flags' ? (o === 'no_flag' ? 'without any of' : 'has any of') : OP_LABEL[o] ?? o}
            </option>
          ))}
        </select>
        {type === 'money' && !NO_VALUE_OPS.has(op) && (
          <select className="input" value={unit} onChange={(e) => setUnit(e.target.value as MoneyUnit)} title="Unit">
            <option value="M">$M</option>
            <option value="B">$B</option>
          </select>
        )}
      </div>

      {NO_VALUE_OPS.has(op) ? null : useChoices ? (
        <div>
          {(options?.length ?? 0) > 10 && (
            <input className="input mb-1 w-full" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          )}
          {type === 'flags' && (
            <div className="mb-1 flex gap-2 text-2xs">
              <button type="button" className="link" onClick={() => setMulti(BAD_FLAGS)}>
                bad-data flags
              </button>
              <button type="button" className="link" onClick={() => setMulti([])}>
                none
              </button>
            </div>
          )}
          <div className="max-h-56 space-y-0.5 overflow-y-auto rounded border border-line p-1">
            {shownOptions.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-start gap-1.5 rounded px-1 py-0.5 hover:bg-sunken" title={o.help}>
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={multi.includes(o.value)}
                  onChange={() => setMulti((m) => (m.includes(o.value) ? m.filter((x) => x !== o.value) : [...m, o.value]))}
                />
                <span className="min-w-0">
                  <span className={clsx(type === 'flags' && 'font-mono text-[11px]')}>{o.label}</span>
                  {o.help && <span className="block text-2xs leading-tight text-faint">{o.help}</span>}
                </span>
              </label>
            ))}
            {shownOptions.length === 0 && <div className="px-1 py-2 text-faint">No options.</div>}
          </div>
        </div>
      ) : multiOp ? (
        <input
          className="input w-full font-mono"
          value={a}
          placeholder="comma-separated values"
          autoFocus
          onChange={(e) => setA(e.target.value)}
        />
      ) : op === 'between' ? (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
          {valueInput(a, setA, 'min', true)}
          <span className="text-muted">and</span>
          {valueInput(b, setB, 'max')}
        </div>
      ) : (
        valueInput(a, setA, 'value', true)
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={!built}>
          {initial ? 'Update' : 'Add filter'}
        </button>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------ field picker */

function FieldPicker({ fields, groups, onPick }: { fields: FieldDef[]; groups: string[]; onPick: (f: FieldDef) => void }) {
  const [q, setQ] = useState('')
  const s = q.trim().toLowerCase()
  const shown = fields.filter((f) => !s || f.label.toLowerCase().includes(s) || f.key.includes(s) || f.desc.toLowerCase().includes(s))
  return (
    <div className="text-xs">
      <div className="border-b border-line p-2">
        <input
          className="input w-full"
          placeholder="Filter by field…"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && shown[0]) onPick(shown[0])
          }}
        />
      </div>
      <div className="max-h-[60vh] overflow-y-auto py-1">
        {groups.map((g) => {
          const fs = shown.filter((f) => f.group === g)
          if (!fs.length) return null
          return (
            <div key={g} className="mb-1">
              <div className="label px-3 py-0.5">{g}</div>
              {fs.map((f) => (
                <button key={f.key} className="block w-full px-3 py-1 text-left hover:bg-sunken" onClick={() => onPick(f)} title={f.desc}>
                  <span className="font-medium">{f.label}</span>
                  {f.desc && <span className="ml-1.5 text-2xs text-faint">{f.desc}</span>}
                </button>
              ))}
            </div>
          )
        })}
        {shown.length === 0 && <div className="px-3 py-3 text-faint">No field matches.</div>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ chips row */

export function FilterChips({
  filters,
  fields,
  groups,
  flags,
  sectors,
  onChange,
}: {
  filters: ScreenFilter[]
  fields: FieldDef[]
  groups: string[]
  flags: Record<string, string>
  sectors?: SectorsResponse
  onChange: (filters: ScreenFilter[]) => void
}) {
  // which popover is open: chip index, 'new' (picker) or a picked field for a new filter
  const [editing, setEditing] = useState<number | null>(null)
  const [adding, setAdding] = useState<FieldDef | 'pick' | null>(null)
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields])
  const filterableFields = useMemo(() => fields, [fields])

  return (
    <div className="flex flex-wrap items-center gap-1">
      {filters.map((flt, i) => {
        const fd = flt.op === 'has_flag' || flt.op === 'no_flag' ? byKey.get('flags') : byKey.get(flt.f)
        const d = describeFilter(flt, fd)
        const title = fd?.type === 'flags' && Array.isArray(flt.v) ? (flt.v as string[]).map((x) => `${x}: ${flags[x] ?? ''}`).join('\n') : fd?.desc
        return (
          <Popover
            key={i}
            open={editing === i}
            onClose={() => setEditing(null)}
            anchor={
              <span
                className={clsx(
                  'inline-flex items-center overflow-hidden rounded border text-xs',
                  editing === i ? 'border-accent' : 'border-line',
                  'bg-panel',
                )}
              >
                <button className="flex items-center gap-1 px-1.5 py-0.5 hover:bg-sunken" onClick={() => setEditing(i)} title={title}>
                  <span className="text-muted">{d.label}</span>
                  <span className="font-semibold">{d.op}</span>
                  {d.value && <span className="num font-medium">{d.value}</span>}
                </button>
                <button
                  className="border-l border-line px-1 py-0.5 text-faint hover:bg-sunken hover:text-neg"
                  title="Remove filter"
                  onClick={() => onChange(filters.filter((_, k) => k !== i))}
                >
                  ×
                </button>
              </span>
            }
          >
            {fd ? (
              <FilterEditor
                field={fd}
                initial={flt}
                flags={flags}
                sectors={sectors}
                onCancel={() => setEditing(null)}
                onApply={(nf) => {
                  onChange(filters.map((x, k) => (k === i ? nf : x)))
                  setEditing(null)
                }}
              />
            ) : (
              <div className="p-3 text-xs text-muted">Unknown field “{flt.f}”.</div>
            )}
          </Popover>
        )
      })}
      <Popover
        open={adding !== null}
        onClose={() => setAdding(null)}
        width={adding && adding !== 'pick' ? 'w-[340px]' : 'w-[380px]'}
        anchor={
          <button className="btn btn-ghost px-1.5 py-0.5 text-accent" onClick={() => setAdding('pick')}>
            + Filter
          </button>
        }
      >
        {adding === 'pick' ? (
          <FieldPicker fields={filterableFields} groups={groups} onPick={(f) => setAdding(f)} />
        ) : adding ? (
          <FilterEditor
            key={adding.key}
            field={adding}
            flags={flags}
            sectors={sectors}
            onCancel={() => setAdding('pick')}
            onApply={(nf) => {
              onChange([...filters, nf])
              setAdding(null)
            }}
          />
        ) : null}
      </Popover>
      {filters.length > 0 && (
        <button className="text-2xs text-faint hover:text-fg" onClick={() => onChange([])}>
          clear all
        </button>
      )}
    </div>
  )
}
