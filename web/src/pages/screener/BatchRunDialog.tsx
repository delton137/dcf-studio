import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { api } from '../../api/client'
import { qk, useConfig, useRuns, useSummary } from '../../api/hooks'
import { SOURCES, type RunMeta, type RunStarted, type Source } from '../../types/api'
import { fmtUsd } from '../../lib/format'
import { median } from '../../lib/screener'
import { SOURCE_LABEL } from '../../lib/sources'
import { runLink, tLink } from '../../lib/links'
import { Modal } from '../../components/Modal'
import { SourceBadge } from '../../components/badges'
import { ErrorBox, Loading, Segmented, Spinner, errorMessage } from '../../components/ui'
import { SourcePicker, effectiveSources, sourceOverrides, useSourcePicker } from '../../components/SourcePicker'

export const MAX_DCF_BATCH = 10

export interface BatchItem {
  symbol: string
  /** DCF Studio ticker when the stock already has models */
  ticker?: string | null
  n_models?: number | null
  name?: string | null
}

/** Median cost per source over past DCF runs (not imports, not screener agent jobs); falls back to imports. */
export function useRunCostMedians(): Partial<Record<Source, { median: number; n: number; basis: 'runs' | 'imports' }>> {
  const runs = useRuns(false, 60_000)
  return useMemo(() => {
    const out: Partial<Record<Source, { median: number; n: number; basis: 'runs' | 'imports' }>> = {}
    const all = (runs.data ?? []).filter((r: RunMeta) => !(r.ticker ?? '').startsWith('_'))
    for (const s of SOURCES) {
      const mine = all.filter((r) => r.source === s && typeof r.usage?.cost_usd === 'number')
      const real = mine.filter((r) => r.origin === 'run')
      const pick = real.length ? real : mine
      const m = median(pick.map((r) => r.usage?.cost_usd))
      if (m !== null) out[s] = { median: m, n: pick.length, basis: real.length ? 'runs' : 'imports' }
    }
    return out
  }, [runs.data])
}

type Outcome = { ticker: string; state: 'pending' | 'starting' | 'ok' | 'error'; runs?: RunStarted[]; error?: string }

function BatchRunForm({ items, onClose }: { items: BatchItem[]; onClose: () => void }) {
  const cfg = useConfig()
  const qc = useQueryClient()
  const costs = useRunCostMedians()
  const picker = useSourcePicker({ sources: ['claude'] })
  const [list, setList] = useState<BatchItem[]>(() => items.slice(0, MAX_DCF_BATCH))
  const [add, setAdd] = useState('')
  const [existing, setExisting] = useState<'update' | 'new'>('update')
  const [instructions, setInstructions] = useState('')
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null)
  const [busy, setBusy] = useState(false)

  const summary = useSummary()
  const modelled = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of summary.data?.tickers ?? []) m.set(t.ticker.toUpperCase(), SOURCES.filter((s) => t.latest[s]).length)
    return m
  }, [summary.data])

  const backends = cfg.data?.backends ?? {}
  const srcs = effectiveSources(picker, backends)
  const truncated = items.length > MAX_DCF_BATCH
  const tickerOf = (it: BatchItem) => (it.ticker || it.symbol).toUpperCase()
  const nModels = (it: BatchItem) => it.n_models ?? modelled.get(tickerOf(it)) ?? 0
  const modeOf = (it: BatchItem): 'new' | 'update' => (nModels(it) > 0 && existing === 'update' ? 'update' : 'new')
  const withModels = list.filter((it) => nModels(it) > 0).length

  const claude = costs.claude
  const nClaude = srcs.includes('claude') ? list.length : 0

  const start = async () => {
    setBusy(true)
    const { models, efforts } = sourceOverrides(picker, backends, srcs)
    const res: Outcome[] = list.map((it) => ({ ticker: tickerOf(it), state: 'pending' }))
    setOutcomes([...res])
    // one ticker at a time so a failure is attributed and the queue fills in order
    for (let i = 0; i < list.length; i++) {
      res[i] = { ...res[i], state: 'starting' }
      setOutcomes([...res])
      try {
        const r = await api.startRuns({
          ticker: tickerOf(list[i]),
          sources: srcs,
          mode: modeOf(list[i]),
          instructions: instructions.trim() || undefined,
          models,
          efforts,
        })
        res[i] = { ...res[i], state: 'ok', runs: r.runs }
      } catch (e) {
        res[i] = { ...res[i], state: 'error', error: errorMessage(e) }
      }
      setOutcomes([...res])
    }
    setBusy(false)
    qc.invalidateQueries({ queryKey: ['runs'] })
    qc.invalidateQueries({ queryKey: qk.summary })
  }

  if (cfg.isLoading) return <Loading label="Loading backends…" />
  const done = outcomes !== null && !busy

  return (
    <div className="space-y-3 text-xs">
      <ErrorBox error={cfg.error} title="Config" />
      {truncated && (
        <div className="rounded border border-warn/40 bg-warn/5 px-3 py-2 text-warn">
          {items.length} stocks selected — DCF runs are capped at {MAX_DCF_BATCH} tickers per batch, so only the first{' '}
          {MAX_DCF_BATCH} are included. Run the rest as another batch.
        </div>
      )}
      <div>
        <div className="label mb-1">
          Tickers ({list.length}/{MAX_DCF_BATCH})
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {list.map((it) => (
            <span key={it.symbol} className="inline-flex items-center gap-1 rounded border border-line bg-sunken px-1.5 py-0.5" title={it.name ?? ''}>
              <span className="font-mono font-semibold">{tickerOf(it)}</span>
              <span className={clsx('text-2xs', modeOf(it) === 'update' ? 'text-accent' : 'text-faint')}>
                {modeOf(it)}
                {nModels(it) > 0 ? ` · ${nModels(it)} model${nModels(it) === 1 ? '' : 's'}` : ''}
              </span>
              {!outcomes && (
                <button className="text-faint hover:text-neg" onClick={() => setList((l) => l.filter((x) => x.symbol !== it.symbol))} title="Remove">
                  ×
                </button>
              )}
            </span>
          ))}
          {!outcomes && list.length < MAX_DCF_BATCH && (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const syms = add
                  .toUpperCase()
                  .split(/[,\s]+/)
                  .filter((s) => /^[A-Z0-9.\-]{1,15}$/.test(s))
                setList((l) => {
                  const have = new Set(l.map((x) => x.symbol))
                  return [...l, ...syms.filter((s) => !have.has(s)).map((s) => ({ symbol: s }))].slice(0, MAX_DCF_BATCH)
                })
                setAdd('')
              }}
            >
              <input className="input w-28 font-mono uppercase" placeholder="+ ticker" value={add} onChange={(e) => setAdd(e.target.value)} />
            </form>
          )}
        </div>
      </div>

      {withModels > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="label">{withModels} already modelled →</span>
          <Segmented
            options={[
              { id: 'update', label: 'Update existing', title: 'Start from the latest version per source (new where a source has none)' },
              { id: 'new', label: 'New model', title: 'Build from scratch for every ticker' },
            ]}
            value={existing}
            onChange={setExisting}
          />
        </div>
      )}

      <SourcePicker state={picker} backends={backends} idPrefix="batch" />

      <label className="flex flex-col gap-1">
        <span className="label">Instructions (optional, sent with every run)</span>
        <textarea
          className="input min-h-[60px] font-mono"
          value={instructions}
          placeholder="e.g. Focus on whether FCF margins are sustainable; the screener flagged a large implied-growth gap."
          onChange={(e) => setInstructions(e.target.value)}
        />
      </label>

      <div className="rounded border border-line bg-sunken px-3 py-2 text-muted">
        {claude ? (
          <>
            ≈ <b className="num text-fg">{fmtUsd(claude.median)}</b> per Claude run (median of {claude.n} past {claude.basis === 'imports' ? 'import ' : ''}
            run{claude.n === 1 ? '' : 's'})
            {nClaude > 0 && (
              <>
                {' '}
                · ≈ <b className="num text-fg">{fmtUsd(claude.median * nClaude)}</b> for {nClaude} Claude run{nClaude === 1 ? '' : 's'}
              </>
            )}
          </>
        ) : (
          <>No past Claude run costs to estimate from.</>
        )}
        ; Codex/Grok/Antigravity via subscription.
      </div>

      {outcomes && (
        <div className="rounded border border-line">
          <table className="tbl">
            <tbody>
              {outcomes.map((o) => (
                <tr key={o.ticker}>
                  <td className="w-20">
                    <Link to={tLink(o.ticker)} className="font-mono font-semibold hover:underline">
                      {o.ticker}
                    </Link>
                  </td>
                  <td>
                    {o.state === 'pending' ? (
                      <span className="text-faint">waiting</span>
                    ) : o.state === 'starting' ? (
                      <Spinner />
                    ) : o.state === 'error' ? (
                      <span className="text-neg">{o.error}</span>
                    ) : (
                      <span className="flex flex-wrap items-center gap-2">
                        {(o.runs ?? []).map((r) => (
                          <span key={r.version_id} className="inline-flex items-center gap-1">
                            <SourceBadge source={r.source} />
                            <Link className="link font-mono text-[11px]" to={runLink(r.version_id)} target="_blank">
                              {r.mode}
                            </Link>
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        {done && (
          <Link className="btn" to="/runs">
            Open Runs
          </Link>
        )}
        <button className="btn" onClick={onClose}>
          {done ? 'Close' : 'Cancel'}
        </button>
        {!done && (
          <button className="btn btn-primary" disabled={busy || !list.length || !srcs.length} onClick={start}>
            {busy && <Spinner className="border-bg/40 border-t-bg" />}
            Start {list.length * srcs.length || ''} run{list.length * srcs.length === 1 ? '' : 's'}
            {srcs.length ? ` (${srcs.map((s) => SOURCE_LABEL[s]).join(' + ')})` : ''}
          </button>
        )}
      </div>
    </div>
  )
}

export function BatchRunDialog({ items, onClose }: { items: BatchItem[] | null; onClose: () => void }) {
  return (
    <Modal open={items !== null} onClose={onClose} title="Run full DCFs" width="max-w-3xl">
      {items && <BatchRunForm items={items} onClose={onClose} />}
    </Modal>
  )
}
