"""In-memory copy of data/screener/table.json + fundamentals.json, reloaded on mtime change."""
from __future__ import annotations

import threading

from server.store import read_json
from server.screener.refresh import FUND, TABLE

_lock = threading.Lock()
_cache = {"mtime": None, "table": None, "fund_mtime": None, "fund": None}


def invalidate():
    with _lock:
        _cache.update(mtime=None, table=None, fund_mtime=None, fund=None)


def table():
    with _lock:
        try:
            m = TABLE.stat().st_mtime_ns
        except OSError:
            return {"asof": None, "rows": [], "counts": {}}
        if _cache["mtime"] != m:
            _cache["table"] = read_json(TABLE, {"asof": None, "rows": []})
            _cache["mtime"] = m
        return _cache["table"]


def fundamentals():
    with _lock:
        try:
            m = FUND.stat().st_mtime_ns
        except OSError:
            return {}
        if _cache["fund_mtime"] != m:
            _cache["fund"] = (read_json(FUND, {}) or {}).get("companies", {})
            _cache["fund_mtime"] = m
        return _cache["fund"]
