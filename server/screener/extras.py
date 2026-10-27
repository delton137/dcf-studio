"""Shortlist-scale background jobs:

* enrich -- Yahoo daily chart (1y): 52-week high/low, % below high, 3/6/12m returns.
* refine -- SEC companyconcept: exact TTM cash flow (FY + YTD - prior-year YTD),
  which frames can't give because 10-Qs report cash flow year-to-date.

Progress lives in data/screener/status.json under jobs.<name>.
"""
from __future__ import annotations

import threading
from datetime import date, datetime, timedelta, timezone

from server.screener.http import get_json
from server.screener.refresh import STATUS, STATUS_LOCK
from server.screener.screens import ENRICH, REFINE
from server.screener.sources import DAY, company_concept
from server.store import now_iso, read_json, write_json

MAX_SYMBOLS = 200
_threads: dict[str, threading.Thread] = {}
_lock = threading.Lock()


def _job(name, **kw):
    with STATUS_LOCK:
        st = read_json(STATUS, {}) or {}
        jobs = st.setdefault("jobs", {})
        jobs.setdefault(name, {}).update(kw)
        write_json(STATUS, st)


def _start(name, fn, items):
    with _lock:
        t = _threads.get(name)
        if t and t.is_alive():
            return False
        _job(name, state="running", done=0, total=len(items), started_at=now_iso(), error=None)
        th = threading.Thread(target=_wrap, args=(name, fn, items), daemon=True)
        _threads[name] = th
        th.start()
        return True


def _wrap(name, fn, items):
    errors = []
    for i, it in enumerate(items):
        try:
            fn(it)
        except Exception as exc:
            errors.append(f"{it}: {type(exc).__name__}: {exc}"[:200])
        if i % 5 == 0 or i == len(items) - 1:
            _job(name, done=i + 1)
    _job(name, state="idle", finished_at=now_iso(), errors=errors[-20:])
    from server.screener import screens
    screens._cov["data"] = None


# --------------------------------------------------------------------------
# enrich (Yahoo)
# --------------------------------------------------------------------------

def enrich_one(symbol):
    ysym = symbol.replace(".", "-")
    d = get_json("yahoo", f"https://query1.finance.yahoo.com/v8/finance/chart/{ysym}",
                 params={"range": "1y", "interval": "1d"}, cache_key=f"yahoo/chart/{ysym}", ttl=DAY * 0.8)
    res = ((d or {}).get("chart") or {}).get("result") or []
    if not res:
        return
    r = res[0]
    meta = r.get("meta") or {}
    closes = [c for c in ((r.get("indicators") or {}).get("quote") or [{}])[0].get("close") or [] if c]
    ts = r.get("timestamp") or []
    price = meta.get("regularMarketPrice") or (closes[-1] if closes else None)
    hi = meta.get("fiftyTwoWeekHigh") or (max(closes) if closes else None)
    lo = meta.get("fiftyTwoWeekLow") or (min(closes) if closes else None)

    allc = ((r.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    series = [(t, c) for t, c in zip(ts, allc) if c]

    def ret(days):
        if not series or not price:
            return None
        target = series[-1][0] - days * 86400
        base = next((c for t, c in series if t >= target), None)
        return (price / base - 1) if base else None

    write_json(ENRICH / f"{symbol}.json", {
        "symbol": symbol, "price": price, "high_52w": hi, "low_52w": lo,
        "pct_below_high": (1 - price / hi) if (price and hi) else None,
        "mom_3m": ret(91), "mom_6m": ret(182), "mom_12m": ret(360),
        "enriched_at": now_iso()})


def start_enrich(symbols):
    syms = list(dict.fromkeys(s.upper() for s in symbols))[:MAX_SYMBOLS]
    return _start("enrich", enrich_one, syms), len(syms)


# --------------------------------------------------------------------------
# refine (SEC companyconcept)
# --------------------------------------------------------------------------

CONCEPTS = {
    "ocf": ["NetCashProvidedByUsedInOperatingActivities"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
    "sbc": ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
}


def _d(s):
    return date.fromisoformat(s[:10])


def exact_ttm(facts):
    """facts: companyconcept units.USD list. -> {val, basis, end, tag} or None."""
    fs = [f for f in facts if f.get("start") and f.get("form", "").startswith(("10-K", "10-Q", "20-F", "40-F"))]
    if not fs:
        return None
    for f in fs:
        f["_s"], f["_e"] = _d(f["start"]), _d(f["end"])
        f["_len"] = (f["_e"] - f["_s"]).days
    annual = sorted((f for f in fs if 350 <= f["_len"] <= 380), key=lambda f: (f["_e"], f.get("filed", "")))
    if not annual:
        return None
    A = annual[-1]
    if (date.today() - A["_e"]).days > 500:
        return None   # tag abandoned by the filer (e.g. NVDA moved capex to PaymentsToAcquireProductiveAssets)
    ytd = sorted((f for f in fs if abs((f["_s"] - (A["_e"] + timedelta(days=1))).days) <= 10
                  and 60 <= f["_len"] <= 300), key=lambda f: (f["_e"], f.get("filed", "")))
    if ytd:
        Y = ytd[-1]
        prior = [f for f in fs if abs((f["_s"] - A["_s"]).days) <= 10 and abs(f["_len"] - Y["_len"]) <= 15
                 and f["_e"] < A["_e"]]
        if prior:
            P = max(prior, key=lambda f: f.get("filed", ""))
            return {"val": A["val"] + Y["val"] - P["val"], "basis": "TTM-exact", "end": Y["end"]}
    return {"val": A["val"], "basis": "FY", "end": A["end"]}


def refine_cik(cik):
    out = {"cik": cik, "refined_at": now_iso()}
    for key, tags in CONCEPTS.items():
        for tag in tags:
            d = company_concept(int(cik), tag)
            facts = ((d or {}).get("units") or {}).get("USD") or []
            v = exact_ttm(facts)
            if v:
                v["tag"] = tag
                if key == "capex":
                    v["val"] = abs(v["val"])
                out[key] = v
                break
    write_json(REFINE / f"{cik}.json", out)


def start_refine(symbols, rows_by_symbol):
    ciks = []
    for s in symbols:
        r = rows_by_symbol.get(s.upper())
        if r and r.get("cik") is not None and str(r["cik"]) not in ciks:
            ciks.append(str(r["cik"]))
    ciks = ciks[:MAX_SYMBOLS]
    return _start("refine", refine_cik, ciks), len(ciks)


def job_status():
    return (read_json(STATUS, {}) or {}).get("jobs", {})
