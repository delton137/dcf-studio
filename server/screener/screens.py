"""Screen definitions, the filter engine (the one implementation -- the UI only
renders), presets and saved screens.

screen = {universe, filters: [{f, op, v}], sort: [{f, dir}], params: {r, g_t, target_margin}}
Percent fields are fractions (0.15 = 15%).
"""
from __future__ import annotations

import re
import time

from server.screener import metrics as M
from server.screener import table as T
from server.screener import universes as U
from server.store import DATA, read_json, write_json

SCREENS = DATA / "screener" / "screens"
ENRICH = DATA / "screener" / "enrich"
REFINE = DATA / "screener" / "refine"

# key, label, group, type, description
FIELDS = [
    ("symbol", "Symbol", "Identity", "text", ""),
    ("name", "Name", "Identity", "text", ""),
    ("sector", "Sector", "Identity", "text", "Nasdaq sector"),
    ("industry", "Industry", "Identity", "text", "Nasdaq industry"),
    ("country", "Country", "Identity", "text", ""),
    ("price", "Price", "Identity", "price", "last sale (Nasdaq)"),
    ("pct_change", "Day %", "Identity", "pctpt", "today's % change (percentage points)"),
    ("market_cap", "Mkt cap", "Identity", "money", "$M (Nasdaq, company total)"),
    ("ev", "EV", "Valuation", "money", "market cap + debt + minority + preferred − cash ($M)"),
    ("ev_sales", "EV/Sales", "Valuation", "mult", ""),
    ("ev_ebit", "EV/EBIT", "Valuation", "mult", "null when EBIT ≤ 0"),
    ("ev_ebitda", "EV/EBITDA", "Valuation", "mult", ""),
    ("pe", "P/E", "Valuation", "mult", "market cap / net income (TTM; FY fallback); null when earnings ≤ 0"),
    ("peg", "PEG (hist.)", "Valuation", "num",
     "P/E / historical net-income growth in percentage points (TTM vs prior TTM; FY fallback). "
     "Earnings-growth proxy, not forward EPS growth; null when earnings or growth ≤ 0 or data is missing."),
    ("fcf_yield", "FCF yield", "Valuation", "pct", "TTM FCF / market cap"),
    ("net_cash_pct", "Net cash % mcap", "Valuation", "pct", "(cash − debt) / market cap"),
    ("implied_growth", "Implied FCF growth", "Reverse DCF", "pct",
     "constant 10-yr FCF growth that justifies EV (r, g_T per screen)"),
    ("implied_gap", "Implied − actual growth", "Reverse DCF", "pct",
     "implied FCF growth minus TTM revenue growth; negative = price asks for less than delivered"),
    ("implied_rev_cagr", "Implied revenue CAGR", "Reverse DCF", "pct",
     "cash-burners: revenue CAGR needed if FCF margin ramps to the target by year 10"),
    ("revenue", "Revenue (TTM)", "Growth & quality", "money", "$M"),
    ("rev_growth", "Revenue growth", "Growth & quality", "pct", "TTM vs prior TTM"),
    ("op_margin", "Op. margin", "Growth & quality", "pct", "EBIT / revenue"),
    ("fcf", "FCF", "Growth & quality", "money", "OCF − capex ($M, levered)"),
    ("fcf_margin", "FCF margin", "Growth & quality", "pct", ""),
    ("rule_of_40", "Rule of 40", "Growth & quality", "num", "100 × (growth + FCF margin)"),
    ("sbc_pct", "SBC % rev", "Growth & quality", "pct", ""),
    ("dilution", "Share dilution YoY", "Growth & quality", "pct", "diluted weighted shares vs a year ago"),
    ("earnings_date", "Next earnings", "Catalysts", "date", "Nasdaq calendar, next 14 weekdays"),
    ("days_to_earnings", "Days to earnings", "Catalysts", "int", ""),
    ("eps_forecast", "EPS forecast", "Catalysts", "price", ""),
    ("pct_below_high", "% below 52w high", "Catalysts", "pct", "needs 'Enrich' (Yahoo)"),
    ("mom_3m", "3m return", "Catalysts", "pct", "needs 'Enrich'"),
    ("mom_12m", "12m return", "Catalysts", "pct", "needs 'Enrich'"),
    ("n_models", "# DCF models", "Coverage", "int", "DCF Studio models (latest per CLI)"),
    ("model_upside", "Model upside (median)", "Coverage", "pct", "median latest-model upside vs price"),
    ("model_age_days", "Model age (days)", "Coverage", "int", "days since the newest model's as_of"),
    ("revenue_basis", "Revenue basis", "Data", "text", "TTM | FY"),
    ("cashflow_basis", "Cash-flow basis", "Data", "text", "FY+Q1 | FY | TTM-exact (after Refine)"),
    ("data_age_days", "Data age (days)", "Data", "int", "days since the latest fiscal period end"),
    ("flags", "Flags", "Data", "flags", "data-quality flags"),
]
FIELD_KEYS = {f[0] for f in FIELDS}

BAD_FLAGS = ["financial", "stale_period", "shares_scale", "no_fundamentals", "ev_nonpositive"]
PRESETS = [
    {"id": "cheap_vs_implied", "name": "Cheap vs implied growth", "group": "Valuation",
     "desc": "FCF-positive growers whose price implies less FCF growth than revenue is delivering.",
     "screen": {"universe": "us1b", "filters": [
         {"f": "fcf", "op": ">", "v": 0}, {"f": "fcf_margin", "op": ">=", "v": 0.05},
         {"f": "rev_growth", "op": ">=", "v": 0}, {"f": "implied_gap", "op": "<=", "v": -0.05},
         {"f": "flags", "op": "no_flag", "v": BAD_FLAGS}], "sort": [{"f": "implied_gap", "dir": "asc"}]}},
    {"id": "low_ev_ebit", "name": "Low EV/EBIT, real FCF", "group": "Valuation",
     "desc": "Cheap on EBIT with a real free-cash-flow yield and no collapsing revenue.",
     "screen": {"universe": "us1b", "filters": [
         {"f": "ev_ebit", "op": "between", "v": [0, 12]}, {"f": "fcf_yield", "op": ">=", "v": 0.06},
         {"f": "rev_growth", "op": ">=", "v": -0.05}, {"f": "flags", "op": "no_flag", "v": BAD_FLAGS}],
         "sort": [{"f": "fcf_yield", "dir": "desc"}]}},
    {"id": "quality", "name": "Quality compounders", "group": "Quality / growth",
     "desc": "Growth ≥ 8%, op. margin ≥ 15%, FCF margin ≥ 12%, low SBC and dilution.",
     "screen": {"universe": "us1b", "filters": [
         {"f": "market_cap", "op": ">=", "v": 2000}, {"f": "rev_growth", "op": ">=", "v": 0.08},
         {"f": "op_margin", "op": ">=", "v": 0.15}, {"f": "fcf_margin", "op": ">=", "v": 0.12},
         {"f": "sbc_pct", "op": "<=", "v": 0.08}, {"f": "dilution", "op": "<=", "v": 0.02},
         {"f": "flags", "op": "no_flag", "v": BAD_FLAGS}], "sort": [{"f": "fcf_yield", "dir": "desc"}]}},
    {"id": "rule_of_40", "name": "Rule of 40", "group": "Quality / growth",
     "desc": "Growth + FCF margin ≥ 40 with positive FCF and limited dilution.",
     "screen": {"universe": "us1b", "filters": [
         {"f": "rule_of_40", "op": ">=", "v": 40}, {"f": "fcf_margin", "op": ">", "v": 0},
         {"f": "rev_growth", "op": ">=", "v": 0.15}, {"f": "dilution", "op": "<=", "v": 0.05},
         {"f": "flags", "op": "no_flag", "v": BAD_FLAGS}], "sort": [{"f": "rule_of_40", "dir": "desc"}]}},
    {"id": "net_cash_growers", "name": "Net-cash growers", "group": "Quality / growth",
     "desc": "Net cash ≥ 15% of market cap, growing ≥ 10%, FCF-positive.",
     "screen": {"universe": "us1b", "filters": [
         {"f": "net_cash_pct", "op": ">=", "v": 0.15}, {"f": "rev_growth", "op": ">=", "v": 0.10},
         {"f": "fcf", "op": ">", "v": 0}, {"f": "flags", "op": "no_flag", "v": BAD_FLAGS}],
         "sort": [{"f": "rev_growth", "dir": "desc"}]}},
    {"id": "earnings_soon", "name": "Earnings in next 7 days", "group": "Catalysts & themes",
     "desc": "Reporting within 7 days (Nasdaq calendar).",
     "screen": {"universe": "us1b", "filters": [{"f": "days_to_earnings", "op": "between", "v": [0, 7]}],
                "sort": [{"f": "days_to_earnings", "dir": "asc"}, {"f": "market_cap", "dir": "desc"}]}},
    {"id": "beaten_down_quality", "name": "Beaten-down quality", "group": "Catalysts & themes",
     "desc": "Profitable growers ≥ 35% below their 52-week high (run Enrich on the list first).",
     "screen": {"universe": "us1b", "filters": [
         {"f": "op_margin", "op": ">=", "v": 0.10}, {"f": "fcf_margin", "op": ">=", "v": 0.08},
         {"f": "rev_growth", "op": ">=", "v": 0}, {"f": "pct_below_high", "op": ">=", "v": 0.35},
         {"f": "flags", "op": "no_flag", "v": BAD_FLAGS}], "sort": [{"f": "pct_below_high", "dir": "desc"}]},
     "needs_enrich": True},
]


# --------------------------------------------------------------------------
# filter engine
# --------------------------------------------------------------------------

def _match(row, flt):
    f, op, v = flt.get("f"), flt.get("op"), flt.get("v")
    x = row.get(f)
    if op == "is_null":
        return x is None
    if op == "not_null":
        return x is not None
    if op == "is_true":
        return bool(x)
    if op == "is_false":
        return not x
    if op in ("has_flag", "no_flag"):
        flags = set(row.get("flags") or [])
        want = set(v if isinstance(v, list) else [v])
        hit = bool(flags & want) or any(fl.startswith(w + ":") for fl in flags for w in want)
        return hit if op == "has_flag" else not hit
    if op in ("in", "not_in"):
        vals = v if isinstance(v, list) else [v]
        hit = x in vals
        return hit if op == "in" else not hit
    if op == "contains":
        return x is not None and str(v).lower() in str(x).lower()
    if x is None:
        return False
    try:
        if op == ">=":
            return x >= v
        if op == "<=":
            return x <= v
        if op == ">":
            return x > v
        if op == "<":
            return x < v
        if op == "between":
            lo, hi = v
            return (lo is None or x >= lo) and (hi is None or x <= hi)
        if op == "==":
            return x == v
    except TypeError:
        return False
    raise ValueError(f"unknown operator {op!r}")


# --------------------------------------------------------------------------
# coverage (DCF Studio models)
# --------------------------------------------------------------------------

_cov = {"t": 0, "data": None}


def coverage():
    if _cov["data"] is not None and time.time() - _cov["t"] < 30:
        return _cov["data"]
    from datetime import date

    from server.prices import quote_symbol
    from server.store import STORE
    out = {}
    for t in STORE.summary():
        latest = [v for v in t["latest"].values() if v]
        if not latest:
            continue
        sym = quote_symbol(t["ticker"])
        ups = sorted(x for x in ((v.get("derived") or {}).get("upside_compare") if (v.get("derived") or {}).get(
            "upside_compare") is not None else (v.get("derived") or {}).get("upside_model") for v in latest)
                     if x is not None)
        asofs = [v.get("as_of") for v in latest if v.get("as_of")]
        out[sym] = {
            "ticker": t["ticker"], "n_models": len(latest),
            "has_claude": bool(t["latest"].get("claude")), "has_codex": bool(t["latest"].get("codex")),
            "has_grok": bool(t["latest"].get("grok")), "has_agy": bool(t["latest"].get("agy")),
            "model_upside": ups[len(ups) // 2] if ups else None,
            "model_age_days": (date.today() - date.fromisoformat(max(asofs)[:10])).days if asofs else None,
        }
    _cov.update(t=time.time(), data=out)
    return out


# --------------------------------------------------------------------------
# query
# --------------------------------------------------------------------------

TABLE_FLAGS = ("multi_class", "secondary_class")   # added by refresh.build_table, not by metrics.compute


def _recompute(row, fund, params):
    listing = {"market_cap": row.get("market_cap"), "price": row.get("price"), "financial": row.get("financial")}
    new = dict(row)
    new.update(M.compute(listing, fund, params))
    keep = [f for f in row.get("flags") or [] if f in TABLE_FLAGS]
    new["flags"] = sorted(set((new.get("flags") or []) + keep))
    return new


def rows_with_extras(params=None):
    """Table rows with enrichment, refinements, coverage and (optional) custom params applied."""
    t = T.table()
    rows = t.get("rows") or []
    defaults = M.DEFAULT_PARAMS
    custom = {k: v for k, v in (params or {}).items() if k in defaults and v is not None and v != defaults[k]}
    funds = T.fundamentals() if (custom or REFINE.exists() or any("peg" not in r for r in rows)) else {}
    refined = {}
    if REFINE.exists():
        for p in REFINE.glob("*.json"):
            d = read_json(p)
            if isinstance(d, dict):
                refined[p.stem] = d
    enrich = {}
    if ENRICH.exists():
        for p in ENRICH.glob("*.json"):
            d = read_json(p)
            if isinstance(d, dict):
                enrich[p.stem] = d
    cov = coverage()
    out = []
    for r in rows:
        cik = str(r.get("cik")) if r.get("cik") is not None else None
        if cik and (custom or cik in refined or "peg" not in r):
            fund = dict(funds.get(cik) or {})
            if cik in refined:
                for k in ("ocf", "capex", "sbc"):
                    if refined[cik].get(k):
                        fund[k] = refined[cik][k]
            if fund:
                r = _recompute(r, fund, {**defaults, **custom})
                if cik in refined:
                    r["cashflow_basis"] = (refined[cik].get("ocf") or {}).get("basis") or r.get("cashflow_basis")
        e = enrich.get(r["symbol"])
        if e:
            r = {**r, **{k: e.get(k) for k in ("high_52w", "low_52w", "pct_below_high", "mom_3m", "mom_6m",
                                               "mom_12m", "enriched_at")}}
        c = cov.get(r["symbol"])
        if c:
            r = {**r, **c}
        out.append(r)
    return t, out


def query(screen, *, limit=None):
    screen = screen or {}
    params = screen.get("params") or {}
    t, rows = rows_with_extras(params)
    from server.runner import cfg
    model_syms = [s for s in coverage()]
    rows, unmatched = U.resolve(screen.get("universe"), rows,
                                min_mcap=float(cfg("screener", "min_market_cap", 1000)), model_symbols=model_syms)
    total = len(rows)
    for flt in screen.get("filters") or []:
        if flt.get("f") not in FIELD_KEYS and flt.get("op") not in ("has_flag", "no_flag"):
            raise ValueError(f"unknown field {flt.get('f')!r}")
        rows = [r for r in rows if _match(r, flt)]
    rows = sort_rows(rows, screen.get("sort") or [{"f": "market_cap", "dir": "desc"}])
    matched = len(rows)
    if limit:
        rows = rows[:limit]
    return {"asof": t.get("asof"), "total": total, "matched": matched, "rows": rows, "unmatched": unmatched,
            "params": {**M.DEFAULT_PARAMS, **{k: v for k, v in params.items() if v is not None}}}


def sort_rows(rows, keys):
    """Stable multi-key sort, None always last."""
    rows = list(rows)
    for k in reversed(keys or []):
        f, desc = k.get("f"), k.get("dir", "desc") == "desc"
        nums = [r for r in rows if isinstance(r.get(f), (int, float)) and not isinstance(r.get(f), bool)]
        others = [r for r in rows if not (isinstance(r.get(f), (int, float)) and not isinstance(r.get(f), bool))
                  and r.get(f) not in (None, "")]
        nulls = [r for r in rows if r.get(f) in (None, "")]
        nums.sort(key=lambda r: r[f], reverse=desc)
        others.sort(key=lambda r: str(r[f]).lower(), reverse=desc)
        rows = nums + others + nulls
    return rows


# --------------------------------------------------------------------------
# saved screens
# --------------------------------------------------------------------------

def _slug(name):
    return re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")[:60] or "screen"


def list_saved():
    if not SCREENS.exists():
        return []
    return [read_json(p) for p in sorted(SCREENS.glob("*.json"))]


def save(name, screen, note=None):
    from server.store import now_iso
    doc = {"slug": _slug(name), "name": name, "note": note, "screen": screen, "saved_at": now_iso()}
    write_json(SCREENS / f"{doc['slug']}.json", doc)
    return doc


def delete(slug):
    p = SCREENS / f"{_slug(slug)}.json"
    if p.exists():
        p.unlink()
        return True
    return False
