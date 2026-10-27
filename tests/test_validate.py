import json
import os
import shutil
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from dcfkit import validate as V  # noqa: E402


@pytest.fixture
def run_dir(tmp_path):
    d = tmp_path / "v"
    d.mkdir()
    shutil.copy(os.path.join(ROOT, "dcfkit", "example_model.py"), d / "model.py")
    shutil.copytree(os.path.join(ROOT, "dcfkit"), d / "dcfkit",
                    ignore=shutil.ignore_patterns("__pycache__", "example_dcf.json"))
    subprocess.run([sys.executable, "model.py"], cwd=d, check=True, capture_output=True)
    hv = json.loads((d / "dcf.json").read_text())["headline"]["value_per_share"]
    (d / "report.md").write_text(f"# report\n\nProbability-weighted value ${hv:.2f} per share.\n")
    return d


def _ids(rep, level="fail"):
    return {i["id"] for i in rep.items if i["level"] == level}


def test_example_passes(run_dir):
    rep, repro = V.validate(str(run_dir / "dcf.json"))
    assert not rep.failures, rep.failures
    assert repro["grade"] == "exact"


def test_hand_edit_is_caught(run_dir):
    p = run_dir / "dcf.json"
    d = json.loads(p.read_text())
    d["scenarios"][1]["results"]["value_per_share"] = 99.0
    p.write_text(json.dumps(d))
    rep, _ = V.validate(str(p))
    assert {"idempotent", "build_api"} & _ids(rep)


def test_mutating_build_is_caught(run_dir):
    src = (run_dir / "model.py").read_text()
    src = src.replace("    p = _params(overrides)\n    scenarios =",
                      "    p = _params(overrides)\n    DEFAULTS.update(overrides or {})\n    scenarios =")
    (run_dir / "model.py").write_text(src)
    subprocess.run([sys.executable, "model.py"], cwd=run_dir, check=True, capture_output=True)
    rep, _ = V.validate(str(run_dir / "dcf.json"))
    assert "purity" in _ids(rep)


def test_dead_knob_is_caught(run_dir):
    src = (run_dir / "model.py").read_text()
    src = src.replace('''{"key": "opex_growth",''', '''{"key": "asp_growth_unused", "label": "dead", "min": 0, "max": 1,
     "scope": ["all"], "group": "x"},
    {"key": "opex_growth",''')
    src = src.replace('"asp_growth": 0.02,', '"asp_growth": 0.02, "asp_growth_unused": 0.5,')
    (run_dir / "model.py").write_text(src)
    subprocess.run([sys.executable, "model.py"], cwd=run_dir, check=True, capture_output=True)
    rep, _ = V.validate(str(run_dir / "dcf.json"))
    assert "live_knobs" in _ids(rep)


def test_units_error_is_caught(run_dir):
    p = run_dir / "dcf.json"
    d = json.loads(p.read_text())
    d["market"]["market_cap"] = d["market"]["market_cap"] * 1000  # $K mistaken for $M
    p.write_text(json.dumps(d))
    rep, _ = V.validate(str(p), run_model=False)
    assert "market_cap" in _ids(rep)


def test_network_import_is_caught(run_dir):
    src = (run_dir / "model.py").read_text().replace("import copy\n", "import copy\nimport urllib.request\n", 1)
    (run_dir / "model.py").write_text(src)
    rep, _ = V.validate(str(run_dir / "dcf.json"))
    assert "model_py_imports" in _ids(rep)


def test_bad_sign_and_identity(run_dir):
    p = run_dir / "dcf.json"
    d = json.loads(p.read_text())
    r = d["scenarios"][1]["components"][0]["rows"][2]
    r["capex"] = -abs(r["capex"])
    p.write_text(json.dumps(d))
    rep, _ = V.validate(str(p), run_model=False)
    assert {"row_sign", "row_identity"} <= _ids(rep)


def test_imported_mode_relaxed(run_dir):
    p = run_dir / "dcf.json"
    d = json.loads(p.read_text())
    d["provenance"]["validation_mode"] = "imported"
    for s in d["scenarios"]:
        s["components"][0]["rows"] = []
    d["checks"] = []
    p.write_text(json.dumps(d))
    rep, repro = V.validate(str(p), mode="imported")
    assert not rep.failures, rep.failures
    assert repro["grade"] == "none"
