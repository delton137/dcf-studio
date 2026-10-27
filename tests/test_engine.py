import copy
import importlib
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from dcfkit import engine as E  # noqa: E402

LEGACY_CLAUDE = os.path.join(os.path.dirname(ROOT), "Claude_DCFs")


def _rows(fcffs, start=2026):
    return [E.make_row(f"FY{start + i}", f"{start + i}-12-31", revenue=100.0, ebit=f, da=0.0, capex=0.0,
                       delta_nwc=0.0, taxes=0.0) for i, f in enumerate(fcffs)]


def _model(comps, wacc=0.10, shares=10.0, bridge=None, **disc):
    return {
        "listing": {"ordinary_per_listed_unit": 1.0},
        "market": {"price": 10.0, "fx_spot": 1.0},
        "bridge": bridge or [],
        "scenarios": [{"id": "base", "role": "base", "discounting": {"wacc": wacc, **disc},
                       "components": comps, "shares": {"used": shares}, "results": {"value_per_share": 0}}],
    }


def test_make_row_tax_guard_and_identity():
    r = E.make_row("FY1", "2026-12-31", revenue=100, ebit=-20, da=5, capex=8, delta_nwc=1, tax_rate=0.25)
    assert r["taxes"] == 0 and r["nopat"] == -20
    assert r["fcff"] == pytest.approx(-20 + 5 - 8 - 1)


def test_end_year_discounting_and_gordon():
    comp = {"id": "c", "rows": _rows([100, 100]), "terminal": {"method": "gordon", "g": 0.0}}
    m = E.value_model(_model([comp]))
    pv = 100 / 1.1 + 100 / 1.1 ** 2
    tv = 100 / 0.1
    assert m["scenarios"][0]["results"]["ev"] == pytest.approx(pv + tv / 1.1 ** 2)


def test_mid_year_with_tv_at_end():
    comp = {"id": "c", "rows": _rows([100, 100]), "terminal": {"method": "gordon", "g": 0.0}}
    m = E.value_model(_model([comp], convention="mid", tv_timing="end_last"))
    exp = 100 / 1.1 ** 0.5 + 100 / 1.1 ** 1.5 + 1000 / 1.1 ** 2
    assert m["scenarios"][0]["results"]["ev"] == pytest.approx(exp)


def test_stub_fraction():
    comp = {"id": "c", "rows": _rows([100, 100]), "terminal": {"method": "none"}}
    m = E.value_model(_model([comp], stub_fraction=0.5))
    exp = 50 / 1.1 ** 0.5 + 100 / 1.1 ** 1.5
    assert m["scenarios"][0]["results"]["ev"] == pytest.approx(exp)


def test_stub_fcff_overrides():
    comp = {"id": "c", "rows": _rows([100, 100]), "terminal": {"method": "none"}}
    m = E.value_model(_model([comp], stub_fraction=0.5, stub_fcff=70.0))
    assert m["scenarios"][0]["results"]["ev"] == pytest.approx(70 / 1.1 ** 0.5 + 100 / 1.1 ** 1.5)


def test_normalized_terminal_capex_rule():
    rows = [E.make_row("FY1", "2026-12-31", revenue=1000, ebit=200, da=50, capex=60, delta_nwc=10, tax_rate=0.2)]
    t = E.normalized_terminal(rows, 0.03, nwc_pct_of_revenue=0.1)
    assert t["capex_next"] / t["da_next"] == pytest.approx(1.03)
    assert t["fcf_next"] == pytest.approx((160 - 0.03 * 50) * 1.03 - 0.1 * 1000 * 0.03)


def test_exit_multiple_and_finite_annuity_and_floor():
    rows = _rows([100])
    rows[0]["ebitda"] = 150.0
    tv, _ = E.terminal_value({"method": "exit_multiple", "multiple": 8, "multiple_metric": "ebitda"}, rows, 0.1)
    assert tv == 1200
    tv, _ = E.terminal_value({"method": "finite_annuity", "g": 0.0, "finite_years": 2}, rows, 0.1)
    assert tv == pytest.approx(100 / 1.1 + 100 / 1.1 ** 2)
    neg = _rows([-100])
    tv, _ = E.terminal_value({"method": "gordon", "g": 0.0, "floor_at_zero": True}, neg, 0.1)
    assert tv == 0


def test_spread_guard():
    with pytest.raises(E.EngineError):
        E.terminal_value({"method": "gordon", "g": 0.095}, _rows([1]), 0.10)


def test_sotp_segment_wacc_and_fixed_and_equity_level():
    a = {"id": "a", "rows": _rows([100]), "terminal": {"method": "none"}, "discounting": {"wacc": 0.20}}
    b = {"id": "b", "rows": _rows([100]), "terminal": {"method": "none"}}
    stake = {"id": "stake", "kind": "fixed", "level": "equity", "fixed_value": 30.0}
    m = E.value_model(_model([a, b, stake], wacc=0.10))
    r = m["scenarios"][0]["results"]
    assert r["ev"] == pytest.approx(100 / 1.2 + 100 / 1.1)
    assert r["equity"] == pytest.approx(r["ev"] + 30)


def test_rnpv_probability():
    asset = {"id": "drug", "kind": "rnpv", "probability": 0.4, "rows": _rows([100]), "terminal": {"method": "none"}}
    m = E.value_model(_model([asset]))
    assert m["scenarios"][0]["results"]["ev"] == pytest.approx(0.4 * 100 / 1.1)


def test_bridge_adr_fx_and_floor():
    comp = {"id": "c", "rows": _rows([110]), "terminal": {"method": "none"}}
    m = _model([comp], bridge=[{"id": "cash", "equity_effect": 50, "included": True},
                               {"id": "lease", "equity_effect": -20, "included": True}])
    m["listing"]["ordinary_per_listed_unit"] = 5.0
    m["market"]["fx_spot"] = 0.5
    m["scenarios"][0]["bridge_overrides"] = {"lease": False}
    r = E.value_model(m)["scenarios"][0]["results"]
    assert r["equity"] == pytest.approx(100 + 50)
    assert r["value_per_share"] == pytest.approx(150 / 10 * 5 * 0.5)
    m2 = _model([comp], bridge=[{"id": "debt", "equity_effect": -500, "included": True}])
    r2 = E.value_model(m2)["scenarios"][0]["results"]
    assert r2["floored"] and r2["value_per_share"] == 0 and r2["value_per_share_raw"] < 0


def test_overlay_bridge_toggle_and_wacc_exact():
    comp = {"id": "c", "rows": _rows([100, 100]), "terminal": {"method": "gordon", "g": 0.02}}
    m = E.value_model(_model([comp], bridge=[{"id": "lease", "equity_effect": -50, "included": True}]))
    o = E.apply_overlay(m, {"bridge": {"lease": False}})
    assert o["scenarios"][0]["results"]["equity"] - m["scenarios"][0]["results"]["equity"] == pytest.approx(50)
    o2 = E.apply_overlay(m, {"wacc": 0.12})
    ref = E.value_model(_model([copy.deepcopy(comp)], wacc=0.12, bridge=m["bridge"]))
    assert o2["scenarios"][0]["results"]["ev"] == pytest.approx(ref["scenarios"][0]["results"]["ev"])


def test_overlay_year1_locked():
    comp = {"id": "c", "rows": [E.make_row(f"FY{y}", f"{y}-12-31", revenue=100 * 1.1 ** i, ebit=20 * 1.1 ** i,
                                           da=5, capex=5, delta_nwc=0, tax_rate=0.2)
                                for i, y in enumerate(range(2026, 2031))],
            "terminal": {"method": "gordon", "g": 0.02}}
    m = E.value_model(_model([comp]))
    o = E.apply_overlay(m, {"ebit_margin_shift": 0.05})
    r0 = m["scenarios"][0]["components"][0]["rows"]
    r1 = o["scenarios"][0]["components"][0]["rows"]
    assert r1[0]["ebit"] == r0[0]["ebit"]
    assert r1[1]["ebit"] == pytest.approx(r0[1]["ebit"] + 0.05 * r0[1]["revenue"])


def test_reproduce_detects_mismatch():
    comp = {"id": "c", "rows": _rows([100]), "terminal": {"method": "none"}}
    m = E.value_model(_model([comp]))
    assert E.reproduce(m)["grade"] == "exact"
    m["scenarios"][0]["results"]["equity"] *= 1.02
    m["scenarios"][0]["results"]["ev"] *= 1.02
    assert E.reproduce(m)["grade"] == "approx"


def test_detect_convention_finds_mid_year():
    comp = {"id": "c", "rows": _rows([100, 120, 130]), "terminal": {"method": "gordon", "g": 0.02}}
    truth = E.value_model(_model([copy.deepcopy(comp)], convention="mid"))
    claimed = _model([comp])
    claimed["scenarios"][0]["results"] = truth["scenarios"][0]["results"]
    rep, conv = E.detect_convention(claimed)
    assert conv["convention"] == "mid" and rep["grade"] == "exact"


@pytest.mark.skipif(not os.path.exists(os.path.join(LEGACY_CLAUDE, "ual_model.py")), reason="legacy repo absent")
def test_reproduces_legacy_ual_exactly():
    sys.path.insert(0, LEGACY_CLAUDE)
    ual = importlib.import_module("ual_model")
    for name in ual.SCENARIOS:
        v = ual.value(name)
        p = v["proj"]
        rows = [E.make_row(r["year"], f"{r['year']}-12-31", revenue=0.0, ebit=r["ebit"], da=r["da"],
                           capex=r["capex"], delta_nwc=r["dwc"], taxes=r["tax"]) for r in p["rows"]]
        g = ual.TERMINAL_GROWTH
        comp = {"id": "c", "rows": rows, "terminal": {"method": "normalized_gordon", "g": g,
                                                      "fcf_next": p["term_fcf"] * (1 + g)}}
        m = _model([comp], wacc=p["wacc"], shares=ual.SHARES,
                   bridge=[{"id": "nd", "equity_effect": -v["net_debt_used"], "included": True}])
        r = E.value_model(m)["scenarios"][0]["results"]
        assert r["value_per_share"] == pytest.approx(v["fmv"], abs=1e-9)
        m2 = E.apply_overlay(m, {"wacc_shift": 0.01})
        assert m2["scenarios"][0]["results"]["value_per_share"] == pytest.approx(
            ual.value(name, wacc=p["wacc"] + 0.01)["fmv"], abs=1e-9)


def test_overlay_preserves_unfloored_legacy_values():
    comp = {"id": "c", "rows": _rows([10, 10]), "terminal": {"method": "none"}}
    m = _model([comp], bridge=[{"id": "debt", "equity_effect": -100, "included": True}])
    m = E.value_model(m)
    r = m["scenarios"][0]["results"]
    r["value_per_share"] = r["value_per_share_raw"]          # legacy stated it unfloored
    assert r["value_per_share"] < 0
    o = E.apply_overlay(m, {"wacc_shift": 0.001})
    assert o["scenarios"][0]["results"]["value_per_share"] < 0
