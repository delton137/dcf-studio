import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { useRun, useRuns } from '../api/hooks'
import { ACTIVE_STATUSES, TERMINAL_STATUSES, type RunMeta, type Usage } from '../types/api'
import { durationBetween, fmtAge, fmtDateTime, fmtDuration, fmtTokens, fmtUsd, isNum } from '../lib/format'
import { isAgentTicker, runLink, screenerAgentLink, tLink } from '../lib/links'
import { Chip, SourceBadge, StatusBadge } from '../components/badges'
import { Card, Collapsible, Empty, ErrorBox, Loading, Segmented, useNow } from '../components/ui'
import { RunLaunchForm } from '../components/RunLauncher'

export function UsageCell({ usage }: { usage?: Usage | null }) {
  if (!usage || !Object.keys(usage).length) return <span className="text-faint">—</span>
  const inTok = (usage.input_tokens ?? 0) + ((usage.cache_read_input_tokens as number | undefined) ?? 0) + ((usage.cache_creation_input_tokens as number | undefined) ?? 0)
  return (
    <span className="num whitespace-nowrap" title={JSON.stringify(usage, null, 1)}>
      {isNum(usage.cost_usd) ? <b>{fmtUsd(usage.cost_usd)}</b> : <span className="text-faint">$—</span>}
      <span className="text-2xs text-muted">
        {' '}
        · {fmtTokens(inTok)} in / {fmtTokens(usage.output_tokens)} out
      </span>
    </span>
  )
}

function ValidationCell({ vid, status }: { vid: string; status?: string }) {
  const terminal = !!status && TERMINAL_STATUSES.includes(status)
  const q = useRun(terminal ? vid : undefined, { poll: false, staleTime: 5 * 60_000 })
  if (!terminal) return <span className="text-faint">…</span>
  const v = q.data?.validation
  if (q.isLoading) return <span className="text-faint">·</span>
  if (!v) return <span className="text-faint">—</span>
  return (
    <span className="inline-flex items-center gap-1">
      <Chip tone={v.ok ? 'pos' : 'neg'}>{v.ok ? 'ok' : 'fail'}</Chip>
      <span className="num text-2xs text-muted">
        {v.summary?.fail ?? 0}F {v.summary?.warn ?? 0}W
      </span>
    </span>
  )
}

function RunsTable({ runs, showValidation = true, now }: { runs: RunMeta[]; showValidation?: boolean; now: number }) {
  const navigate = useNavigate()
  return (
    <div className="scroll-x">
      <table className="tbl">
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Source</th>
            <th>Kind</th>
            <th>Status</th>
            <th>Model</th>
            <th>Started</th>
            <th className="n">Duration</th>
            <th>Cost / tokens</th>
            {showValidation && <th>Validation</th>}
            <th>Version</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const id = r.id ?? ''
            const active = !!r.status && ACTIVE_STATUSES.includes(r.status)
            const dur = durationBetween(r.started_at ?? (active ? null : r.created_at), active ? null : r.finished_at, now)
            return (
              <tr key={id} className="cursor-pointer" onClick={() => navigate(runLink(id))}>
                <td>
                  {isAgentTicker(r.ticker) ? (
                    <Link to={screenerAgentLink(id)} className="font-semibold hover:underline" onClick={(e) => e.stopPropagation()} title="Screener agent job">
                      Screener
                    </Link>
                  ) : (
                    <Link to={tLink(r.ticker ?? '')} className="font-mono font-semibold hover:underline" onClick={(e) => e.stopPropagation()}>
                      {r.ticker}
                    </Link>
                  )}
                </td>
                <td>
                  <SourceBadge source={r.source} />
                </td>
                <td className="text-muted">
                  {r.kind ?? '—'}
                  {r.parent_version && <span className="text-2xs text-faint"> ↻</span>}
                </td>
                <td>
                  <StatusBadge status={r.status} title={r.error ?? undefined} />
                </td>
                <td className="font-mono text-[11px]">
                  {r.origin === 'import' && r.cli ? <span className="text-faint">via </span> : null}
                  {r.model ?? '—'}
                  {r.effort && r.effort !== 'n/a' ? <span className="text-faint"> · {r.effort}</span> : null}
                </td>
                <td className="num text-muted" title={r.started_at ?? r.created_at ?? ''}>
                  {r.started_at ? fmtDateTime(r.started_at) : r.status === 'queued' ? <span className="text-faint">queued {fmtAge(r.created_at, now)}</span> : fmtDateTime(r.created_at)}
                </td>
                <td className="n">{dur !== null && r.status !== 'queued' ? fmtDuration(dur) : '—'}</td>
                <td>
                  <UsageCell usage={r.usage} />
                </td>
                {showValidation && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <ValidationCell vid={id} status={r.status} />
                  </td>
                )}
                <td className="font-mono text-[11px] text-muted">{id}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type KindFilter = 'all' | 'new' | 'update' | 'import'

export function RunsPage() {
  const active = useRuns(true)
  const recent = useRuns(false)
  const now = useNow(1000)
  const [kind, setKind] = useState<KindFilter>('all')
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(60)

  const filtered = useMemo(() => {
    const s = search.trim().toUpperCase()
    return (recent.data ?? []).filter(
      (r) =>
        !(r.status && ACTIVE_STATUSES.includes(r.status)) &&
        (kind === 'all' || r.kind === kind) &&
        (!s || (r.ticker ?? '').includes(s) || (r.id ?? '').toUpperCase().includes(s)),
    )
  }, [recent.data, kind, search])

  const totalCost = filtered.reduce((n, r) => n + (isNum(r.usage?.cost_usd) ? r.usage!.cost_usd! : 0), 0)

  return (
    <div className="space-y-3">
      <h1 className="text-base font-semibold">Runs</h1>
      <Card title="Launch agents" bodyClassName="p-3">
        <Collapsible title={<span className="text-xs">New run form</span>} defaultOpen>
          <RunLaunchForm />
        </Collapsible>
      </Card>

      <Card title={`Active (${active.data?.length ?? 0})`}>
        {active.isLoading ? (
          <Loading />
        ) : active.error ? (
          <ErrorBox error={active.error} className="m-2" />
        ) : (active.data ?? []).length === 0 ? (
          <Empty>No active runs.</Empty>
        ) : (
          <RunsTable runs={active.data ?? []} showValidation={false} now={now} />
        )}
      </Card>

      <Card
        title={`Recent (${filtered.length})`}
        actions={
          <div className="flex items-center gap-2">
            <span className="num text-2xs text-muted">total {fmtUsd(totalCost)}</span>
            <input className="input w-40" placeholder="Filter ticker / id" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Segmented
              size="xs"
              options={[
                { id: 'all', label: 'All' },
                { id: 'new', label: 'New' },
                { id: 'update', label: 'Update' },
                { id: 'import', label: 'Import' },
              ]}
              value={kind}
              onChange={setKind}
            />
          </div>
        }
      >
        {recent.isLoading ? (
          <Loading />
        ) : recent.error ? (
          <ErrorBox error={recent.error} className="m-2" />
        ) : filtered.length === 0 ? (
          <Empty>No finished runs.</Empty>
        ) : (
          <>
            <RunsTable runs={filtered.slice(0, limit)} now={now} />
            {filtered.length > limit && (
              <div className={clsx('p-2 text-center text-xs')}>
                <button className="link" onClick={() => setLimit((l) => l + 100)}>
                  Show more ({filtered.length - limit} hidden)
                </button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
