import copy
import json
import os
import shutil
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server.xlsx_export import verify_export  # noqa: E402

pytestmark = pytest.mark.skipif(shutil.which("soffice") is None, reason="LibreOffice not installed")


def _example():
    return json.load(open(os.path.join(ROOT, "dcfkit", "example_dcf.json")))


def _assert_close(res):
    for sid, (got, exp, diff) in res.items():
        assert got is not None, sid
        assert diff < 1e-6 * max(1, abs(exp)), (sid, got, exp)


def test_example_matches_engine():
    _assert_close(verify_export(_example()))


def test_variants_match_engine():
    d = _example()
    bear, base, bull = d["scenarios"]
    bear["discounting"].update(convention="mid", tv_timing="mid_last", stub_fcff=40.0)
    base["components"][0]["terminal"] = {"method": "exit_multiple", "multiple": 9.0, "multiple_metric": "ebitda",
                                         "metric_period": "next", "g": 0.02}
    seg = copy.deepcopy(bull["components"][0])
    seg.update(id="seg2", label="Segment 2", discounting={"wacc": 0.12}, probability=0.6)
    bull["components"].append(seg)
    bull["components"].append({"id": "stake", "label": "Stake", "kind": "fixed", "level": "equity",
                               "fixed_value": 75.0})
    bull["components"][0]["terminal"]["fcf_next"] *= 1.03  # stated numerator off the formula
    bull["bridge_overrides"] = {"op_leases": False}
    _assert_close(verify_export(d))
