import { Link, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { useCancelRun, useRun } from '../api/hooks'
import { ACTIVE_STATUSES } from '../types/api'
import { durationBetween, fmtDateTime, fmtDuration, fmtPS, fmtTokens, fmtUsd, isNum, shortVid } from '../lib/format'
import { headlineOf } from '../lib/derive'
import { isAgentTicker, screenerAgentLink, tLink, vLink } from '../lib/links'
import { Chip, LevelChip, SourceBadge, StatusBadge, UpsideChip } from '../components/badges'
import { Card, ErrorBox, KV, Loading, Spinner, useNow } from '../components/ui'
import { RunLog } from '../components/RunLog'

export function RunDetailPage() {
  const { vid = '' } = useParams()
  const q = useRun(vid)
  const cancel = useCancelRun()
  const now = useNow(1000)

  if (q.isLoading) return <Loading label="Loading run…" />
  if (q.error && !q.data) return <ErrorBox error={q.error} title={`Run ${vid}`} />
  const run = q.data?.run ?? {}
  const val = q.data?.validation
  const s = q.data?.summary
  const active = !!run.status && ACTIVE_STATUSES.includes(run.status)
  const elapsed = durationBetween(run.started_at ?? run.created_at, active ? null : run.finished_at, now)
  const u = run.usage ?? {}
  const hl = headlineOf(s?.derived)
  const fails = (val?.items ?? []).filter((i) => i.level === 'fail' || i.level === 'warn')

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted">
            <Link to="/runs" className="hover:text-fg">
              Runs
            </Link>
            <span>/</span>
            <span className="font-mono">{vid}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isAgentTicker(run.ticker) ? (
              <Link to={screenerAgentLink(vid)} className="text-lg font-semibold hover:underline">
                Screener agent
              </Link>
            ) : (
              <Link to={tLink(run.ticker ?? '')} className="font-mono text-lg font-semibold hover:underline">
                {run.ticker}
              </Link>
            )}
            <SourceBadge source={run.source} />
            <Chip tone="muted">{run.kind ?? '—'}</Chip>
            <StatusBadge status={run.status} />
            {active && <Spinner />}
          </div>
          <div className="text-2xs text-muted">
            {run.cli ?? '—'} · {run.model ?? '—'}
            {run.effort ? ` · effort ${run.effort}` : ''} · created {fmtDateTime(run.created_at)}
            {run.started_at ? ` · started ${fmtDateTime(run.started_at)}` : ''}
            {run.finished_at ? ` · finished ${fmtDateTime(run.finished_at)}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-3 rounded border border-line bg-panel px-3 py-1.5">
          <div>
            <div className="label">{active ? 'Elapsed' : 'Duration'}</div>
            <div className="num text-lg font-semibold">{run.status === 'queued' ? 'queued' : fmtDuration(elapsed)}</div>
          </div>
          <div className="border-l border-line pl-3">
            <div className="label">Cost</div>
            <div className="num text-lg font-semibold">{fmtUsd(u.cost_usd)}</div>
          </div>
          <div className="num border-l border-line pl-3 text-2xs text-muted">
            <div>in {fmtTokens(u.input_tokens)} · cache {fmtTokens(u.cache_read_input_tokens as number | undefined)}</div>
            <div>out {fmtTokens(u.output_tokens)}</div>
            {isNum(u.num_turns as number | undefined) && <div>{String(u.num_turns)} turns</div>}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {active && (
            <button
              className="btn btn-danger"
              disabled={cancel.isPending}
              onClick={() => {
                if (window.confirm(`Cancel run ${vid}?`)) cancel.mutate(vid)
              }}
            >
              {cancel.isPending && <Spinner />}
              Cancel run
            </button>
          )}
          {isAgentTicker(run.ticker) ? (
            <Link className={clsx('btn', !active && 'btn-primary')} to={screenerAgentLink(vid)}>
              Open in Screener →
            </Link>
          ) : (
            <Link className={clsx('btn', !active && s?.has_dcf && 'btn-primary')} to={vLink(vid)}>
              {s?.has_dcf ? 'Open version →' : 'Version page'}
            </Link>
          )}
        </div>
      </div>

      <ErrorBox error={cancel.error} title="Cancel failed" />
      {run.error && <ErrorBox error={run.error} title="Run error" />}

      {!active && (val || s?.has_dcf) && (
        <Card
          title="Result"
          actions={
            val ? (
              <span className="flex items-center gap-1.5">
                <Chip tone={val.ok ? 'pos' : 'neg'}>{val.ok ? 'valid' : 'invalid'}</Chip>
                <span className="num text-2xs text-muted">
                  {val.summary?.fail ?? 0} fail · {val.summary?.warn ?? 0} warn · {val.summary?.pass ?? 0} pass
                </span>
              </span>
            ) : null
          }
          bodyClassName="p-3"
        >
          <div className="flex flex-wrap items-start gap-6">
            {s?.has_dcf && (
              <div>
                <div className="label">Headline</div>
                <div className="num flex items-baseline gap-2">
                  <span className="text-xl font-semibold">{fmtPS(hl, s.derived?.quote_currency)}</span>
                  <UpsideChip value={s.derived?.upside_compare ?? s.derived?.upside_model} />
                </div>
                <div className="num text-2xs text-muted">
                  bear {fmtPS(s.derived?.value_ps?.bear)} · base {fmtPS(s.derived?.value_ps?.base)} · bull {fmtPS(s.derived?.value_ps?.bull)}
                </div>
              </div>
            )}
            {fails.length > 0 && (
              <div className="min-w-0 flex-1">
                <div className="label mb-1">Validator findings</div>
                <ul className="space-y-0.5 text-xs">
                  {fails.slice(0, 12).map((i, k) => (
                    <li key={k} className="flex items-start gap-1.5">
                      <LevelChip level={i.level} />
                      <span className="font-mono text-[11px]">{i.id}</span>
                      <span className="text-muted">{i.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_340px]">
        <RunLog vid={vid} maxHeight="calc(100vh - 260px)" />
        <div className="space-y-3">
          <Card title="Details" bodyClassName="p-3">
            <KV
              rows={[
                ['Version', <span className="break-all font-mono text-[11px]">{vid}</span>],
                ['Origin', run.origin ?? '—'],
                [
                  'Parent',
                  run.parent_version ? (
                    <Link className="link font-mono" to={vLink(run.parent_version)}>
                      {shortVid(run.parent_version)}
                    </Link>
                  ) : (
                    '—'
                  ),
                ],
                ['Exit code', run.exit_code ?? '—'],
                ['Session', <span className="break-all font-mono text-[11px]">{run.session_id ?? '—'}</span>],
                ...(run.legacy?.legacy_id
                  ? ([['Legacy', <span className="font-mono text-[11px]">{run.legacy.legacy_id} · {run.legacy.generation}</span>]] as [string, React.ReactNode][])
                  : []),
              ]}
            />
            {run.instructions && (
              <div className="mt-2">
                <div className="label mb-0.5">Instructions</div>
                <div className="whitespace-pre-wrap rounded bg-sunken p-2 text-xs">{run.instructions}</div>
              </div>
            )}
          </Card>
          <Card title={`Attempts (${run.attempts?.length ?? 0})`}>
            {(run.attempts ?? []).length ? (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th className="n">Duration</th>
                    <th className="n">Exit</th>
                    <th className="n">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {run.attempts!.map((a, i) => (
                    <tr key={i} title={a.error ?? ''}>
                      <td>{a.attempt === 0 ? 'main' : `fix ${a.attempt}`}</td>
                      <td className="n">{fmtDuration(a.duration_s)}</td>
                      <td className={clsx('n', a.exit_code ? 'text-neg' : '')}>{a.exit_code ?? '—'}</td>
                      <td className="n">{fmtUsd(a.usage?.cost_usd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-3 text-xs text-faint">{active ? 'In progress…' : 'None recorded.'}</div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
