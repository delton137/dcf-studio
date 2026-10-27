import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import {
  useDebounced,
  useEnrich,
  useRefine,
  useScreenerFields,
  useScreenerQuery,
  useScreenerSectors,
  useScreenerStatus,
  useUniverses,
} from '../../api/hooks'
import type { FieldDef, Screen, ScreenerRow } from '../../types/screener'
import { fmtInt } from '../../lib/format'
import {
  AGENT_ROWS,
  DEFAULT_COLS,
  DEFAULT_SCREEN,
  MAX_BATCH,
  decodeScreen,
  defaultDir,
  encodeScreen,
  normalizeScreen,
  queryPart,
  universeLabel,
} from '../../lib/screener'
import { ErrorBox, Loading, Spinner } from '../../components/ui'
import { ScreenerTable } from './ScreenerTable'
import { FilterChips } from './FilterBuilder'
import { ColumnChooser, DataStatus, JobProgress, ParamsEditor, UniversePicker } from './TopBar'
import { LeftRail } from './LeftRail'
import { RowDrawer } from './RowDrawer'
import { BatchRunDialog, MAX_DCF_BATCH, type BatchItem } from './BatchRunDialog'
import { AgentDialog, type AgentDialogState } from './AgentDialog'
import { AddToListDialog, ListManager } from './Lists'

const MODIFIED = ' (modified)'

export function ScreenerPage() {
  const qc = useQueryClient()
  // The screen lives in local state (updated synchronously, so rapid edits compose) and is mirrored
  // to `?s=` for sharing / bookmarking. URL navigations are transitions (v7_startTransition), so an
  // edit must never be computed from the URL-derived value of the last render.
  const [search, setSearch] = useSearchParams()
  const raw = search.get('s')
  const [screen, setScreenState] = useState<Screen>(() => decodeScreen(raw) ?? DEFAULT_SCREEN)
  const latest = useRef(screen)
  const ownWrites = useRef<string[]>([])
  const mounted = useRef(false)

  // adopt URL changes we did not make (back/forward, links, the nav tab)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const i = ownWrites.current.indexOf(raw ?? '')
    if (i >= 0) {
      ownWrites.current.splice(0, i + 1)
      return
    }
    const s = decodeScreen(raw) ?? DEFAULT_SCREEN
    latest.current = s
    setScreenState(s)
  }, [raw])

  /** Set the screen; replaces the URL entry (or pushes one, for whole-screen switches). */
  const setScreen = useCallback(
    (next: Screen, push = false) => {
      latest.current = next
      setScreenState(next)
      const enc = encodeScreen(next)
      ownWrites.current = [...ownWrites.current.slice(-20), enc]
      setSearch(
        (p) => {
          const n = new URLSearchParams(p)
          n.set('s', enc)
          return n
        },
        { replace: !push },
      )
    },
    [setSearch],
  )
  /** A user edit of the current screen: marks a named preset / saved screen as modified. */
  const edit = useCallback(
    (patch: Partial<Screen>) => {
      const cur = latest.current
      const name = cur.name && !cur.name.endsWith(MODIFIED) ? cur.name + MODIFIED : cur.name
      setScreen({ ...cur, ...patch, name })
    },
    [setScreen],
  )
  /** UI-only change (visible columns): no "modified" marker. */
  const setCols = useCallback((cols: string[] | undefined) => setScreen({ ...latest.current, cols }), [setScreen])

  const fieldsQ = useScreenerFields()
  const status = useScreenerStatus()
  const sectors = useScreenerSectors()
  const universes = useUniverses()
  const enrich = useEnrich()
  const refine = useRefine()

  // query: debounced, without the UI-only columns
  const qKey = JSON.stringify(queryPart(screen))
  const debKey = useDebounced(qKey, 250)
  const debScreen = useMemo(() => JSON.parse(debKey) as ReturnType<typeof queryPart>, [debKey])
  const q = useScreenerQuery(debScreen)
  const rows = useMemo(() => q.data?.rows ?? [], [q.data])
  const rowsBySymbol = useMemo(() => new Map(rows.map((r) => [r.symbol, r])), [rows])
  const pending = q.isFetching || qKey !== debKey

  // fields / columns
  const fields = useMemo(() => fieldsQ.data?.fields ?? [], [fieldsQ.data])
  const groups = fieldsQ.data?.groups ?? []
  const flagsHelp = fieldsQ.data?.flags
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields])
  const cols = screen.cols ?? DEFAULT_COLS
  const visible: FieldDef[] = useMemo(() => fields.filter((f) => f.key === 'symbol' || cols.includes(f.key)), [fields, cols])

  // selection
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const selectAll = useCallback(() => setSelected(new Set(rows.slice(0, MAX_BATCH).map((r) => r.symbol))), [rows])

  // panels & dialogs
  const [drawer, setDrawer] = useState<string | null>(null)
  const [batch, setBatch] = useState<BatchItem[] | null>(null)
  const [addTo, setAddTo] = useState<string[] | null>(null)
  // `?agent=<run id>` (from the Runs pages) opens that agent run's result
  const [agent, setAgent] = useState<AgentDialogState | null>(() => {
    const vid = search.get('agent')
    return vid ? { tab: 'runs', vid } : null
  })
  const closeAgent = useCallback(() => {
    setAgent(null)
    if (search.get('agent'))
      setSearch(
        (p) => {
          const n = new URLSearchParams(p)
          n.delete('agent')
          return n
        },
        { replace: true },
      )
  }, [search, setSearch])
  const [listMgr, setListMgr] = useState<{ slug?: string } | null>(null)
  const closeDrawer = useCallback(() => setDrawer(null), [])

  // reload results when a refresh / enrich / refine job finishes
  const prevBusy = useRef<Record<string, boolean> | null>(null)
  useEffect(() => {
    const s = status.data
    if (!s) return
    const cur = {
      refresh: s.state === 'running',
      enrich: s.jobs?.enrich?.state === 'running',
      refine: s.jobs?.refine?.state === 'running',
    }
    const prev = prevBusy.current
    if (prev && Object.keys(cur).some((k) => prev[k] && !cur[k as keyof typeof cur])) {
      qc.invalidateQueries({ queryKey: ['screener', 'query'] })
      qc.invalidateQueries({ queryKey: ['screener', 'row'] })
      if (prev.refresh) qc.invalidateQueries({ queryKey: ['screener', 'sectors'] })
    }
    prevBusy.current = cur
  }, [status.data, qc])

  const onSort = useCallback(
    (key: string, additive: boolean) => {
      const f = byKey.get(key)
      let sort = latest.current.sort
      const i = sort.findIndex((s) => s.f === key)
      const flip = (d: 'asc' | 'desc') => (d === 'asc' ? 'desc' : 'asc')
      if (additive) {
        sort = i >= 0 ? sort.map((s, k) => (k === i ? { ...s, dir: flip(s.dir) } : s)) : [...sort, { f: key, dir: defaultDir(f) }]
      } else {
        sort = i === 0 ? [{ f: key, dir: flip(sort[0].dir) }] : [{ f: key, dir: defaultDir(f) }]
      }
      edit({ sort })
    },
    [byKey, edit],
  )

  const toBatchItems = (symbols: string[]): BatchItem[] =>
    symbols.map((s) => {
      const r = rowsBySymbol.get(s)
      return { symbol: s, ticker: r?.ticker ?? null, n_models: r?.n_models ?? null, name: r?.name ?? null }
    })

  const selectedList = useMemo(() => {
    // keep the table order for the selected symbols that are visible, then the rest
    const inRows = rows.filter((r) => selected.has(r.symbol)).map((r) => r.symbol)
    const rest = [...selected].filter((s) => !rowsBySymbol.has(s))
    return [...inRows, ...rest]
  }, [rows, rowsBySymbol, selected])
  const jobTargets = selectedList.length ? selectedList.slice(0, MAX_BATCH) : rows.slice(0, MAX_BATCH).map((r) => r.symbol)
  const jobScope = selectedList.length ? `${Math.min(selectedList.length, MAX_BATCH)} selected` : `top ${jobTargets.length} matched`
  const jobs = status.data?.jobs ?? {}
  const enrichRunning = jobs.enrich?.state === 'running'
  const refineRunning = jobs.refine?.state === 'running'

  const builtin = universes.data?.builtin ?? []
  const lists = universes.data?.lists ?? []
  const matched = q.data?.matched ?? 0
  const total = q.data?.total ?? 0
  const unmatched = q.data?.unmatched ?? []
  const effParams = q.data?.params ?? status.data?.params ?? fieldsQ.data?.params

  const drawerRow: ScreenerRow | undefined = drawer ? rowsBySymbol.get(drawer) : undefined

  return (
    <div className="-mx-4 -my-3 flex h-[calc(100vh-45px)] min-h-0">
      {/* left rail */}
      <aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-line bg-panel lg:block">
        <LeftRail
          screen={screen}
          onApply={(s) => setScreen(normalizeScreen(s), true)}
          onUniverse={(id) => edit({ universe: id })}
          onManageLists={(slug) => setListMgr({ slug })}
          onBuildTheme={() => setAgent({ tab: 'theme' })}
          onOpenAgentRun={(vid) => setAgent({ tab: 'runs', vid })}
          onAgentRuns={() => setAgent({ tab: 'runs' })}
        />
      </aside>

      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="space-y-1.5 border-b border-line bg-panel px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-base font-semibold">Screener</h1>
            <UniversePicker value={screen.universe} onChange={(id) => edit({ universe: id })} />
            {screen.name && (
              <span className="max-w-[260px] truncate text-xs text-muted" title={screen.name}>
                {screen.name}
              </span>
            )}
            <span className="num flex items-center gap-1.5 text-xs">
              <b>{fmtInt(matched)}</b>
              <span className="text-muted">of {fmtInt(total)} matched</span>
              {pending && <Spinner />}
            </span>
            {unmatched.length > 0 && (
              <span className="text-2xs text-warn" title={unmatched.join(', ')}>
                {unmatched.length} list symbol{unmatched.length === 1 ? '' : 's'} not in the table
              </span>
            )}
            <div className="ml-auto">
              <DataStatus />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <FilterChips
                filters={screen.filters}
                fields={fields}
                groups={groups}
                flags={flagsHelp ?? {}}
                sectors={sectors.data}
                onChange={(filters) => edit({ filters })}
              />
            </div>
            <ParamsEditor params={screen.params} defaults={status.data?.params ?? fieldsQ.data?.params} onChange={(p) => edit({ params: p })} />
            <ColumnChooser fields={fields} groups={groups} cols={cols} onChange={setCols} />
          </div>
        </div>

        {q.error ? <ErrorBox error={q.error} title="Query failed" className="m-2" /> : null}
        {fieldsQ.error ? <ErrorBox error={fieldsQ.error} title="Fields" className="m-2" /> : null}

        <div className={clsx('relative min-h-0 flex-1 bg-panel transition-opacity', pending && q.data && 'opacity-80')}>
          {fieldsQ.isLoading || (q.isLoading && !q.data) ? (
            <Loading label="Loading screen…" />
          ) : (
            <ScreenerTable
              rows={rows}
              fields={visible}
              flagsHelp={flagsHelp}
              sort={screen.sort}
              onSort={onSort}
              selected={selected}
              onSelectedChange={setSelected}
              onSelectAll={selectAll}
              activeSymbol={drawer}
              onOpen={setDrawer}
              emptyText={
                q.error
                  ? 'The query failed — see the error above (remove or fix the offending filter).'
                  : total === 0 && screen.universe.startsWith('list:')
                  ? 'This list has no symbols in the screener table.'
                  : 'No stocks match this screen — loosen a filter.'
              }
            />
          )}
        </div>

        {/* selection / actions bar */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-panel px-3 py-1.5 text-xs">
          <span className="num min-w-[86px]">
            {selected.size ? (
              <>
                <b>{selected.size}</b> selected{' '}
                <button className="text-2xs text-faint hover:text-fg" onClick={() => setSelected(new Set())}>
                  clear
                </button>
              </>
            ) : (
              <span className="text-muted">none selected</span>
            )}
          </span>
          <button className="btn btn-ghost px-1.5 py-0.5 text-accent" disabled={!rows.length} onClick={selectAll}>
            Select all matched (max {MAX_BATCH})
          </button>
          <span className="mx-1 h-4 w-px bg-line" />
          <button
            className="btn btn-primary py-0.5"
            disabled={!selected.size}
            title={selected.size > MAX_DCF_BATCH ? `Only the first ${MAX_DCF_BATCH} are run per batch` : 'Run full agent DCFs on the selected stocks'}
            onClick={() => setBatch(toBatchItems(selectedList))}
          >
            Run DCF…
          </button>
          <button className="btn py-0.5" disabled={!selected.size} onClick={() => setAddTo(selectedList)}>
            Add to list…
          </button>
          <button
            className="btn py-0.5"
            disabled={enrichRunning || enrich.isPending || !jobTargets.length}
            title="Enrich (Yahoo, free): 52-week high/low, % below high and 3/6/12-month returns"
            onClick={() => enrich.mutate(jobTargets)}
          >
            {(enrich.isPending || enrichRunning) && <Spinner />}
            Enrich <span className="text-2xs text-muted">({jobScope})</span>
          </button>
          <button
            className="btn py-0.5"
            disabled={refineRunning || refine.isPending || !jobTargets.length}
            title="Refine (SEC companyconcept): exact TTM operating cash flow, capex and SBC (FY + YTD − prior-year YTD) instead of the FY+Q1 approximation; recomputes FCF, FCF yield and implied growth"
            onClick={() => refine.mutate(jobTargets)}
          >
            {(refine.isPending || refineRunning) && <Spinner />}
            Refine <span className="text-2xs text-muted">({jobScope})</span>
          </button>
          <button
            className="btn py-0.5"
            disabled={!matched}
            title={`A screener agent reviews this screen's top ${AGENT_ROWS} rows and picks the names most worth a full DCF`}
            onClick={() => setAgent({ tab: 'shortlist' })}
          >
            Ask agent…
          </button>
          <span className="ml-2 flex items-center gap-3">
            <JobProgress name="Enrich" job={jobs.enrich} />
            <JobProgress name="Refine" job={jobs.refine} />
          </span>
          {(enrich.error || refine.error) && <ErrorBox error={enrich.error ?? refine.error} className="py-0.5" />}
          {enrich.data && !enrich.data.started && <span className="text-2xs text-warn">an Enrich job is already running</span>}
          {refine.data && !refine.data.started && <span className="text-2xs text-warn">a Refine job is already running</span>}
        </div>
        <div className="border-t border-line bg-sunken px-3 py-1 text-2xs text-faint">
          Screening-grade data: as-reported GAAP from SEC XBRL, levered FCF; fundamentals can lag the price by a quarter. Full DCFs are the
          model-grade view.
          <span className="ml-2">
            Universe: {universeLabel(screen.universe, builtin, lists)} · implied growth at r {((effParams?.r ?? 0.1) * 100).toFixed(1)}% / g_T{' '}
            {((effParams?.g_t ?? 0.025) * 100).toFixed(1)}%
          </span>
        </div>
      </div>

      {drawer && (
        <RowDrawer
          key={drawer}
          symbol={drawer}
          row={drawerRow}
          fields={fields}
          groups={groups}
          flagsHelp={flagsHelp}
          params={effParams}
          onClose={closeDrawer}
          onRunDcf={(r) => setBatch([{ symbol: r.symbol, ticker: r.ticker ?? null, n_models: r.n_models ?? null, name: r.name ?? null }])}
          onAddToList={(syms) => setAddTo(syms)}
        />
      )}

      <BatchRunDialog items={batch} onClose={() => setBatch(null)} />
      <AddToListDialog symbols={addTo} onClose={() => setAddTo(null)} />
      <ListManager
        open={listMgr !== null}
        initialSlug={listMgr?.slug}
        onClose={() => setListMgr(null)}
        onUse={(slug) => edit({ universe: `list:${slug}` })}
        onBuildTheme={() => setAgent({ tab: 'theme' })}
      />
      <AgentDialog
        state={agent}
        onState={setAgent}
        onClose={closeAgent}
        screen={queryPart(screen)}
        matched={matched}
        onRunDcf={(syms) => setBatch(toBatchItems(syms))}
        onOpenList={(slug) => {
          closeAgent()
          edit({ universe: `list:${slug}` })
        }}
      />
    </div>
  )
}
