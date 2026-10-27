import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { useRefreshModels } from '../api/hooks'
import { SOURCES, type BackendInfo, type ModelOption, type Source } from '../types/api'
import { SOURCE_LABEL } from '../lib/sources'
import { fmtAge, fmtDateTime } from '../lib/format'
import { Chip, SourceDot } from './badges'
import { Spinner, errorMessage } from './ui'

type PerSource = Partial<Record<Source, string>>
export type Backends = Partial<Record<Source, BackendInfo>>

const CUSTOM = '__custom__'

/** Selection state for a SourcePicker: which agents, plus a model / effort per agent. */
export function useSourcePicker(initial?: { sources?: Source[]; models?: PerSource; efforts?: PerSource }) {
  const [selected, setSelected] = useState<Set<Source>>(new Set(initial?.sources ?? []))
  const [models, setModels] = useState<PerSource>(initial?.models ?? {})
  const [efforts, setEfforts] = useState<PerSource>(initial?.efforts ?? {})
  const [custom, setCustom] = useState<Partial<Record<Source, boolean>>>({})
  return { selected, setSelected, models, setModels, efforts, setEfforts, custom, setCustom }
}
export type SourcePickerState = ReturnType<typeof useSourcePicker>

export function isUsable(b: BackendInfo | undefined): boolean {
  return !!b?.available && !b?.paused
}

/** The backend's model list: the live catalog when the server has one, else the static ids. */
export function modelOptions(b: BackendInfo | undefined): ModelOption[] {
  if (b?.model_options?.length) return b.model_options
  return (b?.models ?? []).map((id) => ({ id, label: id, kind: 'model', efforts: b?.efforts ?? [], default_effort: b?.default_effort }))
}

/** Efforts the given model supports (falls back to the backend's union for unknown / custom ids). */
export function effortsFor(b: BackendInfo | undefined, model: string): string[] {
  const o = modelOptions(b).find((x) => x.id === model)
  return o?.efforts?.length ? o.efforts : b?.efforts ?? []
}

/** Effort used when none is picked: the configured default if this model supports it, else the model's own default. */
export function defaultEffortFor(b: BackendInfo | undefined, model: string): string {
  const allowed = effortsFor(b, model)
  const conf = b?.default_effort ?? ''
  if (!allowed.length || allowed.includes(conf)) return conf
  const o = modelOptions(b).find((x) => x.id === model)
  if (o?.default_effort && allowed.includes(o.default_effort)) return o.default_effort
  return allowed[0]
}

/** Effective model id for a source ('' when unknown). */
export function modelOf(st: SourcePickerState, backends: Backends, s: Source): string {
  return (st.models[s] ?? backends[s]?.default_model ?? '').trim()
}

/** Effective effort for a source: the picked one if the selected model supports it, else its default. */
export function effortOf(st: SourcePickerState, backends: Backends, s: Source): string {
  const b = backends[s]
  const model = modelOf(st, backends, s)
  const picked = st.efforts[s]
  if (picked && effortsFor(b, model).includes(picked)) return picked
  return defaultEffortFor(b, model)
}

/** Selected sources whose CLI is available and not paused, in canonical order. */
export function effectiveSources(st: SourcePickerState, backends: Backends): Source[] {
  return SOURCES.filter((s) => st.selected.has(s) && isUsable(backends[s]))
}

/** Model / effort maps for a run request, containing only values that differ from the server defaults. */
export function sourceOverrides(
  st: SourcePickerState,
  backends: Backends,
  srcs: Source[],
): { models?: PerSource; efforts?: PerSource } {
  const m: PerSource = {}
  const e: PerSource = {}
  for (const s of srcs) {
    const b = backends[s]
    const model = modelOf(st, backends, s)
    const effort = effortOf(st, backends, s)
    if (model && model !== b?.default_model) m[s] = model
    if (effort && effort !== b?.default_effort) e[s] = effort
  }
  return { models: Object.keys(m).length ? m : undefined, efforts: Object.keys(e).length ? e : undefined }
}

/* ------------------------------------------------------------------ cells */

function optionText(o: ModelOption, b: BackendInfo | undefined): string {
  const tags = [o.id === b?.latest && 'latest', o.id === b?.default_model && 'default'].filter(Boolean)
  return `${o.label || o.id}${tags.length ? `   · ${tags.join(' · ')}` : ''}`
}

function ModelCell({ s, b, st, on }: { s: Source; b: BackendInfo | undefined; st: SourcePickerState; on: boolean }) {
  const opts = modelOptions(b)
  const value = st.models[s] ?? b?.default_model ?? ''
  const known = opts.some((o) => o.id === value)
  const isCustom = !!st.custom[s] || (!!value.trim() && !known)
  const aliases = opts.filter((o) => o.kind === 'alias')
  const pinned = opts.filter((o) => o.kind !== 'alias')
  const sel = opts.find((o) => o.id === value)

  const choose = (id: string) => {
    if (id === CUSTOM) {
      st.setCustom((c) => ({ ...c, [s]: true }))
      st.setModels((m) => ({ ...m, [s]: value }))
      return
    }
    st.setCustom((c) => ({ ...c, [s]: false }))
    st.setModels((m) => ({ ...m, [s]: id }))
    // keep the effort only if the new model supports it
    const cur = st.efforts[s] ?? b?.default_effort ?? ''
    if (!effortsFor(b, id).includes(cur)) st.setEfforts((e) => ({ ...e, [s]: defaultEffortFor(b, id) }))
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <select
        className="input w-60 font-mono"
        disabled={!on}
        value={isCustom ? CUSTOM : value}
        title={sel?.note ?? (sel?.resolved ? `resolves to ${sel.resolved}` : undefined)}
        onChange={(e) => choose(e.target.value)}
      >
        {!known && !isCustom && value && <option value={value}>{value}</option>}
        {aliases.length > 0 && (
          <optgroup label="Aliases (always the newest of the family)">
            {aliases.map((o) => (
              <option key={o.id} value={o.id} title={o.note ?? undefined}>
                {optionText(o, b)}
              </option>
            ))}
          </optgroup>
        )}
        {pinned.length > 0 && (
          <optgroup label={aliases.length ? 'Pinned versions' : 'Models (newest first)'}>
            {pinned.map((o) => (
              <option key={o.id} value={o.id} title={o.note ?? undefined}>
                {optionText(o, b)}
              </option>
            ))}
          </optgroup>
        )}
        <option value={CUSTOM}>Custom…</option>
      </select>
      {isCustom ? (
        <input
          className="input w-44 font-mono"
          disabled={!on}
          autoFocus={!!st.custom[s]}
          placeholder="any model id"
          value={st.models[s] ?? ''}
          onChange={(e) => st.setModels((m) => ({ ...m, [s]: e.target.value }))}
        />
      ) : (
        <>
          {value && value === b?.latest && (
            <Chip tone="accent" className="!px-1 !text-[10px]" title="newest model this CLI offers">
              latest
            </Chip>
          )}
          {value && value === b?.default_model && (
            <Chip
              tone="muted"
              className="!px-1 !text-[10px]"
              title={`configured default${b?.default_model_setting && b.default_model_setting !== value ? ` (“${b.default_model_setting}”)` : ''}`}
            >
              default
            </Chip>
          )}
        </>
      )}
    </div>
  )
}

function CatalogLine({ backends }: { backends: Backends }) {
  const refresh = useRefreshModels()
  const cats = SOURCES.map((s) => ({ s, c: backends[s]?.catalog })).filter((x) => x.c)
  const fetched = cats.map((x) => x.c?.fetched_at).filter((x): x is string => !!x).sort()
  const errors = cats.filter((x) => x.c?.error)
  const tip = cats.length
    ? cats.map(({ s, c }) => `${SOURCE_LABEL[s]}: ${c?.source ?? '?'} · fetched ${fmtDateTime(c?.fetched_at)}${c?.error ? `\n  error: ${c.error}` : ''}`).join('\n')
    : 'This server returns static model lists (no live catalog yet).'
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-faint">
      <span title={tip} className="cursor-help underline decoration-dotted underline-offset-2">
        {cats.length ? `Models discovered from each CLI · fetched ${fmtAge(fetched[0])} ago` : 'Static model lists'}
      </span>
      {errors.map(({ s, c }) => (
        <span key={s} className="text-warn" title={c?.error ?? ''}>
          {SOURCE_LABEL[s]} catalog error (showing last good list)
        </span>
      ))}
      <button
        type="button"
        className="inline-flex items-center gap-1 text-accent hover:underline disabled:text-faint"
        disabled={refresh.isPending}
        title="Re-run model discovery for all CLIs (~2 s)"
        onClick={() => refresh.mutate()}
      >
        {refresh.isPending ? <Spinner /> : '↻'} refresh models
      </button>
      {refresh.error ? <span className="text-neg">{errorMessage(refresh.error)}</span> : null}
      {refresh.data?.errors && Object.keys(refresh.data.errors).length > 0 && (
        <span className="text-warn" title={Object.entries(refresh.data.errors).map(([k, v]) => `${k}: ${v}`).join('\n')}>
          {Object.keys(refresh.data.errors).length} CLI(s) failed discovery
        </span>
      )}
    </div>
  )
}

/**
 * Agent table: checkbox (or radio with `single`) + model + effort per CLI backend, with the
 * live model catalog. Shared by the run launcher, the screener's batch-run dialog and the
 * screener agent dialog.
 */
export function SourcePicker({
  state,
  backends,
  single = false,
  extraColumn,
  idPrefix = 'sp',
}: {
  state: SourcePickerState
  backends: Backends
  single?: boolean
  extraColumn?: { header: ReactNode; cell: (s: Source, on: boolean) => ReactNode }
  idPrefix?: string
}) {
  const { selected, setSelected, setEfforts } = state
  const toggle = (s: Source) =>
    setSelected((prev) => {
      if (single) return new Set([s])
      const n = new Set(prev)
      if (n.has(s)) n.delete(s)
      else n.add(s)
      return n
    })
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th className="w-8" />
              <th>Agent</th>
              <th>Model</th>
              <th>Effort</th>
              {extraColumn && <th>{extraColumn.header}</th>}
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((s) => {
              const b = backends[s]
              const disabled = !isUsable(b)
              const on = selected.has(s) && !disabled
              const model = modelOf(state, backends, s)
              const efforts = effortsFor(b, model)
              const effort = effortOf(state, backends, s)
              return (
                <tr key={s} className={clsx(disabled && 'opacity-50')}>
                  <td>
                    <input
                      type={single ? 'radio' : 'checkbox'}
                      name={single ? `${idPrefix}-cli` : undefined}
                      checked={on}
                      disabled={disabled}
                      onChange={() => toggle(s)}
                    />
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <SourceDot source={s} />
                      <span className="font-medium">{b?.label ?? SOURCE_LABEL[s]}</span>
                    </div>
                    <div className="text-2xs text-faint">
                      {!b ? 'not configured' : !b.available ? 'CLI not found on PATH' : b.paused ? `paused: ${b.paused}` : b.version ?? ''}
                    </div>
                  </td>
                  <td>
                    <ModelCell s={s} b={b} st={state} on={on} />
                  </td>
                  <td>
                    <select className="input" disabled={!on} value={effort} onChange={(e) => setEfforts((m) => ({ ...m, [s]: e.target.value }))}>
                      {!efforts.includes(effort) && effort && <option value={effort}>{effort}</option>}
                      {efforts.map((ef) => (
                        <option key={ef} value={ef}>
                          {ef}
                          {ef === b?.default_effort ? ' (default)' : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  {extraColumn && <td>{extraColumn.cell(s, on)}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <CatalogLine backends={backends} />
    </div>
  )
}
