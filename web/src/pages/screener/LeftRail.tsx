import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { qk, useAgentRuns, useDeleteScreen, useSaveScreen, useSavedScreens, useScreenerPresets, useUniverses } from '../../api/hooks'
import { ACTIVE_STATUSES } from '../../types/api'
import type { Preset, Screen } from '../../types/screener'
import { fmtAge } from '../../lib/format'
import { slugify } from '../../lib/screener'
import { Chip, StatusBadge } from '../../components/badges'
import { ErrorBox, Spinner } from '../../components/ui'
import { ListKindBadge } from './Lists'

function RailSection({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-b border-line px-2 py-2">
      <div className="mb-1 flex items-center justify-between px-1">
        <h2 className="label">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

const itemCls = (active: boolean) =>
  clsx(
    'group flex w-full items-center gap-1.5 rounded px-1.5 py-[3px] text-left text-xs',
    active ? 'bg-sunken font-medium text-fg' : 'text-muted hover:bg-sunken hover:text-fg',
  )

export function LeftRail({
  screen,
  onApply,
  onUniverse,
  onManageLists,
  onBuildTheme,
  onOpenAgentRun,
  onAgentRuns,
}: {
  screen: Screen
  onApply: (s: Screen) => void
  onUniverse: (id: string) => void
  onManageLists: (slug?: string) => void
  onBuildTheme: () => void
  onOpenAgentRun: (vid: string) => void
  onAgentRuns: () => void
}) {
  const presets = useScreenerPresets()
  const saved = useSavedScreens()
  const save = useSaveScreen()
  const del = useDeleteScreen()
  const lists = useUniverses()
  const agentRuns = useAgentRuns()
  const [saving, setSaving] = useState<string | null>(null)

  // a finished theme run saves a list: reload the lists (and that run's result) when an agent run ends
  const qc = useQueryClient()
  const prevActive = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!agentRuns.data) return
    const active = new Set(agentRuns.data.filter((r) => r.status && ACTIVE_STATUSES.includes(r.status)).map((r) => r.id ?? ''))
    const prev = prevActive.current
    if (prev && [...prev].some((id) => !active.has(id))) {
      qc.invalidateQueries({ queryKey: qk.sc.universes })
      for (const id of prev) if (!active.has(id)) qc.invalidateQueries({ queryKey: qk.sc.agentResult(id) })
    }
    prevActive.current = active
  }, [agentRuns.data, qc])

  const groups: string[] = []
  for (const p of presets.data ?? []) if (!groups.includes(p.group)) groups.push(p.group)

  const applyPreset = (p: Preset) =>
    onApply({
      ...p.screen,
      name: p.name,
      // keep the user's reverse-DCF params and columns
      params: screen.params,
      cols: screen.cols,
    })

  const doSave = () => {
    const name = (saving ?? '').trim()
    if (!name) return
    const slug = slugify(name, 'screen')
    if ((saved.data ?? []).some((s) => s.slug === slug) && !window.confirm(`Overwrite the saved screen “${name}”?`)) return
    save.mutate(
      { slug, name, screen: { ...screen, name } },
      {
        onSuccess: () => {
          setSaving(null)
          onApply({ ...screen, name })
        },
      },
    )
  }

  return (
    <div className="text-xs">
      <RailSection title="Presets">
        {presets.error ? <ErrorBox error={presets.error} /> : null}
        {groups.map((g) => (
          <div key={g} className="mb-1.5">
            <div className="px-1.5 text-[10px] font-medium uppercase tracking-wide text-faint">{g}</div>
            {(presets.data ?? [])
              .filter((p) => p.group === g)
              .map((p) => (
                <button
                  key={p.id}
                  className={itemCls(screen.name === p.name)}
                  title={`${p.desc}${p.needs_enrich ? '\n\nNeeds Enrich: % below 52-week high comes from Yahoo — run Enrich on the matched rows first.' : ''}`}
                  onClick={() => applyPreset(p)}
                >
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {p.needs_enrich && (
                    <Chip tone="warn" className="!px-1 !text-[10px]">
                      enrich
                    </Chip>
                  )}
                </button>
              ))}
          </div>
        ))}
        {presets.isLoading && <Spinner className="m-2" />}
      </RailSection>

      <RailSection
        title="Saved screens"
        actions={
          saving === null && (
            <button className="text-2xs text-accent hover:underline" onClick={() => setSaving((screen.name ?? '').replace(/ \(modified\)$/, ''))}>
              Save current…
            </button>
          )
        }
      >
        {saving !== null && (
          <form
            className="mb-1 flex gap-1 px-1"
            onSubmit={(e) => {
              e.preventDefault()
              doSave()
            }}
          >
            <input
              className="input min-w-0 flex-1 py-0.5"
              placeholder="Screen name"
              autoFocus
              value={saving}
              onChange={(e) => setSaving(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setSaving(null)}
            />
            <button className="btn px-1.5 py-0.5" type="submit" disabled={!saving.trim() || save.isPending}>
              Save
            </button>
          </form>
        )}
        <ErrorBox error={save.error ?? del.error} />
        {(saved.data ?? []).map((s) => (
          <div key={s.slug} className={itemCls(screen.name === s.name)}>
            <button className="min-w-0 flex-1 truncate text-left" title={`saved ${fmtAge(s.saved_at)} ago${s.note ? `\n${s.note}` : ''}`} onClick={() => onApply({ ...s.screen, name: s.name })}>
              {s.name}
            </button>
            <button
              className="invisible text-faint hover:text-neg group-hover:visible"
              title="Delete saved screen"
              onClick={() => {
                if (window.confirm(`Delete the saved screen “${s.name}”?`)) del.mutate(s.slug)
              }}
            >
              ×
            </button>
          </div>
        ))}
        {!saved.isLoading && (saved.data ?? []).length === 0 && saving === null && <div className="px-1.5 text-2xs text-faint">None yet.</div>}
      </RailSection>

      <RailSection
        title="Lists"
        actions={
          <button className="text-2xs text-accent hover:underline" onClick={() => onManageLists(screen.universe.startsWith('list:') ? screen.universe.slice(5) : undefined)}>
            Manage…
          </button>
        }
      >
        {lists.error ? <ErrorBox error={lists.error} /> : null}
        {(lists.data?.lists ?? []).map((l) => (
          <button
            key={l.slug}
            className={itemCls(screen.universe === `list:${l.slug}`)}
            title={l.source?.query ? `${l.name}\n“${l.source.query}”` : l.name}
            onClick={() => onUniverse(`list:${l.slug}`)}
          >
            <span className="min-w-0 flex-1 truncate">{l.name}</span>
            <ListKindBadge list={l} />
            <span className="num text-2xs text-faint">{l.count}</span>
          </button>
        ))}
        <button className="mt-1 w-full rounded px-1.5 py-[3px] text-left text-2xs text-accent hover:bg-sunken" onClick={onBuildTheme}>
          Build a theme list with an agent…
        </button>
      </RailSection>

      <RailSection
        title="Agent runs"
        actions={
          <button className="text-2xs text-accent hover:underline" onClick={onAgentRuns}>
            All…
          </button>
        }
      >
        {(agentRuns.data ?? []).slice(0, 6).map((r) => (
          <button key={r.id} className={itemCls(false)} onClick={() => r.id && onOpenAgentRun(r.id)} title={r.id}>
            <span className="min-w-0 flex-1 truncate">
              <span className="text-faint">{r.kind === 'theme' ? 'theme' : 'shortlist'} · </span>
              {r.kind === 'theme' ? r.screener?.query ?? '—' : r.screener?.screen?.name ?? 'custom screen'}
            </span>
            {r.status !== 'valid' && <StatusBadge status={r.status} />}
          </button>
        ))}
        {!agentRuns.isLoading && (agentRuns.data ?? []).length === 0 && <div className="px-1.5 text-2xs text-faint">None yet.</div>}
      </RailSection>
    </div>
  )
}
