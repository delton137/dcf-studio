/* Hand-written API types (docs/API.md). The model payload (dcf.json) types are
 * generated into ./dcf.ts; here they are wrapped in DeepPartial because imported
 * legacy models can miss almost anything — every view must degrade gracefully. */
import type {
  DCF as DCFStrict,
  Input as InputStrict,
  Assumption as AssumptionStrict,
  ChangeEntry as ChangeEntryStrict,
  Provenance as ProvenanceStrict,
} from './dcf'

export type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T

export const SOURCES = ['claude', 'codex', 'grok', 'agy'] as const
export type Source = (typeof SOURCES)[number]

export type VersionStatus =
  | 'queued'
  | 'running'
  | 'validating'
  | 'fixing'
  | 'valid'
  | 'invalid'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'unknown'

export const ACTIVE_STATUSES: readonly string[] = ['queued', 'running', 'validating', 'fixing']
export const TERMINAL_STATUSES: readonly string[] = ['valid', 'invalid', 'failed', 'cancelled', 'interrupted']

export type Origin = 'run' | 'import' | 'app_edit'
export type Reproducibility = 'exact' | 'approx' | 'none'

export interface Usage {
  cost_usd?: number | null
  input_tokens?: number | null
  output_tokens?: number | null
  [k: string]: unknown
}

export interface ValuePs {
  bear?: number | null
  base?: number | null
  bull?: number | null
  pw?: number | null
  headline?: number | null
}

/** Canonical comparison metrics (dcfkit/engine.py::derive). Any field may be missing. */
export interface Derived {
  error?: string
  value_ps?: ValuePs
  price_model?: number | null
  price_ts?: string | null
  upside_model?: number | null
  compare_price?: number | null
  upside_compare?: number | null
  quote_currency?: string | null
  listed_unit?: string | null
  wacc?: number | null
  g?: number | null
  terminal_method?: string | null
  ev?: number | null
  equity?: number | null
  tv_pct_ev?: number | null
  shares_used?: number | null
  horizon_years?: number | null
  rev_cagr?: number | null
  terminal_ebit_margin?: number | null
  margin_basis?: string | null
  terminal_capex_da?: number | null
  implied_exit_ev_ebitda?: number | null
  ev_ebitda_y1?: number | null
  yr1_revenue?: number | null
  yr1_period?: string | null
  yr1_period_end?: string | null
  yr1_guide_mid?: number | null
  yr1_vs_guide?: number | null
  yr1_inside?: boolean | null
  dilution_pct?: number | null
  checks?: { pass?: number; fail?: number; warn?: number; total?: number } | null
  archetype?: string | null
  decisive?: string | null
  scenario_count?: number | null
}

export interface ValidationSummary {
  ok?: boolean | null
  fail?: number
  warn?: number
  pass?: number
}

export interface VersionSummary {
  version_id: string
  ticker: string
  company?: string | null
  source: Source
  origin: Origin
  status: VersionStatus | string
  kind?: string | null
  created_at?: string | null
  finished_at?: string | null
  cli?: string | null
  model?: string | null
  effort?: string | null
  parent_version?: string | null
  error?: string | null
  usage?: Usage | null
  has_dcf: boolean
  as_of?: string | null
  quality?: 'verified' | 'unverified' | null
  validation?: ValidationSummary | null
  reproducibility?: Reproducibility | null
  has_model_py?: boolean
  superseded?: boolean
  latest?: boolean
  derived?: Derived | null
}

export interface PriceQuote {
  price?: number | null
  ts?: string | null
  source?: string | null
  error?: string
}

export interface TickerRow {
  ticker: string
  company?: string | null
  compare_price?: PriceQuote | null
  latest: Partial<Record<Source, VersionSummary | null>>
  versions_count: number
  active_runs: number
}

export interface SummaryResponse {
  tickers: TickerRow[]
}

export interface TickerResponse {
  ticker: string
  company?: string | null
  compare_price?: PriceQuote | null
  versions: VersionSummary[]
}

// ---------------------------------------------------------------- dcf.json

export type DcfInput = DeepPartial<Omit<InputStrict, 'value' | 'options'>> & {
  value?: unknown
  options?: unknown[] | null
}
export type DcfAssumption = DeepPartial<Omit<AssumptionStrict, 'value'>> & { value?: unknown }
export type DcfChangeEntry = DeepPartial<Omit<ChangeEntryStrict, 'old' | 'new'>> & { old?: unknown; new?: unknown }
export type DcfProvenance = DeepPartial<Omit<ProvenanceStrict, 'changelog' | 'overrides_applied'>> & {
  changelog?: DcfChangeEntry[]
  overrides_applied?: Record<string, unknown>
}

export type Dcf = DeepPartial<
  Omit<DCFStrict, 'inputs' | 'assumptions' | 'derived' | 'provenance' | 'extra'>
> & {
  provenance?: DcfProvenance
  inputs?: DcfInput[]
  assumptions?: DcfAssumption[]
  derived?: Derived | null
  extra?: Record<string, unknown>
}

export type DcfScenario = NonNullable<Dcf['scenarios']>[number]
export type DcfComponent = NonNullable<DcfScenario['components']>[number]
export type DcfRow = NonNullable<DcfComponent['rows']>[number]
export type DcfTerminal = NonNullable<DcfComponent['terminal']>
export type DcfBridgeItem = NonNullable<Dcf['bridge']>[number]
export type DcfGrid = NonNullable<Dcf['grids']>[number]
export type DcfCheck = NonNullable<Dcf['checks']>[number]
export type DcfSource = NonNullable<Dcf['sources']>[number]
export type DcfGuidance = NonNullable<Dcf['guidance']>[number]
export type DcfReverse = NonNullable<Dcf['reverse_dcf']>[number]
export type DcfDriverDef = NonNullable<Dcf['drivers']>[number]
export type DcfAltValuation = NonNullable<Dcf['alt_valuations']>[number]

// ---------------------------------------------------------------- versions / runs

export interface ValidationItem {
  level: 'fail' | 'warn' | 'pass' | string
  id: string
  message?: string
}

export interface ReproScenario {
  residual?: number | null
  engine_ev?: number | null
  stated_ev?: number | null
  engine_equity?: number | null
  stated_equity?: number | null
  engine_vps?: number | null
  stated_vps?: number | null
}

export interface Validation {
  mode?: string
  ok?: boolean
  summary?: { fail?: number; warn?: number; pass?: number }
  reproduction?: {
    grade?: Reproducibility | null
    residual?: number | null
    scenarios?: Record<string, ReproScenario>
  } | null
  items?: ValidationItem[]
}

export interface RunAttempt {
  attempt?: number
  resume?: string | null
  started_at?: string | null
  exit_code?: number | null
  usage?: Usage
  session_id?: string | null
  duration_s?: number
  error?: string
  fatal?: string
}

export interface RunMeta {
  id?: string
  ticker?: string
  source?: Source
  origin?: Origin
  kind?: string | null
  status?: VersionStatus | string
  created_at?: string | null
  started_at?: string | null
  finished_at?: string | null
  cli?: string | null
  model?: string | null
  effort?: string | null
  pid?: number | null
  parent_version?: string | null
  instructions?: string | null
  exit_code?: number | null
  error?: string | null
  usage?: Usage | null
  attempts?: RunAttempt[]
  legacy?: { legacy_id?: string; files?: string[]; source?: string; generation?: string; crosscheck?: Crosscheck | null } | null
  session_id?: string | null
}

export interface VersionResponse {
  summary: VersionSummary | null
  dcf: Dcf | null
  run: RunMeta | null
  validation: Validation | null
}

export interface RunResponse {
  run: RunMeta | null
  validation: Validation | null
  summary: VersionSummary | null
}

export interface FileEntry {
  path: string
  size: number
}

export type RunEventKind = 'status' | 'system' | 'text' | 'thinking' | 'tool' | 'tool_result' | 'result' | 'error'

export interface RunEvent {
  seq: number
  ts?: string
  attempt?: number
  kind: RunEventKind | string
  text?: string
  tool?: string | null
  ok?: boolean | null
}

export interface RunRequest {
  ticker: string
  sources: Source[]
  mode: 'new' | 'update'
  parent_versions?: Partial<Record<Source, string>>
  instructions?: string
  models?: Partial<Record<Source, string>>
  efforts?: Partial<Record<Source, string>>
}

export interface RunStarted {
  version_id: string
  source: Source
  mode: 'new' | 'update'
  parent_version?: string | null
}

// ---------------------------------------------------------------- what-if

export type Knobs = {
  wacc?: number
  wacc_shift?: number
  g?: number
  g_shift?: number
  exit_multiple?: number
  bridge?: Record<string, boolean>
  shares_mult?: number
  rev_growth_shift?: number
  ebit_margin_shift?: number
  capex_intensity_mult?: number
  tax_rate?: number
}

export interface WhatIfRequest {
  knobs?: Knobs
  overrides?: Record<string, unknown>
  scenario_ids?: string[]
}

export interface WhatIfResponse {
  dcf: Dcf
  derived: Derived
  layers: string[]
  grade?: string | null
  anchored?: boolean
  warnings?: string[]
}

export interface SavedWhatIf {
  name: string
  slug: string
  knobs?: Knobs
  overrides?: Record<string, unknown>
  note?: string | null
  created_at?: string
  derived?: Derived | null
  layers?: string[]
}

// ---------------------------------------------------------------- config / imports

/** One model a CLI can use (server/models_catalog.py), newest / most capable first. */
export interface ModelOption {
  id: string
  label?: string | null
  kind?: 'alias' | 'model' | string
  resolved?: string | null
  efforts?: string[] | null
  default_effort?: string | null
  note?: string | null
}

export interface BackendInfo {
  label?: string
  binary?: string
  available?: boolean
  version?: string | null
  models?: string[]
  /** live catalog (newer servers); `models` is just the ids */
  model_options?: ModelOption[] | null
  /** union of all models' efforts */
  efforts?: string[]
  /** resolved default model id */
  default_model?: string | null
  /** configured value, e.g. "latest" */
  default_model_setting?: string | null
  latest?: string | null
  cli_default?: string | null
  default_effort?: string | null
  catalog?: { fetched_at?: string | null; source?: string | null; error?: string | null } | null
  paused?: string | null
}

export interface ConfigResponse {
  backends: Partial<Record<Source, BackendInfo>>
  runs?: Record<string, unknown>
  imports?: Record<string, unknown>
  overlay_knobs?: Record<string, string>
}

export interface Crosscheck {
  legacy_vps?: number | null
  imported_vps?: number | null
  match?: boolean | null
  [k: string]: unknown
}

export interface ImportItem {
  legacy_id: string
  source: Source | string
  ticker: string
  files?: string[]
  generation?: string | null
  quality?: 'verified' | 'unverified' | string | null
  superseded_by?: string | null
  main?: string | null
  notes?: string | null
  status: string
  version_id?: string | null
  crosscheck?: Crosscheck | null
  validation?: ValidationSummary | null
  reproducibility?: Reproducibility | null
}

export interface ImportsResponse {
  items: ImportItem[]
  summary: Record<string, number>
}

export interface ImportLaunchResponse {
  launched: { legacy_id: string; version_id?: string; result?: string; error?: string }[]
}
