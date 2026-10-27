"""What-if recompute.

Layer B (preferred): the version's own model.py / legacy_adapter.py
`build(overrides)` in a persistent worker process -> full archetype fidelity.
Layer A: dcfkit.engine.apply_overlay -> WACC / g / multiple / bridge / shares
exactly, plus approximate operating overlays.
Both can be combined: B first, then A on top.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
import threading
import time
from collections import OrderedDict
from datetime import datetime

from dcfkit import engine as E
from server.store import ROOT, WHATIFS, find_version_dir, get_price, now_iso, read_json, write_json

WORKER = ROOT / "server" / "model_worker.py"
MAX_WORKERS = 6
IDLE_SECONDS = 900
BUILD_TIMEOUT = 60


class _Worker:
    def __init__(self, path, modfile):
        self.path = path
        self.lock = threading.Lock()
        self.last = time.time()
        self.cache: OrderedDict[str, dict] = OrderedDict()
        self.proc = subprocess.Popen([sys.executable, str(WORKER), str(path), modfile], cwd=str(path),
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                     text=True, bufsize=1, env={"PYTHONDONTWRITEBYTECODE": "1",
                                                                "PATH": "/usr/bin:/bin"})
        hello = self._readline(30)
        if not hello or not json.loads(hello).get("ready"):
            self.close()
            raise RuntimeError(f"model failed to import: {hello}")

    def _readline(self, timeout):
        out = []

        def rd():
            out.append(self.proc.stdout.readline())
        t = threading.Thread(target=rd, daemon=True)
        t.start()
        t.join(timeout)
        if t.is_alive():
            self.close()
            raise TimeoutError(f"model.build exceeded {timeout}s")
        return out[0]

    def build(self, overrides):
        key = json.dumps(overrides, sort_keys=True)
        with self.lock:
            self.last = time.time()
            if key in self.cache:
                self.cache.move_to_end(key)
                return json.loads(json.dumps(self.cache[key]))
            self.proc.stdin.write(json.dumps({"overrides": overrides}) + "\n")
            self.proc.stdin.flush()
            line = self._readline(BUILD_TIMEOUT)
            if not line:
                raise RuntimeError("model worker died")
            resp = json.loads(line)
            if not resp.get("ok"):
                raise ValueError(resp.get("error"))
            self.cache[key] = resp["dcf"]
            if len(self.cache) > 64:
                self.cache.popitem(last=False)
            return json.loads(json.dumps(resp["dcf"]))

    def close(self):
        try:
            self.proc.kill()
        except Exception:
            pass


_workers: OrderedDict[str, _Worker] = OrderedDict()
_wlock = threading.Lock()


def _model_file(path):
    for name in ("model.py", "legacy_adapter.py"):
        if (path / name).exists():
            return name
    return None


def _get_worker(vid, path):
    with _wlock:
        now = time.time()
        for k in [k for k, w in _workers.items() if now - w.last > IDLE_SECONDS]:
            _workers.pop(k).close()
        w = _workers.get(vid)
        if w and w.proc.poll() is None:
            _workers.move_to_end(vid)
            return w
        modfile = _model_file(path)
        if not modfile:
            return None
        w = _Worker(path, modfile)
        _workers[vid] = w
        while len(_workers) > MAX_WORKERS:
            _workers.popitem(last=False)[1].close()
        return w


def recompute(vid, *, knobs=None, overrides=None, scenario_ids=None):
    """Returns {dcf, derived, layers, anchored, grade, warnings}."""
    path = find_version_dir(vid)
    if path is None:
        raise KeyError(vid)
    base = read_json(path / "dcf.json")
    warnings = []
    layers = []
    knobs = {k: v for k, v in (knobs or {}).items() if v not in (None, "", {})}
    overrides = overrides or {}
    model = base
    grade = (read_json(path / "validation.json", {}) or {}).get("reproduction", {}) or {}
    grade = grade.get("grade") or E.reproduce(base)["grade"]
    if overrides:
        w = _get_worker(vid, path)
        if w is None:
            raise ValueError("this version has no model.py; only Layer A knobs are available")
        model = w.build(overrides)
        model["provenance"] = base.get("provenance")
        layers.append("B")
        grade = "exact"
    if knobs:
        model = E.apply_overlay(model, knobs, scenario_ids=scenario_ids, anchor=grade)
        layers.append("A")
        if grade == "approx":
            warnings.append("Engine reproduces this model only approximately; Layer A changes are applied as "
                            "deltas on the model's stated values.")
        approx_knobs = set(knobs) - E.EXACT_KNOBS
        if approx_knobs:
            warnings.append(f"Generic overlay (approximate): {sorted(approx_knobs)} rescale rows ratio-wise; "
                            f"for capacity/asset-turn engines prefer the model's own inputs.")
    price = (get_price(path.parent.name) or {}).get("price")
    model["derived"] = E.derive(model, compare_price=price)
    return {"dcf": model, "derived": model["derived"], "layers": layers, "grade": grade,
            "anchored": grade == "approx" and "A" in layers, "warnings": warnings}


# --------------------------------------------------------------------------
# saved what-ifs
# --------------------------------------------------------------------------

def _slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60] or "whatif"


def list_saved(vid):
    d = WHATIFS / vid
    if not d.is_dir():
        return []
    return sorted((read_json(p) for p in d.glob("*.json")), key=lambda x: x.get("created_at", ""))


def save(vid, name, knobs, overrides, note=None):
    res = recompute(vid, knobs=knobs, overrides=overrides)
    entry = {"name": name, "slug": _slug(name), "knobs": knobs or {}, "overrides": overrides or {},
             "note": note, "created_at": now_iso(), "derived": res["derived"], "layers": res["layers"]}
    write_json(WHATIFS / vid / f"{entry['slug']}.json", entry)
    return entry


def delete(vid, slug):
    p = WHATIFS / vid / f"{slug}.json"
    if p.exists():
        p.unlink()
        if not any(p.parent.iterdir()):
            p.parent.rmdir()
        return True
    return False


def shutdown():
    with _wlock:
        for w in _workers.values():
            w.close()
        _workers.clear()


def promote(vid, name, knobs, overrides, note=None):
    """Turn a what-if into a first-class `app_edit` version (shows up in comparisons)."""
    import shutil
    from datetime import datetime
    from server.store import STORE, create_version, parse_version_id, update_run, write_json
    from server.validation import run_validation

    src = find_version_dir(vid)
    res = recompute(vid, knobs=knobs, overrides=overrides)
    d = res["dcf"]
    d.pop("derived", None)
    meta = read_json(src / "run.json", {}) or {}
    source = meta.get("source") or parse_version_id(vid)[1]
    new_vid, path = create_version(src.parent.name, source, "app_edit", vendor=False, run_meta={
        "kind": "app_edit", "parent_version": vid, "instructions": note, "cli": None,
        "model": meta.get("model")})
    for f in ("model.py", "legacy_adapter.py", "convert.py", "report.md"):
        if (src / f).exists():
            shutil.copy2(src / f, path / f)
    for dname in ("dcfkit", "legacy", "sources"):
        if (src / dname).is_dir():
            shutil.copytree(src / dname, path / dname)
    prov = d.setdefault("provenance", {})
    prov.update({"version_id": new_vid, "parent_version": vid, "producer": "app_edit",
                 "validation_mode": "imported", "overrides_applied": {"knobs": knobs or {}, "overrides": overrides or {}}})
    prov.setdefault("changelog", [])
    prov["changelog"] = list(prov["changelog"]) + [{"summary": f"What-if '{name}' promoted from {vid}",
                                                    "detail": note, "new": {"knobs": knobs, "overrides": overrides}}]
    write_json(path / "dcf.json", d)
    with open(path / "report.md", "a") as fh:
        fh.write(f"\n\n---\n**What-if '{name}'** (promoted in DCF Studio from `{vid}`): "
                 f"knobs {json.dumps(knobs or {})}, overrides {json.dumps(overrides or {})}.\n")
    val = run_validation(path, "imported")
    update_run(path, status="valid" if val.get("ok") else "invalid", finished_at=now_iso())
    STORE.invalidate(src.parent.name)
    return {"version_id": new_vid, "validation": val.get("summary")}
