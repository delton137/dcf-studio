import asyncio
import json
import os
import stat
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dcfkit import engine as E  # noqa: E402
from server.screener import agent_validate as AV  # noqa: E402
from server.screener import fundamentals as F  # noqa: E402
from server.screener import metrics as M  # noqa: E402
from server.screener import screens as SC  # noqa: E402
from server.screener import universes as U  # noqa: E402
from server.screener.sources import security_kind  # noqa: E402

D = date.fromisoformat


def q(start, end, val, label="x"):
    return {"start": D(start), "end": D(end), "val": val, "tag": "T", "label": label, "disagree": False}


# ----------------------------------------------------------------- TTM building

CAL_QUARTERS = [("2024-01-01", "2024-03-31"), ("2024-04-01", "2024-06-30"), ("2024-07-01", "2024-09-30"),
                ("2025-01-01", "2025-03-31"), ("2025-04-01", "2025-06-30"), ("2025-07-01", "2025-09-30"),
                ("2026-01-01", "2026-03-31"), ("2026-04-01", "2026-06-30")]


def test_ttm_income_imputes_q4_and_builds_prior():
    qs = [q(s, e, 100.0 + i) for i, (s, e) in enumerate(CAL_QUARTERS)]
    ann = [q("2024-01-01", "2024-12-31", 500.0), q("2025-01-01", "2025-12-31", 600.0)]
    r = F.ttm_income(qs, ann)
    # chain: 2024Q3? .. Q4(imputed) 2025Q1-Q3, Q4(imputed), 2026Q1-Q2
    q4_2025 = 600.0 - (103 + 104 + 105)
    q4_2024 = 500.0 - (100 + 101 + 102)
    assert r["basis"] == "TTM" and r["end"] == "2026-06-30"
    assert r["val"] == pytest.approx(105 + q4_2025 + 106 + 107)          # 2025Q3, Q4*, 2026Q1, Q2
    assert r["prior"] == pytest.approx(102 + q4_2024 + 103 + 104)        # 2024Q3, Q4*, 2025Q1, Q2
    assert r["imputed"]


def test_ttm_income_january_and_53_week_year():
    # fiscal year Feb 2 2025 .. Jan 31 2026 with a 98-day Q4 (53-week year)
    qs = [q("2025-02-02", "2025-05-03", 10), q("2025-05-04", "2025-08-02", 11), q("2025-08-03", "2025-11-01", 12),
          q("2026-02-01", "2026-05-02", 14)]
    ann = [q("2025-02-02", "2026-01-31", 50)]
    r = F.ttm_income(qs, ann)
    assert r["basis"] == "TTM" and r["val"] == pytest.approx(11 + 12 + (50 - 33) + 14)


def test_ttm_income_falls_back_to_fy():
    r = F.ttm_income([q("2026-01-01", "2026-03-31", 5)], [q("2024-01-01", "2024-12-31", 40),
                                                           q("2025-01-01", "2025-12-31", 44)])
    assert r["basis"] == "FY" and r["val"] == 44 and r["prior"] == 40


def test_ttm_cashflow_fy_plus_q1():
    ann = [q("2025-01-01", "2025-12-31", 400)]
    qs = [q("2025-01-01", "2025-03-31", 90), q("2026-01-01", "2026-03-31", 120)]
    r = F.ttm_cashflow(qs, ann)
    assert r["basis"] == "FY+Q1" and r["val"] == 430 and r["end"] == "2026-03-31"
    assert F.ttm_cashflow([], ann)["basis"] == "FY"


def test_shares_yoy():
    qs = [q("2025-04-01", "2025-06-30", 100), q("2026-04-01", "2026-06-30", 110)]
    assert F.shares_yoy(qs) == {"latest_q": 110, "year_ago_q": 100}


def _cf(**tags):
    return {("dei" if t == "EntityCommonStockSharesOutstanding" else "us-gaap", t):
            {"CY2026Q2I": {"end": "2026-06-30", "val": v}} for t, v in tags.items()}


def test_balance_sheet_no_double_count():
    bs, flags = F.balance_sheet(_cf(LongTermDebt=100, LongTermDebtNoncurrent=90, LongTermDebtCurrent=10,
                                    ShortTermBorrowings=5, CashAndCashEquivalentsAtCarryingValue=50,
                                    ShortTermInvestments=20))
    assert bs["debt"] == 105 and bs["cash"] == 70
    bs, _ = F.balance_sheet(_cf(LongTermDebtNoncurrent=90, DebtCurrent=7, CashCashEquivalentsAndShortTermInvestments=9))
    assert bs["debt"] == 97 and bs["cash"] == 9
    bs, flags = F.balance_sheet(_cf(ConvertibleNotesPayable=40, CashAndCashEquivalentsAtCarryingValue=1))
    assert bs["debt"] == 40 and "debt_from_notes" in flags
    bs, flags = F.balance_sheet(_cf(CashAndCashEquivalentsAtCarryingValue=1))
    assert bs["debt"] == 0 and "debt_none_reported" in flags


# ----------------------------------------------------------------- metrics

def _fund(**kw):
    def v(x, prior=None, basis="TTM"):
        return {"val": x * 1e6, "prior": None if prior is None else prior * 1e6, "basis": basis,
                "end": (date.today() - timedelta(days=60)).isoformat(), "tag": "T"}
    f = {"revenue": v(1000, 800), "ebit": v(200), "net_income": v(150), "interest": v(10), "da": v(50),
         "ocf": v(260, basis="FY+Q1"), "capex": v(60, basis="FY+Q1"), "sbc": v(30),
         "diluted_shares": {"val": 100e6, "latest_q": 100e6, "year_ago_q": 98e6, "basis": "TTM"},
         "cash": 300e6, "debt": 100e6, "minority": None, "preferred": None, "flags": []}
    f.update(kw)
    return f


def test_metric_formulas():
    r = M.compute({"market_cap": 4000.0, "price": 40.0, "financial": False}, _fund())
    assert r["ev"] == pytest.approx(4000 + 100 - 300)
    assert r["rev_growth"] == pytest.approx(0.25)
    assert r["op_margin"] == pytest.approx(0.2)
    assert r["fcf"] == pytest.approx(200) and r["fcf_margin"] == pytest.approx(0.2)
    assert r["fcf_yield"] == pytest.approx(0.05)
    assert r["ev_ebit"] == pytest.approx(3800 / 200)
    assert r["ev_ebitda"] == pytest.approx(3800 / 250)
    assert r["pe"] == pytest.approx(4000 / 150)
    assert r["rule_of_40"] == pytest.approx(45)
    assert r["dilution"] == pytest.approx(100 / 98 - 1)
    assert r["net_cash_pct"] == pytest.approx(200 / 4000)
    assert r["implied_growth"] is not None and r["implied_gap"] == pytest.approx(r["implied_growth"] - 0.25)


def test_financials_and_missing_capex():
    r = M.compute({"market_cap": 4000.0, "price": 40.0, "financial": True}, _fund())
    assert r["ev"] is None and r["fcf_yield"] is None and r["implied_growth"] is None and "financial" in r["flags"]
    f = _fund(capex=None)
    r = M.compute({"market_cap": 4000.0, "price": 40.0, "financial": False}, f)
    assert r["fcf"] == pytest.approx(260) and "fcf_no_capex" in r["flags"]


@pytest.mark.parametrize("current,prior,expected", [
    (125, 100, 0.8),  # P/E 20 / growth 25 percentage points
    (100, 100, None),
    (80, 100, None),
    (-25, 100, None),
    (125, -100, None),
    (125, 0, None),
    (125, None, None),
    (None, 100, None),
])
def test_historical_peg(current, prior, expected):
    fund = _fund(net_income={"val": current * 1e6 if current is not None else None,
                             "prior": prior * 1e6 if prior is not None else None})
    row = M.compute({"market_cap": 2500, "price": 25}, fund)
    if expected is None:
        assert row["peg"] is None
    else:
        assert row["peg"] == pytest.approx(expected)


def test_cached_rows_gain_peg_without_refresh(tmp_path, monkeypatch):
    cached = [{"symbol": "AAA", "cik": 1, "market_cap": 2500, "price": 25, "flags": ["multi_class"]}]
    monkeypatch.setattr(SC.T, "table", lambda: {"rows": cached})
    monkeypatch.setattr(SC.T, "fundamentals", lambda: {
        "1": _fund(net_income={"val": 125e6, "prior": 100e6})})
    monkeypatch.setattr(SC, "REFINE", tmp_path / "refine")
    monkeypatch.setattr(SC, "ENRICH", tmp_path / "enrich")
    monkeypatch.setattr(SC, "coverage", lambda: {})
    result = SC.query({"universe": "us1b", "filters": [{"f": "peg", "op": "<=", "v": 1}],
                       "sort": [{"f": "peg", "dir": "asc"}]})
    assert result["matched"] == 1
    assert result["rows"][0]["pe"] == pytest.approx(20)
    assert result["rows"][0]["peg"] == pytest.approx(0.8)
    assert "multi_class" in result["rows"][0]["flags"]
    assert "peg" not in cached[0]


def test_reverse_dcf_matches_engine():
    f0, g, r, gt = 100.0, 0.12, 0.10, 0.025
    rows = [E.make_row(f"Y{t}", f"{2026 + t}-12-31", revenue=0, ebit=f0 * (1 + g) ** t, da=0, capex=0,
                       delta_nwc=0, taxes=0) for t in range(1, 11)]
    comp = {"id": "c", "rows": rows, "terminal": {"method": "gordon", "g": gt}}
    engine_ev = E.value_component(comp, {"wacc": r, "convention": "end"})["value"]
    assert M.dcf_value_growth(f0, g, r, gt) == pytest.approx(engine_ev, rel=1e-12)
    g_solved, edge = M.implied_fcf_growth(engine_ev, f0, r, gt)
    assert edge is None and g_solved == pytest.approx(g, abs=1e-7)
    assert M.implied_fcf_growth(-5, f0, r, gt) == (None, None)
    assert M.implied_fcf_growth(1e9, f0, r, gt)[1] == "above_range"


def test_implied_revenue_cagr_for_cash_burners():
    c = M.implied_revenue_cagr(5000, 1000, -0.2, 0.15, 0.10, 0.025)
    assert c is not None
    assert M.dcf_value_ramp(1000, -0.2, c, 0.15, 0.10, 0.025) == pytest.approx(5000, rel=1e-6)


def test_security_kind():
    assert security_kind("United Airlines Holdings Inc. Common Stock") == "common"
    assert security_kind("Preferred Bank Common Stock") == "common"
    assert security_kind("Foo Acquisition Corp Units") == "other"
    assert security_kind("Bar Inc 6.5% Notes due 2030") == "other"
    assert security_kind("Novo Nordisk A/S American Depositary Shares") == "adr"


# ----------------------------------------------------------------- filters & screens

ROWS = [
    {"symbol": "AAA", "name": "A", "market_cap": 5000, "revenue": 100, "rev_growth": 0.3, "fcf": 10,
     "fcf_margin": 0.1, "implied_gap": -0.2, "flags": [], "sector": "Technology"},
    {"symbol": "BBB", "name": "B", "market_cap": 2000, "revenue": 50, "rev_growth": 0.05, "fcf": -1,
     "fcf_margin": -0.02, "implied_gap": None, "flags": ["stale_period"], "sector": "Energy"},
    {"symbol": "CCC", "name": "C", "market_cap": 500, "revenue": 10, "rev_growth": None, "fcf": 1,
     "fcf_margin": 0.1, "implied_gap": 0.1, "flags": ["missing:capex"], "sector": "Technology"},
    {"symbol": "DDD", "name": "D", "market_cap": 9000, "revenue": None, "flags": ["no_fundamentals"],
     "sector": "Finance"},
]


@pytest.mark.parametrize("flt,expect", [
    ({"f": "rev_growth", "op": ">=", "v": 0.1}, ["AAA"]),
    ({"f": "fcf", "op": "between", "v": [0, 5]}, ["CCC"]),
    ({"f": "rev_growth", "op": "is_null"}, ["CCC", "DDD"]),
    ({"f": "sector", "op": "in", "v": ["Energy", "Finance"]}, ["BBB", "DDD"]),
    ({"f": "flags", "op": "no_flag", "v": ["stale_period", "missing"]}, ["AAA", "DDD"]),
    ({"f": "flags", "op": "has_flag", "v": "missing"}, ["CCC"]),
    ({"f": "name", "op": "contains", "v": "b"}, ["BBB"]),
])
def test_filter_ops(flt, expect):
    assert [r["symbol"] for r in ROWS if SC._match(r, flt)] == expect


def test_sort_none_last_and_multikey():
    out = SC.sort_rows(ROWS, [{"f": "rev_growth", "dir": "desc"}])
    assert [r["symbol"] for r in out][:2] == ["AAA", "BBB"] and out[-1].get("rev_growth") is None
    out = SC.sort_rows(ROWS, [{"f": "sector", "dir": "asc"}, {"f": "market_cap", "dir": "asc"}])
    assert [r["symbol"] for r in out] == ["BBB", "DDD", "CCC", "AAA"]


def test_presets_run_and_universes(tmp_path, monkeypatch):
    monkeypatch.setattr(U, "DIR", tmp_path / "universes")
    monkeypatch.setattr(SC.T, "table", lambda: {"asof": "x", "rows": [dict(r) for r in ROWS]})
    monkeypatch.setattr(SC, "coverage", lambda: {})
    for p in SC.PRESETS:
        res = SC.query(p["screen"])
        assert res["total"] >= res["matched"]
    res = SC.query({"universe": "us1b"})
    assert {r["symbol"] for r in res["rows"]} == {"AAA", "BBB"}
    U.save({"name": "My List", "members": ["aaa", {"symbol": "ZZZ", "note": "n"}, "AAA"]})
    res = SC.query({"universe": "list:my-list"})
    assert [r["symbol"] for r in res["rows"]] == ["AAA"] and res["unmatched"] == ["ZZZ"]
    assert any(l["slug"] == "my-list" and l["count"] == 2 for l in U.list_all())


# ----------------------------------------------------------------- agent output checks

def _write(d, name, obj):
    (d / name).write_text(obj if isinstance(obj, str) else json.dumps(obj))


def test_agent_validate_shortlist(tmp_path):
    _write(tmp_path, "screen.csv", "symbol,name\nAAA,A\nBBB,B\n")
    _write(tmp_path, "screen.json", {"top_n": 2})
    pick = {"thesis": "x" * 50, "why_now": "earnings soon", "key_risk": "cyclical peak"}
    _write(tmp_path, "shortlist.json", {"picks": [{"symbol": "AAA", "rank": 1, **pick},
                                                  {"symbol": "ZZZ", "rank": 2, **pick}]})
    _write(tmp_path, "report.md", "r" * 300)
    res = AV.check("shortlist", str(tmp_path))
    assert not res["ok"] and any(i["id"] == "symbol" for i in res["items"])
    _write(tmp_path, "shortlist.json", {"picks": [{"symbol": "AAA", "rank": 1, **pick}]})
    assert AV.check("shortlist", str(tmp_path))["ok"]


def test_agent_validate_theme(tmp_path):
    _write(tmp_path, "universe_index.csv", "symbol,name\nAAA,A\nBBB,B\nCCC,C\n")
    _write(tmp_path, "universe.json", {"name": "t", "members": [{"symbol": s} for s in ("AAA", "BBB", "CCC")]})
    assert AV.check("theme", str(tmp_path))["ok"]


# ----------------------------------------------------------------- agent job end to end (fake CLI)

FAKE = r'''#!/usr/bin/env python3
import json, sys
args = sys.argv[1:]
sys.stdin.read()
resume = "--resume" in args
print(json.dumps({"type": "system", "subtype": "init", "session_id": "s-1", "model": "fake", "tools": []}), flush=True)
members = [{"symbol": "AAA", "note": "pure play"}, {"symbol": "BBB"}, {"symbol": "CCC" if resume else "NOPE"}]
json.dump({"name": "Fake theme", "description": "d", "members": members}, open("universe.json", "w"))
print(json.dumps({"type": "result", "subtype": "success", "result": "ok", "total_cost_usd": 0.1}), flush=True)
'''


def test_theme_agent_job_end_to_end(tmp_path, monkeypatch):
    bindir = tmp_path / "bin"
    bindir.mkdir()
    (bindir / "claude").write_text(FAKE)
    (bindir / "claude").chmod(0o755)
    monkeypatch.setenv("PATH", f"{bindir}:{os.environ['PATH']}")
    from server import runner as R
    from server import store
    from server.screener import agent as A
    for mod in (store, A):
        monkeypatch.setattr(mod, "AGENT_RUNS", tmp_path / "agent")
    monkeypatch.setattr(U, "DIR", tmp_path / "universes")
    monkeypatch.setattr(A.T, "table", lambda: {"asof": "x", "rows": [dict(r) for r in ROWS]})
    vid = A.submit_theme("fake theme", list_name="Fake theme")
    job = R.RUNNER.agent_queue.get_nowait()
    asyncio.run(R.RUNNER._execute(job))
    meta = json.loads((tmp_path / "agent" / vid / "run.json").read_text())
    assert meta["status"] == "valid" and len(meta["attempts"]) == 2, meta
    saved = U.get("fake-theme")
    assert saved and [m["symbol"] for m in saved["members"]] == ["AAA", "BBB", "CCC"]
    assert saved["kind"] == "agent" and meta["result_list"] == "fake-theme"


# ----------------------------------------------------------------- model catalog parsing

def test_grok_and_codex_model_discovery(tmp_path, monkeypatch):
    from server import models_catalog as MC

    class P:
        stdout = "You are logged in.\n\nDefault model: grok-9\n\nAvailable models:\n  * grok-9 (default)\n  - grok-9-fast\n  - grok-8\n"
    monkeypatch.setattr(MC.subprocess, "run", lambda *a, **k: P())
    g = MC.discover_grok()
    assert [m["id"] for m in g["models"]] == ["grok-9", "grok-9-fast", "grok-8"] and g["latest"] == "grok-9"
    cache = tmp_path / "models_cache.json"
    cache.write_text(json.dumps({"fetched_at": "2026-10-01T00:00:00Z", "models": [
        {"slug": "b", "display_name": "B", "visibility": "list", "priority": 2,
         "supported_reasoning_levels": [{"effort": "low"}], "default_reasoning_level": "low"},
        {"slug": "hidden", "visibility": "hide", "priority": 0},
        {"slug": "a", "display_name": "A", "visibility": "list", "priority": 1,
         "supported_reasoning_levels": [{"effort": "low"}, {"effort": "ultra"}]}]}))
    monkeypatch.setattr(MC, "CODEX_CACHE", cache)
    c = MC.discover_codex()
    assert [m["id"] for m in c["models"]] == ["a", "b"] and c["latest"] == "a"
    assert c["models"][0]["efforts"] == ["low", "ultra"]
    monkeypatch.setattr(MC, "catalog", lambda: {"backends": {"codex": c}})
    assert MC.resolve_model("codex", "latest") == "a" and MC.resolve_model("codex", "pinned-x") == "pinned-x"

    class PAgy:
        stdout = (
            "gemini-4-argon-medium\tGemini 4 Argon (Medium)\n"
            "gemini-4-argon-high\tGemini 4 Argon (High)\n"
            "gemini-4-argon-low\tGemini 4 Argon (Low)\n"
            "gpt-oss-120b-medium\tGPT-OSS 120B (Medium)\n"
        )
    monkeypatch.setattr(MC.subprocess, "run", lambda *a, **k: PAgy())
    ag = MC.discover_agy()
    assert [m["id"] for m in ag["models"]] == ["gemini-4-argon", "gpt-oss-120b"]
    assert ag["latest"] == "gemini-4-argon"
    assert ag["models"][0]["efforts"] == ["low", "medium", "high"] and ag["models"][0]["default_effort"] == "high"
    assert ag["models"][1]["efforts"] == ["medium"] and ag["models"][1]["default_effort"] == "medium"


def test_custom_params_keep_share_class_flags(monkeypatch):
    row = {"symbol": "GOOG", "cik": 1, "market_cap": 4000.0, "price": 40.0, "financial": False,
           "revenue": 1000, "flags": ["multi_class", "secondary_class"]}
    monkeypatch.setattr(SC.T, "table", lambda: {"asof": "x", "rows": [dict(row)]})
    monkeypatch.setattr(SC.T, "fundamentals", lambda: {"1": _fund()})
    monkeypatch.setattr(SC, "coverage", lambda: {})
    _, rows = SC.rows_with_extras({"r": 0.09})
    assert {"multi_class", "secondary_class"} <= set(rows[0]["flags"])
    assert SC.query({"universe": "us1b", "params": {"r": 0.09}})["matched"] == 0   # secondary class excluded
