"""dcfkit.schema -- the unified DCF JSON contract (pydantic v2).

This is the single source of truth for the dcf.json format. The JSON Schema
(dcfkit/dcf.schema.json) and the frontend TypeScript types are generated from
it: `python3 -m dcfkit.schema > dcfkit/dcf.schema.json`.

Conventions (see engine.py docstring): reporting-currency MILLIONS for flows,
ordinary-share MILLIONS for share counts, capex/da/taxes >= 0, delta_nwc > 0 is
cash out, bridge equity_effect signed (cash +, debt -), per-share values per
LISTED unit in QUOTE currency.

Unknown keys are rejected (typo protection). Put anything extra in the
`extra` dict that most objects carry.
"""
from __future__ import annotations

import json
from datetime import date
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

SCHEMA_VERSION = "1.0"

Ccy = str  # ISO 4217, validated below


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


def _ccy(v):
    if v is not None and (len(v) != 3 or not v.isalpha() or not v.isupper()):
        raise ValueError(f"currency must be an ISO 4217 code like 'USD', got {v!r}")
    return v


# --------------------------------------------------------------------------
# provenance (APP-OWNED for native runs: the app fills/overwrites it)
# --------------------------------------------------------------------------

class ChangeEntry(_Strict):
    summary: str
    detail: Optional[str] = None
    paths: list[str] = []
    old: Any = None
    new: Any = None


class ImportInfo(_Strict):
    path: str = Field(description="legacy source path(s), relative to DCF_models/")
    source: Literal["claude", "codex", "grok", "agy", "other"]
    generation: str = Field(description="e.g. claude_g1, claude_g2, claude_wm, claude_g3, claude_sotp, "
                                        "claude_rnpv, claude_xlsx, grok_xlsx, codex_json, codex_xlsx")
    fidelity: Literal["full", "rows", "headline"] = "rows"
    source_scale: Literal["units", "thousands", "millions", "billions"] = "millions"
    convention_detected: Optional[dict] = None
    quality: Literal["verified", "unverified"] = "verified"
    legacy_created: Optional[str] = None
    notes: Optional[str] = None


class Provenance(_Strict):
    schema_version: Literal["1.0"] = "1.0"
    dcfkit_version: Optional[str] = None
    ticker: str
    company: str
    cik: Optional[str] = None
    version_id: Optional[str] = None
    parent_version: Optional[str] = None
    producer: Literal["claude", "codex", "grok", "agy", "import", "app_edit"] = "claude"
    cli: Optional[str] = None
    model: Optional[str] = None
    run_id: Optional[str] = None
    created_at: Optional[str] = None
    imported_from: Optional[ImportInfo] = None
    overrides_applied: dict[str, Any] = {}
    changelog: list[ChangeEntry] = []
    validation_mode: Literal["native", "imported"] = "native"


# --------------------------------------------------------------------------
# basis, listing, market
# --------------------------------------------------------------------------

class Basis(_Strict):
    as_of: date = Field(description="date the model's data is current to (latest filing/price date)")
    valuation_date: date = Field(description="date cash flows are discounted to")
    latest_period: str = Field(description="e.g. 'Q2 FY2026 ended 2026-06-30'")
    reporting_currency: Ccy = "USD"
    fiscal_year_end: str = Field("12-31", pattern=r"^\d{2}-\d{2}$", description="MM-DD")
    margin_basis: Literal["gaap", "adjusted", "mixed", "unknown"] = "gaap"
    sbc_treatment: Literal["in_ebit", "deducted", "dilution_only", "ignored", "unknown"] = "in_ebit"
    extra: dict[str, Any] = {}

    _c = field_validator("reporting_currency")(lambda cls, v: _ccy(v))


class ShareClass(_Strict):
    name: str
    shares: float
    common_equiv: float = 1.0


class Listing(_Strict):
    symbol: str
    exchange: Optional[str] = None
    quote_currency: Ccy = "USD"
    listed_unit: Literal["common", "ADS", "ADR", "GDR", "class", "private"] = "common"
    ordinary_per_listed_unit: float = Field(1.0, gt=0, description="ordinary shares per listed unit "
                                            "(TSM ADR 5, SIMO ADS 4, WRD ADS 3, SNY ADS 0.5)")
    share_classes: list[ShareClass] = []

    _c = field_validator("quote_currency")(lambda cls, v: _ccy(v))


class Market(_Strict):
    price: float = Field(gt=0, description="price per LISTED unit in quote currency")
    price_ts: str = Field(description="ISO timestamp/date of the quote")
    price_source: str = "unknown"
    session: Optional[Literal["close", "intraday", "pre", "post"]] = None
    fx_spot: float = Field(1.0, gt=0, description="reporting -> quote currency, at price_ts")
    fx_ts: Optional[str] = None
    fx_projection: Optional[float] = None
    shares_basic: Optional[float] = Field(None, description="ordinary, millions")
    shares_diluted: float = Field(gt=0, description="ordinary, millions")
    market_cap: Optional[float] = Field(None, description="quote currency, millions")
    local_price: Optional[float] = None
    extra: dict[str, Any] = {}


# --------------------------------------------------------------------------
# archetype, drivers, bridge
# --------------------------------------------------------------------------

class Anchor(_Strict):
    label: str
    value: Optional[float] = None
    source_id: Optional[str] = None


class Decisive(_Strict):
    key: Optional[str] = None
    label: str
    unit: Optional[str] = None
    base_value: Optional[float] = None
    market_implied: Optional[float] = None
    anchor: Optional[Anchor] = None


class IdentityCheck(_Strict):
    expr: str
    period: Optional[str] = None
    model: Optional[float] = None
    reported: Optional[float] = None
    passed: Optional[bool] = None


ArchetypeKind = Literal["capital_intensive", "asset_light", "airline", "manufacturer", "ad_platform",
                        "utility", "sotp", "pre_revenue", "biotech_pipeline", "financial",
                        "semiconductor", "consumer", "software", "other"]


class Archetype(_Strict):
    kind: ArchetypeKind
    engine: str = Field(description="one line: the revenue/value identity, e.g. 'ASMs x (TRASM - CASM)'")
    decisive: Decisive
    identity_check: Optional[IdentityCheck] = None


class DriverDef(_Strict):
    key: str
    label: str
    unit: str = ""
    kind: Optional[Literal["volume", "price", "ratio", "margin", "capital", "segment", "other"]] = None


BridgeKind = Literal["cash", "investments", "debt", "op_lease", "fin_lease", "restricted_cash", "decom_trust",
                     "pension", "nci", "preferred", "customer_fin_debt", "deferred_revenue", "options_claim",
                     "investment_stake", "settlement", "tax_asset", "other"]


class BridgeItem(_Strict):
    id: str
    label: str
    kind: BridgeKind
    equity_effect: float = Field(description="signed, reporting ccy millions: cash +, debt -")
    included: bool = True
    debatable: bool = False
    rationale: Optional[str] = None
    source_id: Optional[str] = None


# --------------------------------------------------------------------------
# rows, terminal, components, scenarios
# --------------------------------------------------------------------------

class Row(_Strict):
    period: str = Field(description="label, e.g. 'FY2026' or '2026'")
    period_end: date
    is_actual: bool = False
    revenue: Optional[float] = None
    ebitda: Optional[float] = None
    ebit: Optional[float] = None
    taxes: Optional[float] = None
    nopat: Optional[float] = None
    da: Optional[float] = None
    capex: Optional[float] = None
    delta_nwc: Optional[float] = None
    other_adj: float = 0.0
    fcff: float
    drivers: dict[str, Optional[float]] = {}


class WaccBuild(_Strict):
    risk_free: Optional[float] = None
    beta: Optional[float] = None
    erp: Optional[float] = None
    country_risk: Optional[float] = None
    size_premium: Optional[float] = None
    cost_of_equity: Optional[float] = None
    pre_tax_cost_of_debt: Optional[float] = None
    tax_rate: Optional[float] = None
    weight_equity: Optional[float] = None
    weight_debt: Optional[float] = None
    note: Optional[str] = None


class Discounting(_Strict):
    wacc: float = Field(gt=0, lt=1)
    convention: Literal["end", "mid"] = "end"
    stub_fraction: float = Field(1.0, gt=0, le=1, description="share of period 1 still ahead of the valuation date")
    stub_fcff: Optional[float] = Field(None, description="explicit remaining period-1 FCFF (seasonal names)")
    tv_timing: Literal["end_last", "mid_last"] = "end_last"
    wacc_build: Optional[WaccBuild] = None


class ComponentDiscounting(_Strict):
    wacc: Optional[float] = Field(None, gt=0, lt=1)
    convention: Optional[Literal["end", "mid"]] = None
    stub_fraction: Optional[float] = None
    stub_fcff: Optional[float] = None
    tv_timing: Optional[Literal["end_last", "mid_last"]] = None
    wacc_build: Optional[WaccBuild] = None


class TaxRule(_Strict):
    rate: float = Field(ge=0, lt=1)
    guard: bool = True
    mode: Literal["rate_on_ebit", "as_given"] = "rate_on_ebit"
    nol_opening: Optional[float] = None


class Terminal(_Strict):
    method: Literal["normalized_gordon", "gordon", "exit_multiple", "finite_annuity", "none"]
    g: Optional[float] = None
    nopat_next: Optional[float] = None
    da_next: Optional[float] = None
    capex_next: Optional[float] = None
    dnwc_next: Optional[float] = None
    fcf_next: Optional[float] = Field(None, description="stored N+1 numerator; makes reproduction exact")
    nwc_pct_of_revenue: Optional[float] = None
    multiple: Optional[float] = None
    multiple_metric: Optional[Literal["ebitda", "ebit", "revenue", "fcff", "nopat"]] = None
    metric_period: Literal["last", "next"] = "last"
    finite_years: Optional[int] = None
    floor_at_zero: bool = False
    note: Optional[str] = None

    @model_validator(mode="after")
    def _req(self):
        if self.method in ("normalized_gordon", "gordon", "finite_annuity") and self.g is None:
            raise ValueError(f"terminal method {self.method} requires g")
        if self.method == "exit_multiple" and (self.multiple is None or self.multiple_metric is None):
            raise ValueError("exit_multiple requires multiple and multiple_metric")
        if self.method == "finite_annuity" and not self.finite_years:
            raise ValueError("finite_annuity requires finite_years")
        return self


class ComponentResult(BaseModel):
    model_config = ConfigDict(extra="allow")
    pv_explicit: Optional[float] = None
    tv: Optional[float] = None
    pv_tv: Optional[float] = None
    value: Optional[float] = None


class Component(_Strict):
    id: str
    label: str
    kind: Literal["dcf", "rnpv", "fixed"] = "dcf"
    level: Literal["enterprise", "equity"] = "enterprise"
    probability: Optional[float] = Field(None, ge=0, le=1, description="rNPV probability of success")
    discounting: Optional[ComponentDiscounting] = None
    rows: list[Row] = []
    terminal: Optional[Terminal] = None
    fixed_value: Optional[float] = None
    note: Optional[str] = None
    results: Optional[ComponentResult] = None

    @model_validator(mode="after")
    def _req(self):
        if self.kind == "fixed" and self.fixed_value is None:
            raise ValueError(f"component {self.id}: fixed requires fixed_value")
        return self


class ExcludedInstrument(_Strict):
    label: str
    shares: Optional[float] = None
    per_share_impact_if_vested: Optional[float] = None
    note: Optional[str] = None


class PeriodValue(_Strict):
    period_end: date
    value: float


class ShareSpec(_Strict):
    used: float = Field(gt=0, description="ordinary shares (millions) dividing equity value")
    method: Literal["current_diluted", "current_basic", "path_mid", "path_end", "burn_funded", "other"] = "current_diluted"
    path: list[PeriodValue] = []
    issuance_price: Optional[float] = None
    issue_discount: float = 0.0
    new_shares: Optional[float] = None
    proceeds: float = Field(0.0, description="cash raised by assumed issuance, added to equity")
    proceeds_in_bridge: Optional[bool] = None
    price_sensitive: bool = False
    excluded_instruments: list[ExcludedInstrument] = []
    note: Optional[str] = None


class ScenarioResult(BaseModel):
    model_config = ConfigDict(extra="allow")
    ev: Optional[float] = None
    equity: Optional[float] = None
    value_per_share: float
    value_per_share_raw: Optional[float] = None
    value_per_ordinary: Optional[float] = None
    tv_share_of_ev: Optional[float] = None
    upside: Optional[float] = None
    shares_used: Optional[float] = None
    floored: Optional[bool] = None


class Scenario(_Strict):
    id: str
    role: Literal["bear", "base", "bull", "other"]
    label: str
    probability: Optional[float] = Field(None, ge=0, le=1)
    narrative: Optional[str] = None
    year1_locked: bool = True
    discounting: Discounting
    tax: Optional[TaxRule] = None
    components: list[Component] = []
    consolidated_rows: list[Row] = []
    shares: ShareSpec
    bridge_overrides: dict[str, bool] = {}
    results: ScenarioResult


# --------------------------------------------------------------------------
# everything around the valuation
# --------------------------------------------------------------------------

class SharePoint(_Strict):
    date: date
    shares: float
    kind: Optional[str] = None
    source_id: Optional[str] = None


class Historicals(_Strict):
    rows: list[Row] = []
    share_count_series: list[SharePoint] = []
    extra: dict[str, Any] = {}


class Headline(_Strict):
    method: Literal["base_dcf", "prob_weighted", "sotp", "rnpv_sum", "floor"] = "base_dcf"
    rationale: str = ""
    value_per_share: Optional[float] = None
    probability_weighted: Optional[float] = None


class AltValuation(_Strict):
    id: str
    label: str
    method: Literal["net_cash_floor", "exit_multiple", "pe_multiple", "ev_sales", "mature_state",
                    "liquidation", "peer", "analyst_target", "other"]
    scenario_id: Optional[str] = None
    value_per_share: Optional[float] = None
    inputs: dict[str, Any] = {}
    note: Optional[str] = None


class Input(_Strict):
    key: str = Field(description="passed verbatim to model.build(overrides)")
    label: str
    unit: str = ""
    type: Literal["float", "int", "bool", "enum"] = "float"
    value: Any
    min: Optional[float] = None
    max: Optional[float] = None
    step: Optional[float] = None
    options: Optional[list[Any]] = None
    scope: list[str] = Field(default_factory=lambda: ["all"], description="scenario ids or ['all']")
    group: str = "drivers"
    decisive: bool = False
    expected_sign: Literal["+", "-", "?"] = "?"
    description: Optional[str] = None
    assumption_id: Optional[str] = None


class Assumption(_Strict):
    id: str
    label: str
    value: Any
    unit: str = ""
    scenario_id: Optional[str] = None
    status: Literal["measured", "derived", "guided", "assumed"] = "assumed"
    method: Optional[str] = None
    source_id: Optional[str] = None


class GuidanceItem(_Strict):
    metric: str
    basis: Literal["gaap", "adjusted", "unknown"] = "unknown"
    period: str
    low: Optional[float] = None
    high: Optional[float] = None
    unit: str = ""
    ytd_actual: Optional[float] = None
    model: dict[str, float] = {}
    inside: dict[str, bool] = {}
    source_id: Optional[str] = None


class ReverseDCF(_Strict):
    variable: str
    unit: str = ""
    solved: Optional[float] = None
    reachable: bool = True
    target_price: Optional[float] = None
    held_fixed: Optional[str] = None
    costs_scale_with_driver: Optional[bool] = None
    anchor: Optional[Anchor] = None
    commentary: Optional[str] = None


class Axis(_Strict):
    key: str
    label: str
    values: list[float]


class Grid(_Strict):
    id: str
    label: Optional[str] = None
    scenario_id: Optional[str] = None
    x: Axis
    y: Axis
    output: Literal["value_ps", "ev", "upside", "other"] = "value_ps"
    z: list[list[Optional[float]]] = Field(description="z[i][j] for y.values[i], x.values[j]")


class Check(_Strict):
    id: str
    label: Optional[str] = None
    status: Literal["pass", "fail", "warn", "na"]
    detail: str = ""
    diagnosis: Optional[str] = None
    produced_by: Literal["agent", "validator", "app", "legacy"] = "agent"


class Source(_Strict):
    id: str
    kind: str = Field(description="10-K, 10-Q, 8-K, 20-F, 6-K, companyfacts, price, transcript, other")
    description: Optional[str] = None
    accession: Optional[str] = None
    exhibit: Optional[str] = None
    url: Optional[str] = None
    filed: Optional[date] = None
    fetched_at: Optional[str] = None


class Trigger(_Strict):
    metric: str
    threshold: Optional[str] = None
    direction: Optional[str] = None


class Narrative(_Strict):
    headline: str = Field(description="one sentence: the number and the gap")
    decisive_variable: str = ""
    thesis: str = ""
    bear_case: str = ""
    bull_case: str = ""
    opposing_case: str = ""
    change_my_mind: list[Trigger] = []
    market_implied: str = ""
    measured_vs_assumed: str = ""
    errors_corrected: list[str] = []
    key_risks: list[str] = []


class DCF(_Strict):
    provenance: Provenance
    basis: Basis
    listing: Listing
    market: Market
    archetype: Archetype
    drivers: list[DriverDef] = []
    bridge: list[BridgeItem] = []
    historicals: Historicals = Historicals()
    scenarios: list[Scenario]
    headline: Headline = Headline()
    alt_valuations: list[AltValuation] = []
    inputs: list[Input] = []
    assumptions: list[Assumption] = []
    guidance: list[GuidanceItem] = []
    reverse_dcf: list[ReverseDCF] = []
    grids: list[Grid] = []
    checks: list[Check] = []
    narrative: Narrative
    sources: list[Source] = []
    engine_override_reason: Optional[str] = None
    derived: Optional[dict[str, Any]] = Field(None, description="APP-WRITTEN canonical metrics; ignored on input")
    extra: dict[str, Any] = {}

    @model_validator(mode="after")
    def _structure(self):
        ids = [s.id for s in self.scenarios]
        if len(ids) != len(set(ids)):
            raise ValueError("scenario ids must be unique")
        if not any(s.role == "base" for s in self.scenarios):
            raise ValueError("a scenario with role 'base' is required")
        bids = [b.id for b in self.bridge]
        if len(bids) != len(set(bids)):
            raise ValueError("bridge ids must be unique")
        for s in self.scenarios:
            for k in s.bridge_overrides:
                if k not in bids:
                    raise ValueError(f"scenario {s.id}: bridge_override {k!r} is not a bridge id")
        return self


def json_schema() -> dict:
    return DCF.model_json_schema()


if __name__ == "__main__":
    print(json.dumps(json_schema(), indent=1))
