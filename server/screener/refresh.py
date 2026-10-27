"""Screener data refresh: Nasdaq listings + SEC frames + earnings -> table.json.

    uv run python -m server.screener.refresh [--force]

Single-flight; progress is written to data/screener/status.json.
"""
from __future__ import annotations

import sys
import threading
import time
import traceback
from datetime import date, datetime, timezone

from server.screener import fundamentals as F
from server.screener import metrics as M
from server.screener import sources as S
from server.store import DATA, read_json, write_json

ROOT = DATA / "screener"
STATUS = ROOT / "status.json"
TABLE = ROOT / "table.json"
FUND = ROOT / "fundamentals.json"
STAGES = ["listings", "tickers", "frames", "fundamentals", "earnings", "table"]

_lock = threading.Lock()
STATUS_LOCK = threading.Lock()   # status.json is shared by refresh and the enrich/refine jobs
_thread: threading.Thread | None = None


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def status():
    st = read_json(STATUS, {}) or {}
    t = read_json(TABLE, None)
    st.setdefault("state", "idle")
    st["table_asof"] = (t or {}).get("asof") if isinstance(t, dict) else None
    st["table_rows"] = len((t or {}).get("rows") or []) if isinstance(t, dict) else 0
    return st


def _set(**kw):
    with STATUS_LOCK:
        st = read_json(STATUS, {}) or {}
        st.update(kw)
        write_json(STATUS, st)


def build_table(listings, tick, funds, earnings, today=None):
    today = today or date.today()
    rows = []
    by_cik = {}
    for L in listings:
        if L["kind"] == "other":
            continue
        t = tick.get(S.sec_key(L["symbol"]))
        cik = t["cik"] if t else None
        fund = funds.get(str(cik)) if cik is not None else None
        r = {
            "symbol": L["symbol"], "name": L["name"], "sector": L["sector"], "industry": L["industry"],
            "country": L["country"], "kind": L["kind"], "price": L["price"], "pct_change": L["pct_change"],
            "volume": L["volume"], "cik": cik, "financial": L["financial"],
        }
        r.update(M.compute(L, fund, today=today))
        e = earnings.get(L["symbol"])
        if e:
            r["earnings_date"] = e["date"]
            r["earnings_time"] = e["time"]
            r["eps_forecast"] = e["eps_forecast"]
            r["days_to_earnings"] = (date.fromisoformat(e["date"]) - today).days
        rows.append(r)
        if cik is not None:
            by_cik.setdefault(cik, []).append(r)
    # several share classes of one company: keep fundamentals on all, mark the most traded as primary
    for cik, rs in by_cik.items():
        if len(rs) > 1:
            rs.sort(key=lambda r: -(r.get("volume") or 0))
            for i, r in enumerate(rs):
                r["flags"] = sorted(set(r["flags"] + ["multi_class"] + ([] if i == 0 else ["secondary_class"])))
    return rows


def run(force=False, progress=None):
    """Synchronous refresh. Returns the status dict."""
    t0 = time.time()
    _set(state="running", stage="listings", done=0, total=len(STAGES), started_at=_now(), error=None, detail="")

    def stage(name, detail=""):
        _set(stage=name, detail=detail, done=STAGES.index(name))
        if progress:
            progress(name, detail)

    try:
        stage("listings")
        listings = S.nasdaq_listings(ttl=0 if force else 6 * 3600)
        stage("tickers")
        tick = S.sec_tickers()
        stage("frames")

        def fp(i, n, what):
            if i % 10 == 0 or i == n:
                _set(stage="frames", frames_done=i, frames_total=n, detail=what)
        frames = F.fetch_all(progress=fp, force=force)
        stage("fundamentals")
        facts, names = F.index_frames(frames)
        p = F.periods()
        funds = {}
        for cik, cf in facts.items():
            funds[str(cik)] = F.build_company(cf, p)
            funds[str(cik)]["entity"] = names.get(cik)
        write_json(FUND, {"asof": _now(), "periods": {k: [x[0] for x in v] for k, v in p.items()},
                          "companies": funds})
        stage("earnings")
        try:
            earnings = S.earnings_calendar(days=14)
        except Exception as exc:  # earnings are optional
            earnings = {}
            _set(earnings_error=str(exc))
        stage("table")
        rows = build_table(listings, tick, funds, earnings)
        with_rev = sum(1 for r in rows if r.get("revenue") is not None)
        write_json(TABLE, {"asof": _now(), "rows": rows, "counts": {
            "listings": len(listings), "rows": len(rows), "with_revenue": with_rev,
            "with_earnings": sum(1 for r in rows if r.get("earnings_date"))}})
        _set(state="idle", stage=None, done=len(STAGES), finished_at=_now(), last_ok=_now(),
             seconds=round(time.time() - t0, 1), detail=f"{len(rows)} rows, {with_rev} with fundamentals")
    except Exception as exc:
        _set(state="error", error=f"{type(exc).__name__}: {exc}", trace=traceback.format_exc()[-3000:],
             finished_at=_now())
    from server.screener import table
    table.invalidate()
    return status()


def start_background(force=False):
    """Start a refresh unless one is running. Returns True if started."""
    global _thread
    with _lock:
        if _thread and _thread.is_alive():
            return False
        _thread = threading.Thread(target=run, kwargs={"force": force}, daemon=True)
        _thread.start()
        return True


def table_age_hours():
    t = read_json(TABLE, None)
    if not isinstance(t, dict) or not t.get("asof"):
        return None
    asof = datetime.fromisoformat(t["asof"])
    return (datetime.now(timezone.utc) - asof).total_seconds() / 3600


if __name__ == "__main__":
    st = run(force="--force" in sys.argv, progress=lambda s, d: print(f"[{s}] {d}", flush=True))
    print({k: st.get(k) for k in ("state", "seconds", "detail", "error")})
