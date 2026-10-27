import { useState } from 'react'
import type { Dcf, DcfSource } from '../../types/api'
import { fmtDate, fmtUnit } from '../../lib/format'
import { AssumptionStatusChip } from '../../components/badges'
import { Card, Empty, Segmented } from '../../components/ui'

type F = 'all' | 'measured' | 'derived' | 'guided' | 'assumed'

export function SourcesTab({ dcf }: { dcf: Dcf }) {
  const sources = (dcf.sources ?? []) as DcfSource[]
  const assumptions = dcf.assumptions ?? []
  const [f, setF] = useState<F>('all')
  const ccy = dcf.listing?.quote_currency ?? 'USD'
  const cik = /^\d+$/.test(dcf.provenance?.cik ?? '') ? String(Number(dcf.provenance!.cik)) : null
  const counts: Record<string, number> = {}
  for (const a of assumptions) counts[a.status ?? 'assumed'] = (counts[a.status ?? 'assumed'] ?? 0) + 1
  const srcIds = new Set(sources.map((s) => s.id))
  const shown = assumptions.filter((a) => f === 'all' || (a.status ?? 'assumed') === f)

  return (
    <div className="space-y-3">
      <Card
        title={`Assumptions (${assumptions.length})`}
        actions={
          <Segmented
            size="xs"
            options={(['all', 'measured', 'derived', 'guided', 'assumed'] as F[]).map((k) => ({
              id: k,
              label: k === 'all' ? 'All' : `${k} ${counts[k] ?? 0}`,
            }))}
            value={f}
            onChange={setF}
          />
        }
      >
        {shown.length ? (
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Assumption</th>
                  <th className="n">Value</th>
                  <th>Scenario</th>
                  <th>Method</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a, i) => (
                  <tr key={`${a.id}-${i}`}>
                    <td>
                      <AssumptionStatusChip status={a.status} />
                    </td>
                    <td>
                      <div className="font-medium">{a.label}</div>
                      <div className="font-mono text-2xs text-faint">{a.id}</div>
                    </td>
                    <td className="n whitespace-nowrap">{fmtUnit(a.value, a.unit, ccy)}</td>
                    <td className="text-muted">{a.scenario_id ?? 'all'}</td>
                    <td className="max-w-[460px] text-muted">{a.method ?? ''}</td>
                    <td>
                      {a.source_id ? (
                        srcIds.has(a.source_id) ? (
                          <a href={`#src-${a.source_id}`} className="link font-mono text-2xs">
                            {a.source_id}
                          </a>
                        ) : (
                          <span className="font-mono text-2xs text-faint">{a.source_id}</span>
                        )
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No assumptions recorded.</Empty>
        )}
      </Card>

      <Card title={`Sources (${sources.length})`}>
        {sources.length ? (
          <div className="scroll-x">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Id</th>
                  <th>Kind</th>
                  <th>Description</th>
                  <th>Accession</th>
                  <th>Exhibit</th>
                  <th>Filed</th>
                  <th>Fetched</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s, i) => (
                  <tr key={`${s.id}-${i}`} id={`src-${s.id}`}>
                    <td className="font-mono text-[11px]">{s.id}</td>
                    <td>{s.kind}</td>
                    <td className="max-w-[420px]">{s.description ?? ''}</td>
                    <td className="font-mono text-[11px]">
                      {s.accession ? (
                        cik ? (
                          <a
                            className="link"
                            target="_blank"
                            rel="noreferrer"
                            href={`https://www.sec.gov/Archives/edgar/data/${cik}/${s.accession.replace(/-/g, '')}/`}
                            title="Open the filing index on EDGAR"
                          >
                            {s.accession}
                          </a>
                        ) : (
                          s.accession
                        )
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{s.exhibit ?? ''}</td>
                    <td className="num">{s.filed ? fmtDate(s.filed) : ''}</td>
                    <td className="num text-2xs text-faint">{s.fetched_at ? fmtDate(s.fetched_at) : ''}</td>
                    <td>
                      {s.url ? (
                        <a className="link" href={s.url} target="_blank" rel="noreferrer" title={s.url}>
                          open ↗
                        </a>
                      ) : (
                        ''
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No sources recorded.</Empty>
        )}
      </Card>
    </div>
  )
}
