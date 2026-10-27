"""Independent cross-check of agent conversions: recompute each legacy model's
base value per share straight from the legacy source (run on the version's
legacy/ COPY in a subprocess) and compare it with the imported dcf.json.

    uv run python -m server.importer.crosscheck            # all Claude/Codex imports
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from server.store import DATA, MODELS, read_json, update_run, write_json

_SNIPPET = r"""
import importlib, json, sys
sys.path.insert(0, '.')
mod = sys.argv[1]
M = importlib.import_module(mod)
KEYS = ('fmv', 'per_share', 'value_per_share', 'per_ads_usd')
def pick(r):
    if isinstance(r, dict):
        for k in KEYS:
            if r.get(k) is not None:
                return float(r[k])
    return None
out = None
sc = getattr(M, 'SCENARIOS', None)
cands = []
if isinstance(sc, dict):
    for k in sc:
        if str(k).lower() == 'base':
            cands += [('value', sc[k]), ('project', k), ('value', k)]
elif isinstance(sc, (list, tuple)):
    for el in sc:
        nm = el.get('name') if isinstance(el, dict) else getattr(el, 'name', None)
        if str(nm).lower() == 'base':
            cands += [('value', el), ('project', el), ('value_scenario', el)]
for fn in ('project', 'value'):
    for name in ('base', 'Base', 'BASE'):
        cands.append((fn, name))
for fn, arg in cands:
    f = getattr(M, fn, None)
    if f is None:
        continue
    try:
        out = pick(f(arg))
    except Exception:
        out = None
    if out is not None:
        break
print('__X__' + json.dumps(out))
"""


def legacy_base_vps(version_path, item_legacy):
    files = item_legacy.get("files") or []
    src = item_legacy.get("source")
    leg = Path(version_path) / "legacy"
    if src == "claude":
        mods = [Path(f).stem for f in files if f.endswith("_model.py")]
        if not mods:
            return None, "workbook-only (no module to recompute)"
        p = subprocess.run([sys.executable, "-c", _SNIPPET, mods[0]], cwd=leg, capture_output=True, text=True,
                           timeout=300, env={"PYTHONDONTWRITEBYTECODE": "1", "PATH": "/usr/bin:/bin"})
        line = next((ln for ln in p.stdout.splitlines() if ln.startswith("__X__")), None)
        if not line:
            return None, f"legacy module failed: {p.stderr.strip()[-300:]}"
        v = json.loads(line[5:])
        return v, None if v is not None else "could not locate a base-scenario per-share value"
    if src == "codex":
        cr = leg / "case_results.json"
        if cr.exists():
            return float(json.load(open(cr))["Base"]["price"]), None
        mr = leg / "model_results.json"
        if mr.exists():
            rows = json.load(open(mr))
            base = next((r for r in rows if r.get("case") == 2), None)
            return (float(base["price"]), None) if base else (None, "no case 2")
        return None, "no machine-readable legacy results (formula workbook)"
    return None, "n/a"


def run(only=None):
    report = {}
    for rj in sorted(MODELS.glob("*/*import*/run.json")):
        meta = read_json(rj, {}) or {}
        leg = meta.get("legacy") or {}
        if leg.get("source") not in ("claude", "codex") or meta.get("status") not in ("valid", "invalid"):
            continue
        vid = rj.parent.name
        if only and vid not in only:
            continue
        d = read_json(rj.parent / "dcf.json") or {}
        base = next((s for s in d.get("scenarios") or [] if s.get("role") == "base"), None)
        imported = (base or {}).get("results", {}).get("value_per_share")
        legacy, why = legacy_base_vps(rj.parent, leg)
        match = None
        if legacy is not None and imported is not None:
            match = abs(imported - legacy) <= 0.005 * max(abs(legacy), 1e-9) or abs(imported - legacy) < 0.01
        cc = {"legacy_vps": legacy, "imported_vps": imported, "match": match, "note": why}
        leg["crosscheck"] = cc
        update_run(rj.parent, legacy=leg)
        report[f"{rj.parent.parent.name}/{vid}"] = cc
    write_json(DATA / "imports" / "crosscheck_report.json", report)
    return report


if __name__ == "__main__":
    rep = run(sys.argv[1:] or None)
    bad = {k: v for k, v in rep.items() if v["match"] is False}
    unk = {k: v for k, v in rep.items() if v["match"] is None}
    print(f"{len(rep)} checked: {sum(1 for v in rep.values() if v['match'])} match, {len(bad)} mismatch, "
          f"{len(unk)} not checkable")
    for k, v in {**bad, **unk}.items():
        print(f"  {k}: legacy {v['legacy_vps']} imported {v['imported_vps']} {v['note'] or ''}")
