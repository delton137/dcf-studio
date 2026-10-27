import { Link } from 'react-router-dom'
import clsx from 'clsx'
import type { Dcf, DcfAltValuation, DcfGuidance, VersionResponse } from '../../types/api'
import {
  fmtAny,
  fmtDate,
  fmtDateTime,
  fmtM,
  fmtNum,
  fmtPS,
  fmtPct,
  fmtSmart,
  fmtUnit,
  isNum,
} from '../../lib/format'
import { headlineOf, mainTerminal, refPrice, scenarioEv, scenarios } from '../../lib/derive'
import { vLink } from '../../lib/links'
import { Chip, ReproBadge, UpsideChip } from '../../components/badges'
import { Card, Empty, KV, Stat } from '../../components/ui'

function roleTone(role?: string) {
  return role === 'bear' ? 'neg' : role === 'bull' ? 'pos' : role === 'base' ? 'accent' : 'muted'
}

export function SummaryTab({ data, dcf }: { data: VersionResponse; dcf: Dcf }) {
  const d = dcf.derived ?? data.summary?.derived ?? {}
  const ccy = d.quote_currency ?? dcf.listing?.quote_currency ?? 'USD'
  const price = refPrice(d)
  const scns = scenarios(dcf)
  const prov = dcf.provenance ?? {}
  const imp = prov.imported_from
  const val = data.validation
  const arch = dcf.archetype
  const idc = arch?.identity_check

  return (
    <div className="space-y-3">
      {/* headline numbers */}
      <div className="flex flex-wrap gap-2">
        {(['bear', 'base', 'bull'] as const).map((k) => (
          <Stat
            key={k}
            label={k}
            value={<span className={clsx(isNum(d.value_ps?.[k]) && d.value_ps![k]! < 0 && 'text-neg')}>{fmtPS(d.value_ps?.[k], ccy)}</span>}
            sub={isNum(price) && isNum(d.value_ps?.[k]) ? <UpsideChip value={d.value_ps![k]! / price - 1} /> : undefined}
          />
        ))}
        <Stat label="Prob-weighted" value={fmtPS(d.value_ps?.pw, ccy)} sub={isNum(price) && isNum(d.value_ps?.pw) ? <UpsideChip value={d.value_ps!.pw! / price - 1} /> : undefined} />
        <Stat
          label={`Headline · ${dcf.headline?.method?.replace(/_/g, ' ') ?? 'base'}`}
          value={fmtPS(headlineOf(d), ccy)}
          valueClassName="text-accent"
          sub={isNum(price) && isNum(headlineOf(d)) ? <UpsideChip value={headlineOf(d)! / price - 1} /> : undefined}
        />
        <Stat
          label="Compare price"
          value={fmtPS(d.compare_price, ccy)}
          sub={<span className="text-faint">common app price</span>}
        />
        <Stat label="Model price" value={fmtPS(d.price_model, ccy)} sub={fmtDate(d.price_ts)} />
        <Stat label="EV ($M)" value={fmtM(d.ev)} sub={`equity ${fmtM(d.equity)}`} />
      </div>
      {dcf.headline?.rationale && <div className="text-xs text-muted">Headline rationale: {dcf.headline.rationale}</div>}
      {dcf.narrative?.headline && (
        <div className="rounded border-l-2 border-accent bg-accent/5 px-3 py-1.5 text-sm">{dcf.narrative.headline}</div>
      )}
      {dcf.engine_override_reason && (
        <div className="rounded border border-warn/40 bg-warn/5 px-3 py-1.5 text-xs text-warn">
          Engine override: {dcf.engine_override_reason}
        </div>
      )}

      {/* scenario table */}
      <Card title="Scenarios">
        <div className="scroll-x">
          <table className="tbl">
            <thead>
              <tr>
                <th>Scenario</th>
                <th className="n">Prob.</th>
                <th className="n">WACC</th>
                <th className="n">g</th>
                <th>Terminal</th>
                <th className="n">EV ($M)</th>
                <th className="n">Equity ($M)</th>
                <th className="n">Shares (M)</th>
                <th className="n">Value / share</th>
                <th className="n">Upside</th>
                <th className="n">TV % EV</th>
              </tr>
            </thead>
            <tbody>
              {scns.map((s) => {
                const t = mainTerminal(s)
                const vps = s.results?.value_per_share
                return [
                  <tr key={s.id}>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <Chip tone={roleTone(s.role)}>{s.role}</Chip>
                        <span className="font-medium">{s.label ?? s.id}</span>
                        {s.results?.floored && <Chip tone="warn">floored</Chip>}
                      </div>
                    </td>
                    <td className="n">{fmtPct(s.probability, 0)}</td>
                    <td className="n">{fmtPct(s.discounting?.wacc, 2)}</td>
                    <td className="n">{fmtPct(t?.g, 2)}</td>
                    <td className="text-muted">
                      {t?.method?.replace(/_/g, ' ') ?? '—'}
                      {t?.method === 'exit_multiple' && isNum(t.multiple) && ` ${fmtNum(t.multiple, 1)}× ${t.multiple_metric ?? ''}`}
                    </td>
                    <td className={clsx('n', (scenarioEv(s) ?? 0) < 0 && 'text-neg')}>{fmtM(scenarioEv(s))}</td>
                    <td className={clsx('n', (s.results?.equity ?? 0) < 0 && 'text-neg')}>{fmtM(s.results?.equity)}</td>
                    <td className="n">{fmtNum(s.results?.shares_used ?? s.shares?.used, 1)}</td>
                    <td className={clsx('n font-semibold', isNum(vps) && vps < 0 && 'text-neg')}>{fmtPS(vps, ccy)}</td>
                    <td className="n">
                      <UpsideChip value={isNum(vps) && isNum(price) && price ? vps / price - 1 : s.results?.upside} />
                    </td>
                    <td className="n">{fmtPct(s.results?.tv_share_of_ev)}</td>
                  </tr>,
                  s.narrative ? (
                    <tr key={`${s.id}-n`}>
                      <td colSpan={11} className="pb-2 pt-0 text-2xs text-muted">
                        {s.narrative}
                      </td>
                    </tr>
                  ) : null,
                ]
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title="Archetype & decisive variable" bodyClassName="p-3">
          <KV
            rows={[
              ['Archetype', <b>{arch?.kind ? arch.kind.replace(/_/g, ' ') : '—'}</b>],
              ['Engine identity', <span className="font-mono text-[11px]">{arch?.engine ?? '—'}</span>],
              ['Decisive variable', <b>{arch?.decisive?.label ?? '—'}</b>],
              [
                'Base value',
                arch?.decisive?.base_value != null ? fmtUnit(arch.decisive.base_value, arch.decisive.unit, ccy) : '—',
              ],
              [
                'Market implied',
                arch?.decisive?.market_implied != null ? fmtUnit(arch.decisive.market_implied, arch.decisive.unit, ccy) : '—',
              ],
              [
                'Anchor',
                arch?.decisive?.anchor ? (
                  <span>
                    {arch.decisive.anchor.label}
                    {arch.decisive.anchor.value != null && `: ${fmtUnit(arch.decisive.anchor.value, arch.decisive.unit, ccy)}`}
                    {arch.decisive.anchor.source_id && <span className="text-faint"> [{arch.decisive.anchor.source_id}]</span>}
                  </span>
                ) : (
                  '—'
                ),
              ],
              [
                'Identity check',
                idc ? (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[11px]">{idc.expr}</span>
                    {idc.period && <span className="text-faint">{idc.period}</span>}
                    <span className="num">
                      model {fmtSmart(idc.model)} vs reported {fmtSmart(idc.reported)}
                    </span>
                    {idc.passed === true && <Chip tone="pos">pass</Chip>}
                    {idc.passed === false && <Chip tone="neg">fail</Chip>}
                  </span>
                ) : (
                  '—'
                ),
              ],
            ]}
          />
        </Card>

        <Card title="Validation & provenance" bodyClassName="p-3">
          <KV
            rows={[
              [
                'Validator',
                val ? (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <Chip tone={val.ok ? 'pos' : 'neg'}>{val.ok ? 'valid' : 'invalid'}</Chip>
                    <span className="num">
                      {val.summary?.fail ?? 0} fail · {val.summary?.warn ?? 0} warn · {val.summary?.pass ?? 0} pass
                    </span>
                    <span className="text-faint">mode {val.mode ?? '—'}</span>
                  </span>
                ) : (
                  '—'
                ),
              ],
              [
                'Reproducibility',
                <span className="inline-flex items-center gap-1.5">
                  <ReproBadge grade={data.summary?.reproducibility ?? val?.reproduction?.grade} />
                  {isNum(val?.reproduction?.residual) && (
                    <span className="num text-faint">residual {val!.reproduction!.residual!.toExponential(1)}</span>
                  )}
                </span>,
              ],
              ['Producer', `${prov.producer ?? '—'}${prov.cli ? ` · ${prov.cli}` : ''}${prov.model ? ` · ${prov.model}` : ''}`],
              ['Origin', data.summary?.origin ?? '—'],
              ['Created', fmtDateTime(prov.created_at ?? data.summary?.created_at)],
              [
                'Parent',
                prov.parent_version || data.summary?.parent_version ? (
                  <Link className="link font-mono" to={vLink((prov.parent_version || data.summary?.parent_version)!)}>
                    {prov.parent_version || data.summary?.parent_version}
                  </Link>
                ) : (
                  '—'
                ),
              ],
              ['dcfkit', `${prov.dcfkit_version ?? '—'} · schema ${prov.schema_version ?? '—'} · ${prov.validation_mode ?? ''}`],
              ...(imp
                ? ([
                    ['Imported from', <span className="break-all font-mono text-[11px]">{imp.path}</span>],
                    [
                      'Legacy',
                      <span>
                        {imp.source} · {imp.generation} · fidelity {imp.fidelity ?? '—'} · scale {imp.source_scale ?? '—'} ·{' '}
                        {imp.quality ?? '—'}
                        {imp.legacy_created ? ` · created ${imp.legacy_created}` : ''}
                      </span>,
                    ],
                    ...(imp.notes ? ([['Import notes', <span className="text-muted">{imp.notes}</span>]] as [string, React.ReactNode][]) : []),
                  ] as [string, React.ReactNode][])
                : []),
              ...(prov.overrides_applied && Object.keys(prov.overrides_applied).length
                ? ([['Overrides applied', <span className="font-mono text-[11px]">{JSON.stringify(prov.overrides_applied)}</span>]] as [
                    string,
                    React.ReactNode,
                  ][])
                : []),
            ]}
          />
        </Card>

        <Card title="Basis & market" bodyClassName="p-3">
          <KV
            rows={[
              ['As of', fmtDate(dcf.basis?.as_of)],
              ['Valuation date', fmtDate(dcf.basis?.valuation_date)],
              ['Latest period', dcf.basis?.latest_period ?? '—'],
              ['Fiscal year end', dcf.basis?.fiscal_year_end ?? '—'],
              ['Reporting ccy', `${dcf.basis?.reporting_currency ?? '—'} → quote ${dcf.listing?.quote_currency ?? '—'} (fx ${fmtSmart(dcf.market?.fx_spot)})`],
              ['Margin basis / SBC', `${dcf.basis?.margin_basis ?? '—'} · SBC ${dcf.basis?.sbc_treatment?.replace(/_/g, ' ') ?? '—'}`],
              [
                'Listing',
                `${dcf.listing?.symbol ?? '—'}${dcf.listing?.exchange ? ` · ${dcf.listing.exchange}` : ''} · ${dcf.listing?.listed_unit ?? 'common'}${
                  isNum(dcf.listing?.ordinary_per_listed_unit) && dcf.listing!.ordinary_per_listed_unit !== 1
                    ? ` (${dcf.listing!.ordinary_per_listed_unit} ord/unit)`
                    : ''
                }`,
              ],
              [
                'Price',
                <span>
                  {fmtPS(dcf.market?.price, ccy)} <span className="text-faint">{dcf.market?.price_ts} · {dcf.market?.price_source}</span>
                </span>,
              ],
              ['Shares (M)', `diluted ${fmtNum(dcf.market?.shares_diluted, 1)} · basic ${fmtNum(dcf.market?.shares_basic, 1)}`],
              ['Market cap ($M)', fmtM(dcf.market?.market_cap)],
            ]}
          />
        </Card>

        <Card title="Changelog" bodyClassName="p-3">
          {prov.changelog?.length ? (
            <ul className="space-y-1.5 text-xs">
              {prov.changelog.map((c, i) => (
                <li key={i}>
                  <div className="font-medium">{c.summary}</div>
                  {c.detail && <div className="text-muted">{c.detail}</div>}
                  {(c.old !== undefined || c.new !== undefined) && (
                    <div className="num text-2xs">
                      <span className="text-neg line-through">{fmtAny(c.old)}</span> → <span className="text-pos">{fmtAny(c.new)}</span>
                    </div>
                  )}
                  {c.paths?.length ? <div className="font-mono text-2xs text-faint">{c.paths.join(', ')}</div> : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty className="py-2">No changelog entries.</Empty>
          )}
        </Card>
      </div>

      <GuidanceTable items={(dcf.guidance ?? []) as DcfGuidance[]} scenarioIds={scns.map((s) => s.id ?? '')} />
      <AltValuations items={(dcf.alt_valuations ?? []) as DcfAltValuation[]} ccy={ccy} />
    </div>
  )
}

function GuidanceTable({ items, scenarioIds }: { items: DcfGuidance[]; scenarioIds: string[] }) {
  if (!items.length) return null
  return (
    <Card title="Guidance">
      <div className="scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Period</th>
              <th>Basis</th>
              <th className="n">Low</th>
              <th className="n">High</th>
              <th className="n">YTD actual</th>
              {scenarioIds.map((s) => (
                <th key={s} className="n">
                  Model {s}
                </th>
              ))}
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {items.map((g, i) => (
              <tr key={i}>
                <td className="font-medium">{g.metric}</td>
                <td>{g.period}</td>
                <td className="text-muted">{g.basis}</td>
                <td className="n">{fmtUnit(g.low, g.unit)}</td>
                <td className="n">{fmtUnit(g.high, g.unit)}</td>
                <td className="n">{fmtUnit(g.ytd_actual, g.unit)}</td>
                {scenarioIds.map((s) => {
                  const v = (g.model as Record<string, number> | undefined)?.[s]
                  const ins = (g.inside as Record<string, boolean> | undefined)?.[s]
                  return (
                    <td key={s} className={clsx('n', ins === false && 'text-neg', ins === true && 'text-pos')}>
                      {fmtUnit(v, g.unit)}
                      {ins === false && ' ✗'}
                      {ins === true && ' ✓'}
                    </td>
                  )
                })}
                <td className="text-faint">{g.source_id ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function AltValuations({ items, ccy }: { items: DcfAltValuation[]; ccy: string }) {
  if (!items.length) return null
  return (
    <Card title="Alternative valuations">
      <div className="scroll-x">
        <table className="tbl">
          <thead>
            <tr>
              <th>Label</th>
              <th>Method</th>
              <th>Scenario</th>
              <th className="n">Value / share</th>
              <th>Inputs</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a, i) => (
              <tr key={a.id ?? i}>
                <td className="font-medium">{a.label}</td>
                <td className="text-muted">{a.method?.replace(/_/g, ' ')}</td>
                <td>{a.scenario_id ?? '—'}</td>
                <td className={clsx('n font-semibold', isNum(a.value_per_share) && a.value_per_share < 0 && 'text-neg')}>
                  {fmtPS(a.value_per_share, ccy)}
                </td>
                <td className="max-w-[320px] font-mono text-[11px] text-muted">
                  {a.inputs && Object.keys(a.inputs).length
                    ? Object.entries(a.inputs)
                        .map(([k, v]) => `${k}=${fmtAny(v)}`)
                        .join(', ')
                    : '—'}
                </td>
                <td className="text-muted">{a.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
