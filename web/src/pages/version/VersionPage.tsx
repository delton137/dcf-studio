import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useVersion } from '../../api/hooks'
import { downloadUrl, exportXlsxUrl } from '../../api/client'
import { ACTIVE_STATUSES, type Source } from '../../types/api'
import { fmtAge, fmtDate, fmtDateTime, fmtPS, isNum, shortVid } from '../../lib/format'
import { headlineOf, upsideOf } from '../../lib/derive'
import { isSource } from '../../lib/sources'
import { runLink, tLink, vLink } from '../../lib/links'
import { Chip, LegacyBadge, QualityBadge, ReproBadge, SourceBadge, StatusBadge, UpsideChip } from '../../components/badges'
import { ErrorBox, Loading, Spinner, Tabs, errorMessage } from '../../components/ui'
import { useRunLauncher } from '../../components/RunLauncher'
import { RunLog } from '../../components/RunLog'
import { SummaryTab } from './SummaryTab'
import { ProjectionsTab } from './ProjectionsTab'
import { WhatIfTab } from './WhatIfTab'
import { SensitivityTab } from './SensitivityTab'
import { BridgeTab } from './BridgeTab'
import { ChecksTab } from './ChecksTab'
import { ReportTab } from './ReportTab'
import { SourcesTab } from './SourcesTab'
import { FilesTab } from './FilesTab'
import { VersionsTab } from './VersionsTab'

type TabId =
  | 'summary'
  | 'projections'
  | 'whatif'
  | 'sensitivity'
  | 'bridge'
  | 'checks'
  | 'report'
  | 'sources'
  | 'files'
  | 'versions'
  | 'log'

export function VersionPage() {
  const { vid = '' } = useParams()
  const q = useVersion(vid)
  const [params, setParams] = useSearchParams()
  const { open } = useRunLauncher()
  const [exporting, setExporting] = useState(false)
  const [exportErr, setExportErr] = useState<string | null>(null)

  if (q.isLoading) return <Loading label="Loading version…" />
  if (q.error && !q.data) return <ErrorBox error={q.error} title={`Could not load ${vid}`} />
  const data = q.data
  if (!data) return null
  const s = data.summary
  const dcf = data.dcf
  const derived = dcf?.derived ?? s?.derived ?? null
  const ticker = s?.ticker ?? data.run?.ticker ?? dcf?.provenance?.ticker ?? ''
  const source = (s?.source ?? data.run?.source ?? '') as string
  const active = !!s?.status && ACTIVE_STATUSES.includes(s.status)
  const hasLog = s?.origin === 'run' || !!data.run?.cli || active
  const ccy = derived?.quote_currency ?? dcf?.listing?.quote_currency

  const tabs: { id: TabId; label: string; hidden?: boolean }[] = [
    { id: 'summary', label: 'Summary', hidden: !dcf },
    { id: 'projections', label: 'Projections', hidden: !dcf },
    { id: 'whatif', label: 'What-if', hidden: !dcf },
    { id: 'sensitivity', label: `Sensitivity${dcf?.grids?.length ? ` (${dcf.grids.length})` : ''}`, hidden: !dcf },
    { id: 'bridge', label: 'Bridge', hidden: !dcf },
    { id: 'checks', label: 'Checks' },
    { id: 'report', label: 'Report' },
    { id: 'sources', label: 'Sources & assumptions', hidden: !dcf },
    { id: 'files', label: 'Files' },
    { id: 'versions', label: 'Versions' },
    { id: 'log', label: active ? 'Run log ●' : 'Run log', hidden: !hasLog },
  ]
  const visible = tabs.filter((t) => !t.hidden).map((t) => t.id)
  const requested = params.get('tab') as TabId | null
  const tab: TabId =
    requested && visible.includes(requested) ? requested : dcf ? 'summary' : hasLog ? 'log' : 'files'
  const setTab = (t: TabId) => {
    const n = new URLSearchParams(params)
    n.set('tab', t)
    setParams(n, { replace: true })
  }

  const hl = headlineOf(derived)
  const up = upsideOf(derived)

  const doExport = async () => {
    setExporting(true)
    setExportErr(null)
    try {
      await downloadUrl(exportXlsxUrl(vid), `${ticker}_${vid}.xlsx`)
    } catch (e) {
      setExportErr(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* header */}
      <div className="flex flex-wrap items-start gap-x-6 gap-y-2">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Link to="/" className="hover:text-fg">
              Dashboard
            </Link>
            <span>/</span>
            {ticker && (
              <Link to={tLink(ticker)} className="font-mono hover:text-fg">
                {ticker}
              </Link>
            )}
            <span>/</span>
            <span className="font-mono">{vid}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-lg font-semibold">{ticker}</h1>
            <span className="text-sm text-muted">{s?.company ?? dcf?.provenance?.company ?? ''}</span>
            <SourceBadge source={source} />
            <StatusBadge status={s?.status ?? data.run?.status} />
            <LegacyBadge origin={s?.origin} />
            <ReproBadge grade={s?.reproducibility} />
            <QualityBadge quality={s?.quality} />
            {s?.latest && <Chip tone="pos">latest</Chip>}
            {s?.superseded && <Chip tone="muted">superseded</Chip>}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 text-2xs text-muted">
            <span>
              as of <b className="text-fg">{fmtDate(s?.as_of ?? dcf?.basis?.as_of)}</b> ({fmtAge(s?.as_of ?? dcf?.basis?.as_of)} old)
            </span>
            <span>created {fmtDateTime(s?.created_at)}</span>
            {(s?.cli || s?.model) && (
              <span>
                {s?.origin === 'import' ? 'converted by' : 'built by'} {s?.cli ?? '—'} · {s?.model ?? '—'}
                {s?.effort && s.effort !== 'n/a' ? ` · ${s.effort}` : ''}
              </span>
            )}
            {s?.parent_version && (
              <span>
                parent{' '}
                <Link className="link font-mono" to={vLink(s.parent_version)}>
                  {shortVid(s.parent_version)}
                </Link>
              </span>
            )}
            {active && (
              <Link className="link" to={runLink(vid)}>
                run in progress →
              </Link>
            )}
          </div>
        </div>
        {dcf && (
          <div className="flex items-center gap-3 rounded border border-line bg-panel px-3 py-1.5">
            <div>
              <div className="label">Headline</div>
              <div className={`num text-xl font-semibold ${isNum(hl) && hl < 0 ? 'text-neg' : ''}`}>{fmtPS(hl, ccy)}</div>
            </div>
            <div className="text-xs">
              <UpsideChip value={up.value} className="text-xs" />
              <div className="num text-2xs text-muted">
                vs {fmtPS(up.basis === 'compare' ? derived?.compare_price : derived?.price_model, ccy)}{' '}
                {up.basis === 'model' ? '(model px)' : ''}
              </div>
            </div>
            <div className="num border-l border-line pl-3 text-2xs text-muted">
              <div>bear {fmtPS(derived?.value_ps?.bear, ccy)}</div>
              <div>base {fmtPS(derived?.value_ps?.base, ccy)}</div>
              <div>bull {fmtPS(derived?.value_ps?.bull, ccy)}</div>
            </div>
          </div>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            className="btn"
            disabled={!isSource(source) || !ticker}
            title="Start an update run from this version with the same agent"
            onClick={() =>
              open({
                ticker,
                mode: 'update',
                sources: [source as Source],
                parent_versions: { [source]: vid } as Partial<Record<Source, string>>,
              })
            }
          >
            Update with this agent
          </button>
          {ticker && (
            <Link className="btn" to={tLink(ticker)}>
              Compare
            </Link>
          )}
          <button className="btn" onClick={doExport} disabled={exporting || !dcf}>
            {exporting && <Spinner />}
            Export xlsx
          </button>
        </div>
      </div>
      {exportErr && <ErrorBox error={exportErr} title="Export failed" />}
      {s?.error && <ErrorBox error={s.error} title="Run error" />}
      {derived?.error && <ErrorBox error={derived.error} title="Derived metrics error" />}
      {!dcf && !active && (
        <div className="rounded border border-warn/40 bg-warn/5 px-3 py-2 text-xs text-warn">
          This version has no dcf.json{s?.status ? ` (status: ${s.status})` : ''}. Look at the run log, files and validator output.
        </div>
      )}

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      <div key={vid}>
        {tab === 'summary' && dcf && <SummaryTab data={data} dcf={dcf} />}
        {tab === 'projections' && dcf && <ProjectionsTab dcf={dcf} />}
        {tab === 'whatif' && dcf && <WhatIfTab vid={vid} data={data} dcf={dcf} />}
        {tab === 'sensitivity' && dcf && <SensitivityTab dcf={dcf} />}
        {tab === 'bridge' && dcf && <BridgeTab dcf={dcf} />}
        {tab === 'checks' && <ChecksTab data={data} />}
        {tab === 'report' && <ReportTab vid={vid} />}
        {tab === 'sources' && dcf && <SourcesTab dcf={dcf} />}
        {tab === 'files' && <FilesTab vid={vid} />}
        {tab === 'versions' && <VersionsTab vid={vid} data={data} />}
        {tab === 'log' && <RunLog vid={vid} />}
      </div>
    </div>
  )
}
