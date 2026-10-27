"""Grok legacy importer: convert() only -- never writes into data/."""
import copy
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from dcfkit import engine as E  # noqa: E402
from dcfkit.schema import DCF  # noqa: E402
from server.importer import grok_xlsx as G  # noqa: E402

pytestmark = pytest.mark.skipif(not G.GROK_DIR.is_dir(), reason="legacy grok_dcf_models folder absent")


def _summary_values(item):
    summ = G.parse_summary(G.load_book(item["xlsx"])["Summary"])
    _, fv = G.block_row(summ, r"^fair value /")
    return [G.num(v) for v in fv[:3]], summ["pw"]["fv"]


@pytest.fixture(scope="module")
def converted():
    out = {}
    for t in ("AMKR", "SNY", "DELL"):
        item = G.find_item(t)
        assert item is not None, t
        out[t] = (item, G.convert(item))
    return out


@pytest.mark.parametrize("ticker", ["AMKR", "SNY", "DELL"])
def test_schema_and_headline(converted, ticker):
    item, m = converted[ticker]
    DCF.model_validate(m)
    (bear, base, bull), pw = _summary_values(item)
    got = {s["role"]: s["results"]["value_per_share"] for s in m["scenarios"]}
    assert got["base"] == pytest.approx(base, rel=1e-9)
    assert got["bear"] == pytest.approx(bear, rel=1e-9)
    assert got["bull"] == pytest.approx(bull, rel=1e-9)
    assert m["headline"]["method"] == "prob_weighted"
    assert m["headline"]["value_per_share"] == pytest.approx(pw, rel=1e-9)
    assert sum(s["probability"] for s in m["scenarios"]) == pytest.approx(1.0)
    # the engine reproduces the workbook: equity, EV and the per-listed-unit value
    rep = E.reproduce(m)
    assert rep["grade"] == "exact", rep
    eng = E.value_model(copy.deepcopy(m))
    assert E.scenario_by_role(eng, "base")["results"]["value_per_share_raw"] == pytest.approx(base, rel=1e-9)
    conv = m["provenance"]["imported_from"]["convention_detected"]
    assert (conv["convention"], conv["tv_timing"], conv["stub_fraction"]) == ("mid", "end_last", 1.0)


def test_rows_identity_and_signs(converted):
    for item, m in converted.values():
        for s in m["scenarios"]:
            for r in s["components"][0]["rows"]:
                assert r["taxes"] >= 0 and r["capex"] >= 0 and r["da"] >= 0
                assert r["nopat"] == pytest.approx(r["ebit"] - r["taxes"], abs=1e-6)
                f = r["nopat"] + r["da"] - r["capex"] - r["delta_nwc"] + r["other_adj"]
                assert f == pytest.approx(r["fcff"], abs=1e-6)


def test_sny_eur_adr(converted):
    _, m = converted["SNY"]
    assert m["basis"]["reporting_currency"] == "EUR"
    assert m["listing"]["listed_unit"] == "ADR"
    assert m["listing"]["ordinary_per_listed_unit"] == 0.5
    assert m["market"]["fx_spot"] == pytest.approx(1.153)
    base = E.scenario_by_role(m, "base")
    # equity (EUR m) / ordinary shares x 0.5 ADR ratio x EURUSD = USD per ADR
    r = base["results"]
    assert r["equity"] / base["shares"]["used"] * 0.5 * 1.153 == pytest.approx(r["value_per_share"], rel=1e-9)
    mk = m["market"]
    assert mk["price"] * mk["shares_diluted"] / 0.5 == pytest.approx(mk["market_cap"], rel=0.05)


def test_dell_fiscal_years(converted):
    _, m = converted["DELL"]
    assert m["basis"]["fiscal_year_end"] == "01-31"
    rows = E.scenario_by_role(m, "base")["components"][0]["rows"]
    assert rows[0]["period"] == "FY2027" and rows[0]["period_end"] == "2027-01-31"
    assert rows[-1]["period"] == "FY2036"


def test_amkr_bridge_and_segments(converted):
    _, m = converted["AMKR"]
    base = E.scenario_by_role(m, "base")
    r = base["results"]
    assert r["ev"] + sum(b["equity_effect"] for b in m["bridge"]) == pytest.approx(r["equity"], abs=1e-6)
    row = base["components"][0]["rows"][0]
    segs = [v for k, v in row["drivers"].items() if k.startswith("seg_rev:")]
    assert len(segs) == 4 and sum(segs) == pytest.approx(row["revenue"])
    assert {d["key"] for d in m["drivers"]} >= set(row["drivers"])
    assert any(g["id"] == "wacc_g" for g in m["grids"])


def test_inventory_skips_duplicate():
    tickers = [it["ticker"] for it in G.inventory()]
    assert "CRBS" not in tickers and "CBRS" in tickers
    assert len(tickers) == len(set(tickers))
