import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { useRefreshPrices, useRuns, useSummary } from '../api/hooks'
import { SOURCES, type Source, type TickerRow, type VersionSummary } from '../types/api'
import { ageDays, fmtAge, fmtDate, fmtMult, fmtPS, isNum } from '../lib/format'
import { headlineOf, upsideOf } from '../lib/derive'
import { SOURCE_LABEL, sourceColor } from '../lib/sources'
import { Chip, LegacyBadge, QualityBadge, ReproBadge, SourceDot, StatusBadge, UpsideChip } from '../components/badges'
import { ErrorBox, Loading, Segmented, Spinner, errorMessage } from '../components/ui'
import { useRunLauncher } from '../components/RunLauncher'
import { tLink, vLink } from '../lib/links'

type SortKey = 'ticker' | 'company' | 'price' | Source | 'spread' | 'runs' | 'versions'
type Filter = 'all' | 'multi' | 'active' | 'issues'

function spreadOf(row: TickerRow): { ratio: number | null; values: number[] } {
  const vals = SOURCES.map((s) => headlineOf(row.latest[s]?.derived)).filter(isNum)
  if (vals.length < 2) return { ratio: null, values: vals }
  const mx = Math.max(...vals)
  const mn = Math.min(...vals)
  return { ratio: mn > 0 ? mx / mn : null, values: vals }
}

function cellUpside(v: VersionSummary | null | undefined): number | null {
  return upsideOf(v?.derived).value
}

function SourceCell({
  v,
  running,
  onOpen,
}: {
  v: VersionSummary | null | undefined
  running: number
  onOpen: (vid: string) => void
}) {
  if (!v)
    return running ? (
      <Chip tone="accent">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" /> building…
      </Chip>
    ) : (
      <span className="text-faint">—</span>
    )
  const d = v.derived
  const hl = headlineOf(d)
  const up = upsideOf(d)
  const stale = (ageDays(v.as_of) ?? 0) > 120
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onOpen(v.version_id)
      }}
      className="group -mx-1 -my-0.5 block w-[calc(100%+8px)] rounded px-1 py-0.5 text-left hover:bg-sunken"
      title={`${v.version_id}\n${v.model ? `model ${v.model}` : ''}`}
    >
      <div className="flex items-baseline gap-1.5">
        <span className={clsx('num text-[13px] font-semibold', isNum(hl) && hl < 0 && 'text-neg')}>
          {fmtPS(hl, d?.quote_currency)}
        </span>
        <UpsideChip
          value={up.value}
          title={up.basis === 'model' ? "vs the model's own as-of price (no common compare price yet)" : 'vs common compare price'}
        />
        {up.basis === 'model' && <span className="text-2xs text-faint" title="vs the model's own as-of price">m</span>}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1">
        <span className={clsx('num text-2xs', stale ? 'text-warn' : 'text-faint')} title={`as of ${fmtDate(v.as_of)}`}>
          {fmtDate(v.as_of)} · {fmtAge(v.as_of)}
        </span>
        {v.status !== 'valid' && <StatusBadge status={v.status} />}
        <LegacyBadge origin={v.origin} />
        {v.reproducibility && v.reproducibility !== 'exact' && <ReproBadge grade={v.reproducibility} compact />}
        <QualityBadge quality={v.quality} />
        {running > 0 && (
          <Chip tone="accent" title={`${running} active run(s) for this source`}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            run
          </Chip>
        )}
        {d?.error && (
          <Chip tone="neg" title={d.error}>
            derive error
          </Chip>
        )}
      </div>
    </button>
  )
}

export function DashboardPage() {
  const q = useSummary()
  const runs = useRuns(true)
  const refresh = useRefreshPrices()
  const { open } = useRunLauncher()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'ticker', dir: 1 })

  const activeBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of runs.data ?? []) {
      const k = `${r.ticker}|${r.source}`
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [runs.data])

  const rows = useMemo(() => {
    const all = q.data?.tickers ?? []
    const s = search.trim().toLowerCase()
    let out = all.filter((r) => !s || r.ticker.toLowerCase().includes(s) || (r.company ?? '').toLowerCase().includes(s))
    if (filter === 'multi') out = out.filter((r) => SOURCES.filter((src) => r.latest[src]).length >= 2)
    if (filter === 'active') out = out.filter((r) => r.active_runs > 0)
    if (filter === 'issues')
      out = out.filter((r) =>
        SOURCES.some((src) => {
          const v = r.latest[src]
          return v && (v.status !== 'valid' || v.reproducibility === 'none' || v.quality === 'unverified' || v.derived?.error)
        }),
      )
    const val = (r: TickerRow): string | number | null => {
      switch (sort.key) {
        case 'ticker':
          return r.ticker
        case 'company':
          return (r.company ?? '').toLowerCase()
        case 'price':
          return r.compare_price?.price ?? null
        case 'spread':
          return spreadOf(r).ratio
        case 'runs':
          return r.active_runs
        case 'versions':
          return r.versions_count
        default:
          return cellUpside(r.latest[sort.key])
      }
    }
    return [...out].sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      if (va === null && vb === null) return a.ticker.localeCompare(b.ticker)
      if (va === null) return 1
      if (vb === null) return -1
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * sort.dir
      return ((va as number) - (vb as number)) * sort.dir
    })
  }, [q.data, search, filter, sort])

  const th = (key: SortKey, label: React.ReactNode, cls?: string) => (
    <th
      className={clsx('cursor-pointer select-none hover:text-fg', cls)}
      onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'ticker' || key === 'company' ? 1 : -1 }))}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sort.key === key && <span className="text-fg">{sort.dir === 1 ? '▲' : '▼'}</span>}
      </span>
    </th>
  )

  const totals = useMemo(() => {
    const t = q.data?.tickers ?? []
    const models = t.reduce((n, r) => n + SOURCES.filter((s) => r.latest[s]).length, 0)
    const priced = t.filter((r) => isNum(r.compare_price?.price)).length
    return { tickers: t.length, models, priced }
  }, [q.data])

  const refreshResult = refresh.data
  const refreshErrors = refreshResult ? Object.entries(refreshResult).filter(([, v]) => v && 'error' in v && v.error) : []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-base font-semibold">Models</h1>
        <span className="num text-xs text-muted">
          {totals.tickers} tickers · {totals.models} latest models · {totals.priced} priced
          {(runs.data?.length ?? 0) > 0 && (
            <>
              {' · '}
              <Link to="/runs" className="link">
                {runs.data!.length} active runs
              </Link>
            </>
          )}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            className="input w-56"
            placeholder="Search ticker or company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Segmented
            options={[
              { id: 'all', label: 'All' },
              { id: 'multi', label: '≥2 sources', title: 'Tickers with models from at least two agents' },
              { id: 'active', label: 'Running' },
              { id: 'issues', label: 'Issues', title: 'Invalid, not reproducible, unverified or derive errors' },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <button className="btn" onClick={() => refresh.mutate(undefined)} disabled={refresh.isPending}>
            {refresh.isPending && <Spinner />}
            Refresh prices
          </button>
          <button className="btn btn-primary" onClick={() => open()}>
            New run
          </button>
        </div>
      </div>

      {refresh.error && <ErrorBox error={refresh.error} title="Price refresh failed" />}
      {refreshResult && !refresh.isPending && (
        <div className="text-2xs text-muted">
          Prices refreshed: {Object.keys(refreshResult).length - refreshErrors.length} ok
          {refreshErrors.length > 0 && (
            <span className="text-warn" title={refreshErrors.map(([t, v]) => `${t}: ${(v as { error?: string }).error}`).join('\n')}>
              {' '}
              · {refreshErrors.length} failed ({refreshErrors.slice(0, 6).map(([t]) => t).join(', ')}
              {refreshErrors.length > 6 ? '…' : ''})
            </span>
          )}
        </div>
      )}

      {q.isLoading ? (
        <Loading label="Loading models…" />
      ) : q.error && !q.data ? (
        <ErrorBox error={q.error} title="Could not load summary" />
      ) : (
        <div className="card scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                {th('ticker', 'Ticker', 'w-20')}
                {th('company', 'Company')}
                {th('price', 'Compare price', 'n')}
                {SOURCES.map((s) => (
                  <th
                    key={s}
                    className="min-w-[170px] cursor-pointer select-none hover:text-fg"
                    onClick={() => setSort((p) => ({ key: s, dir: p.key === s ? (p.dir === 1 ? -1 : 1) : -1 }))}
                    title="Sort by upside"
                  >
                    <span className="inline-flex items-center gap-1.5" style={{ color: sourceColor(s) }}>
                      <SourceDot source={s} />
                      {SOURCE_LABEL[s]}
                      {sort.key === s && <span className="text-fg">{sort.dir === 1 ? '▲' : '▼'}</span>}
                    </span>
                  </th>
                ))}
                {th('spread', <span title="max / min headline value across sources">Spread</span>, 'n')}
                {th('versions', 'Vers.', 'n')}
                {th('runs', 'Runs', 'n')}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const sp = spreadOf(r)
                const priceAge = ageDays(r.compare_price?.ts)
                return (
                  <tr key={r.ticker} className="cursor-pointer" onClick={() => navigate(tLink(r.ticker))}>
                    <td>
                      <Link
                        to={tLink(r.ticker)}
                        className="font-mono text-[13px] font-semibold hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.ticker}
                      </Link>
                    </td>
                    <td className="max-w-[220px] truncate text-muted" title={r.company ?? ''}>
                      {r.company ?? '—'}
                    </td>
                    <td className="n">
                      {isNum(r.compare_price?.price) ? (
                        <div>
                          <div className="font-medium">{fmtPS(r.compare_price!.price)}</div>
                          <div
                            className={clsx('text-2xs', (priceAge ?? 0) > 3 ? 'text-warn' : 'text-faint')}
                            title={`${r.compare_price?.source ?? ''} ${r.compare_price?.ts ?? ''}`}
                          >
                            {fmtAge(r.compare_price?.ts)} ago
                          </div>
                        </div>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    {SOURCES.map((s) => (
                      <td key={s}>
                        <SourceCell
                          v={r.latest[s]}
                          running={activeBy.get(`${r.ticker}|${s}`) ?? 0}
                          onOpen={(vid) => navigate(vLink(vid))}
                        />
                      </td>
                    ))}
                    <td className="n">
                      {sp.ratio !== null ? (
                        <span className={clsx('font-medium', sp.ratio > 1.5 && 'text-warn')} title={sp.values.map((v) => v.toFixed(2)).join(' / ')}>
                          {fmtMult(sp.ratio, 2)}
                        </span>
                      ) : sp.values.length >= 2 ? (
                        <span className="text-faint" title="a source has a non-positive value">
                          n/m
                        </span>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td className="n text-muted">{r.versions_count}</td>
                    <td className="n">
                      {r.active_runs > 0 ? (
                        <Chip tone="accent">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                          {r.active_runs}
                        </Chip>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6 + SOURCES.length} className="py-8 text-center text-faint">
                    {q.data?.tickers.length ? 'No tickers match the filter.' : 'No models yet — start a run or import legacy models.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {q.error && q.data && <div className="text-2xs text-warn">Refresh failed: {errorMessage(q.error)} (showing cached data)</div>}
    </div>
  )
}
