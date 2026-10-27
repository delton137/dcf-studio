import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { useAddMembers, useDeleteUniverse, usePutUniverse, useUniverseDoc, useUniverses } from '../../api/hooks'
import type { UniverseListSummary } from '../../types/screener'
import { fmtAge } from '../../lib/format'
import { slugify } from '../../lib/screener'
import { runLink } from '../../lib/links'
import { Modal } from '../../components/Modal'
import { Chip } from '../../components/badges'
import { Empty, ErrorBox, Loading, Spinner } from '../../components/ui'

export function ListKindBadge({ list }: { list: Pick<UniverseListSummary, 'kind' | 'source'> }) {
  if (list.kind === 'agent')
    return (
      <Chip tone="accent" className="!px-1 !text-[10px]" title={list.source?.query ? `agent-built: “${list.source.query}”` : 'built by a screener agent'}>
        agent
      </Chip>
    )
  if (list.source?.by === 'seed')
    return (
      <Chip tone="muted" className="!px-1 !text-[10px]" title={list.source?.query ?? 'seed list'}>
        seed
      </Chip>
    )
  return null
}

function parseSymbols(s: string): string[] {
  return Array.from(
    new Set(
      s
        .toUpperCase()
        .split(/[,\s;]+/)
        .map((x) => x.trim())
        .filter((x) => /^[A-Z0-9.\-]{1,15}$/.test(x)),
    ),
  )
}

/* ------------------------------------------------------------------ list manager */

function ListEditor({ slug, onUse, onDeleted }: { slug: string; onUse: (slug: string) => void; onDeleted: () => void }) {
  const q = useUniverseDoc(slug)
  const put = usePutUniverse()
  const del = useDeleteUniverse()
  const addM = useAddMembers()
  const [name, setName] = useState('')
  const [add, setAdd] = useState('')
  const doc = q.data
  useEffect(() => {
    if (doc) setName(doc.name)
  }, [doc])

  if (q.isLoading) return <Loading />
  if (q.error || !doc) return <ErrorBox error={q.error ?? 'List not found'} />

  const save = (members = doc.members, newName = name.trim() || doc.name) =>
    put.mutate({ slug: doc.slug, name: newName, members, kind: doc.kind })

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="label">Name</span>
          <input
            className="input w-64"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim() && name.trim() !== doc.name) save()
            }}
          />
        </label>
        <button className="btn" disabled={!name.trim() || name.trim() === doc.name || put.isPending} onClick={() => save()}>
          Rename
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <button className="btn btn-primary" onClick={() => onUse(doc.slug)}>
            Screen this list
          </button>
          <button
            className="btn btn-danger"
            disabled={del.isPending}
            onClick={() => {
              if (window.confirm(`Delete the list “${doc.name}” (${doc.members.length} members)?`))
                del.mutate(doc.slug, { onSuccess: onDeleted })
            }}
          >
            Delete
          </button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-2xs text-muted">
        <ListKindBadge list={doc} />
        <span className="font-mono">list:{doc.slug}</span>
        {doc.source?.query && <span>“{doc.source.query}”</span>}
        {doc.source?.run_id && (
          <Link className="link" to={runLink(doc.source.run_id)} target="_blank">
            agent run ↗
          </Link>
        )}
        {doc.source?.cli && (
          <span>
            {doc.source.cli} · {doc.source.model}
          </span>
        )}
        {doc.updated_at && <span>updated {fmtAge(doc.updated_at)} ago</span>}
      </div>
      {doc.source?.description && <p className="text-2xs text-muted">{doc.source.description}</p>}
      <ErrorBox error={put.error ?? del.error ?? addM.error} />
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          const syms = parseSymbols(add)
          if (syms.length) addM.mutate({ slug: doc.slug, symbols: syms }, { onSuccess: () => setAdd('') })
        }}
      >
        <input className="input w-72 font-mono uppercase" placeholder="Add symbols: MU, AVGO …" value={add} onChange={(e) => setAdd(e.target.value)} />
        <button className="btn" type="submit" disabled={!parseSymbols(add).length || addM.isPending}>
          {addM.isPending && <Spinner />}
          Add
        </button>
        <span className="ml-auto num text-2xs text-muted">{doc.members.length} members</span>
      </form>
      <div className="max-h-[46vh] overflow-y-auto rounded border border-line">
        {doc.members.length === 0 ? (
          <Empty>No members yet.</Empty>
        ) : (
          <table className="tbl">
            <tbody>
              {doc.members.map((m) => (
                <tr key={m.symbol}>
                  <td className="w-20 font-mono font-semibold">{m.symbol}</td>
                  <td className="max-w-[180px] truncate text-muted" title={m.name}>
                    {m.name ?? ''}
                  </td>
                  <td className="text-2xs text-muted">{m.note ?? ''}</td>
                  <td className="w-6 text-right">
                    <button
                      className="text-faint hover:text-neg"
                      title={`Remove ${m.symbol}`}
                      disabled={put.isPending}
                      onClick={() => save(doc.members.filter((x) => x.symbol !== m.symbol), doc.name)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export function ListManager({
  open,
  initialSlug,
  onClose,
  onUse,
  onBuildTheme,
}: {
  open: boolean
  initialSlug?: string | null
  onClose: () => void
  onUse: (slug: string) => void
  onBuildTheme: () => void
}) {
  const lists = useUniverses()
  const put = usePutUniverse()
  const [sel, setSel] = useState<string | null>(initialSlug ?? null)
  const [newName, setNewName] = useState('')
  useEffect(() => {
    if (open) setSel(initialSlug ?? lists.data?.lists[0]?.slug ?? null)
  }, [open, initialSlug])
  const all = lists.data?.lists ?? []
  const exists = (slug: string) => all.some((l) => l.slug === slug)

  return (
    <Modal open={open} onClose={onClose} title="Lists" width="max-w-4xl">
      <div className="grid grid-cols-[220px_1fr] gap-4">
        <div className="space-y-2 text-xs">
          <div className="max-h-[56vh] space-y-0.5 overflow-y-auto">
            {all.map((l) => (
              <button
                key={l.slug}
                className={clsx('flex w-full items-center gap-1.5 rounded px-2 py-1 text-left', sel === l.slug ? 'bg-sunken font-medium text-fg' : 'text-muted hover:bg-sunken hover:text-fg')}
                onClick={() => setSel(l.slug)}
              >
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                <ListKindBadge list={l} />
                <span className="num text-2xs text-faint">{l.count}</span>
              </button>
            ))}
            {lists.isLoading && <Loading />}
          </div>
          <form
            className="space-y-1 border-t border-line pt-2"
            onSubmit={(e) => {
              e.preventDefault()
              const name = newName.trim()
              const slug = slugify(name)
              if (!name) return
              if (exists(slug) && !window.confirm(`A list with the id “${slug}” exists. Replace its members with an empty list?`)) return
              put.mutate(
                { slug, name, members: [] },
                {
                  onSuccess: (d) => {
                    setSel(d.slug)
                    setNewName('')
                  },
                },
              )
            }}
          >
            <div className="label">New list</div>
            <div className="flex gap-1">
              <input className="input min-w-0 flex-1" placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <button className="btn" type="submit" disabled={!newName.trim() || put.isPending}>
                Create
              </button>
            </div>
            <ErrorBox error={put.error} />
          </form>
          <button
            className="btn w-full justify-center"
            onClick={() => {
              onClose()
              onBuildTheme()
            }}
          >
            Build a theme list with an agent…
          </button>
        </div>
        <div className="min-w-0">
          {sel ? (
            <ListEditor
              key={sel}
              slug={sel}
              onUse={(slug) => {
                onUse(slug)
                onClose()
              }}
              onDeleted={() => setSel(null)}
            />
          ) : (
            <Empty>Pick or create a list.</Empty>
          )}
        </div>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ add to list */

export function AddToListDialog({ symbols, onClose }: { symbols: string[] | null; onClose: () => void }) {
  const lists = useUniverses()
  const addM = useAddMembers()
  const put = usePutUniverse()
  const [target, setTarget] = useState<string>('')
  const [newName, setNewName] = useState('')
  const [done, setDone] = useState<string | null>(null)
  useEffect(() => {
    setDone(null)
    setNewName('')
  }, [symbols])
  const all = lists.data?.lists ?? []
  const n = symbols?.length ?? 0
  const pending = addM.isPending || put.isPending

  const submit = () => {
    if (!symbols?.length) return
    if (target === '__new') {
      const name = newName.trim()
      if (!name) return
      const slug = slugify(name)
      if (all.some((l) => l.slug === slug)) {
        addM.mutate({ slug, symbols }, { onSuccess: (d) => setDone(d.name) })
      } else {
        put.mutate({ slug, name, members: symbols.map((s) => ({ symbol: s })) }, { onSuccess: (d) => setDone(d.name) })
      }
    } else if (target) {
      addM.mutate({ slug: target, symbols }, { onSuccess: (d) => setDone(d.name) })
    }
  }

  return (
    <Modal open={symbols !== null} onClose={onClose} title={`Add ${n} symbol${n === 1 ? '' : 's'} to a list`} width="max-w-md">
      {done ? (
        <div className="space-y-3 text-xs">
          <div className="rounded border border-pos/30 bg-pos/5 px-3 py-2 text-pos">
            Added {n} symbol{n === 1 ? '' : 's'} to “{done}”.
          </div>
          <div className="flex justify-end">
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 text-xs">
          <div className="max-h-24 overflow-y-auto font-mono text-[11px] text-muted">{symbols?.join(', ')}</div>
          <div className="max-h-[40vh] space-y-0.5 overflow-y-auto rounded border border-line p-1">
            {all.map((l) => (
              <label key={l.slug} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-sunken">
                <input type="radio" name="add-to-list" checked={target === l.slug} onChange={() => setTarget(l.slug)} />
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                <ListKindBadge list={l} />
                <span className="num text-2xs text-faint">{l.count}</span>
              </label>
            ))}
            <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-sunken">
              <input type="radio" name="add-to-list" checked={target === '__new'} onChange={() => setTarget('__new')} />
              <span>New list:</span>
              <input
                className="input min-w-0 flex-1"
                placeholder="name"
                value={newName}
                onFocus={() => setTarget('__new')}
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
          </div>
          <ErrorBox error={addM.error ?? put.error} />
          <div className="flex justify-end gap-2">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!n || pending || !target || (target === '__new' && !newName.trim())} onClick={submit}>
              {pending && <Spinner className="border-bg/40 border-t-bg" />}
              Add
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
