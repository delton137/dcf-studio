import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { useTicker, useVersion } from '../../api/hooks'
import type { VersionResponse, VersionSummary } from '../../types/api'
import {
  fmtAny,
  fmtDate,
  fmtDateTime,
  fmtM,
  fmtPS,
  fmtPct,
  fmtPctSigned,
  fmtSignedPS,
  fmtUnit,
  isNum,
  shortVid,
} from '../../lib/format'
import { diffDcf, headlineOf, type DiffEntry } from '../../lib/derive'
import { vLink } from '../../lib/links'
import { Chip, LegacyBadge, StatusBadge } from '../../components/badges'
import { Card, Empty, ErrorBox, Loading } from '../../components/ui'

function DiffTable({ title, rows, ccy }: { title: string; rows: DiffEntry[]; ccy: string }) {
  if (!rows.length) return null
  return (
    <Card title={`${title} (${rows.length})`}>
      <div className="scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>Key</th>
              <th>Label</th>
              <th className="n">Other</th>
              <th />
              <th className="n">This</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const fmt = (v: unknown) =>
                v && typeof v === 'object' && 'effect' in (v as object)
                  ? `${fmtM((v as { effect?: number }).effect)}${(v as { included?: boolean }).included === false ? ' (excl.)' : ''}`
                  : r.unit !== undefined
                    ? fmtUnit(v, r.unit, ccy)
                    : fmtAny(v)
              return (
                <tr key={r.key}>
                  <td className="font-mono text-[11px] text-muted">{r.key}</td>
                  <td>{r.label}</td>
                  <td className="n text-muted">{r.status === 'added' ? '—' : fmt(r.old)}</td>
                  <td className="text-faint">→</td>
                  <td className="n font-medium">{r.status === 'removed' ? '—' : fmt(r.new)}</td>
                  <td>
                    <Chip tone={r.status === 'changed' ? 'accent' : r.status === 'added' ? 'pos' : 'neg'}>{r.status}</Chip>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function Diff({ other, self }: { other: VersionResponse; self: VersionResponse }) {
  const diff = useMemo(() => diffDcf(other.dcf, self.dcf), [other.dcf, self.dcf])
  const ccy = self.dcf?.listing?.quote_currency ?? 'USD'
  const changelog = self.dcf?.provenance?.changelog ?? []
  const nothing = !diff.meta.length && !diff.inputs.length && !diff.assumptions.length && !diff.bridge.length
  return (
    <div className="space-y-3">
      <Card title="Value per share by scenario (other → this)">
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>Scenario</th>
                <th className="n">Other</th>
                <th className="n">This</th>
                <th className="n">Δ</th>
                <th className="n">Δ %</th>
                <th className="n">WACC</th>
                <th className="n">g</th>
                <th className="n">Prob.</th>
                <th className="n">EV ($M)</th>
              </tr>
            </thead>
            <tbody>
              {diff.scenarios.map((s) => {
                const dv = isNum(s.oldVps) && isNum(s.newVps) ? s.newVps - s.oldVps : null
                const pair = (a: number | null, b: number | null, f: (v: number | null) => string) =>
                  a === b || (isNum(a) && isNum(b) && Math.abs(a - b) < 1e-9) ? (
                    <span className="text-muted">{f(b)}</span>
                  ) : (
                    <span>
                      <span className="text-faint">{f(a)}</span> → <b>{f(b)}</b>
                    </span>
                  )
                return (
                  <tr key={s.id}>
                    <td className="font-medium">{s.label}</td>
                    <td className="n">{fmtPS(s.oldVps, ccy)}</td>
                    <td className="n font-semibold">{fmtPS(s.newVps, ccy)}</td>
                    <td className={clsx('n', isNum(dv) && (dv > 0 ? 'text-pos' : dv < 0 ? 'text-neg' : ''))}>{fmtSignedPS(dv, ccy)}</td>
                    <td className="n">{isNum(dv) && isNum(s.oldVps) && s.oldVps ? fmtPctSigned(dv / Math.abs(s.oldVps)) : '—'}</td>
                    <td className="n">{pair(s.oldWacc, s.newWacc, (v) => fmtPct(v, 2))}</td>
                    <td className="n">{pair(s.oldG, s.newG, (v) => fmtPct(v, 2))}</td>
                    <td className="n">{pair(s.oldProb, s.newProb, (v) => fmtPct(v, 0))}</td>
                    <td className="n">{pair(s.oldEv, s.newEv, fmtM)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>
      {nothing && <Empty>No differences in basis, inputs, assumptions or bridge.</Empty>}
      <DiffTable title="Basis & headline" rows={diff.meta} ccy={ccy} />
      <DiffTable title="Inputs" rows={diff.inputs} ccy={ccy} />
      <DiffTable title="Assumptions" rows={diff.assumptions} ccy={ccy} />
      <DiffTable title="Bridge" rows={diff.bridge} ccy={ccy} />
      <Card title="Changelog (this version)" bodyClassName="p-3">
        {changelog.length ? (
          <ul className="space-y-1 text-xs">
            {changelog.map((c, i) => (
              <li key={i}>
                <b>{c.summary}</b>
                {c.detail && <span className="text-muted"> — {c.detail}</span>}
                {(c.old !== undefined || c.new !== undefined) && (
                  <span className="num text-2xs">
                    {' '}
                    ({fmtAny(c.old)} → {fmtAny(c.new)})
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-xs text-faint">No changelog entries.</span>
        )}
      </Card>
    </div>
  )
}

export function VersionsTab({ vid, data }: { vid: string; data: VersionResponse }) {
  const ticker = data.summary?.ticker ?? data.run?.ticker
  const source = data.summary?.source
  const tq = useTicker(ticker)
  const [scope, setScope] = useState<'source' | 'all'>('source')
  const list: VersionSummary[] = useMemo(
    () => (tq.data?.versions ?? []).filter((v) => scope === 'all' || v.source === source),
    [tq.data, source, scope],
  )
  const idx = list.findIndex((v) => v.version_id === vid)
  const parent = data.summary?.parent_version
  const defaultOther =
    (parent && list.some((v) => v.version_id === parent) ? parent : null) ??
    list.slice(idx + 1).find((v) => v.has_dcf)?.version_id ??
    null
  const [picked, setPicked] = useState<string | null>(null)
  const other = picked ?? defaultOther
  const oq = useVersion(other ?? undefined)
  const hl = headlineOf(data.dcf?.derived ?? data.summary?.derived)
  const ccy = data.summary?.derived?.quote_currency ?? 'USD'

  return (
    <div className="space-y-3">
      <Card
        title={`History — ${ticker ?? ''} ${scope === 'source' ? source ?? '' : 'all sources'}`}
        actions={
          <select className="input" value={scope} onChange={(e) => setScope(e.target.value as 'source' | 'all')}>
            <option value="source">Same source</option>
            <option value="all">All sources</option>
          </select>
        }
      >
        {tq.isLoading ? (
          <Loading />
        ) : tq.error ? (
          <ErrorBox error={tq.error} className="m-2" />
        ) : (
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="w-8">Diff</th>
                  <th>Version</th>
                  <th>Created</th>
                  <th>As of</th>
                  <th>Kind</th>
                  <th>Status</th>
                  <th className="n">Headline</th>
                  <th className="n">vs this</th>
                  <th>Parent</th>
                </tr>
              </thead>
              <tbody>
                {list.map((v) => {
                  const h = headlineOf(v.derived)
                  const self = v.version_id === vid
                  return (
                    <tr key={v.version_id} className={clsx(self && 'bg-accent/5')}>
                      <td>
                        {!self && v.has_dcf && (
                          <input type="radio" name="diff-other" checked={other === v.version_id} onChange={() => setPicked(v.version_id)} />
                        )}
                      </td>
                      <td>
                        {self ? (
                          <span className="font-mono text-[11px] font-semibold">{v.version_id} (this)</span>
                        ) : (
                          <Link to={vLink(v.version_id, 'versions')} className="link font-mono text-[11px]">
                            {v.version_id}
                          </Link>
                        )}
                        {v.latest && (
                          <Chip tone="pos" className="ml-1">
                            latest
                          </Chip>
                        )}
                      </td>
                      <td className="num text-muted">{fmtDateTime(v.created_at)}</td>
                      <td className="num">{fmtDate(v.as_of)}</td>
                      <td>
                        <span className="text-muted">{v.kind ?? '—'}</span> <LegacyBadge origin={v.origin} />
                      </td>
                      <td>
                        <StatusBadge status={v.status} />
                      </td>
                      <td className="n font-semibold">{fmtPS(h, v.derived?.quote_currency ?? ccy)}</td>
                      <td className="n">{!self && isNum(h) && isNum(hl) && h ? fmtPctSigned(hl / h - 1) : ''}</td>
                      <td className="font-mono text-2xs text-faint">{v.parent_version ? shortVid(v.parent_version) : ''}</td>
                    </tr>
                  )
                })}
                {list.length === 0 && (
                  <tr>
                    <td colSpan={9} className="text-faint">
                      No versions.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!data.dcf ? (
        <Empty>This version has no model to diff.</Empty>
      ) : !other ? (
        <Empty>No other version of this ticker/source to diff against.</Empty>
      ) : oq.isLoading ? (
        <Loading label="Loading comparison version…" />
      ) : oq.error ? (
        <ErrorBox error={oq.error} />
      ) : oq.data?.dcf ? (
        <>
          <div className="text-xs text-muted">
            Diff: <span className="font-mono">{other}</span>
            {other === parent && ' (parent)'} → <span className="font-mono">{vid}</span> (this)
          </div>
          <Diff other={oq.data} self={data} />
        </>
      ) : (
        <Empty>The selected version has no dcf.json.</Empty>
      )}
    </div>
  )
}
