import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { useImports, useRunImports } from '../api/hooks'
import { ApiError } from '../api/client'
import type { ImportItem } from '../types/api'
import { fmtPS, isNum } from '../lib/format'
import { tLink, vLink } from '../lib/links'
import { Chip, QualityBadge, ReproBadge, SourceBadge, StatusBadge } from '../components/badges'
import { Card, Empty, ErrorBox, Loading, Segmented, Spinner } from '../components/ui'

type SrcF = 'all' | 'claude' | 'codex' | 'grok'

export function ImportsPage() {
  const q = useImports()
  const run = useRunImports()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [src, setSrc] = useState<SrcF>('all')
  const [status, setStatus] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [hideSuperseded, setHideSuperseded] = useState(false)

  const items = useMemo(() => q.data?.items ?? [], [q.data])
  const statuses = useMemo(() => [...new Set(items.map((i) => i.status))].sort(), [items])
  const shown = useMemo(() => {
    const s = search.trim().toUpperCase()
    return items.filter(
      (i) =>
        (src === 'all' || i.source === src) &&
        (status === 'all' || i.status === status) &&
        (!hideSuperseded || !i.superseded_by) &&
        (!s || i.ticker.toUpperCase().includes(s) || i.legacy_id.toUpperCase().includes(s)),
    )
  }, [items, src, status, search, hideSuperseded])

  const pending = items.filter((i) => i.status === 'pending')
  const selectable = (i: ImportItem) => i.status === 'pending' || ['failed', 'invalid', 'cancelled', 'interrupted'].includes(i.status)
  const allShownSelected = shown.filter(selectable).length > 0 && shown.filter(selectable).every((i) => sel.has(i.legacy_id))

  const toggle = (id: string) =>
    setSel((p) => {
      const n = new Set(p)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const notAvailable = q.error instanceof ApiError && q.error.status === 404

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-base font-semibold">Legacy imports</h1>
        {q.data && (
          <div className="flex flex-wrap items-center gap-1">
            {Object.entries(q.data.summary ?? {})
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => (
                <button key={k} onClick={() => setStatus(status === k ? 'all' : k)}>
                  <StatusBadge status={k} title={`${v} ${k}`} />
                  <span className="num ml-0.5 text-2xs text-muted">{v}</span>
                </button>
              ))}
            <span className="num ml-2 text-2xs text-faint">{items.length} total</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            className="btn"
            disabled={sel.size === 0 || run.isPending}
            onClick={() => {
              if (window.confirm(`Launch ${sel.size} import(s)? Claude/Codex imports run a conversion agent (costs API usage).`))
                run.mutate({ legacy_ids: [...sel] }, { onSuccess: () => setSel(new Set()) })
            }}
          >
            {run.isPending && <Spinner />}
            Import selected ({sel.size})
          </button>
          <button
            className="btn btn-primary"
            disabled={pending.length === 0 || run.isPending}
            onClick={() => {
              if (window.confirm(`Import all ${pending.length} pending legacy models? This launches conversion agents (costs API usage).`))
                run.mutate({ all: true })
            }}
          >
            Import all pending ({pending.length})
          </button>
        </div>
      </div>

      <ErrorBox error={run.error} title="Launch failed" />
      {run.data && (
        <div className="rounded border border-pos/30 bg-pos/5 px-3 py-2 text-xs">
          Launched {run.data.launched.length}:{' '}
          {run.data.launched.slice(0, 20).map((l) => (
            <span key={l.legacy_id} className={clsx('mr-2 font-mono text-[11px]', l.error && 'text-neg')} title={l.error ?? l.result ?? ''}>
              {l.version_id ? <Link className="link" to={vLink(l.version_id)}>{l.legacy_id}</Link> : l.legacy_id}
              {l.error ? ' ✗' : ''}
            </span>
          ))}
          {run.data.launched.length > 20 && '…'}
        </div>
      )}

      {q.isLoading ? (
        <Loading label="Loading import inventory…" />
      ) : notAvailable ? (
        <Card>
          <Empty>The imports endpoint is not available on this server yet (GET /api/imports → 404).</Empty>
        </Card>
      ) : q.error && !q.data ? (
        <ErrorBox error={q.error} title="Could not load imports" />
      ) : (
        <Card
          title={`Inventory (${shown.length})`}
          actions={
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-2xs text-muted">
                <input type="checkbox" checked={hideSuperseded} onChange={(e) => setHideSuperseded(e.target.checked)} />
                hide superseded
              </label>
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">all statuses</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input className="input w-36" placeholder="Filter ticker / id" value={search} onChange={(e) => setSearch(e.target.value)} />
              <Segmented
                size="xs"
                options={[
                  { id: 'all', label: 'All' },
                  { id: 'claude', label: 'Claude' },
                  { id: 'codex', label: 'Codex' },
                  { id: 'grok', label: 'Grok' },
                ]}
                value={src}
                onChange={setSrc}
              />
            </div>
          }
        >
          {shown.length === 0 ? (
            <Empty>No items match.</Empty>
          ) : (
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th className="w-6">
                      <input
                        type="checkbox"
                        checked={allShownSelected}
                        onChange={() =>
                          setSel((p) => {
                            const n = new Set(p)
                            const ids = shown.filter(selectable).map((i) => i.legacy_id)
                            if (allShownSelected) ids.forEach((id) => n.delete(id))
                            else ids.forEach((id) => n.add(id))
                            return n
                          })
                        }
                      />
                    </th>
                    <th>Legacy id</th>
                    <th>Source</th>
                    <th>Ticker</th>
                    <th>Generation</th>
                    <th>Quality</th>
                    <th>Status</th>
                    <th>Version</th>
                    <th>Validation</th>
                    <th className="n">Crosscheck (legacy → imported)</th>
                    <th>Files</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((i) => {
                    const cc = i.crosscheck
                    return (
                      <tr key={i.legacy_id} className={clsx(i.superseded_by && 'opacity-60')}>
                        <td>
                          {selectable(i) && <input type="checkbox" checked={sel.has(i.legacy_id)} onChange={() => toggle(i.legacy_id)} />}
                        </td>
                        <td className="font-mono text-[11px]" title={i.notes ?? ''}>
                          {i.legacy_id}
                          {i.superseded_by && <div className="text-2xs text-faint">superseded by {i.superseded_by}</div>}
                        </td>
                        <td>
                          <SourceBadge source={i.source} />
                        </td>
                        <td>
                          <Link className="font-mono font-semibold hover:underline" to={tLink(i.ticker)}>
                            {i.ticker}
                          </Link>
                        </td>
                        <td className="text-muted">{i.generation ?? '—'}</td>
                        <td>{i.quality === 'unverified' ? <QualityBadge quality="unverified" /> : <span className="text-2xs text-muted">{i.quality ?? '—'}</span>}</td>
                        <td>
                          <StatusBadge status={i.status} />
                        </td>
                        <td className="whitespace-nowrap">
                          {i.version_id ? (
                            <Link className="link font-mono text-[11px]" to={vLink(i.version_id)}>
                              {i.version_id}
                            </Link>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap">
                          {i.validation ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="num text-2xs text-muted">
                                {i.validation.fail ?? 0}F {i.validation.warn ?? 0}W {i.validation.pass ?? 0}P
                              </span>
                              <ReproBadge grade={i.reproducibility} compact />
                            </span>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                        <td className="n whitespace-nowrap">
                          {cc ? (
                            <span className="inline-flex items-center gap-1">
                              {fmtPS(cc.legacy_vps)} → {fmtPS(cc.imported_vps)}
                              {cc.match === true && <Chip tone="pos">match</Chip>}
                              {cc.match === false && <Chip tone="neg">mismatch</Chip>}
                              {isNum(cc.legacy_vps) && isNum(cc.imported_vps) && cc.match === false && cc.legacy_vps !== 0 && (
                                <span className="text-2xs text-neg">{(((cc.imported_vps as number) / (cc.legacy_vps as number) - 1) * 100).toFixed(1)}%</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-faint">—</span>
                          )}
                        </td>
                        <td className="max-w-[220px] truncate font-mono text-2xs text-faint" title={(i.files ?? []).join('\n')}>
                          {(i.files ?? []).map((f) => f.split('/').pop()).join(', ')}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
