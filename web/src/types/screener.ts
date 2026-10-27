/* Screener API types (docs/API.md "Screener", server/screener/*.py).
 * Money in $M; percent fields are fractions (0.15 = 15%) except `pct_change`
 * (percentage points) and `rule_of_40` (points). Any row field may be missing. */
import type { RunMeta, Validation } from './api'

export type FieldType = 'text' | 'price' | 'pctpt' | 'money' | 'mult' | 'pct' | 'num' | 'int' | 'date' | 'flags'

export interface FieldDef {
  key: string
  label: string
  group: string
  type: FieldType | string
  desc: string
}

export interface ScreenParams {
  r: number
  g_t: number
  target_margin: number
  years?: number
}

export interface FieldsResponse {
  fields: FieldDef[]
  groups: string[]
  flags: Record<string, string>
  params: ScreenParams
}

export type FilterOp =
  | '>='
  | '<='
  | '>'
  | '<'
  | '=='
  | 'between'
  | 'in'
  | 'not_in'
  | 'is_null'
  | 'not_null'
  | 'is_true'
  | 'is_false'
  | 'has_flag'
  | 'no_flag'
  | 'contains'

export interface ScreenFilter {
  f: string
  op: FilterOp | string
  v?: unknown
}

export interface SortKey {
  f: string
  dir: 'asc' | 'desc'
}

/** A screen. `cols` (visible columns) is UI-only: kept in the URL / saved screens, never sent to /query. */
export interface Screen {
  name?: string
  universe: string
  filters: ScreenFilter[]
  sort: SortKey[]
  params?: Partial<ScreenParams>
  cols?: string[]
}

export interface Preset {
  id: string
  name: string
  group: string
  desc: string
  screen: Screen
  needs_enrich?: boolean
}

export type ImpliedEdge = 'below_range' | 'above_range' | null

export interface ScreenerRow {
  symbol: string
  name?: string | null
  sector?: string | null
  industry?: string | null
  country?: string | null
  kind?: string | null
  cik?: number | null
  financial?: boolean | null
  price?: number | null
  pct_change?: number | null
  volume?: number | null
  market_cap?: number | null
  ev?: number | null
  revenue?: number | null
  revenue_basis?: string | null
  revenue_end?: string | null
  rev_growth?: number | null
  ebit?: number | null
  op_margin?: number | null
  net_income?: number | null
  ebitda?: number | null
  ocf?: number | null
  capex?: number | null
  fcf?: number | null
  cashflow_basis?: string | null
  fcf_margin?: number | null
  fcf_yield?: number | null
  sbc?: number | null
  sbc_pct?: number | null
  cash?: number | null
  debt?: number | null
  net_cash?: number | null
  net_cash_pct?: number | null
  ev_sales?: number | null
  ev_ebit?: number | null
  ev_ebitda?: number | null
  pe?: number | null
  peg?: number | null
  rule_of_40?: number | null
  dilution?: number | null
  shares?: number | null
  fcf_unlevered?: number | null
  implied_growth?: number | null
  implied_edge?: ImpliedEdge | string
  implied_gap?: number | null
  implied_rev_cagr?: number | null
  data_age_days?: number | null
  earnings_date?: string | null
  earnings_time?: string | null
  eps_forecast?: number | null
  days_to_earnings?: number | null
  high_52w?: number | null
  low_52w?: number | null
  pct_below_high?: number | null
  mom_3m?: number | null
  mom_6m?: number | null
  mom_12m?: number | null
  enriched_at?: string | null
  ticker?: string | null
  n_models?: number | null
  has_claude?: boolean | null
  has_codex?: boolean | null
  has_grok?: boolean | null
  has_agy?: boolean | null
  model_upside?: number | null
  model_age_days?: number | null
  flags?: string[] | null
  [k: string]: unknown
}

export interface QueryResponse {
  asof?: string | null
  total: number
  matched: number
  rows: ScreenerRow[]
  unmatched?: string[]
  params?: ScreenParams
}

export interface JobStatus {
  state?: 'idle' | 'running' | string
  done?: number
  total?: number
  errors?: string[]
  error?: string | null
  started_at?: string | null
  finished_at?: string | null
}

export interface ScreenerStatus {
  state: 'idle' | 'running' | 'error' | string
  stage?: string | null
  detail?: string | null
  done?: number | null
  total?: number | null
  frames_done?: number | null
  frames_total?: number | null
  started_at?: string | null
  finished_at?: string | null
  seconds?: number | null
  table_asof?: string | null
  table_rows?: number | null
  last_ok?: string | null
  error?: string | null
  jobs?: { enrich?: JobStatus; refine?: JobStatus; [k: string]: JobStatus | undefined }
  params?: ScreenParams
}

/** One SEC fundamental with provenance (raw USD / raw shares, not $M). */
export interface FundEntry {
  val?: number | null
  basis?: string | null
  end?: string | null
  tag?: string | null
  imputed?: boolean | null
  disagree?: boolean | null
  prior?: number | null
  prior_end?: string | null
  latest_q?: number | null
  year_ago_q?: number | null
}

export interface Fundamentals {
  revenue?: FundEntry | null
  ebit?: FundEntry | null
  pretax?: FundEntry | null
  net_income?: FundEntry | null
  interest?: FundEntry | null
  da?: FundEntry | null
  diluted_shares?: FundEntry | null
  ocf?: FundEntry | null
  capex?: FundEntry | null
  sbc?: FundEntry | null
  cash?: number | null
  debt?: number | null
  minority?: number | null
  preferred?: number | null
  bs_end?: string | null
  shares_out?: number | null
  shares_out_end?: string | null
  flags?: string[] | null
  entity?: string | null
  [k: string]: unknown
}

export interface Refine {
  cik?: number | string
  refined_at?: string | null
  ocf?: FundEntry | null
  capex?: FundEntry | null
  sbc?: FundEntry | null
}

export interface RowDetail {
  row: ScreenerRow
  fundamentals: Fundamentals | null
  refine: Refine | null
  flags_help: Record<string, string>
}

export interface SectorsResponse {
  sectors: { name: string; count: number }[]
  industries: { sector: string; name: string; count: number }[]
}

export interface SavedScreen {
  slug: string
  name: string
  note?: string | null
  screen: Screen
  saved_at?: string | null
}

export interface ListSource {
  by?: string
  run_id?: string
  query?: string
  cli?: string
  model?: string
  description?: string
}

export interface UniverseListSummary {
  slug: string
  name: string
  kind: 'custom' | 'agent' | string
  source?: ListSource | null
  count: number
  created_at?: string | null
  updated_at?: string | null
}

export interface BuiltinUniverse {
  id: string
  name: string
  desc: string
}

export interface UniversesResponse {
  builtin: BuiltinUniverse[]
  lists: UniverseListSummary[]
}

export interface ListMember {
  symbol: string
  name?: string
  note?: string
}

export interface UniverseDoc {
  slug: string
  name: string
  kind: 'custom' | 'agent' | string
  source?: ListSource | null
  members: ListMember[]
  created_at?: string | null
  updated_at?: string | null
}

export interface AgentRequest {
  kind: 'shortlist' | 'theme'
  screen?: Omit<Screen, 'cols'>
  top_n?: number
  objective?: string
  query?: string
  list_name?: string
  cli: string
  model?: string
  effort?: string
}

export interface AgentRunMeta extends RunMeta {
  screener?: {
    screen?: Screen
    top_n?: number
    objective?: string | null
    query?: string
    list_name?: string | null
    instructions?: string | null
  } | null
  result_list?: string | null
}

export interface ShortlistPick {
  symbol: string
  rank?: number
  thesis?: string
  why_now?: string
  key_risk?: string
  what_the_dcf_must_answer?: string
}

export interface ThemeMember {
  symbol: string
  name?: string
  exposure?: string
  note?: string
}

export interface AgentResult {
  run: AgentRunMeta
  validation: Validation | null
  shortlist: { picks?: ShortlistPick[] } | null
  universe: { name?: string; description?: string; members?: ThemeMember[] } | null
  screen: { screen?: Screen; top_n?: number; matched?: number; rows_given?: number; params?: ScreenParams; asof?: string } | null
  report: string | null
}
