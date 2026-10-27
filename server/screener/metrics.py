"""Screening metrics ($M) from a listing row + SEC fundamentals.

Screening-grade: as-reported GAAP, levered FCF, no one-off adjustments; the
fundamentals can lag the price by a quarter or more. Model-grade numbers are
the agents' DCFs.
"""
from __future__ import annotations

from datetime import date

TAX = 0.21
DEFAULT_PARAMS = {"r": 0.10, "g_t": 0.025, "target_margin": 0.15, "years": 10}


def _m(x):
    return None if x is None else x / 1e6


def _v(f, key="val"):
    return None if not f else f.get(key)


def _div(a, b):
    try:
        return a / b if (a is not None and b not in (None, 0)) else None
    except ZeroDivisionError:
        return None


# --------------------------------------------------------------------------
# reverse DCF lite
# --------------------------------------------------------------------------

def dcf_value_growth(f0, g, r, g_t, n=10):
    """PV of FCF growing at g for n years (end-year discounting, full first
    year) plus a Gordon terminal value growing at g_t. Same convention as
    dcfkit.engine with convention='end', stub=1, method='gordon'."""
    x = (1 + g) / (1 + r)
    pv = sum(f0 * x ** t for t in range(1, n + 1))
    fn = f0 * (1 + g) ** n
    return pv + fn * (1 + g_t) / ((r - g_t) * (1 + r) ** n)


def implied_fcf_growth(ev, f0, r, g_t, n=10, lo=-0.5, hi=1.0):
    """Constant growth g that makes the DCF equal EV. None if FCF<=0 or EV<=0;
    returns ('<', lo) / ('>', hi) markers as floats at the bounds via flag."""
    if ev is None or f0 is None or ev <= 0 or f0 <= 0:
        return None, None
    flo, fhi = dcf_value_growth(f0, lo, r, g_t, n) - ev, dcf_value_growth(f0, hi, r, g_t, n) - ev
    if flo > 0:
        return lo, "below_range"
    if fhi < 0:
        return hi, "above_range"
    for _ in range(80):
        mid = (lo + hi) / 2
        fm = dcf_value_growth(f0, mid, r, g_t, n) - ev
        if abs(fm) < 1e-9 * ev:
            break
        if fm > 0:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2, None


def dcf_value_ramp(rev0, m0, c, m_star, r, g_t, n=10):
    """Revenue grows at c; FCF margin ramps linearly from m0 to m_star by year n."""
    pv = 0.0
    fcf_n = 0.0
    for t in range(1, n + 1):
        rev = rev0 * (1 + c) ** t
        m = m0 + (m_star - m0) * t / n
        fcf_n = rev * m
        pv += fcf_n / (1 + r) ** t
    return pv + fcf_n * (1 + g_t) / ((r - g_t) * (1 + r) ** n)


def implied_revenue_cagr(ev, rev0, m0, m_star, r, g_t, n=10, lo=-0.3, hi=1.5):
    if ev is None or rev0 is None or rev0 <= 0 or ev <= 0 or m_star <= 0:
        return None
    f = lambda c: dcf_value_ramp(rev0, m0, c, m_star, r, g_t, n) - ev  # noqa: E731
    flo, fhi = f(lo), f(hi)
    if flo * fhi > 0:
        return None
    for _ in range(80):
        mid = (lo + hi) / 2
        fm = f(mid)
        if (fm > 0) == (fhi > 0):
            hi, fhi = mid, fm
        else:
            lo, flo = mid, fm
    return (lo + hi) / 2


# --------------------------------------------------------------------------
# row metrics
# --------------------------------------------------------------------------

def compute(listing, fund, params=None, today=None):
    p = {**DEFAULT_PARAMS, **(params or {})}
    today = today or date.today()
    row = {}
    flags = list((fund or {}).get("flags") or [])
    mcap = listing.get("market_cap")
    price = listing.get("price")
    row["market_cap"] = mcap
    if not fund or "no_fundamentals" in flags:
        row["flags"] = sorted(set(flags + ["no_fundamentals"]))
        return row
    rev = _m(_v(fund.get("revenue")))
    rev_prior = _m(_v(fund.get("revenue"), "prior"))
    ebit = _m(_v(fund.get("ebit")))
    ni = _m(_v(fund.get("net_income")))
    interest = _m(_v(fund.get("interest")))
    da = _m(_v(fund.get("da")))
    ocf = _m(_v(fund.get("ocf")))
    capex = _m(_v(fund.get("capex")))
    sbc = _m(_v(fund.get("sbc")))
    cash, debt = _m(fund.get("cash")), _m(fund.get("debt"))
    minority, pref = _m(fund.get("minority")), _m(fund.get("preferred"))
    if ocf is not None and capex is not None:
        fcf = ocf - capex
    elif ocf is not None:
        fcf = ocf
        flags.append("fcf_no_capex")   # no capex tag reported: FCF = OCF (overstates for capex-heavy names)
    else:
        fcf = None
    fin = listing.get("financial")
    ev = None
    if mcap is not None and cash is not None and not fin:
        ev = mcap + (debt or 0.0) + (minority or 0.0) + (pref or 0.0) - cash
    # same-basis guard: a cash-flow figure on FY basis vs TTM revenue still compared (documented)
    row.update(
        revenue=rev, revenue_basis=_v(fund.get("revenue"), "basis"), revenue_end=_v(fund.get("revenue"), "end"),
        rev_growth=(rev / rev_prior - 1) if (rev and rev_prior and rev_prior > 0) else None,
        ebit=ebit, op_margin=_div(ebit, rev) if rev and rev > 0 else None,
        net_income=ni, ebitda=(ebit + da) if (ebit is not None and da is not None) else None,
        ocf=ocf, capex=capex, fcf=fcf, cashflow_basis=_v(fund.get("ocf"), "basis"),
        fcf_margin=_div(fcf, rev) if rev and rev > 0 else None,
        fcf_yield=_div(fcf, mcap) if mcap else None,
        sbc=sbc, sbc_pct=_div(sbc, rev) if rev and rev > 0 else None,
        cash=cash, debt=debt, net_cash=(cash - debt) if (cash is not None and debt is not None) else None,
        ev=ev,
    )
    row["net_cash_pct"] = _div(row["net_cash"], mcap) if mcap else None
    row["ev_sales"] = _div(ev, rev) if (ev is not None and rev and rev > 0) else None
    row["ev_ebit"] = _div(ev, ebit) if (ev is not None and ebit and ebit > 0) else None
    row["ev_ebitda"] = _div(ev, row["ebitda"]) if (ev is not None and row["ebitda"] and row["ebitda"] > 0) else None
    row["pe"] = _div(mcap, ni) if (mcap and ni and ni > 0) else None
    # Historical earnings-growth proxy: diluted-share periods in the cached
    # SEC data can differ from income periods, so do not imply EPS precision.
    ni_prior = _m(_v(fund.get("net_income"), "prior"))
    earnings_growth = ni / ni_prior - 1 if (ni and ni > 0 and ni_prior and ni_prior > 0) else None
    row["peg"] = (_div(row["pe"], earnings_growth * 100)
                  if earnings_growth is not None and earnings_growth > 0 else None)
    row["rule_of_40"] = (100 * (row["rev_growth"] + row["fcf_margin"])
                         if (row["rev_growth"] is not None and row["fcf_margin"] is not None) else None)
    ds = fund.get("diluted_shares") or {}
    if ds.get("latest_q") and ds.get("year_ago_q"):
        row["dilution"] = ds["latest_q"] / ds["year_ago_q"] - 1
    else:
        row["dilution"] = None
    row["shares"] = _m(ds.get("latest_q") or fund.get("shares_out"))
    if row["shares"] and price and mcap and abs(price * row["shares"] / mcap - 1) > 0.3:
        flags.append("shares_scale")
    if fin:
        # banks/insurers: operating cash flow and EV are not meaningful
        for k in ("fcf_margin", "fcf_yield", "ev_sales", "ev_ebit", "ev_ebitda", "rule_of_40"):
            row[k] = None
        fcf = None
    # reverse DCF lite
    f0 = None if fcf is None else fcf + (interest or 0.0) * (1 - TAX)
    row["fcf_unlevered"] = f0
    g, edge = implied_fcf_growth(ev, f0, p["r"], p["g_t"], p["years"])
    row["implied_growth"] = g
    row["implied_edge"] = edge
    if g is None and ev is not None and ev > 0 and rev and rev > 0 and row["fcf_margin"] is not None:
        row["implied_rev_cagr"] = implied_revenue_cagr(ev, rev, row["fcf_margin"], p["target_margin"],
                                                       p["r"], p["g_t"], p["years"])
    else:
        row["implied_rev_cagr"] = None
    row["implied_gap"] = (g - row["rev_growth"]) if (g is not None and edge is None
                                                     and row["rev_growth"] is not None) else None
    # staleness
    end = row.get("revenue_end")
    if end:
        age = (today - date.fromisoformat(end)).days
        row["data_age_days"] = age
        if age > 135:
            flags.append("stale_period")
    if fin:
        flags.append("financial")
    if ev is not None and ev <= 0:
        flags.append("ev_nonpositive")
    row["flags"] = sorted(set(flags))
    return row
