import { useState } from 'react'
import clsx from 'clsx'
import type { DcfCheck, VersionResponse } from '../../types/api'
import { fmtPS, fmtM, isNum } from '../../lib/format'
import { Chip, LevelChip, ReproBadge } from '../../components/badges'
import { Card, Empty, Segmented } from '../../components/ui'

type F = 'all' | 'fail' | 'warn' | 'pass' | 'na'

function looksLikeJson(s: string) {
  const t = s.trim()
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))
}

export function ChecksTab({ data }: { data: VersionResponse }) {
  const checks = (data.dcf?.checks ?? []) as DcfCheck[]
  const val = data.validation
  const [f, setF] = useState<F>('all')
  const counts = { fail: 0, warn: 0, pass: 0, na: 0 } as Record<string, number>
  for (const c of checks) counts[c.status ?? 'na'] = (counts[c.status ?? 'na'] ?? 0) + 1
  const order: Record<string, number> = { fail: 0, warn: 1, pass: 2, na: 3 }
  const shown = checks
    .filter((c) => f === 'all' || c.status === f)
    .sort((a, b) => (order[a.status ?? 'na'] ?? 4) - (order[b.status ?? 'na'] ?? 4))
  const items = val?.items ?? []
  const vOrder: Record<string, number> = { fail: 0, warn: 1, pass: 2 }
  const ccy = data.dcf?.listing?.quote_currency ?? 'USD'
  const repro = val?.reproduction

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-5">
      <Card
        className="xl:col-span-3"
        title={`Model checks (${checks.length})`}
        actions={
          <Segmented
            size="xs"
            options={[
              { id: 'all', label: 'All' },
              { id: 'fail', label: `Fail ${counts.fail || ''}` },
              { id: 'warn', label: `Warn ${counts.warn || ''}` },
              { id: 'pass', label: `Pass ${counts.pass || ''}` },
              { id: 'na', label: `n/a ${counts.na || ''}` },
            ]}
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
                  <th className="w-14">Status</th>
                  <th>Check</th>
                  <th>Detail / diagnosis</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c, i) => (
                  <tr key={`${c.id}-${i}`} className={clsx(c.status === 'fail' && 'bg-neg/5')}>
                    <td>
                      <LevelChip level={c.status} />
                    </td>
                    <td>
                      <div className="font-mono text-[11px]">{c.id}</div>
                      {c.label && <div className="text-muted">{c.label}</div>}
                    </td>
                    <td className="max-w-[520px]">
                      {c.detail ? (
                        <div className={clsx('break-words', looksLikeJson(c.detail) && 'font-mono text-[11px]')}>{c.detail}</div>
                      ) : null}
                      {c.diagnosis && <div className="mt-0.5 text-warn">Diagnosis: {c.diagnosis}</div>}
                    </td>
                    <td className="text-2xs text-faint">{c.produced_by ?? 'agent'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{checks.length ? 'No checks with this status.' : 'The model declares no checks.'}</Empty>
        )}
      </Card>

      <div className="space-y-3 xl:col-span-2">
        <Card
          title="Validator"
          actions={
            val ? (
              <span className="flex items-center gap-1.5">
                <Chip tone={val.ok ? 'pos' : 'neg'}>{val.ok ? 'valid' : 'invalid'}</Chip>
                <span className="text-2xs text-faint">mode {val.mode ?? '—'}</span>
              </span>
            ) : null
          }
        >
          {items.length ? (
            <table className="tbl">
              <tbody>
                {[...items]
                  .sort((a, b) => (vOrder[a.level] ?? 3) - (vOrder[b.level] ?? 3))
                  .map((it, i) => (
                    <tr key={`${it.id}-${i}`}>
                      <td className="w-12">
                        <LevelChip level={it.level} />
                      </td>
                      <td className="font-mono text-[11px]">{it.id}</td>
                      <td className="break-words text-muted">{it.message}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <Empty>{val ? 'No validator items.' : 'Not validated yet.'}</Empty>
          )}
        </Card>
        <Card title="Reproduction" actions={<ReproBadge grade={repro?.grade ?? data.summary?.reproducibility} />}>
          {repro?.scenarios && Object.keys(repro.scenarios).length ? (
            <div className="scroll-x">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Scenario</th>
                    <th className="n">Engine EV</th>
                    <th className="n">Stated EV</th>
                    <th className="n">Engine v/s</th>
                    <th className="n">Stated v/s</th>
                    <th className="n">Residual</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(repro.scenarios).map(([k, s]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <td className="n">{fmtM(s.engine_ev)}</td>
                      <td className="n">{fmtM(s.stated_ev)}</td>
                      <td className="n">{fmtPS(s.engine_vps, ccy)}</td>
                      <td className="n">{fmtPS(s.stated_vps, ccy)}</td>
                      <td className={clsx('n', isNum(s.residual) && s.residual > 1e-3 && 'text-warn')}>
                        {isNum(s.residual) ? s.residual.toExponential(1) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty className="py-3">No reproduction details.</Empty>
          )}
        </Card>
      </div>
    </div>
  )
}
