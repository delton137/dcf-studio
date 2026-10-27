import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useConfig, useDebounced, useStartRuns, useTicker } from '../api/hooks'
import { type RunStarted, type Source } from '../types/api'
import { shortVid } from '../lib/format'
import { Modal } from './Modal'
import { ErrorBox, Loading, Segmented, Spinner } from './ui'
import { SourceBadge } from './badges'
import { SourcePicker, effectiveSources, sourceOverrides, useSourcePicker } from './SourcePicker'
import { runLink, vLink } from '../lib/links'

export interface LaunchPrefill {
  ticker?: string
  sources?: Source[]
  mode?: 'new' | 'update'
  parent_versions?: Partial<Record<Source, string>>
  instructions?: string
}

export function RunLaunchForm({
  initial,
  onLaunched,
  onCancel,
}: {
  initial?: LaunchPrefill
  onLaunched?: (runs: RunStarted[]) => void
  onCancel?: () => void
}) {
  const cfg = useConfig()
  const start = useStartRuns()
  const [ticker, setTicker] = useState((initial?.ticker ?? '').toUpperCase())
  const [mode, setMode] = useState<'new' | 'update'>(initial?.mode ?? 'new')
  const picker = useSourcePicker({ sources: initial?.sources })
  const [parents, setParents] = useState<Partial<Record<Source, string>>>(initial?.parent_versions ?? {})
  const [instructions, setInstructions] = useState(initial?.instructions ?? '')
  const [launched, setLaunched] = useState<RunStarted[] | null>(null)

  const dTicker = useDebounced(ticker.trim(), 400)
  const tq = useTicker(mode === 'update' && dTicker ? dTicker : undefined)
  const latestBySource = useMemo(() => {
    const out: Partial<Record<Source, string>> = {}
    for (const v of tq.data?.versions ?? []) if (v.latest && !out[v.source]) out[v.source] = v.version_id
    return out
  }, [tq.data])

  const backends = cfg.data?.backends ?? {}
  const effective = effectiveSources(picker, backends)
  const tickerOk = /^[A-Z0-9.\-]{1,15}$/.test(ticker.trim())
  const canStart = tickerOk && effective.length > 0 && !start.isPending

  const submit = () => {
    const srcs = effective
    const { models, efforts } = sourceOverrides(picker, backends, srcs)
    const pv: Partial<Record<Source, string>> = {}
    if (mode === 'update') for (const s of srcs) if (parents[s]) pv[s] = parents[s]
    start.mutate(
      {
        ticker: ticker.trim().toUpperCase(),
        sources: srcs,
        mode,
        parent_versions: Object.keys(pv).length ? pv : undefined,
        instructions: instructions.trim() || undefined,
        models,
        efforts,
      },
      {
        onSuccess: (r) => {
          setLaunched(r.runs)
          onLaunched?.(r.runs)
        },
      },
    )
  }

  if (cfg.isLoading) return <Loading label="Loading backends…" />

  return (
    <div className="space-y-3 text-xs">
      <ErrorBox error={cfg.error} title="Config" />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="label">Ticker</span>
          <input
            className="input w-28 font-mono uppercase"
            value={ticker}
            placeholder="e.g. MU"
            autoFocus={!initial?.ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/\s/g, ''))}
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="label">Mode</span>
          <Segmented
            options={[
              { id: 'new', label: 'New model', title: 'Build from scratch' },
              { id: 'update', label: 'Update', title: 'Start from the previous version (falls back to new if none)' },
            ]}
            value={mode}
            onChange={setMode}
          />
        </div>
      </div>

      <SourcePicker
        state={picker}
        backends={backends}
        idPrefix="launch"
        extraColumn={
          mode === 'update'
            ? {
                header: 'Parent version',
                cell: (s) => {
                  const parent = parents[s] ?? latestBySource[s]
                  return (
                    <span className="font-mono text-2xs">
                      {parent ? (
                        <span className="flex items-center gap-1">
                          <Link to={vLink(parent)} className="link" target="_blank">
                            {shortVid(parent)}
                          </Link>
                          {parents[s] ? (
                            <button
                              className="text-faint hover:text-fg"
                              title="Use latest instead"
                              onClick={() => setParents((p) => ({ ...p, [s]: undefined }))}
                            >
                              ✕
                            </button>
                          ) : (
                            <span className="text-faint">(latest)</span>
                          )}
                        </span>
                      ) : tq.isFetching ? (
                        <Spinner />
                      ) : (
                        <span className="text-faint">none → new</span>
                      )}
                    </span>
                  )
                },
              }
            : undefined
        }
      />

      <label className="flex flex-col gap-1">
        <span className="label">Instructions (optional)</span>
        <textarea
          className="input min-h-[72px] font-mono"
          value={instructions}
          placeholder={mode === 'update' ? 'e.g. Roll forward to the latest 10-Q; revisit the terminal margin.' : 'Extra guidance for the agents'}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </label>

      <ErrorBox error={start.error} title="Could not start" />
      {launched && (
        <div className="rounded border border-pos/30 bg-pos/5 px-3 py-2">
          <div className="mb-1 font-semibold text-pos">Started {launched.length} run(s)</div>
          <ul className="space-y-0.5">
            {launched.map((r) => (
              <li key={r.version_id} className="flex items-center gap-2">
                <SourceBadge source={r.source} />
                <Link className="link font-mono" to={runLink(r.version_id)}>
                  {r.version_id}
                </Link>
                <span className="text-muted">
                  {r.mode}
                  {r.parent_version ? ` from ${shortVid(r.parent_version)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <button className="btn" onClick={onCancel}>
            Close
          </button>
        )}
        <button className="btn btn-primary" disabled={!canStart} onClick={submit}>
          {start.isPending && <Spinner className="border-bg/40 border-t-bg" />}
          Start {effective.length > 0 ? `${effective.length} run${effective.length > 1 ? 's' : ''}` : ''}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ global launcher dialog */

const Ctx = createContext<{ open: (p?: LaunchPrefill) => void }>({ open: () => {} })

export function useRunLauncher() {
  return useContext(Ctx)
}

export function RunLauncherProvider({ children }: { children: ReactNode }) {
  const [prefill, setPrefill] = useState<LaunchPrefill | null>(null)
  const [nonce, setNonce] = useState(0)
  const navigate = useNavigate()
  const open = useCallback((p?: LaunchPrefill) => {
    setPrefill(p ?? {})
    setNonce((n) => n + 1)
  }, [])
  const close = useCallback(() => setPrefill(null), [])
  const value = useMemo(() => ({ open }), [open])
  return (
    <Ctx.Provider value={value}>
      {children}
      <Modal
        open={prefill !== null}
        onClose={close}
        title={prefill?.mode === 'update' ? `Update ${prefill.ticker ?? ''} with agents` : 'New agent run'}
        width="max-w-3xl"
      >
        {prefill && (
          <RunLaunchForm
            key={nonce}
            initial={prefill}
            onCancel={close}
            onLaunched={(runs) => {
              close()
              if (runs.length === 1) navigate(runLink(runs[0].version_id))
              else navigate('/runs')
            }}
          />
        )}
      </Modal>
    </Ctx.Provider>
  )
}
