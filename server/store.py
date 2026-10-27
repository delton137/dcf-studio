"""Filesystem store: every model version is a directory.

data/models/<TICKER>/<version_id>/
    dcf.json         unified model (dcfkit schema)
    run.json         run/import metadata (RunMeta below)
    validation.json  output of `dcfkit/validate.py --json`
    report.md        narrative
    model.py         native runs (and legacy_adapter.py for some imports)
    dcfkit/          vendored copy (native runs)
    events.jsonl     normalized agent stream (runs)
    prompt.md        the exact prompt sent (runs)
    sources/ legacy/ previous/

version_id = <TICKER>_<YYYYMMDD-HHMMSS>_<source>[-import|-edit]   (globally unique;
             older ids without the ticker prefix are still understood)
source     = claude | codex | grok | agy  (the CLI family that built the model)
origin     = run | import | app_edit
"""
from __future__ import annotations

import copy
import json
import os
import shutil
import sys
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from dcfkit import engine as E  # noqa: E402

DATA = Path(os.environ.get("DCF_STUDIO_DATA", ROOT / "data"))
MODELS = DATA / "models"
PRICES = DATA / "prices"
WHATIFS = DATA / "whatifs"
AGENT_RUNS = DATA / "screener" / "agent"   # screener agent jobs (shortlists, theme lists)
LEGACY_ROOT = ROOT.parent  # DCF_models/
SOURCES = ("claude", "codex", "grok", "agy")

RUN_STATUSES = ("queued", "running", "validating", "fixing", "valid", "invalid", "failed",
                "cancelled", "interrupted")
TERMINAL_STATUSES = {"valid", "invalid", "failed", "cancelled", "interrupted"}


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def write_json(path, obj):
    """Atomic JSON write (Dropbox-friendly: never a half-written file)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
    with os.fdopen(fd, "w") as fh:
        json.dump(obj, fh, indent=1, default=str)
    os.chmod(tmp, 0o644)  # mkstemp creates 0600
    os.replace(tmp, path)


def read_json(path, default=None):
    try:
        with open(path) as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return default


def make_version_id(source, origin="run", ts=None, ticker=None):
    ts = ts or datetime.now()
    suffix = {"run": "", "import": "-import", "app_edit": "-edit"}[origin]
    vid = f"{ts:%Y%m%d-%H%M%S}_{source}{suffix}"
    return f"{ticker.upper()}_{vid}" if ticker else vid


def parse_version_id(vid):
    """-> (stamp, source, origin). Accepts TICKER_stamp_source[-kind] and stamp_source[-kind]."""
    parts = vid.split("_")
    if len(parts) >= 3 and not parts[0][:8].isdigit():
        parts = parts[1:]
    stamp, rest = parts[0], "_".join(parts[1:])
    source, _, kind = rest.partition("-")
    origin = {"": "run", "import": "import", "edit": "app_edit"}.get(kind.split("-")[0], "run")
    return stamp, source, origin


def version_stamp(vid):
    return parse_version_id(vid)[0]


def version_dir(ticker, vid):
    return MODELS / ticker.upper() / vid


def find_version_dir(vid):
    for p in MODELS.glob(f"*/{vid}"):
        if p.is_dir():
            return p
    return None


def find_run_dir(vid):
    """A model version dir, or a screener agent-job dir."""
    p = find_version_dir(vid)
    if p is None and vid and "/" not in vid and (AGENT_RUNS / vid).is_dir():
        p = AGENT_RUNS / vid
    return p


def run_json_paths():
    yield from MODELS.glob("*/*/run.json")
    yield from AGENT_RUNS.glob("*/run.json")


def vendor_dcfkit(dest):
    """Copy dcfkit (engine, schema, validator, guide, example) into a run dir."""
    src = ROOT / "dcfkit"
    shutil.copytree(src, Path(dest) / "dcfkit", dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))


def create_version(ticker, source, origin="run", *, ts=None, vendor=True, run_meta=None):
    """Create a fresh version directory and its run.json; returns (vid, path)."""
    ticker = ticker.upper()
    ts = ts or datetime.now()
    vid = make_version_id(source, origin, ts, ticker=ticker)
    path = version_dir(ticker, vid)
    n = 1
    while path.exists() or find_version_dir(vid) is not None:  # same-second collision
        vid = make_version_id(source, origin, ts, ticker=ticker) + f"-{n}"
        path = version_dir(ticker, vid)
        n += 1
    path.mkdir(parents=True)
    if vendor:
        vendor_dcfkit(path)
    meta = {
        "id": vid, "ticker": ticker, "source": source, "origin": origin,
        "kind": "import" if origin == "import" else "new",
        "status": "queued", "created_at": now_iso(),
        "started_at": None, "finished_at": None,
        "cli": None, "model": None, "effort": None, "pid": None,
        "parent_version": None, "instructions": None,
        "exit_code": None, "error": None,
        "usage": {}, "attempts": [], "legacy": None,
    }
    meta.update(run_meta or {})
    write_json(path / "run.json", meta)
    return vid, path


def update_run(path, **fields):
    path = Path(path)
    meta = read_json(path / "run.json", {}) or {}
    meta.update(fields)
    write_json(path / "run.json", meta)
    t = meta.get("ticker")
    if t and not t.startswith("_"):      # agent jobs use "_SCREENER"; never wipe the whole cache
        STORE.invalidate(t)
    return meta


# --------------------------------------------------------------------------
# prices
# --------------------------------------------------------------------------

def get_price(ticker):
    return read_json(PRICES / f"{ticker.upper()}.json")


def set_price(ticker, price, ts, source):
    write_json(PRICES / f"{ticker.upper()}.json", {"price": price, "ts": ts, "source": source})
    STORE.invalidate(ticker)


# --------------------------------------------------------------------------
# index
# --------------------------------------------------------------------------

def _summary(path):
    meta = read_json(path / "run.json", {}) or {}
    vid = path.name
    stamp, source, origin = parse_version_id(vid)
    ticker = path.parent.name
    s = {
        "version_id": vid, "ticker": ticker,
        "source": meta.get("source") or source, "origin": meta.get("origin") or origin,
        "status": meta.get("status", "unknown"), "kind": meta.get("kind"),
        "created_at": meta.get("created_at"), "finished_at": meta.get("finished_at"),
        "cli": meta.get("cli"), "model": meta.get("model"), "effort": meta.get("effort"),
        "parent_version": meta.get("parent_version"), "error": meta.get("error"),
        "usage": meta.get("usage") or {},
        "has_dcf": False, "company": None, "as_of": None, "quality": "verified",
        "validation": None, "reproducibility": None, "derived": None,
        "has_model_py": (path / "model.py").exists() or (path / "legacy_adapter.py").exists(),
        "superseded": False, "latest": False,
    }
    val = read_json(path / "validation.json")
    if val:
        s["validation"] = {"ok": val.get("ok"), **(val.get("summary") or {})}
        s["reproducibility"] = (val.get("reproduction") or {}).get("grade")
    d = read_json(path / "dcf.json")
    if isinstance(d, dict) and d.get("scenarios"):
        s["has_dcf"] = True
        prov = d.get("provenance") or {}
        s["company"] = prov.get("company")
        s["as_of"] = (d.get("basis") or {}).get("as_of")
        imp = prov.get("imported_from") or {}
        s["quality"] = imp.get("quality", "verified")
        if origin == "import" and imp.get("source"):
            s["source"] = imp["source"]
        price = get_price(ticker)
        try:
            s["derived"] = E.derive(d, compare_price=(price or {}).get("price"))
        except Exception as exc:  # derived metrics must never break the index
            s["derived"] = {"error": f"{type(exc).__name__}: {exc}"}
        if s["reproducibility"] is None:
            try:
                s["reproducibility"] = E.reproduce(d)["grade"]
            except Exception:
                s["reproducibility"] = "none"
    return s


def _fingerprint(ticker):
    """Cheap change detector: mtimes of every version's key files + the price file."""
    parts = []
    tdir = MODELS / ticker
    try:
        for v in sorted(tdir.iterdir()):
            if v.is_dir():
                for f in ("run.json", "dcf.json", "validation.json"):
                    try:
                        parts.append((v.name, f, (v / f).stat().st_mtime_ns))
                    except OSError:
                        pass
    except OSError:
        pass
    try:
        parts.append(("price", (PRICES / f"{ticker}.json").stat().st_mtime_ns))
    except OSError:
        pass
    return hash(tuple(parts))


class Store:
    """In-memory index over data/models, rebuilt per ticker whenever its files
    change on disk (so CLI importers / other processes show up without a restart)."""

    def __init__(self):
        self._lock = threading.RLock()
        self._tickers: dict[str, list[dict]] = {}
        self._fp: dict[str, int] = {}
        self._loaded = False

    def invalidate(self, ticker=None):
        with self._lock:
            if ticker is None:
                self._tickers.clear()
                self._fp.clear()
                self._loaded = False
            else:
                self._tickers.pop(ticker.upper(), None)

    def _fresh(self, t):
        fp = _fingerprint(t)
        if t not in self._tickers or self._fp.get(t) != fp:
            self._tickers[t] = self._load_ticker(t)
            self._fp[t] = fp
        return self._tickers[t]

    def _load_ticker(self, ticker):
        tdir = MODELS / ticker
        versions = []
        if tdir.is_dir():
            for p in sorted(tdir.iterdir()):
                if p.is_dir() and not p.name.startswith("."):
                    versions.append(_summary(p))
        # latest per source among versions that have a dcf.json
        by_src: dict[str, list[dict]] = {}
        for v in versions:
            if v["has_dcf"]:
                by_src.setdefault(v["source"], []).append(v)
        for src, vs in by_src.items():
            vs.sort(key=lambda v: ((v["as_of"] or ""), version_stamp(v["version_id"])))
            for v in vs[:-1]:
                v["superseded"] = True
            vs[-1]["latest"] = True
        versions.sort(key=lambda v: version_stamp(v["version_id"]), reverse=True)
        return versions

    def tickers(self):
        with self._lock:
            MODELS.mkdir(parents=True, exist_ok=True)
            present = sorted(p.name for p in MODELS.iterdir() if p.is_dir())
            for t in list(self._tickers):
                if t not in present:
                    self._tickers.pop(t, None)
            for t in present:
                self._fresh(t)
            return dict(self._tickers)

    def versions(self, ticker):
        ticker = ticker.upper()
        with self._lock:
            return self._fresh(ticker)

    def summary(self):
        out = []
        for t, versions in self.tickers().items():
            latest = {src: None for src in SOURCES}
            company = None
            for v in versions:
                if v["latest"]:
                    latest[v["source"]] = v
                company = company or v["company"]
            price = get_price(t)
            active = [v for v in versions if v["status"] in ("queued", "running", "validating", "fixing")]
            building = {src: any(v["source"] == src for v in active) for src in SOURCES}
            out.append({"ticker": t, "company": company, "compare_price": price,
                        "latest": latest, "versions_count": len(versions),
                        "active_runs": len(active), "building": building})
        return out

    def get(self, vid):
        path = find_version_dir(vid)
        if path is None:
            return None
        for v in self.versions(path.parent.name):
            if v["version_id"] == vid:
                return v
        return _summary(path)


STORE = Store()


def load_dcf(vid, *, with_derived=True):
    path = find_version_dir(vid)
    if path is None:
        return None
    d = read_json(path / "dcf.json")
    if d is None:
        return None
    if with_derived:
        price = get_price(path.parent.name)
        try:
            d["derived"] = E.derive(d, compare_price=(price or {}).get("price"))
        except Exception as exc:
            d["derived"] = {"error": str(exc)}
    return d


def clone(obj):
    return copy.deepcopy(obj)
