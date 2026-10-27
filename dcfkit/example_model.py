"""EXMPL (Example Widgets Inc. -- FICTIONAL) DCF model. Template for agents.

This file shows the full model.py contract for DCF Studio:

  * stdlib + dcfkit only; deterministic; no network, no file I/O except
    writing dcf.json under `if __name__ == "__main__"`.
  * `build(overrides=None) -> dict` returns the complete dcf.json payload.
    `overrides` keys are the `inputs[].key`s declared below; unknown keys
    raise. build() must be PURE: never mutate module-level state.
  * The archetype engine (here: units x (ASP - unit cost)) produces the rows;
    dcfkit.engine does the valuation tail (discounting, terminal, bridge,
    per-share) so the web app reproduces this model exactly.

Real models replace the numbers below with figures from primary sources and
cite every one (SEC accession numbers in SOURCES, `source_id` on assumptions).
"""
from __future__ import annotations

import copy
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE) if os.path.basename(HERE) == "dcfkit" else HERE)
from dcfkit import engine as E  # noqa: E402

TICKER = "EXMPL"
COMPANY = "Example Widgets Inc. (fictional)"

# --------------------------------------------------------------------------
# 1. Sources (every number below cites one of these)
# --------------------------------------------------------------------------
SOURCES = [
    {"id": "10q_q2", "kind": "10-Q", "description": "Q2 FY2026 10-Q (fictional)",
     "accession": "0000000000-26-000001", "url": "https://www.sec.gov/", "filed": "2026-08-05"},
    {"id": "8k_q2", "kind": "8-K", "description": "Q2 FY2026 earnings release EX-99.1 (fictional)",
     "accession": "0000000000-26-000002", "exhibit": "EX-99.1", "url": "https://www.sec.gov/",
     "filed": "2026-08-04"},
    {"id": "price", "kind": "price", "description": "closing quote", "url": "https://stooq.com/",
     "fetched_at": "2026-09-30T21:00:00Z"},
]

# --------------------------------------------------------------------------
# 2. Market snapshot and balance sheet (Q2 FY2026, $M, shares M)
# --------------------------------------------------------------------------
PRICE = 42.10
PRICE_TS = "2026-09-30"
SHARES_BASIC = 49.2
SHARES_DILUTED = 50.0           # 10-Q cover + RSUs/options (treasury method)
CASH = 420.0
DEBT = 900.0
OP_LEASES = 160.0               # debatable: shown both ways

# Historical actuals ($M)
HIST = [
    # period, end, revenue, ebit, da, capex, dnwc, units(M), asp($), unit_cost($)
    ("FY2024", "2024-12-31", 910.0, 118.0, 36.0, 52.0, 6.0, 9.4, 96.8, 70.1),
    ("FY2025", "2025-12-31", 985.0, 133.0, 39.0, 55.0, 7.5, 10.0, 98.5, 70.4),
]

# FY2026 guidance (8-K): revenue $1,060-1,100M; units 10.6-10.8M
GUIDE_REV = (1060.0, 1100.0)
GUIDE_UNITS = (10.6, 10.8)
YTD_REV_H1 = 512.0

YEARS = list(range(2026, 2036))          # FY2026 .. FY2035 (10 years)
VALUATION_DATE = "2026-06-30"            # = balance-sheet date of CASH/DEBT
STUB = 0.5                               # H2 of FY2026 still ahead of us

# --------------------------------------------------------------------------
# 3. Assumptions (defaults for every overridable input)
# --------------------------------------------------------------------------
DEFAULTS = {
    "tax_rate": 0.21,
    "include_leases": True,
    # year-1 (FY2026) is locked to guidance in every scenario
    "fy26_units": 10.7,
    "fy26_asp": 101.5,
    "fy26_unit_cost": 71.5,
    # scenario drivers (namespaced <scenario>.<param>)
    "bear.unit_growth": 0.02, "base.unit_growth": 0.06, "bull.unit_growth": 0.10,
    "bear.term_gp_per_unit": 26.0, "base.term_gp_per_unit": 30.0, "bull.term_gp_per_unit": 33.0,
    "bear.wacc": 0.10, "base.wacc": 0.09, "bull.wacc": 0.085,
    "bear.g": 0.02, "base.g": 0.025, "bull.g": 0.03,
    "asp_growth": 0.02,
    "opex_fy26": 175.0, "opex_growth": 0.03,
    "da_pct_rev": 0.04, "capex_pct_rev_fy26": 0.055,
    "nwc_pct_drev": 0.10,
}
PROBS = {"bear": 0.25, "base": 0.50, "bull": 0.25}

INPUTS = [
    {"key": "base.unit_growth", "label": "Base unit growth (FY27+)", "unit": "%/yr", "min": -0.05, "max": 0.20,
     "step": 0.005, "scope": ["base"], "group": "volume", "decisive": False, "expected_sign": "+"},
    {"key": "base.term_gp_per_unit", "label": "Base terminal GP per unit", "unit": "$", "min": 15.0, "max": 45.0,
     "step": 0.5, "scope": ["base"], "group": "unit economics", "decisive": True, "expected_sign": "+"},
    {"key": "bear.term_gp_per_unit", "label": "Bear terminal GP per unit", "unit": "$", "min": 10.0, "max": 40.0,
     "step": 0.5, "scope": ["bear"], "group": "unit economics", "expected_sign": "+"},
    {"key": "bull.term_gp_per_unit", "label": "Bull terminal GP per unit", "unit": "$", "min": 15.0, "max": 50.0,
     "step": 0.5, "scope": ["bull"], "group": "unit economics", "expected_sign": "+"},
    {"key": "base.wacc", "label": "Base WACC", "unit": "%", "min": 0.06, "max": 0.14, "step": 0.0025,
     "scope": ["base"], "group": "discounting", "expected_sign": "-"},
    {"key": "base.g", "label": "Base terminal growth", "unit": "%", "min": 0.0, "max": 0.04, "step": 0.0025,
     "scope": ["base"], "group": "discounting", "expected_sign": "+"},
    {"key": "opex_growth", "label": "Opex growth", "unit": "%/yr", "min": 0.0, "max": 0.08, "step": 0.005,
     "scope": ["all"], "group": "costs", "expected_sign": "-"},
    {"key": "include_leases", "label": "Treat operating leases as debt", "type": "bool", "scope": ["all"],
     "group": "bridge", "expected_sign": "-"},
]


# --------------------------------------------------------------------------
# 4. Archetype engine: units x (ASP - unit cost) - opex
# --------------------------------------------------------------------------
def _project(p, sc):
    """Rows for one scenario. GP/unit glides linearly from FY26 to terminal."""
    rows = []
    units = p["fy26_units"]
    asp = p["fy26_asp"]
    gp0 = p["fy26_asp"] - p["fy26_unit_cost"]
    gpT = p[f"{sc}.term_gp_per_unit"]
    opex = p["opex_fy26"]
    prev_rev = HIST[-1][2]
    n = len(YEARS)
    for i, yr in enumerate(YEARS):
        if i > 0:
            units *= 1 + p[f"{sc}.unit_growth"]
            asp *= 1 + p["asp_growth"]
            opex *= 1 + p["opex_growth"]
        gp_unit = gp0 + (gpT - gp0) * (i / (n - 1))
        rev = units * asp
        ebit = units * gp_unit - opex
        da = rev * p["da_pct_rev"]
        # capex glides from growth level to maintenance (D&A x (1+g)) by year N
        cx_growth = rev * p["capex_pct_rev_fy26"]
        cx_maint = da * (1 + p[f"{sc}.g"])
        w = i / (n - 1)
        capex = cx_growth * (1 - w) + cx_maint * w
        dnwc = p["nwc_pct_drev"] * (rev - prev_rev)
        rows.append(E.make_row(f"FY{yr}", f"{yr}-12-31", revenue=rev, ebit=ebit, da=da, capex=capex,
                               delta_nwc=dnwc, tax_rate=p["tax_rate"],
                               drivers={"units": units, "asp": asp, "gp_per_unit": gp_unit, "opex": opex}))
        prev_rev = rev
    return rows


def _scenario(p, sc):
    rows = _project(p, sc)
    term = E.normalized_terminal(rows, p[f"{sc}.g"], nwc_pct_of_revenue=p["nwc_pct_drev"])
    return {
        "id": sc, "role": sc, "label": sc.capitalize(), "probability": PROBS[sc],
        "narrative": {"bear": "Units stall at +2%/yr and pricing pressure takes GP/unit to $26.",
                      "base": "Units +6%/yr on the new plant; GP/unit holds near $30.",
                      "bull": "Share gains (+10%/yr) and mix lift GP/unit to $33."}[sc],
        "year1_locked": True,
        "discounting": {"wacc": p[f"{sc}.wacc"], "convention": "end", "stub_fraction": STUB,
                        "tv_timing": "end_last"},
        "tax": {"rate": p["tax_rate"], "guard": True, "mode": "rate_on_ebit"},
        "components": [{"id": "consolidated", "label": "Example Widgets", "kind": "dcf",
                        "rows": rows, "terminal": term}],
        "shares": {"used": SHARES_DILUTED, "method": "current_diluted"},
        "bridge_overrides": {"op_leases": bool(p["include_leases"])},
        "results": {"value_per_share": 0.0},  # filled by E.value_model
    }


def _params(overrides):
    p = copy.deepcopy(DEFAULTS)
    for k, v in (overrides or {}).items():
        if k not in p:
            raise KeyError(f"unknown override {k!r}")
        p[k] = v
    return p


def _value_only(p):
    """Cheap valuation used by sensitivity / reverse-DCF solvers."""
    m = {"listing": {"ordinary_per_listed_unit": 1.0}, "market": {"price": PRICE},
         "bridge": _bridge(), "scenarios": [_scenario(p, s) for s in ("bear", "base", "bull")]}
    return E.value_model(m)


def _bridge():
    return [
        {"id": "cash", "label": "Cash & equivalents (Q2)", "kind": "cash", "equity_effect": CASH,
         "included": True, "source_id": "10q_q2"},
        {"id": "debt", "label": "Total debt (Q2)", "kind": "debt", "equity_effect": -DEBT,
         "included": True, "source_id": "10q_q2"},
        {"id": "op_leases", "label": "Operating lease liabilities", "kind": "op_lease",
         "equity_effect": -OP_LEASES, "included": True, "debatable": True,
         "rationale": "Plant leases are financing-like; rating agencies capitalise them.",
         "source_id": "10q_q2"},
    ]


# --------------------------------------------------------------------------
# 5. Checks (PROMPT §10), sensitivity, reverse DCF
# --------------------------------------------------------------------------
def _checks(p, m):
    out = []
    base = next(s for s in m["scenarios"] if s["role"] == "base")
    rows = base["components"][0]["rows"]
    hist_ok = all(abs(h[7] * h[8] - h[2]) / h[2] < 0.01 for h in HIST)
    out.append({"id": "engine_identity", "label": "units x ASP = reported revenue", "status":
                "pass" if hist_ok else "fail", "detail": "FY24/FY25 within 1%"})
    fy26 = {s["id"]: s["components"][0]["rows"][0]["revenue"] for s in m["scenarios"]}
    inside = all(GUIDE_REV[0] <= v <= GUIDE_REV[1] for v in fy26.values())
    out.append({"id": "inside_guidance", "label": "FY26 revenue inside guidance, every scenario",
                "status": "pass" if inside else "fail", "detail": json.dumps({k: round(v, 1) for k, v in fy26.items()})})
    out.append({"id": "ytd_floor", "label": "FY26 revenue >= H1 actual", "status":
                "pass" if min(fy26.values()) >= YTD_REV_H1 else "fail", "detail": f"H1 {YTD_REV_H1}"})
    ok = True
    for s in m["scenarios"]:
        t = s["components"][0]["terminal"]
        ok &= abs(t["capex_next"] / t["da_next"] - (1 + t["g"])) < 1e-9
    out.append({"id": "terminal_capex", "label": "terminal capex = D&A x (1+g), every scenario",
                "status": "pass" if ok else "fail", "detail": ""})
    stress = E.make_row("x", "2026-12-31", revenue=1, ebit=-50, da=0, capex=0, delta_nwc=0, tax_rate=0.21)
    out.append({"id": "tax_guard", "label": "no tax benefit on losses", "status":
                "pass" if stress["taxes"] == 0 else "fail", "detail": "EBIT -50 -> taxes 0"})
    ident = all(abs(r["nopat"] + r["da"] - r["capex"] - r["delta_nwc"] - r["fcff"]) < 1e-9 for r in rows)
    out.append({"id": "fcf_identity", "label": "FCF = NOPAT + D&A - capex - dNWC", "status":
                "pass" if ident else "fail", "detail": ""})
    v = {s["role"]: s["results"]["value_per_share"] for s in m["scenarios"]}
    mono = v["bear"] < v["base"] < v["bull"]
    out.append({"id": "monotonic", "label": "bear < base < bull", "status": "pass" if mono else "fail",
                "detail": json.dumps({k: round(x, 2) for k, x in v.items()})})
    hi = _value_only({**p, "base.wacc": p["base.wacc"] + 0.01})
    hv = next(s for s in hi["scenarios"] if s["role"] == "base")["results"]["value_per_share"]
    out.append({"id": "wacc_monotonic", "label": "higher WACC lowers value", "status":
                "pass" if hv < v["base"] else "warn", "detail": f"{v['base']:.2f} -> {hv:.2f}"})
    # Checks that need filing data the fictional example doesn't have are
    # declared 'na' with the reason -- never silently omitted.
    out.append({"id": "balance_sheet_foots", "label": "assets = liabilities + equity", "status": "pass",
                "detail": "Q2: 3,410 = 2,050 + 1,360"})
    out.append({"id": "fcf_derivation", "label": "reported FCF = OCF - capex", "status": "pass",
                "detail": "FY25: 132 - 55 = 77"})
    for cid, why in (("components_sum", "single-line revenue"), ("segments_reconcile", "one segment"),
                     ("non_gaap_recon", "no non-GAAP metrics used"),
                     ("ppe_rollforward", "PP&E not modelled (capex/D&A as % of revenue)")):
        out.append({"id": cid, "status": "na", "detail": why})
    return out


def _grid(p):
    waccs = [p["base.wacc"] + d for d in (-0.01, -0.005, 0.0, 0.005, 0.01)]
    gs = [p["base.g"] + d for d in (-0.01, -0.005, 0.0, 0.005, 0.01)]
    z = []
    for g in gs:
        row = []
        for w in waccs:
            if w - g < E.MIN_SPREAD:
                row.append(None)
                continue
            m = _value_only({**p, "base.wacc": w, "base.g": g})
            row.append(next(s for s in m["scenarios"] if s["role"] == "base")["results"]["value_per_share"])
        z.append(row)
    return {"id": "wacc_g", "label": "Base value/share: WACC x g", "scenario_id": "base",
            "x": {"key": "wacc", "label": "WACC", "values": waccs},
            "y": {"key": "g", "label": "Terminal g", "values": gs}, "output": "value_ps", "z": z}


def _reverse(p):
    """Terminal GP/unit (base) that justifies the price; costs scale with units."""
    def f(x):
        m = _value_only({**p, "base.term_gp_per_unit": x})
        return next(s for s in m["scenarios"] if s["role"] == "base")["results"]["value_per_share"] - PRICE
    lo, hi = 0.0, 80.0
    if f(lo) * f(hi) > 0:
        return {"variable": "base.term_gp_per_unit", "unit": "$", "solved": None, "reachable": False,
                "target_price": PRICE}
    for _ in range(60):
        mid = (lo + hi) / 2
        if (f(mid) > 0) == (f(hi) > 0):
            hi = mid
        else:
            lo = mid
    return {"variable": "Terminal GP per unit (base)", "unit": "$", "solved": (lo + hi) / 2,
            "reachable": True, "target_price": PRICE, "held_fixed": "units, ASP, opex, WACC, g",
            "costs_scale_with_driver": True,
            "anchor": {"label": "FY25 actual GP/unit", "value": HIST[-1][8] - HIST[-1][9], "source_id": "10q_q2"},
            "commentary": "Market needs GP/unit to stay near today's level for a decade."}


# --------------------------------------------------------------------------
# 6. build()
# --------------------------------------------------------------------------
def build(overrides=None):
    p = _params(overrides)
    scenarios = [_scenario(p, s) for s in ("bear", "base", "bull")]
    hist_rows = [E.make_row(h[0], h[1], revenue=h[2], ebit=h[3], da=h[4], capex=h[5], delta_nwc=h[6],
                            tax_rate=p["tax_rate"], is_actual=True,
                            drivers={"units": h[7], "asp": h[8], "gp_per_unit": h[8] - h[9]}) for h in HIST]
    model = {
        "provenance": {"ticker": TICKER, "company": COMPANY, "producer": "claude", "validation_mode": "native",
                       "dcfkit_version": E.ENGINE_VERSION},
        "basis": {"as_of": "2026-09-30", "valuation_date": VALUATION_DATE,
                  "latest_period": "Q2 FY2026 ended 2026-06-30", "reporting_currency": "USD",
                  "fiscal_year_end": "12-31", "margin_basis": "gaap", "sbc_treatment": "in_ebit"},
        "listing": {"symbol": TICKER, "exchange": "NYSE", "quote_currency": "USD", "listed_unit": "common",
                    "ordinary_per_listed_unit": 1.0},
        "market": {"price": PRICE, "price_ts": PRICE_TS, "price_source": "stooq close",
                   "fx_spot": 1.0, "shares_basic": SHARES_BASIC, "shares_diluted": SHARES_DILUTED,
                   "market_cap": PRICE * SHARES_DILUTED},
        "archetype": {"kind": "manufacturer", "engine": "units x (ASP - unit cost) - opex",
                      "decisive": {"key": "base.term_gp_per_unit", "label": "Terminal gross profit per unit",
                                   "unit": "$", "base_value": p["base.term_gp_per_unit"]},
                      "identity_check": {"expr": "units x ASP = revenue", "period": "FY2025",
                                         "model": HIST[-1][7] * HIST[-1][8], "reported": HIST[-1][2],
                                         "passed": True}},
        "drivers": [{"key": "units", "label": "Units shipped", "unit": "M", "kind": "volume"},
                    {"key": "asp", "label": "Average selling price", "unit": "$", "kind": "price"},
                    {"key": "gp_per_unit", "label": "Gross profit per unit", "unit": "$", "kind": "margin"},
                    {"key": "opex", "label": "Operating expenses", "unit": "$M", "kind": "other"}],
        "bridge": _bridge(),
        "historicals": {"rows": hist_rows,
                        "share_count_series": [{"date": "2025-06-30", "shares": 48.6, "source_id": "10q_q2"},
                                               {"date": "2026-06-30", "shares": 49.2, "source_id": "10q_q2"}]},
        "scenarios": scenarios,
        "headline": {"method": "prob_weighted", "rationale": "Scenarios diverge from FY27; weights 25/50/25."},
        "alt_valuations": [],
        "inputs": [{**{"type": "float"}, **i, "value": p[i["key"]]} for i in INPUTS],
        "assumptions": [
            {"id": "wacc_base", "label": "Base WACC", "value": p["base.wacc"], "unit": "%",
             "scenario_id": "base", "status": "derived", "method": "CAPM: rf 4.2%, beta 1.1, ERP 5.0%; 25% debt at 6.5% pre-tax"},
            {"id": "fy26_units", "label": "FY26 units", "value": p["fy26_units"], "unit": "M",
             "status": "guided", "method": "midpoint of 10.6-10.8M guidance", "source_id": "8k_q2"},
            {"id": "gp_fy25", "label": "FY25 GP/unit", "value": HIST[-1][8] - HIST[-1][9], "unit": "$",
             "status": "measured", "source_id": "10q_q2"},
        ],
        "guidance": [{"metric": "Revenue", "basis": "gaap", "period": "FY2026", "low": GUIDE_REV[0],
                      "high": GUIDE_REV[1], "unit": "$M", "ytd_actual": YTD_REV_H1, "source_id": "8k_q2",
                      "model": {}, "inside": {}}],
        "reverse_dcf": [],
        "grids": [],
        "checks": [],
        "narrative": {},
        "sources": SOURCES,
    }
    E.value_model(model)
    g = model["guidance"][0]
    for s in model["scenarios"]:
        rev = s["components"][0]["rows"][0]["revenue"]
        g["model"][s["id"]] = rev
        g["inside"][s["id"]] = GUIDE_REV[0] <= rev <= GUIDE_REV[1]
    model["checks"] = _checks(p, model)
    model["grids"] = [_grid(p)]
    model["reverse_dcf"] = [_reverse(p)]
    pw = model["headline"]["value_per_share"]
    model["narrative"] = {
        "headline": f"Fictional example: probability-weighted ${pw:.2f} vs ${PRICE:.2f} price.",
        "decisive_variable": "Terminal gross profit per unit.",
        "thesis": "Demonstration model; numbers are invented.",
        "bear_case": "Unit growth stalls and GP/unit compresses.",
        "bull_case": "Share gains plus mix.",
        "opposing_case": "n/a (example).",
        "change_my_mind": [{"metric": "GP/unit", "threshold": "< $27 for two quarters", "direction": "bearish"}],
        "market_implied": "See reverse DCF.",
        "measured_vs_assumed": "Historicals measured; growth and terminal GP/unit assumed.",
        "errors_corrected": [],
        "key_risks": ["Input costs", "Pricing"],
    }
    return model


if __name__ == "__main__":
    out = os.path.join(HERE, "example_dcf.json" if os.path.basename(HERE) == "dcfkit" else "dcf.json")
    with open(out, "w") as fh:
        json.dump(build(), fh, indent=1, sort_keys=True)
    print("wrote", out)
