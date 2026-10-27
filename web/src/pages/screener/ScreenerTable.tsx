import { memo, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import clsx from 'clsx'
import type { FieldDef, ScreenerRow, SortKey } from '../../types/screener'
import { tLink } from '../../lib/links'
import { SHORT_LABEL, colWidth, isNumericType } from '../../lib/screener'
import { FieldCell } from './cells'

const ROW_H = 28
const CHECK_W = 30

interface Props {
  rows: ScreenerRow[]
  fields: FieldDef[]
  flagsHelp?: Record<string, string>
  sort: SortKey[]
  onSort: (key: string, additive: boolean) => void
  selected: Set<string>
  onSelectedChange: (next: Set<string>) => void
  onSelectAll: () => void
  activeSymbol: string | null
  onOpen: (symbol: string) => void
  emptyText?: string
}

const Row = memo(function Row({
  row,
  index,
  fields,
  widths,
  flagsHelp,
  selected,
  active,
  onCheck,
  onOpen,
  top,
}: {
  row: ScreenerRow
  index: number
  fields: FieldDef[]
  widths: number[]
  flagsHelp?: Record<string, string>
  selected: boolean
  active: boolean
  onCheck: (index: number, shift: boolean) => void
  onOpen: (symbol: string) => void
  top: number
}) {
  return (
    <div
      className={clsx('sc-row absolute left-0 flex w-full border-b border-line/60 text-xs', selected && 'sc-sel', active && 'sc-active')}
      style={{ height: ROW_H, transform: `translateY(${top}px)` }}
      onDoubleClick={() => onOpen(row.symbol)}
    >
      <div className="sc-sticky sticky left-0 z-[2] flex shrink-0 items-center justify-center" style={{ width: CHECK_W }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => {}}
          onClick={(e) => onCheck(index, e.shiftKey)}
          aria-label={`select ${row.symbol}`}
        />
      </div>
      {fields.map((f, i) => {
        const numeric = isNumericType(f.type)
        if (f.key === 'symbol')
          return (
            <div
              key={f.key}
              className="sc-sticky sticky z-[2] flex shrink-0 items-center gap-1 overflow-hidden border-r border-line/60 px-2"
              style={{ width: widths[i], left: CHECK_W }}
            >
              <button
                className="truncate font-mono text-[12px] font-semibold hover:text-accent hover:underline"
                onClick={() => onOpen(row.symbol)}
                title={`${row.symbol} — open details`}
              >
                {row.symbol}
              </button>
              {row.ticker ? (
                <Link
                  to={tLink(row.ticker)}
                  className="shrink-0 text-2xs text-accent hover:underline"
                  title={`Open the DCF Studio models for ${row.ticker}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  ↗
                </Link>
              ) : null}
            </div>
          )
        return (
          <div
            key={f.key}
            className={clsx('flex shrink-0 items-center overflow-hidden whitespace-nowrap px-2', numeric ? 'justify-end' : '', f.key === 'name' && 'text-muted')}
            style={{ width: widths[i] }}
          >
            {f.type === 'text' ? (
              <span className="truncate" title={String(row[f.key] ?? '')}>
                <FieldCell field={f} row={row} flagsHelp={flagsHelp} />
              </span>
            ) : (
              <FieldCell field={f} row={row} flagsHelp={flagsHelp} />
            )}
          </div>
        )
      })}
    </div>
  )
})

/** Virtualized screener grid: fixed 28px rows, sticky header + selection/symbol columns, server-side sort. */
export function ScreenerTable({
  rows,
  fields,
  flagsHelp,
  sort,
  onSort,
  selected,
  onSelectedChange,
  onSelectAll,
  activeSymbol,
  onOpen,
  emptyText = 'No stocks match this screen.',
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastIdx = useRef<number | null>(null)
  const widths = useMemo(() => fields.map(colWidth), [fields])
  const total = CHECK_W + widths.reduce((a, b) => a + b, 0)

  const groups = useMemo(() => {
    const out: { group: string; width: number }[] = []
    fields.forEach((f, i) => {
      const last = out[out.length - 1]
      if (last && last.group === f.group) last.width += widths[i]
      else out.push({ group: f.group, width: widths[i] })
    })
    return out
  }, [fields, widths])

  const v = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 16,
  })

  // keep a stable reference for the memoized rows
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const selRef = useRef(selected)
  selRef.current = selected

  // a new result set invalidates the shift-click anchor
  useEffect(() => {
    lastIdx.current = null
  }, [rows])

  const onCheck = useMemo(
    () => (index: number, shift: boolean) => {
      const rs = rowsRef.current
      const sym = rs[index]?.symbol
      if (!sym) return
      const next = new Set(selRef.current)
      const turnOn = !next.has(sym)
      if (shift && lastIdx.current !== null && lastIdx.current < rs.length) {
        const [a, b] = lastIdx.current < index ? [lastIdx.current, index] : [index, lastIdx.current]
        for (let i = a; i <= b; i++) {
          if (turnOn) next.add(rs[i].symbol)
          else next.delete(rs[i].symbol)
        }
      } else if (turnOn) next.add(sym)
      else next.delete(sym)
      lastIdx.current = index
      onSelectedChange(next)
    },
    [onSelectedChange],
  )

  const nSelVisible = useMemo(() => rows.reduce((n, r) => n + (selected.has(r.symbol) ? 1 : 0), 0), [rows, selected])
  const headCheck = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (headCheck.current) headCheck.current.indeterminate = nSelVisible > 0 && nSelVisible < Math.min(rows.length, 200)
  }, [nSelVisible, rows.length])

  const sortIdx = (key: string) => sort.findIndex((s) => s.f === key)

  return (
    <div ref={scrollRef} className="relative h-full overflow-auto">
      <div style={{ width: total, minWidth: '100%' }}>
        {/* header */}
        <div className="sticky top-0 z-[5] border-b border-line bg-sunken">
          <div className="flex h-5 border-b border-line/60 text-[10px] font-semibold uppercase tracking-wide text-faint">
            <div className="sticky left-0 z-[6] shrink-0 bg-sunken" style={{ width: CHECK_W }} />
            {groups.map((g, i) => (
              <div
                key={i}
                className="flex shrink-0 items-center overflow-hidden whitespace-nowrap border-l border-line/60 px-2"
                style={{ width: g.width }}
              >
                {g.group}
              </div>
            ))}
          </div>
          <div className="flex h-7 text-[10px] font-semibold uppercase text-muted">
            <div className="sticky left-0 z-[6] flex shrink-0 items-center justify-center bg-sunken" style={{ width: CHECK_W }}>
              <input
                ref={headCheck}
                type="checkbox"
                checked={nSelVisible > 0}
                title={nSelVisible > 0 ? 'Clear selection' : 'Select all matched (max 200)'}
                onChange={() => (nSelVisible > 0 ? onSelectedChange(new Set()) : onSelectAll())}
              />
            </div>
            {fields.map((f, i) => {
              const si = sortIdx(f.key)
              const numeric = isNumericType(f.type)
              return (
                <button
                  key={f.key}
                  className={clsx(
                    'flex shrink-0 items-center gap-0.5 overflow-hidden whitespace-nowrap px-2 text-left uppercase hover:text-fg',
                    numeric && 'justify-end',
                    si >= 0 && 'text-fg',
                    f.key === 'symbol' && 'sticky z-[6] border-r border-line/60 bg-sunken',
                  )}
                  style={{ width: widths[i], left: f.key === 'symbol' ? CHECK_W : undefined }}
                  title={`${f.label}${f.desc ? `\n${f.desc}` : ''}\nClick to sort · shift-click to add a secondary sort`}
                  onClick={(e) => onSort(f.key, e.shiftKey)}
                >
                  <span className="truncate">{SHORT_LABEL[f.key] ?? f.label}</span>
                  {si >= 0 && (
                    <span className="shrink-0 text-[9px]">
                      {sort[si].dir === 'asc' ? '▲' : '▼'}
                      {sort.length > 1 ? si + 1 : ''}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
        {/* body */}
        {rows.length === 0 ? (
          <div className="sticky left-0 px-3 py-10 text-center text-xs text-faint" style={{ width: scrollRef.current?.clientWidth }}>
            {emptyText}
          </div>
        ) : (
          <div className="relative" style={{ height: v.getTotalSize() }}>
            {v.getVirtualItems().map((vi) => {
              const r = rows[vi.index]
              return (
                <Row
                  key={r.symbol}
                  row={r}
                  index={vi.index}
                  top={vi.start}
                  fields={fields}
                  widths={widths}
                  flagsHelp={flagsHelp}
                  selected={selected.has(r.symbol)}
                  active={activeSymbol === r.symbol}
                  onCheck={onCheck}
                  onOpen={onOpen}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
