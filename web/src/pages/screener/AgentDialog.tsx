import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { useAgentResult, useAgentRuns, useCancelRun, useConfig, useRun, useStartAgent } from '../../api/hooks'
import { ACTIVE_STATUSES, type Source } from '../../types/api'
import type { AgentRunMeta, Screen } from '../../types/screener'
import { durationBetween, fmtDateTime, fmtDuration, fmtUsd } from '../../lib/format'
import { AGENT_ROWS } from '../../lib/screener'
import { runLink } from '../../lib/links'
import { Modal } from '../../components/Modal'
import { Markdown } from '../../components/Markdown'
import { RunLog } from '../../components/RunLog'
import { Chip, LevelChip, SourceBadge, StatusBadge } from '../../components/badges'
import { Collapsible, Empty, ErrorBox, Loading, Spinner, Tabs, useNow } from '../../components/ui'
import { SourcePicker, effectiveSources, effortOf, modelOf, useSourcePicker } from '../../components/SourcePicker'

export type AgentTab = 'shortlist' | 'theme' | 'runs'
export interface AgentDialogState {
  tab: AgentTab
  vid?: string
}

/* ------------------------------------------------------------------ CLI picker defaults */

function useAgentPicker() {
  return useSourcePicker({
    sources: ['claude'],
    models: { claude: 'sonnet' },
    efforts: { claude: 'medium', codex: 'medium', grok: 'medium', agy: 'medium' },
  })
}

function cliOf(st: ReturnType<typeof useAgentPicker>, backends: Parameters<typeof effectiveSources>[1]): Source | null {
  return effectiveSources(st, backends)[0] ?? null
}

/* ------------------------------------------------------------------ forms */

function ShortlistForm({
  screen,
  matched,
  onStarted,
}: {
  screen: Omit<Screen, 'cols'>
  matched: number
  onStarted: (vid: string) => void
}) {
  const cfg = useConfig()
  const start = useStartAgent()
  const picker = useAgentPicker()
  const [topN, setTopN] = useState(10)
  const [objective, setObjective] = useState('')
  const backends = cfg.data?.backends ?? {}
  const cli = cliOf(picker, backends)
  if (cfg.isLoading) return <Loading label="Loading backends…" />
  return (
    <div className="space-y-3 text-xs">
      <div className="rounded border border-line bg-sunken px-3 py-2 text-muted">
        The agent reviews <b className="text-fg">the current screen's top {Math.min(AGENT_ROWS, matched)} rows</b>
        {matched > AGENT_ROWS ? ` (of ${matched.toLocaleString()} matched, in the current sort order)` : ''} and picks the names most worth a
        full DCF, with a thesis, catalyst, key risk and the question the DCF must answer.
        {screen.name ? (
          <>
            {' '}
            Screen: <b className="text-fg">{screen.name}</b>.
          </>
        ) : null}
      </div>
      {matched === 0 && <ErrorBox error="The current screen matches no stocks." title="Nothing to review" />}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="label">Picks (max)</span>
          <input
            type="number"
            min={1}
            max={25}
            className="input w-20 num"
            value={topN}
            onChange={(e) => setTopN(Math.max(1, Math.min(25, Number(e.target.value) || 10)))}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="label">Objective (optional)</span>
        <textarea
          className="input min-h-[60px]"
          value={objective}
          placeholder="e.g. Prefer AI-adjacent hardware with near-term earnings; avoid Chinese ADRs."
          onChange={(e) => setObjective(e.target.value)}
        />
      </label>
      <SourcePicker state={picker} backends={backends} single idPrefix="agent-sl" />
      <ErrorBox error={start.error} title="Could not start" />
      <div className="flex justify-end">
        <button
          className="btn btn-primary"
          disabled={!cli || matched === 0 || start.isPending}
          onClick={() =>
            cli &&
            start.mutate(
              {
                kind: 'shortlist',
                screen,
                top_n: topN,
                objective: objective.trim() || undefined,
                cli,
                model: modelOf(picker, backends, cli) || undefined,
                effort: effortOf(picker, backends, cli) || undefined,
              },
              { onSuccess: (r) => onStarted(r.version_id) },
            )
          }
        >
          {start.isPending && <Spinner className="border-bg/40 border-t-bg" />}
          Start shortlist agent
        </button>
      </div>
    </div>
  )
}

function ThemeForm({ onStarted }: { onStarted: (vid: string) => void }) {
  const cfg = useConfig()
  const start = useStartAgent()
  const picker = useAgentPicker()
  const [query, setQuery] = useState('')
  const [listName, setListName] = useState('')
  const backends = cfg.data?.backends ?? {}
  const cli = cliOf(picker, backends)
  if (cfg.isLoading) return <Loading label="Loading backends…" />
  return (
    <div className="space-y-3 text-xs">
      <div className="rounded border border-line bg-sunken px-3 py-2 text-muted">
        The agent maps a theme to listed US symbols (pure plays and companies with material exposure), using its knowledge and web
        research. When it finishes and validates, the list is saved automatically and appears under <b className="text-fg">Lists</b>.
      </div>
      <label className="flex flex-col gap-1">
        <span className="label">Theme</span>
        <input
          className="input"
          value={query}
          autoFocus
          placeholder="e.g. AI data-center power equipment"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">List name (optional)</span>
        <input className="input w-72" value={listName} placeholder="defaults to the agent's name for the theme" onChange={(e) => setListName(e.target.value)} />
      </label>
      <SourcePicker state={picker} backends={backends} single idPrefix="agent-th" />
      <ErrorBox error={start.error} title="Could not start" />
      <div className="flex justify-end">
        <button
          className="btn btn-primary"
          disabled={!cli || !query.trim() || start.isPending}
          onClick={() =>
            cli &&
            start.mutate(
              {
                kind: 'theme',
                query: query.trim(),
                list_name: listName.trim() || undefined,
                cli,
                model: modelOf(picker, backends, cli) || undefined,
                effort: effortOf(picker, backends, cli) || undefined,
              },
              { onSuccess: (r) => onStarted(r.version_id) },
            )
          }
        >
          {start.isPending && <Spinner className="border-bg/40 border-t-bg" />}
          Build theme list
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ run view */

function describeRun(r: AgentRunMeta): string {
  const x = r.screener ?? {}
  if (r.kind === 'theme') return x.query ?? r.instructions ?? '—'
  const name = x.screen?.name ?? 'custom screen'
  return `${name} · top ${x.top_n ?? '?'}${x.objective ? ` · ${x.objective}` : ''}`
}

function AgentRunView({
  vid,
  onRunDcf,
  onOpenList,
}: {
  vid: string
  onRunDcf: (symbols: string[]) => void
  onOpenList: (slug: string) => void
}) {
  const rq = useRun(vid)
  const res = useAgentResult(vid)
  const cancel = useCancelRun()
  const now = useNow(1000)
  const run = (res.data?.run ?? rq.data?.run ?? {}) as AgentRunMeta
  const status = rq.data?.run?.status ?? run.status
  const active = !status || ACTIVE_STATUSES.includes(status)
  const picks = useMemo(() => res.data?.shortlist?.picks ?? [], [res.data])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<'result' | 'report' | 'log'>('result')
  useEffect(() => {
    setChecked(new Set(picks.map((p) => p.symbol)))
  }, [picks])
  // live log while running; the result once finished
  useEffect(() => {
    setTab(active ? 'log' : 'result')
  }, [active])

  const usage = rq.data?.run?.usage ?? run.usage
  const elapsed = durationBetween(run.started_at ?? run.created_at, active ? null : run.finished_at, now)
  const val = res.data?.validation ?? rq.data?.validation
  const issues = (val?.items ?? []).filter((i) => i.level === 'fail' || i.level === 'warn')
  const members = res.data?.universe?.members ?? []
  const listSlug = run.result_list ?? (res.data?.run as AgentRunMeta | undefined)?.result_list

  if (res.isLoading && rq.isLoading) return <Loading label="Loading agent run…" />

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="muted">{run.kind ?? 'agent'}</Chip>
        <StatusBadge status={status} />
        {run.cli && <SourceBadge source={run.cli} />}
        <span className="font-mono text-[11px] text-muted">
          {run.model ?? '—'}
          {run.effort ? ` · ${run.effort}` : ''}
        </span>
        <span className="num text-muted">
          {status === 'queued' ? 'queued' : fmtDuration(elapsed)} · {fmtUsd(usage?.cost_usd)}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted" title={describeRun(run)}>
          {describeRun(run)}
        </span>
        <Link to={runLink(vid)} className="link text-2xs" target="_blank">
          run page ↗
        </Link>
        {active && (
          <button
            className="btn btn-danger"
            disabled={cancel.isPending}
            onClick={() => {
              if (window.confirm('Cancel this agent run?')) cancel.mutate(vid)
            }}
          >
            Cancel
          </button>
        )}
      </div>
      <ErrorBox error={res.error ?? rq.error} />
      <ErrorBox error={cancel.error} title="Cancel failed" />
      {run.error && <ErrorBox error={run.error} title="Run error" />}

      <Tabs
        className="overflow-y-hidden"
        tabs={[
          { id: 'result', label: run.kind === 'theme' ? `List (${members.length})` : `Picks (${picks.length})` },
          { id: 'report', label: 'Report', hidden: run.kind === 'theme' },
          { id: 'log', label: active ? 'Live log' : 'Log' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'log' && <RunLog vid={vid} maxHeight="48vh" />}

      {tab === 'result' && (
        <div className="space-y-2">
          {!active && val && !val.ok && (
            <div className="rounded border border-neg/40 bg-neg/5 px-3 py-2">
              <div className="mb-1 font-semibold text-neg">Output failed validation</div>
              <ul className="space-y-0.5">
                {issues.slice(0, 8).map((i, k) => (
                  <li key={k} className="flex items-start gap-1.5">
                    <LevelChip level={i.level} />
                    <span className="font-mono text-[11px]">{i.id}</span>
                    <span className="text-muted">{i.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {active && <Empty>The agent is still working — results appear here when it finishes (see the live log).</Empty>}

          {!active && run.kind !== 'theme' && (
            <>
              {picks.length === 0 ? (
                <Empty>No picks were produced.</Empty>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={checked.size === picks.length}
                        onChange={() => setChecked(checked.size === picks.length ? new Set() : new Set(picks.map((p) => p.symbol)))}
                      />
                      <span className="text-muted">all</span>
                    </label>
                    <button className="btn btn-primary ml-auto" disabled={!checked.size} onClick={() => onRunDcf(picks.filter((p) => checked.has(p.symbol)).map((p) => p.symbol))}>
                      Run DCF on selected ({checked.size})…
                    </button>
                  </div>
                  <ol className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
                    {picks.map((p, i) => (
                      <li key={p.symbol} className={clsx('rounded border px-2.5 py-1.5', checked.has(p.symbol) ? 'border-accent/40 bg-accent/5' : 'border-line')}>
                        <label className="flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked.has(p.symbol)}
                            onChange={() =>
                              setChecked((c) => {
                                const n = new Set(c)
                                if (n.has(p.symbol)) n.delete(p.symbol)
                                else n.add(p.symbol)
                                return n
                              })
                            }
                          />
                          <span className="num w-5 text-right text-muted">{p.rank ?? i + 1}.</span>
                          <span className="font-mono text-[13px] font-semibold">{p.symbol}</span>
                        </label>
                        <div className="mt-1 grid grid-cols-[110px_1fr] gap-x-3 gap-y-0.5 pl-7">
                          <span className="text-muted">Thesis</span>
                          <span>{p.thesis ?? '—'}</span>
                          <span className="text-muted">Why now</span>
                          <span>{p.why_now ?? '—'}</span>
                          <span className="text-muted">Key risk</span>
                          <span>{p.key_risk ?? '—'}</span>
                          <span className="text-muted">DCF must answer</span>
                          <span className="font-medium">{p.what_the_dcf_must_answer ?? '—'}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </>
          )}

          {!active && run.kind === 'theme' && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{res.data?.universe?.name ?? run.screener?.list_name ?? run.screener?.query}</span>
                {listSlug ? (
                  <button className="btn btn-primary ml-auto" onClick={() => onOpenList(listSlug)}>
                    Open list
                  </button>
                ) : (
                  <span className="ml-auto text-2xs text-faint">{val?.ok ? 'list not saved' : 'list is saved only when the output validates'}</span>
                )}
              </div>
              {res.data?.universe?.description && <p className="text-muted">{res.data.universe.description}</p>}
              {members.length > 0 ? (
                <div className="max-h-[48vh] overflow-y-auto rounded border border-line">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Symbol</th>
                        <th>Name</th>
                        <th>Exposure</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.symbol}>
                          <td className="font-mono font-semibold">{m.symbol}</td>
                          <td className="max-w-[180px] truncate text-muted" title={m.name}>
                            {m.name ?? '—'}
                          </td>
                          <td>
                            <Chip tone={m.exposure === 'pure' ? 'pos' : m.exposure === 'major' ? 'accent' : 'muted'}>{m.exposure ?? '—'}</Chip>
                          </td>
                          <td className="text-muted">{m.note ?? ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>No members were produced.</Empty>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'report' &&
        (res.data?.report ? (
          <div className="max-h-[60vh] overflow-y-auto rounded border border-line p-3">
            <Markdown>{res.data.report}</Markdown>
          </div>
        ) : (
          <Empty>{active ? 'The report is written at the end of the run.' : 'No report.md was produced.'}</Empty>
        ))}
    </div>
  )
}

/* ------------------------------------------------------------------ past runs */

export function AgentRunsTable({ onOpen, limit }: { onOpen: (vid: string) => void; limit?: number }) {
  const q = useAgentRuns()
  if (q.isLoading) return <Loading />
  if (q.error) return <ErrorBox error={q.error} />
  const runs = (q.data ?? []).slice(0, limit)
  if (!runs.length) return <Empty>No screener agent runs yet.</Empty>
  return (
    <div className="max-h-[60vh] overflow-y-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>Started</th>
            <th>Kind</th>
            <th>Status</th>
            <th>Agent</th>
            <th className="n">Cost</th>
            <th>What</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="cursor-pointer" onClick={() => r.id && onOpen(r.id)}>
              <td className="num whitespace-nowrap text-muted">{fmtDateTime(r.created_at)}</td>
              <td>
                <Chip tone="muted">{r.kind ?? '—'}</Chip>
              </td>
              <td>
                <StatusBadge status={r.status} title={r.error ?? undefined} />
              </td>
              <td className="whitespace-nowrap font-mono text-[11px]">
                {r.cli ?? '—'} · {r.model ?? '—'}
              </td>
              <td className="n">{fmtUsd(r.usage?.cost_usd)}</td>
              <td className="max-w-[280px] truncate text-muted" title={describeRun(r)}>
                {describeRun(r)}
              </td>
              <td className="text-2xs">{r.result_list ? <Chip tone="accent">list: {r.result_list}</Chip> : <span className="text-faint">open →</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ------------------------------------------------------------------ dialog */

export function AgentDialog({
  state,
  onState,
  onClose,
  screen,
  matched,
  onRunDcf,
  onOpenList,
}: {
  state: AgentDialogState | null
  onState: (s: AgentDialogState) => void
  onClose: () => void
  screen: Omit<Screen, 'cols'>
  matched: number
  onRunDcf: (symbols: string[]) => void
  onOpenList: (slug: string) => void
}) {
  const title = state?.vid ? (
    <span className="flex items-center gap-2">
      <button className="btn btn-ghost px-1.5" onClick={() => state && onState({ tab: 'runs' })} title="All agent runs">
        ←
      </button>
      Screener agent run <span className="font-mono text-2xs font-normal text-muted">{state.vid}</span>
    </span>
  ) : (
    'Screener agent'
  )
  return (
    <Modal open={state !== null} onClose={onClose} title={title} width="max-w-4xl">
      {state &&
        (state.vid ? (
          <AgentRunView key={state.vid} vid={state.vid} onRunDcf={onRunDcf} onOpenList={onOpenList} />
        ) : (
          <div className="space-y-3">
            <Tabs
              className="overflow-y-hidden"
              tabs={[
                { id: 'shortlist', label: 'Shortlist from this screen' },
                { id: 'theme', label: 'Build a theme list' },
                { id: 'runs', label: 'Agent runs' },
              ]}
              value={state.tab}
              onChange={(t) => onState({ tab: t })}
            />
            {state.tab === 'shortlist' && <ShortlistForm screen={screen} matched={matched} onStarted={(vid) => onState({ tab: 'shortlist', vid })} />}
            {state.tab === 'theme' && <ThemeForm onStarted={(vid) => onState({ tab: 'theme', vid })} />}
            {state.tab === 'runs' && <AgentRunsTable onOpen={(vid) => onState({ tab: 'runs', vid })} />}
            <Collapsible title={<span className="text-2xs">About agent runs</span>}>
              <p className="text-2xs text-muted">
                Agent runs use the same runner as DCF runs (budget-capped per run). They appear in Runs; Claude runs are billed per token, Codex /
                Grok / Antigravity run on their subscriptions.
              </p>
            </Collapsible>
          </div>
        ))}
    </Modal>
  )
}
