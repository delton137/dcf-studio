import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { useScreenerRow } from '../../api/hooks'
import type { FieldDef, FundEntry, Fundamentals, Refine, ScreenParams, ScreenerRow } from '../../types/screener'
import { fmtAge, fmtDate, fmtNum, fmtPS, fmtPct, isNum } from '../../lib/format'
import { fmtMoneyM, fmtPctPt, fmtRawUsdM } from '../../lib/screener'
import { tLink } from '../../lib/links'
import { anyModalOpen } from '../../components/Modal'
import { Chip, SourceDot } from '../../components/badges'
import { ErrorBox, Loading } from '../../components/ui'
import { SOURCES } from '../../types/api'
import { SOURCE_LABEL } from '../../lib/sources'
import { FieldCell, flagHelp } from './cells'

const FUND_ROWS: { key: keyof Fundamentals; label: string; shares?: boolean }[] = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'ebit', label: 'EBIT' },
  { key: 'pretax', label: 'Pre-tax income' },
  { key: 'net_income', label: 'Net income' },
  { key: 'interest', label: 'Interest expense' },
  { key: 'da', label: 'D&A' },
  { key: 'ocf', label: 'Operating cash flow' },
  { key: 'capex', label: 'Capex' },
  { key: 'sbc', label: 'SBC' },
  { key: 'diluted_shares', label: 'Diluted shares (M)', shares: true },
]

const BS_ROWS: { key: keyof Fundamentals; label: string }[] = [
  { key: 'cash', label: 'Cash' },
  { key: 'debt', label: 'Debt' },
  { key: 'minority', label: 'Minority interest' },
  { key: 'preferred', label: 'Preferred' },
]

function basisTone(b?: string | null): 'pos' | 'neutral' | 'warn' | 'muted' {
  if (b === 'TTM-exact') return 'pos'
  if (b === 'TTM') return 'neutral'
  if (b === 'FY+Q1') return 'muted'
  if (b === 'FY') return 'warn'
  return 'muted'
}

const BASIS_HELP: Record<string, string> = {
  TTM: 'trailing twelve months from four quarters (a fiscal Q4 may be imputed as FY − Q1..Q3)',
  FY: 'latest fiscal year only (no usable quarters)',
  'FY+Q1': 'cash flow approximated as FY + latest Q1 − prior-year Q1 (10-Qs report cash flow year-to-date); Refine gives exact TTM',
  'TTM-exact': 'exact TTM from SEC companyconcept: FY + YTD − prior-year YTD (after Refine)',
  BS: 'balance sheet at the latest period end (instant value)',
  'latest Q': 'diluted weighted shares of the latest quarter (dilution compares it with the year-ago quarter)',
  cover: 'EntityCommonStockSharesOutstanding from the latest filing cover page',
}

function Basis({ b }: { b?: string | null }) {
  if (!b) return <span className="text-faint">—</span>
  return (
    <Chip tone={basisTone(b)} title={BASIS_HELP[b] ?? b} className="!px-1 !text-[10px]">
      {b}
    </Chip>
  )
}

function Section({ title, children, right }: { title: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-line px-4 py-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="label">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  )
}

function MetricGrid({ fields, row, flagsHelp }: { fields: FieldDef[]; row: ScreenerRow; flagsHelp?: Record<string, string> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      {fields.map((f) => (
        <div key={f.key} className="flex min-w-0 items-baseline justify-between gap-2" title={f.desc}>
          <dt className="truncate text-muted">{f.label}</dt>
          <dd className="shrink-0 text-right">
            <FieldCell field={f} row={row} flagsHelp={flagsHelp} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function FundRow({ label, e, refined, shares }: { label: string; e?: FundEntry | null; refined?: FundEntry | null; shares?: boolean }) {
  const used = refined ?? e
  const fmt = (v: unknown) => (shares ? fmtNum(isNum(v) ? v / 1e6 : null, 0) : fmtRawUsdM(v))
  const val = shares ? used?.latest_q ?? used?.val : used?.val
  return (
    <>
      <tr>
        <td className="whitespace-nowrap text-muted">{label}</td>
        <td className="n font-medium">{fmt(val)}</td>
        <td>
          <span className="inline-flex items-center gap-1">
            <Basis b={shares && used?.latest_q ? 'latest Q' : used?.basis} />
            {used?.imputed && (
              <span className="text-[10px] text-faint" title="includes a fiscal Q4 imputed as FY − (Q1+Q2+Q3)">
                imp.
              </span>
            )}
            {used?.disagree && (
              <span className="text-[10px] text-warn" title="revenue tags disagree by > 10% (largest used)">
                ≠tags
              </span>
            )}
          </span>
        </td>
        <td className="num whitespace-nowrap text-muted">{shares && used?.latest_q ? '' : fmtDate(used?.end)}</td>
        <td className="max-w-[140px] truncate font-mono text-[10px] text-faint" title={used?.tag ?? ''}>
          {used?.tag ?? '—'}
        </td>
      </tr>
      {refined && e && (
        <tr className="text-faint">
          <td className="pl-4 text-2xs">frames</td>
          <td className="n text-2xs line-through decoration-faint/60">{fmt(e.val)}</td>
          <td>
            <span className="text-[10px]">{e.basis ?? '—'}</span>
          </td>
          <td className="num text-2xs">{fmtDate(e.end)}</td>
          <td />
        </tr>
      )}
      {!shares && isNum(used?.prior) && (
        <tr className="text-faint">
          <td className="pl-4 text-2xs">prior</td>
          <td className="n text-2xs">{fmt(used?.prior)}</td>
          <td />
          <td className="num text-2xs">{fmtDate(used?.prior_end)}</td>
          <td />
        </tr>
      )}
      {shares && isNum(used?.year_ago_q) && (
        <tr className="text-faint">
          <td className="pl-4 text-2xs">year-ago Q</td>
          <td className="n text-2xs">{fmt(used?.year_ago_q)}</td>
          <td colSpan={3} className="text-2xs">
            FY {fmt(used?.val)} ({fmtDate(used?.end)})
          </td>
        </tr>
      )}
    </>
  )
}

function Provenance({ fund, refine }: { fund: Fundamentals | null; refine: Refine | null }) {
  if (!fund) return <div className="text-xs text-faint">No SEC fundamentals for this listing (foreign IFRS filer, fund or SPAC).</div>
  return (
    <div className="space-y-2">
      <table className="tbl">
        <thead>
          <tr>
            <th>Item ($M)</th>
            <th className="n">Value</th>
            <th>Basis</th>
            <th>Period end</th>
            <th>SEC tag</th>
          </tr>
        </thead>
        <tbody>
          {FUND_ROWS.map((r) => {
            const e = fund[r.key] as FundEntry | null | undefined
            const refined = (r.key === 'ocf' || r.key === 'capex' || r.key === 'sbc' ? refine?.[r.key] : null) ?? null
            if (!e && !refined) {
              return (
                <tr key={r.key}>
                  <td className="text-muted">{r.label}</td>
                  <td className="n text-faint">—</td>
                  <td colSpan={3} className="text-2xs text-faint">
                    not reported
                  </td>
                </tr>
              )
            }
            return <FundRow key={r.key} label={r.label} e={e} refined={refined} shares={r.shares} />
          })}
          {BS_ROWS.map((r) => (
            <tr key={r.key}>
              <td className="text-muted">{r.label}</td>
              <td className="n font-medium">{fmtRawUsdM(fund[r.key])}</td>
              <td>
                <Basis b={isNum(fund[r.key]) ? 'BS' : null} />
              </td>
              <td className="num text-muted">{isNum(fund[r.key]) ? fmtDate(fund.bs_end) : ''}</td>
              <td />
            </tr>
          ))}
          <tr>
            <td className="text-muted">Shares out (M)</td>
            <td className="n font-medium">{fmtNum(isNum(fund.shares_out) ? fund.shares_out / 1e6 : null, 0)}</td>
            <td>
              <Basis b={isNum(fund.shares_out) ? 'cover' : null} />
            </td>
            <td className="num text-muted">{fmtDate(fund.shares_out_end)}</td>
            <td className="max-w-[140px] truncate font-mono text-[10px] text-faint" title="dei:EntityCommonStockSharesOutstanding">
              EntityCommonStockSharesOutstanding
            </td>
          </tr>
        </tbody>
      </table>
      <div className="text-2xs text-faint">
        {fund.entity ? <>SEC entity: {fund.entity}. </> : null}
        {refine?.refined_at ? <>Cash flow refined {fmtAge(refine.refined_at)} ago (TTM-exact). </> : null}
        Values are as reported (raw XBRL ÷ 10⁶).
      </div>
    </div>
  )
}

export function RowDrawer({
  symbol,
  row: liveRow,
  fields,
  groups,
  flagsHelp,
  params,
  onClose,
  onRunDcf,
  onAddToList,
}: {
  symbol: string
  row?: ScreenerRow
  fields: FieldDef[]
  groups: string[]
  flagsHelp?: Record<string, string>
  params?: ScreenParams
  onClose: () => void
  onRunDcf: (row: ScreenerRow) => void
  onAddToList: (symbols: string[]) => void
}) {
  const q = useScreenerRow(symbol)
  const row: ScreenerRow | undefined = liveRow ?? q.data?.row
  const help = { ...(flagsHelp ?? {}), ...(q.data?.flags_help ?? {}) }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !anyModalOpen()) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const groupFields = (g: string) => fields.filter((f) => f.group === g && !['symbol', 'name', 'flags', 'n_models', 'model_upside', 'model_age_days'].includes(f.key))
  const flags = (row?.flags ?? []) as string[]
  const enriched = !!row?.enriched_at

  return (
    <aside className="fixed bottom-0 right-0 top-[45px] z-40 flex w-[min(520px,100vw)] flex-col border-l border-line bg-panel shadow-2xl">
      <header className="flex items-start gap-2 border-b border-line px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-lg font-semibold">{symbol}</span>
            {row && (
              <>
                <span className="num text-base font-semibold">{fmtPS(row.price)}</span>
                <span className={clsx('num text-xs', isNum(row.pct_change) && row.pct_change < 0 ? 'text-neg' : 'text-pos')}>{fmtPctPt(row.pct_change)}</span>
                <span className="num text-xs text-muted">mkt cap {fmtMoneyM(row.market_cap)}</span>
              </>
            )}
          </div>
          <div className="truncate text-xs text-muted" title={row?.name ?? ''}>
            {row?.name ?? '—'}
          </div>
          <div className="truncate text-2xs text-faint">
            {[row?.sector, row?.industry, row?.country, row?.kind].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button className="btn btn-ghost px-1.5" onClick={onClose} aria-label="Close" title="Close (Esc)">
          ✕
        </button>
      </header>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2">
        <button className="btn btn-primary" disabled={!row} onClick={() => row && onRunDcf(row)}>
          Run DCF…
        </button>
        <button className="btn" onClick={() => onAddToList([symbol])}>
          Add to list…
        </button>
        {row?.ticker && (
          <Link className="btn" to={tLink(row.ticker)}>
            Open models →
          </Link>
        )}
        {row?.cik ? (
          <a
            className="link ml-auto text-2xs"
            href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${row.cik}&type=10-&dateb=&owner=include&count=40`}
            target="_blank"
            rel="noreferrer"
          >
            SEC filings ↗
          </a>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {q.isLoading && !row ? <Loading /> : null}
        {q.error && !row ? <ErrorBox error={q.error} className="m-3" /> : null}
        {row && (
          <>
            {(row.n_models ?? 0) > 0 && (
              <Section title="DCF Studio models">
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  {SOURCES.filter((s) => row[`has_${s}`]).map((s) => (
                    <span key={s} className="inline-flex items-center gap-1">
                      <SourceDot source={s} /> {SOURCE_LABEL[s]}
                    </span>
                  ))}
                  <span className="text-muted">
                    median upside{' '}
                    <FieldCell field={{ key: 'model_upside', label: '', group: '', type: 'pct', desc: '' }} row={row} />
                  </span>
                  <span className="text-muted">newest {row.model_age_days ?? '—'}d old</span>
                  {row.ticker && (
                    <Link className="link ml-auto" to={tLink(row.ticker)}>
                      Compare models →
                    </Link>
                  )}
                </div>
              </Section>
            )}
            {groups
              .filter((g) => g !== 'Identity' && g !== 'Coverage' && g !== 'Data')
              .map((g) => (
                <Section
                  key={g}
                  title={g}
                  right={
                    g === 'Reverse DCF' && params ? (
                      <span className="num text-2xs text-faint">
                        r {fmtPct(params.r, 1)} · g_T {fmtPct(params.g_t, 1)} · target FCF margin {fmtPct(params.target_margin, 0)}
                      </span>
                    ) : g === 'Catalysts' ? (
                      <span className="text-2xs text-faint">{enriched ? `enriched ${fmtAge(row.enriched_at)} ago` : 'not enriched (52-week data needs Enrich)'}</span>
                    ) : undefined
                  }
                >
                  <MetricGrid fields={groupFields(g)} row={row} flagsHelp={help} />
                  {g === 'Reverse DCF' && (
                    <p className="mt-1.5 text-2xs leading-snug text-faint">
                      Implied growth = constant 10-yr FCF growth that justifies today's EV (unlevered FCF, Gordon terminal). Gap = implied − actual
                      revenue growth; negative means the price asks for less than the company is delivering.
                      {row.implied_edge === 'below_range' && ' EV is below the value at −50%/yr growth.'}
                      {row.implied_edge === 'above_range' && ' EV is above the value at +100%/yr growth.'}
                      {row.implied_growth == null && row.implied_rev_cagr != null && ' FCF ≤ 0: the revenue CAGR shown assumes FCF margin ramps to the target by year 10.'}
                    </p>
                  )}
                  {g === 'Catalysts' && (row.earnings_date || enriched) && (
                    <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      {row.earnings_date && (
                        <div className="col-span-2 text-muted">
                          Next earnings <b className="num text-fg">{fmtDate(row.earnings_date)}</b>
                          {row.earnings_time ? ` (${row.earnings_time})` : ''}
                          {isNum(row.days_to_earnings) ? ` · in ${row.days_to_earnings} day${row.days_to_earnings === 1 ? '' : 's'}` : ''}
                          {isNum(row.eps_forecast) ? ` · EPS est. ${fmtPS(row.eps_forecast)}` : ''}
                        </div>
                      )}
                      {enriched && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-muted">52w high</span>
                            <span className="num">{fmtPS(row.high_52w)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted">52w low</span>
                            <span className="num">{fmtPS(row.low_52w)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted">6m return</span>
                            <span className={clsx('num', isNum(row.mom_6m) && row.mom_6m < 0 ? 'text-neg' : 'text-pos')}>{fmtPct(row.mom_6m)}</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </Section>
              ))}
            <Section title={`Flags (${flags.length})`}>
              {flags.length ? (
                <ul className="space-y-1 text-xs">
                  {flags.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Chip tone="warn" className="shrink-0 font-mono !text-[10px]">
                        {f}
                      </Chip>
                      <span className="text-muted">{flagHelp(f, help)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs text-faint">No data-quality flags.</div>
              )}
            </Section>
            <Section
              title="SEC fundamentals & provenance"
              right={
                <span className="text-2xs text-faint">
                  rev {row.revenue_basis ?? '—'} to {fmtDate(row.revenue_end)} · cash flow {row.cashflow_basis ?? '—'} · data age {row.data_age_days ?? '—'}d
                </span>
              }
            >
              {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : <Provenance fund={q.data?.fundamentals ?? null} refine={q.data?.refine ?? null} />}
            </Section>
            <div className="px-4 py-2 text-2xs text-faint">
              Screening-grade data: as-reported GAAP from SEC XBRL, levered FCF; fundamentals can lag the price by a quarter. Full DCFs are the
              model-grade view.
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
