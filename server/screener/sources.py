"""Free data sources: Nasdaq listings + earnings calendar, SEC ticker map,
XBRL frames and per-company concepts."""
from __future__ import annotations

import re
from datetime import date, timedelta

from server.screener.http import get_json

HOUR = 3600
DAY = 24 * HOUR

# --------------------------------------------------------------------------
# Nasdaq
# --------------------------------------------------------------------------

EXCLUDE = re.compile(r"\b(warrants?|rights?|units?|preferred|notes?|debentures?|subordinated|etns?|"
                     r"baby bonds?)\b|%|depositary shares,? each representing|depositary shares representing",
                     re.I)
FINANCIAL_INDUSTRY = re.compile(r"bank|savings institution|insurer|insurance|real estate investment trust|"
                                r"finance companies|investment managers|finance: consumer|brokers|"
                                r"specialty insurers|life insurance|reit", re.I)


def _num(s):
    if s in (None, "", "NA", "N/A"):
        return None
    try:
        return float(str(s).replace("$", "").replace(",", "").replace("%", ""))
    except ValueError:
        return None


DERIVATIVE = re.compile(r"\b(warrants?|rights?|units?)\b", re.I)
COMMON_LABEL = re.compile(r"common stock|ordinary shares|capital stock|common shares", re.I)


def security_kind(name):
    n = (name or "").lower()
    if COMMON_LABEL.search(n):
        if DERIVATIVE.search(n):
            return "other"
    elif EXCLUDE.search(n):
        return "other"
    if "depositary" in n or re.search(r"\bad[rs]\b", n):
        return "adr"
    return "common"


def normalize_symbol(sym):
    """Nasdaq 'BRK/B' -> 'BRK.B' (app/model convention)."""
    return (sym or "").strip().upper().replace("/", ".").replace("^", "-P")


def sec_key(sym):
    """Key used to match SEC company_tickers ('BRK-B') and our symbols ('BRK.B')."""
    return (sym or "").upper().replace(".", "-").replace("/", "-")


def nasdaq_listings(ttl=6 * HOUR):
    d = get_json("nasdaq", "https://api.nasdaq.com/api/screener/stocks",
                 params={"tableonly": "true", "download": "true"}, cache_key="nasdaq/listings", ttl=ttl)
    rows = ((d or {}).get("data") or {}).get("rows") or []
    out = []
    for r in rows:
        sym = normalize_symbol(r.get("symbol"))
        if not sym:
            continue
        industry = r.get("industry") or ""
        sector = r.get("sector") or ""
        out.append({
            "symbol": sym, "name": r.get("name") or "", "price": _num(r.get("lastsale")),
            "pct_change": _num(r.get("pctchange")), "volume": _num(r.get("volume")),
            "market_cap": (_num(r.get("marketCap")) or 0) / 1e6 or None,      # $M
            "country": r.get("country") or "", "ipo_year": r.get("ipoyear") or None,
            "sector": sector, "industry": industry,
            "kind": security_kind(r.get("name")),
            "financial": bool(FINANCIAL_INDUSTRY.search(industry)),
        })
    return out


def earnings_calendar(days=14, start=None):
    """symbol -> {date, time, eps_forecast, n_estimates, fiscal_quarter} for the next `days` weekdays."""
    start = start or date.today()
    out = {}
    d = start
    seen = 0
    while seen < days:
        if d.weekday() < 5:
            seen += 1
            ttl = None if d < date.today() else 12 * HOUR
            data = get_json("nasdaq", "https://api.nasdaq.com/api/calendar/earnings",
                            params={"date": d.isoformat()}, cache_key=f"nasdaq/earnings/{d.isoformat()}",
                            ttl=ttl if ttl is not None else 10 * 365 * DAY)
            for r in ((data or {}).get("data") or {}).get("rows") or []:
                sym = normalize_symbol(r.get("symbol"))
                if sym and sym not in out:
                    out[sym] = {"date": d.isoformat(), "time": (r.get("time") or "").replace("time-", ""),
                                "eps_forecast": _num(r.get("epsForecast")),
                                "n_estimates": _num(r.get("noOfEsts")),
                                "fiscal_quarter": r.get("fiscalQuarterEnding")}
        d += timedelta(days=1)
    return out


# --------------------------------------------------------------------------
# SEC
# --------------------------------------------------------------------------

def sec_tickers(ttl=7 * DAY):
    """sec_key(ticker) -> {cik, title}."""
    d = get_json("sec", "https://www.sec.gov/files/company_tickers.json", cache_key="sec/company_tickers", ttl=ttl)
    out = {}
    for v in (d or {}).values():
        out[sec_key(v["ticker"])] = {"cik": int(v["cik_str"]), "title": v.get("title")}
    return out


def frame(taxonomy, tag, unit, period, *, ttl):
    """All companies' value of one tag for one period. Returns list of rows or []."""
    d = get_json("sec", f"https://data.sec.gov/api/xbrl/frames/{taxonomy}/{tag}/{unit}/{period}.json",
                 cache_key=f"sec/frames/{taxonomy}/{tag}/{unit}/{period}", ttl=ttl)
    return (d or {}).get("data") or []


def company_concept(cik, tag, *, taxonomy="us-gaap", ttl=7 * DAY):
    d = get_json("sec", f"https://data.sec.gov/api/xbrl/companyconcept/CIK{cik:010d}/{taxonomy}/{tag}.json",
                 cache_key=f"sec/concept/{cik}/{tag}", ttl=ttl)
    return d or {}
