/* Generated from dcfkit/dcf.schema.json by json-schema-to-typescript. Do not edit; run npm run gen:types. */

export type SchemaVersion = "1.0";
export type DcfkitVersion = string | null;
export type Ticker = string;
export type Company = string;
export type Cik = string | null;
export type VersionId = string | null;
export type ParentVersion = string | null;
export type Producer = "claude" | "codex" | "grok" | "agy" | "import" | "app_edit";
export type Cli = string | null;
export type Model = string | null;
export type RunId = string | null;
export type CreatedAt = string | null;
/**
 * legacy source path(s), relative to DCF_models/
 */
export type Path = string;
export type Source = "claude" | "codex" | "grok" | "agy" | "other";
/**
 * e.g. claude_g1, claude_g2, claude_wm, claude_g3, claude_sotp, claude_rnpv, claude_xlsx, grok_xlsx, codex_json, codex_xlsx
 */
export type Generation = string;
export type Fidelity = "full" | "rows" | "headline";
export type SourceScale = "units" | "thousands" | "millions" | "billions";
export type ConventionDetected = {
  [k: string]: unknown;
} | null;
export type Quality = "verified" | "unverified";
export type LegacyCreated = string | null;
export type Notes = string | null;
export type Summary = string;
export type Detail = string | null;
export type Paths = string[];
export type Changelog = ChangeEntry[];
export type ValidationMode = "native" | "imported";
/**
 * date the model's data is current to (latest filing/price date)
 */
export type AsOf = string;
/**
 * date cash flows are discounted to
 */
export type ValuationDate = string;
/**
 * e.g. 'Q2 FY2026 ended 2026-06-30'
 */
export type LatestPeriod = string;
export type ReportingCurrency = string;
/**
 * MM-DD
 */
export type FiscalYearEnd = string;
export type MarginBasis = "gaap" | "adjusted" | "mixed" | "unknown";
export type SbcTreatment = "in_ebit" | "deducted" | "dilution_only" | "ignored" | "unknown";
export type Symbol = string;
export type Exchange = string | null;
export type QuoteCurrency = string;
export type ListedUnit = "common" | "ADS" | "ADR" | "GDR" | "class" | "private";
/**
 * ordinary shares per listed unit (TSM ADR 5, SIMO ADS 4, WRD ADS 3, SNY ADS 0.5)
 */
export type OrdinaryPerListedUnit = number;
export type Name = string;
export type Shares = number;
export type CommonEquiv = number;
export type ShareClasses = ShareClass[];
/**
 * price per LISTED unit in quote currency
 */
export type Price = number;
/**
 * ISO timestamp/date of the quote
 */
export type PriceTs = string;
export type PriceSource = string;
export type Session = ("close" | "intraday" | "pre" | "post") | null;
/**
 * reporting -> quote currency, at price_ts
 */
export type FxSpot = number;
export type FxTs = string | null;
export type FxProjection = number | null;
/**
 * ordinary, millions
 */
export type SharesBasic = number | null;
/**
 * ordinary, millions
 */
export type SharesDiluted = number;
/**
 * quote currency, millions
 */
export type MarketCap = number | null;
export type LocalPrice = number | null;
export type Kind =
  | "capital_intensive"
  | "asset_light"
  | "airline"
  | "manufacturer"
  | "ad_platform"
  | "utility"
  | "sotp"
  | "pre_revenue"
  | "biotech_pipeline"
  | "financial"
  | "semiconductor"
  | "consumer"
  | "software"
  | "other";
/**
 * one line: the revenue/value identity, e.g. 'ASMs x (TRASM - CASM)'
 */
export type Engine = string;
export type Key = string | null;
export type Label = string;
export type Unit = string | null;
export type BaseValue = number | null;
export type MarketImplied = number | null;
export type Label1 = string;
export type Value = number | null;
export type SourceId = string | null;
export type Expr = string;
export type Period = string | null;
export type Model1 = number | null;
export type Reported = number | null;
export type Passed = boolean | null;
export type Key1 = string;
export type Label2 = string;
export type Unit1 = string;
export type Kind1 = ("volume" | "price" | "ratio" | "margin" | "capital" | "segment" | "other") | null;
export type Drivers = DriverDef[];
export type Id = string;
export type Label3 = string;
export type Kind2 =
  | "cash"
  | "investments"
  | "debt"
  | "op_lease"
  | "fin_lease"
  | "restricted_cash"
  | "decom_trust"
  | "pension"
  | "nci"
  | "preferred"
  | "customer_fin_debt"
  | "deferred_revenue"
  | "options_claim"
  | "investment_stake"
  | "settlement"
  | "tax_asset"
  | "other";
/**
 * signed, reporting ccy millions: cash +, debt -
 */
export type EquityEffect = number;
export type Included = boolean;
export type Debatable = boolean;
export type Rationale = string | null;
export type SourceId1 = string | null;
export type Bridge = BridgeItem[];
/**
 * label, e.g. 'FY2026' or '2026'
 */
export type Period1 = string;
export type PeriodEnd = string;
export type IsActual = boolean;
export type Revenue = number | null;
export type Ebitda = number | null;
export type Ebit = number | null;
export type Taxes = number | null;
export type Nopat = number | null;
export type Da = number | null;
export type Capex = number | null;
export type DeltaNwc = number | null;
export type OtherAdj = number;
export type Fcff = number;
export type Rows = Row[];
export type Date = string;
export type Shares1 = number;
export type Kind3 = string | null;
export type SourceId2 = string | null;
export type ShareCountSeries = SharePoint[];
export type Id1 = string;
export type Role = "bear" | "base" | "bull" | "other";
export type Label4 = string;
export type Probability = number | null;
export type Narrative = string | null;
export type Year1Locked = boolean;
export type Wacc = number;
export type Convention = "end" | "mid";
/**
 * share of period 1 still ahead of the valuation date
 */
export type StubFraction = number;
/**
 * explicit remaining period-1 FCFF (seasonal names)
 */
export type StubFcff = number | null;
export type TvTiming = "end_last" | "mid_last";
export type RiskFree = number | null;
export type Beta = number | null;
export type Erp = number | null;
export type CountryRisk = number | null;
export type SizePremium = number | null;
export type CostOfEquity = number | null;
export type PreTaxCostOfDebt = number | null;
export type TaxRate = number | null;
export type WeightEquity = number | null;
export type WeightDebt = number | null;
export type Note = string | null;
export type Rate = number;
export type Guard = boolean;
export type Mode = "rate_on_ebit" | "as_given";
export type NolOpening = number | null;
export type Id2 = string;
export type Label5 = string;
export type Kind4 = "dcf" | "rnpv" | "fixed";
export type Level = "enterprise" | "equity";
/**
 * rNPV probability of success
 */
export type Probability1 = number | null;
export type Wacc1 = number | null;
export type Convention1 = ("end" | "mid") | null;
export type StubFraction1 = number | null;
export type StubFcff1 = number | null;
export type TvTiming1 = ("end_last" | "mid_last") | null;
export type Rows1 = Row[];
export type Method = "normalized_gordon" | "gordon" | "exit_multiple" | "finite_annuity" | "none";
export type G = number | null;
export type NopatNext = number | null;
export type DaNext = number | null;
export type CapexNext = number | null;
export type DnwcNext = number | null;
/**
 * stored N+1 numerator; makes reproduction exact
 */
export type FcfNext = number | null;
export type NwcPctOfRevenue = number | null;
export type Multiple = number | null;
export type MultipleMetric = ("ebitda" | "ebit" | "revenue" | "fcff" | "nopat") | null;
export type MetricPeriod = "last" | "next";
export type FiniteYears = number | null;
export type FloorAtZero = boolean;
export type Note1 = string | null;
export type FixedValue = number | null;
export type Note2 = string | null;
export type PvExplicit = number | null;
export type Tv = number | null;
export type PvTv = number | null;
export type Value1 = number | null;
export type Components = Component[];
export type ConsolidatedRows = Row[];
/**
 * ordinary shares (millions) dividing equity value
 */
export type Used = number;
export type Method1 = "current_diluted" | "current_basic" | "path_mid" | "path_end" | "burn_funded" | "other";
export type PeriodEnd1 = string;
export type Value2 = number;
export type Path1 = PeriodValue[];
export type IssuancePrice = number | null;
export type IssueDiscount = number;
export type NewShares = number | null;
/**
 * cash raised by assumed issuance, added to equity
 */
export type Proceeds = number;
export type ProceedsInBridge = boolean | null;
export type PriceSensitive = boolean;
export type Label6 = string;
export type Shares2 = number | null;
export type PerShareImpactIfVested = number | null;
export type Note3 = string | null;
export type ExcludedInstruments = ExcludedInstrument[];
export type Note4 = string | null;
export type Ev = number | null;
export type Equity = number | null;
export type ValuePerShare = number;
export type ValuePerShareRaw = number | null;
export type ValuePerOrdinary = number | null;
export type TvShareOfEv = number | null;
export type Upside = number | null;
export type SharesUsed = number | null;
export type Floored = boolean | null;
export type Scenarios = Scenario[];
export type Method2 = "base_dcf" | "prob_weighted" | "sotp" | "rnpv_sum" | "floor";
export type Rationale1 = string;
export type ValuePerShare1 = number | null;
export type ProbabilityWeighted = number | null;
export type Id3 = string;
export type Label7 = string;
export type Method3 =
  | "net_cash_floor"
  | "exit_multiple"
  | "pe_multiple"
  | "ev_sales"
  | "mature_state"
  | "liquidation"
  | "peer"
  | "analyst_target"
  | "other";
export type ScenarioId = string | null;
export type ValuePerShare2 = number | null;
export type Note5 = string | null;
export type AltValuations = AltValuation[];
/**
 * passed verbatim to model.build(overrides)
 */
export type Key2 = string;
export type Label8 = string;
export type Unit2 = string;
export type Type = "float" | "int" | "bool" | "enum";
export type Min = number | null;
export type Max = number | null;
export type Step = number | null;
export type Options = unknown[] | null;
/**
 * scenario ids or ['all']
 */
export type Scope = string[];
export type Group = string;
export type Decisive1 = boolean;
export type ExpectedSign = "+" | "-" | "?";
export type Description = string | null;
export type AssumptionId = string | null;
export type Inputs1 = Input[];
export type Id4 = string;
export type Label9 = string;
export type Unit3 = string;
export type ScenarioId1 = string | null;
export type Status = "measured" | "derived" | "guided" | "assumed";
export type Method4 = string | null;
export type SourceId3 = string | null;
export type Assumptions = Assumption[];
export type Metric = string;
export type Basis1 = "gaap" | "adjusted" | "unknown";
export type Period2 = string;
export type Low = number | null;
export type High = number | null;
export type Unit4 = string;
export type YtdActual = number | null;
export type SourceId4 = string | null;
export type Guidance = GuidanceItem[];
export type Variable = string;
export type Unit5 = string;
export type Solved = number | null;
export type Reachable = boolean;
export type TargetPrice = number | null;
export type HeldFixed = string | null;
export type CostsScaleWithDriver = boolean | null;
export type Commentary = string | null;
export type ReverseDcf = ReverseDCF[];
export type Id5 = string;
export type Label10 = string | null;
export type ScenarioId2 = string | null;
export type Key3 = string;
export type Label11 = string;
export type Values = number[];
export type Output = "value_ps" | "ev" | "upside" | "other";
/**
 * z[i][j] for y.values[i], x.values[j]
 */
export type Z = (number | null)[][];
export type Grids = Grid[];
export type Id6 = string;
export type Label12 = string | null;
export type Status1 = "pass" | "fail" | "warn" | "na";
export type Detail1 = string;
export type Diagnosis = string | null;
export type ProducedBy = "agent" | "validator" | "app" | "legacy";
export type Checks = Check[];
/**
 * one sentence: the number and the gap
 */
export type Headline1 = string;
export type DecisiveVariable = string;
export type Thesis = string;
export type BearCase = string;
export type BullCase = string;
export type OpposingCase = string;
export type Metric1 = string;
export type Threshold = string | null;
export type Direction = string | null;
export type ChangeMyMind = Trigger[];
export type MarketImplied1 = string;
export type MeasuredVsAssumed = string;
export type ErrorsCorrected = string[];
export type KeyRisks = string[];
export type Id7 = string;
/**
 * 10-K, 10-Q, 8-K, 20-F, 6-K, companyfacts, price, transcript, other
 */
export type Kind5 = string;
export type Description1 = string | null;
export type Accession = string | null;
export type Exhibit = string | null;
export type Url = string | null;
export type Filed = string | null;
export type FetchedAt = string | null;
export type Sources = Source1[];
export type EngineOverrideReason = string | null;
/**
 * APP-WRITTEN canonical metrics; ignored on input
 */
export type Derived = {
  [k: string]: unknown;
} | null;

export interface DCF {
  provenance: Provenance;
  basis: Basis;
  listing: Listing;
  market: Market;
  archetype: Archetype;
  drivers?: Drivers;
  bridge?: Bridge;
  historicals?: Historicals;
  scenarios: Scenarios;
  headline?: Headline;
  alt_valuations?: AltValuations;
  inputs?: Inputs1;
  assumptions?: Assumptions;
  guidance?: Guidance;
  reverse_dcf?: ReverseDcf;
  grids?: Grids;
  checks?: Checks;
  narrative: Narrative1;
  sources?: Sources;
  engine_override_reason?: EngineOverrideReason;
  derived?: Derived;
  extra?: Extra3;
}
export interface Provenance {
  schema_version?: SchemaVersion;
  dcfkit_version?: DcfkitVersion;
  ticker: Ticker;
  company: Company;
  cik?: Cik;
  version_id?: VersionId;
  parent_version?: ParentVersion;
  producer?: Producer;
  cli?: Cli;
  model?: Model;
  run_id?: RunId;
  created_at?: CreatedAt;
  imported_from?: ImportInfo | null;
  overrides_applied?: OverridesApplied;
  changelog?: Changelog;
  validation_mode?: ValidationMode;
}
export interface ImportInfo {
  path: Path;
  source: Source;
  generation: Generation;
  fidelity?: Fidelity;
  source_scale?: SourceScale;
  convention_detected?: ConventionDetected;
  quality?: Quality;
  legacy_created?: LegacyCreated;
  notes?: Notes;
}
export interface OverridesApplied {
  [k: string]: unknown;
}
export interface ChangeEntry {
  summary: Summary;
  detail?: Detail;
  paths?: Paths;
  old?: Old;
  new?: New;
}
export interface Old {
  [k: string]: unknown;
}
export interface New {
  [k: string]: unknown;
}
export interface Basis {
  as_of: AsOf;
  valuation_date: ValuationDate;
  latest_period: LatestPeriod;
  reporting_currency?: ReportingCurrency;
  fiscal_year_end?: FiscalYearEnd;
  margin_basis?: MarginBasis;
  sbc_treatment?: SbcTreatment;
  extra?: Extra;
}
export interface Extra {
  [k: string]: unknown;
}
export interface Listing {
  symbol: Symbol;
  exchange?: Exchange;
  quote_currency?: QuoteCurrency;
  listed_unit?: ListedUnit;
  ordinary_per_listed_unit?: OrdinaryPerListedUnit;
  share_classes?: ShareClasses;
}
export interface ShareClass {
  name: Name;
  shares: Shares;
  common_equiv?: CommonEquiv;
}
export interface Market {
  price: Price;
  price_ts: PriceTs;
  price_source?: PriceSource;
  session?: Session;
  fx_spot?: FxSpot;
  fx_ts?: FxTs;
  fx_projection?: FxProjection;
  shares_basic?: SharesBasic;
  shares_diluted: SharesDiluted;
  market_cap?: MarketCap;
  local_price?: LocalPrice;
  extra?: Extra1;
}
export interface Extra1 {
  [k: string]: unknown;
}
export interface Archetype {
  kind: Kind;
  engine: Engine;
  decisive: Decisive;
  identity_check?: IdentityCheck | null;
}
export interface Decisive {
  key?: Key;
  label: Label;
  unit?: Unit;
  base_value?: BaseValue;
  market_implied?: MarketImplied;
  anchor?: Anchor | null;
}
export interface Anchor {
  label: Label1;
  value?: Value;
  source_id?: SourceId;
}
export interface IdentityCheck {
  expr: Expr;
  period?: Period;
  model?: Model1;
  reported?: Reported;
  passed?: Passed;
}
export interface DriverDef {
  key: Key1;
  label: Label2;
  unit?: Unit1;
  kind?: Kind1;
}
export interface BridgeItem {
  id: Id;
  label: Label3;
  kind: Kind2;
  equity_effect: EquityEffect;
  included?: Included;
  debatable?: Debatable;
  rationale?: Rationale;
  source_id?: SourceId1;
}
export interface Historicals {
  rows?: Rows;
  share_count_series?: ShareCountSeries;
  extra?: Extra2;
}
export interface Row {
  period: Period1;
  period_end: PeriodEnd;
  is_actual?: IsActual;
  revenue?: Revenue;
  ebitda?: Ebitda;
  ebit?: Ebit;
  taxes?: Taxes;
  nopat?: Nopat;
  da?: Da;
  capex?: Capex;
  delta_nwc?: DeltaNwc;
  other_adj?: OtherAdj;
  fcff: Fcff;
  drivers?: Drivers1;
}
export interface Drivers1 {
  [k: string]: number | null;
}
export interface SharePoint {
  date: Date;
  shares: Shares1;
  kind?: Kind3;
  source_id?: SourceId2;
}
export interface Extra2 {
  [k: string]: unknown;
}
export interface Scenario {
  id: Id1;
  role: Role;
  label: Label4;
  probability?: Probability;
  narrative?: Narrative;
  year1_locked?: Year1Locked;
  discounting: Discounting;
  tax?: TaxRule | null;
  components?: Components;
  consolidated_rows?: ConsolidatedRows;
  shares: ShareSpec;
  bridge_overrides?: BridgeOverrides;
  results: ScenarioResult;
}
export interface Discounting {
  wacc: Wacc;
  convention?: Convention;
  stub_fraction?: StubFraction;
  stub_fcff?: StubFcff;
  tv_timing?: TvTiming;
  wacc_build?: WaccBuild | null;
}
export interface WaccBuild {
  risk_free?: RiskFree;
  beta?: Beta;
  erp?: Erp;
  country_risk?: CountryRisk;
  size_premium?: SizePremium;
  cost_of_equity?: CostOfEquity;
  pre_tax_cost_of_debt?: PreTaxCostOfDebt;
  tax_rate?: TaxRate;
  weight_equity?: WeightEquity;
  weight_debt?: WeightDebt;
  note?: Note;
}
export interface TaxRule {
  rate: Rate;
  guard?: Guard;
  mode?: Mode;
  nol_opening?: NolOpening;
}
export interface Component {
  id: Id2;
  label: Label5;
  kind?: Kind4;
  level?: Level;
  probability?: Probability1;
  discounting?: ComponentDiscounting | null;
  rows?: Rows1;
  terminal?: Terminal | null;
  fixed_value?: FixedValue;
  note?: Note2;
  results?: ComponentResult | null;
}
export interface ComponentDiscounting {
  wacc?: Wacc1;
  convention?: Convention1;
  stub_fraction?: StubFraction1;
  stub_fcff?: StubFcff1;
  tv_timing?: TvTiming1;
  wacc_build?: WaccBuild | null;
}
export interface Terminal {
  method: Method;
  g?: G;
  nopat_next?: NopatNext;
  da_next?: DaNext;
  capex_next?: CapexNext;
  dnwc_next?: DnwcNext;
  fcf_next?: FcfNext;
  nwc_pct_of_revenue?: NwcPctOfRevenue;
  multiple?: Multiple;
  multiple_metric?: MultipleMetric;
  metric_period?: MetricPeriod;
  finite_years?: FiniteYears;
  floor_at_zero?: FloorAtZero;
  note?: Note1;
}
export interface ComponentResult {
  pv_explicit?: PvExplicit;
  tv?: Tv;
  pv_tv?: PvTv;
  value?: Value1;
  [k: string]: unknown;
}
export interface ShareSpec {
  used: Used;
  method?: Method1;
  path?: Path1;
  issuance_price?: IssuancePrice;
  issue_discount?: IssueDiscount;
  new_shares?: NewShares;
  proceeds?: Proceeds;
  proceeds_in_bridge?: ProceedsInBridge;
  price_sensitive?: PriceSensitive;
  excluded_instruments?: ExcludedInstruments;
  note?: Note4;
}
export interface PeriodValue {
  period_end: PeriodEnd1;
  value: Value2;
}
export interface ExcludedInstrument {
  label: Label6;
  shares?: Shares2;
  per_share_impact_if_vested?: PerShareImpactIfVested;
  note?: Note3;
}
export interface BridgeOverrides {
  [k: string]: boolean;
}
export interface ScenarioResult {
  ev?: Ev;
  equity?: Equity;
  value_per_share: ValuePerShare;
  value_per_share_raw?: ValuePerShareRaw;
  value_per_ordinary?: ValuePerOrdinary;
  tv_share_of_ev?: TvShareOfEv;
  upside?: Upside;
  shares_used?: SharesUsed;
  floored?: Floored;
  [k: string]: unknown;
}
export interface Headline {
  method?: Method2;
  rationale?: Rationale1;
  value_per_share?: ValuePerShare1;
  probability_weighted?: ProbabilityWeighted;
}
export interface AltValuation {
  id: Id3;
  label: Label7;
  method: Method3;
  scenario_id?: ScenarioId;
  value_per_share?: ValuePerShare2;
  inputs?: Inputs;
  note?: Note5;
}
export interface Inputs {
  [k: string]: unknown;
}
export interface Input {
  key: Key2;
  label: Label8;
  unit?: Unit2;
  type?: Type;
  value: Value3;
  min?: Min;
  max?: Max;
  step?: Step;
  options?: Options;
  scope?: Scope;
  group?: Group;
  decisive?: Decisive1;
  expected_sign?: ExpectedSign;
  description?: Description;
  assumption_id?: AssumptionId;
}
export interface Value3 {
  [k: string]: unknown;
}
export interface Assumption {
  id: Id4;
  label: Label9;
  value: Value4;
  unit?: Unit3;
  scenario_id?: ScenarioId1;
  status?: Status;
  method?: Method4;
  source_id?: SourceId3;
}
export interface Value4 {
  [k: string]: unknown;
}
export interface GuidanceItem {
  metric: Metric;
  basis?: Basis1;
  period: Period2;
  low?: Low;
  high?: High;
  unit?: Unit4;
  ytd_actual?: YtdActual;
  model?: Model2;
  inside?: Inside;
  source_id?: SourceId4;
}
export interface Model2 {
  [k: string]: number;
}
export interface Inside {
  [k: string]: boolean;
}
export interface ReverseDCF {
  variable: Variable;
  unit?: Unit5;
  solved?: Solved;
  reachable?: Reachable;
  target_price?: TargetPrice;
  held_fixed?: HeldFixed;
  costs_scale_with_driver?: CostsScaleWithDriver;
  anchor?: Anchor | null;
  commentary?: Commentary;
}
export interface Grid {
  id: Id5;
  label?: Label10;
  scenario_id?: ScenarioId2;
  x: Axis;
  y: Axis;
  output?: Output;
  z: Z;
}
export interface Axis {
  key: Key3;
  label: Label11;
  values: Values;
}
export interface Check {
  id: Id6;
  label?: Label12;
  status: Status1;
  detail?: Detail1;
  diagnosis?: Diagnosis;
  produced_by?: ProducedBy;
}
export interface Narrative1 {
  headline: Headline1;
  decisive_variable?: DecisiveVariable;
  thesis?: Thesis;
  bear_case?: BearCase;
  bull_case?: BullCase;
  opposing_case?: OpposingCase;
  change_my_mind?: ChangeMyMind;
  market_implied?: MarketImplied1;
  measured_vs_assumed?: MeasuredVsAssumed;
  errors_corrected?: ErrorsCorrected;
  key_risks?: KeyRisks;
}
export interface Trigger {
  metric: Metric1;
  threshold?: Threshold;
  direction?: Direction;
}
export interface Source1 {
  id: Id7;
  kind: Kind5;
  description?: Description1;
  accession?: Accession;
  exhibit?: Exhibit;
  url?: Url;
  filed?: Filed;
  fetched_at?: FetchedAt;
}
export interface Extra3 {
  [k: string]: unknown;
}
