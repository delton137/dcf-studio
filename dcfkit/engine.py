"""dcfkit.engine -- the shared valuation tail. Standard library only.

Every model in DCF Studio is a plain JSON-able dict (see dcfkit/schema.py for
the field-by-field contract). Agents own the *drivers -> rows* part of a model
(the archetype engine: ASMs x spread, PP&E x asset turn, units x GP/unit ...);
this module owns everything downstream of the per-period free cash flows:

    discounting (end / mid-year, stub period) -> terminal value -> components
    (DCF / rNPV / fixed) -> EV -> EV-to-equity bridge -> shares -> per-share

Because native model.py files call `value_model()` themselves, the app's
what-if engine reproduces them exactly by construction.

Fixed conventions (never configurable):
  * flows in reporting currency, MILLIONS; shares in ordinary shares, MILLIONS
  * capex, da, taxes >= 0 (outflows/charges are positive numbers)
  * delta_nwc > 0 is an investment (cash out)
  * fcff = nopat + da - capex - delta_nwc + other_adj
  * bridge items carry a signed equity_effect (cash +, debt -)
  * per-share values are per LISTED unit in QUOTE currency:
        value_per_ordinary (reporting ccy) * ordinary_per_listed_unit * fx_spot
"""
from __future__ import annotations

import copy
import math

ENGINE_VERSION = "1.0.1"  # bump on ANY change: the validator detects edits to vendored copies by version

#: Minimum WACC - g spread for a perpetuity. Below this the TV explodes.
MIN_SPREAD = 0.01


class EngineError(ValueError):
    """The model cannot be valued as specified."""


# --------------------------------------------------------------------------
# Helpers for model.py authors
# --------------------------------------------------------------------------

def make_row(period, period_end, *, revenue, ebit, da, capex, delta_nwc,
             tax_rate=None, taxes=None, ebitda=None, other_adj=0.0,
             drivers=None, is_actual=False, tax_guard=True):
    """Build one standardized period row.

    Taxes default to `tax_rate * max(ebit, 0)` (no tax benefit on losses).
    Pass `taxes=` explicitly for NOL shields or cash-tax schedules.
    """
    if taxes is None:
        if tax_rate is None:
            raise EngineError(f"{period}: pass tax_rate or taxes")
        taxes = tax_rate * max(ebit, 0.0) if tax_guard else tax_rate * ebit
    nopat = ebit - taxes
    fcff = nopat + da - capex - delta_nwc + other_adj
    return {
        "period": str(period),
        "period_end": str(period_end),
        "is_actual": bool(is_actual),
        "revenue": float(revenue),
        "ebitda": float(ebit + da) if ebitda is None else float(ebitda),
        "ebit": float(ebit),
        "taxes": float(taxes),
        "nopat": float(nopat),
        "da": float(da),
        "capex": float(capex),
        "delta_nwc": float(delta_nwc),
        "other_adj": float(other_adj),
        "fcff": float(fcff),
        "drivers": dict(drivers or {}),
    }


def normalized_terminal(rows, g, *, nwc_pct_of_revenue=None):
    """PROMPT §8 terminal discipline, as a Terminal dict.

    NOPAT and D&A grow at g into year N+1, capex is forced to maintenance
    (D&A x (1+g)), and dNWC is nwc% x revenue_N x g. Equivalent to
    FCF_{N+1} = (NOPAT_N - g x D&A_N)(1+g) - dNWC.
    """
    last = _explicit(rows)[-1]
    nopat_next = last["nopat"] * (1 + g)
    da_next = last["da"] * (1 + g)
    capex_next = da_next * (1 + g)
    dnwc_next = 0.0
    if nwc_pct_of_revenue is not None:
        dnwc_next = nwc_pct_of_revenue * last["revenue"] * g
    return {
        "method": "normalized_gordon",
        "g": g,
        "nopat_next": nopat_next,
        "da_next": da_next,
        "capex_next": capex_next,
        "dnwc_next": dnwc_next,
        "fcf_next": nopat_next + da_next - capex_next - dnwc_next,
        "nwc_pct_of_revenue": nwc_pct_of_revenue,
    }


# --------------------------------------------------------------------------
# Core valuation
# --------------------------------------------------------------------------

def _explicit(rows):
    return [r for r in (rows or []) if not r.get("is_actual")]


def flow_times(n, disc):
    """Discount times (years from valuation date) for n explicit periods.

    end: t_i = s + i            mid: t_0 = s/2, t_i = s + i - 0.5
    where s = stub_fraction (share of period 1 still ahead of us).
    """
    s = float(disc.get("stub_fraction", 1.0) or 1.0)
    if disc.get("convention", "end") == "mid":
        return [s / 2.0] + [s + i - 0.5 for i in range(1, n)]
    return [s + i for i in range(n)]


def tv_time(n, disc):
    s = float(disc.get("stub_fraction", 1.0) or 1.0)
    if disc.get("tv_timing", "end_last") == "mid_last":
        return flow_times(n, disc)[-1]
    return s + n - 1


def _norm_fcf_next(last, g, nwc_pct):
    dnwc = nwc_pct * last.get("revenue", 0.0) * g if nwc_pct is not None else 0.0
    return (last["nopat"] - g * last["da"]) * (1 + g) - dnwc


def terminal_value(term, rows, wacc):
    """Undiscounted terminal value at the TV date. Returns (tv, fcf_next)."""
    term = term or {}
    method = term.get("method", "none")
    rows = _explicit(rows)
    if method == "none" or not rows:
        return 0.0, None
    last = rows[-1]
    g = term.get("g")
    fcf_next = term.get("fcf_next")
    if method in ("normalized_gordon", "gordon"):
        if g is None:
            raise EngineError(f"{method} terminal needs g")
        if wacc - g < MIN_SPREAD - 1e-12:
            raise EngineError(f"WACC {wacc:.4f} - g {g:.4f} < {MIN_SPREAD}")
        if fcf_next is None:
            if method == "gordon":
                fcf_next = last["fcff"] * (1 + g)
            else:
                fcf_next = _norm_fcf_next(last, g, term.get("nwc_pct_of_revenue"))
        tv = fcf_next / (wacc - g)
    elif method == "exit_multiple":
        metric = term.get("multiple_metric", "ebitda")
        base = last.get(metric)
        if base is None:
            raise EngineError(f"exit multiple metric {metric!r} missing in last row")
        if term.get("metric_period", "last") == "next":
            base *= 1 + (g or 0.0)
        tv = float(term["multiple"]) * base
    elif method == "finite_annuity":
        n = int(term["finite_years"])
        gg = g or 0.0
        f = fcf_next if fcf_next is not None else last["fcff"] * (1 + gg)
        tv = sum(f * (1 + gg) ** (k - 1) / (1 + wacc) ** k for k in range(1, n + 1))
    else:
        raise EngineError(f"unknown terminal method {method!r}")
    if term.get("floor_at_zero"):
        tv = max(tv, 0.0)
    return tv, fcf_next


def value_component(comp, scenario_disc):
    """Value one component; returns its results dict (also stored on comp).

    A component's own `discounting` (e.g. a segment WACC) overrides the
    scenario's field by field.
    """
    d = dict(scenario_disc or {})
    d.update({k: v for k, v in (comp.get("discounting") or {}).items() if v is not None})
    kind = comp.get("kind", "dcf")
    prob = float(comp.get("probability", 1.0) if comp.get("probability") is not None else 1.0)
    if kind == "fixed":
        v = float(comp.get("fixed_value") or 0.0)
        res = {"pv_explicit": v, "tv": 0.0, "pv_tv": 0.0, "value": v, "wacc": None}
        comp["results"] = res
        return res
    wacc = float(d["wacc"])
    rows = _explicit(comp.get("rows"))
    times = flow_times(len(rows), d)
    pv_explicit = 0.0
    for i, (r, t) in enumerate(zip(rows, times)):
        f = r["fcff"]
        if i == 0:
            if d.get("stub_fcff") is not None:
                f = float(d["stub_fcff"])
            else:
                f = f * float(d.get("stub_fraction", 1.0) or 1.0)
        pv_explicit += f / (1 + wacc) ** t
    tv, fcf_next = terminal_value(comp.get("terminal"), rows, wacc)
    pv_tv = tv / (1 + wacc) ** tv_time(len(rows), d) if rows else 0.0
    value = prob * (pv_explicit + pv_tv)
    res = {
        "pv_explicit": prob * pv_explicit,
        "tv": tv,
        "pv_tv": prob * pv_tv,
        "value": value,
        "wacc": wacc,
        "tv_share": (prob * pv_tv / value) if value > 0 else None,
    }
    if fcf_next is not None:
        res["fcf_next"] = fcf_next
    comp["results"] = res
    return res


def bridge_total(model, scn):
    overrides = scn.get("bridge_overrides") or {}
    total = 0.0
    for item in model.get("bridge") or []:
        inc = overrides.get(item["id"], item.get("included", True))
        if inc:
            total += float(item["equity_effect"])
    return total


def value_scenario(scn, model):
    """Value one scenario in place; returns its results dict."""
    disc = scn["discounting"]
    ev = 0.0
    eq_components = 0.0
    pv_tv = 0.0
    pv_explicit = 0.0
    for comp in scn.get("components") or []:
        r = value_component(comp, disc)
        if comp.get("level", "enterprise") == "equity":
            eq_components += r["value"]
        else:
            ev += r["value"]
            pv_tv += r["pv_tv"]
            pv_explicit += r["pv_explicit"]
    shares = scn.get("shares") or {}
    proceeds = float(shares.get("proceeds") or 0.0)
    bridge = bridge_total(model, scn)
    equity = ev + bridge + eq_components + proceeds
    used = float(shares["used"])
    if used <= 0:
        raise EngineError(f"scenario {scn.get('id')}: shares.used must be > 0")
    listing = model.get("listing") or {}
    market = model.get("market") or {}
    ratio = float(listing.get("ordinary_per_listed_unit", 1.0) or 1.0)
    fx = float(market.get("fx_spot", 1.0) or 1.0)
    vpo = equity / used
    raw = vpo * ratio * fx
    vps = max(raw, 0.0)
    price = market.get("price")
    res = {
        "ev": ev,
        "pv_explicit": pv_explicit,
        "pv_tv": pv_tv,
        "tv_share_of_ev": (pv_tv / ev) if ev > 0 else None,
        "bridge_total": bridge,
        "equity_components": eq_components,
        "issuance_proceeds": proceeds,
        "equity": equity,
        "shares_used": used,
        "value_per_ordinary": vpo,
        "value_per_share_raw": raw,
        "value_per_share": vps,
        "floored": raw < 0,
        "upside": (vps / price - 1.0) if price else None,
    }
    scn["results"] = res
    return res


def probability_weighted(model):
    """Sum p * floored value; None unless every scenario carries a probability."""
    scns = model.get("scenarios") or []
    if not scns or any(s.get("probability") is None for s in scns):
        return None
    total_p = sum(float(s["probability"]) for s in scns)
    if abs(total_p - 1.0) > 1e-6:
        return None
    return sum(float(s["probability"]) * s["results"]["value_per_share"] for s in scns)


def scenario_by_role(model, role):
    for s in model.get("scenarios") or []:
        if s.get("role") == role:
            return s
    return None


def headline_value(model):
    h = (model.get("headline") or {}).get("method", "base_dcf")
    if h == "prob_weighted":
        pw = probability_weighted(model)
        if pw is not None:
            return pw
    if h == "floor":
        for a in model.get("alt_valuations") or []:
            if a.get("method") == "net_cash_floor":
                return a.get("value_per_share")
    base = scenario_by_role(model, "base") or (model.get("scenarios") or [None])[0]
    return base["results"]["value_per_share"] if base else None


def value_model(model):
    """Value every scenario in place; return the model (for chaining)."""
    for scn in model.get("scenarios") or []:
        value_scenario(scn, model)
    model.setdefault("headline", {"method": "base_dcf", "rationale": ""})
    model["headline"]["value_per_share"] = headline_value(model)
    model["headline"]["probability_weighted"] = probability_weighted(model)
    return model


# --------------------------------------------------------------------------
# Reproduction (does the engine reproduce a model's stated results?)
# --------------------------------------------------------------------------

def _rel(a, b):
    if a is None or b is None:
        return None
    denom = max(abs(a), abs(b), 1e-9)
    return abs(a - b) / denom


def reproduce(model, *, exact_tol=1e-3, approx_tol=0.05):
    """Re-value a deep copy and compare against the stored scenario results.

    Returns {"grade": exact|approx|none, "residual": max rel diff, "scenarios": {...}}.
    Comparison is on equity value (falls back to per-share when equity absent).
    """
    claimed = {}
    for s in model.get("scenarios") or []:
        r = s.get("results") or {}
        claimed[s["id"]] = (r.get("equity"), r.get("value_per_share"), r.get("ev"))
    out = {"grade": "none", "residual": None, "scenarios": {}}
    try:
        m = value_model(copy.deepcopy(model))
    except (EngineError, KeyError, TypeError, ZeroDivisionError) as exc:
        out["error"] = f"{type(exc).__name__}: {exc}"
        return out
    worst = 0.0
    for s in m.get("scenarios") or []:
        ceq, cvps, cev = claimed.get(s["id"], (None, None, None))
        r = s["results"]
        valued = [c for c in s.get("components") or [] if c.get("kind", "dcf") != "fixed"]
        if not s.get("components") or any(not _explicit(c.get("rows")) for c in valued):
            out["scenarios"][s["id"]] = {"residual": None, "reason": "no projection rows"}
            worst = math.inf
            continue
        diffs = [d for d in (_rel(r["equity"], ceq), _rel(r["ev"], cev)) if d is not None]
        if not diffs:
            d = _rel(r["value_per_share_raw"], cvps)
            diffs = [d] if d is not None else []
        if not diffs:
            out["scenarios"][s["id"]] = {"residual": None, "reason": "no stated results"}
            worst = math.inf
            continue
        res = max(diffs)
        worst = max(worst, res)
        out["scenarios"][s["id"]] = {
            "residual": res,
            "engine_ev": r["ev"], "stated_ev": cev,
            "engine_equity": r["equity"], "stated_equity": ceq,
            "engine_vps": r["value_per_share"], "stated_vps": cvps,
        }
    if not out["scenarios"]:
        return out
    out["residual"] = None if math.isinf(worst) else worst
    if math.isinf(worst):
        out["grade"] = "none"
    elif worst <= exact_tol:
        out["grade"] = "exact"
    elif worst <= approx_tol:
        out["grade"] = "approx"
    return out


def detect_convention(model, *, candidates=None):
    """For importers: try discounting conventions until the engine matches.

    Mutates `model` to the best candidate and returns (grade_info, convention).
    """
    candidates = candidates or [
        {"convention": "end", "tv_timing": "end_last"},
        {"convention": "mid", "tv_timing": "end_last"},
        {"convention": "mid", "tv_timing": "mid_last"},
    ]
    best = None
    for cand in candidates:
        trial = copy.deepcopy(model)
        for s in trial.get("scenarios") or []:
            s["discounting"].update(cand)
        rep = reproduce(trial)
        score = rep["residual"] if rep["residual"] is not None else math.inf
        if best is None or score < best[0]:
            best = (score, cand, rep)
    if best:
        for s in model.get("scenarios") or []:
            s["discounting"].update(best[1])
        return best[2], best[1]
    return {"grade": "none"}, None


# --------------------------------------------------------------------------
# Layer A what-if overlays
# --------------------------------------------------------------------------

OVERLAY_KNOBS = {
    "wacc": "absolute WACC for every scenario (or per-scenario dict)",
    "wacc_shift": "added to each scenario's WACC",
    "g": "absolute terminal growth",
    "g_shift": "added to each scenario's terminal growth",
    "exit_multiple": "absolute exit multiple (exit_multiple terminals only)",
    "rev_growth_shift": "added to annual revenue growth from year 2 (approximate)",
    "ebit_margin_shift": "added to EBIT margin from year 2 (approximate)",
    "capex_intensity_mult": "multiplies capex from year 2 (approximate)",
    "tax_rate": "re-taxes EBIT at this rate with the loss guard",
    "bridge": "{bridge_id: bool} include/exclude debatable items",
    "shares_mult": "multiplies the share count used",
}

#: knobs that are exact for any reproducible model (no operating approximation)
EXACT_KNOBS = {"wacc", "wacc_shift", "g", "g_shift", "exit_multiple", "bridge", "shares_mult"}


def _terminal_F(term, rows, g):
    """The engine-native terminal numerator used for anchored re-derivation."""
    last = _explicit(rows)[-1]
    if term.get("method") == "gordon":
        return last["fcff"] * (1 + g)
    return _norm_fcf_next(last, g, term.get("nwc_pct_of_revenue"))


def _apply_operating(comp, knobs, year1_locked, tax_rate):
    rows = comp.get("rows") or []
    exp_idx = [i for i, r in enumerate(rows) if not r.get("is_actual")]
    start = 1 if year1_locked else 0
    dg = float(knobs.get("rev_growth_shift") or 0.0)
    dm = float(knobs.get("ebit_margin_shift") or 0.0)
    cm = float(knobs.get("capex_intensity_mult") or 1.0)
    new_tax = knobs.get("tax_rate")
    scale = 1.0
    for k, i in enumerate(exp_idx):
        r = dict(rows[i])
        if k >= start and dg:
            prev_rev = rows[exp_idx[k - 1]]["revenue"] if k > 0 else None
            if prev_rev:
                g0 = r["revenue"] / prev_rev - 1.0
                scale *= (1 + g0 + dg) / (1 + g0)
        rev0 = r["revenue"]
        if k >= start:
            margin = (r["ebit"] / rev0) if rev0 else 0.0
            rev = rev0 * scale
            ebit = rev * (margin + dm) if (dm or scale != 1.0) else r["ebit"]
            da = r["da"] * scale
            capex = r["capex"] * scale * cm
            dnwc = r["delta_nwc"] * scale
        else:
            rev, ebit, da, capex, dnwc = rev0, r["ebit"], r["da"], r["capex"], r["delta_nwc"]
        if new_tax is not None:
            taxes = float(new_tax) * max(ebit, 0.0)
        elif ebit != r["ebit"]:
            rate = tax_rate if tax_rate is not None else (
                r["taxes"] / r["ebit"] if r["ebit"] > 0 else 0.0)
            taxes = r["taxes"] + rate * (max(ebit, 0.0) - max(r["ebit"], 0.0))
            taxes = max(taxes, 0.0)
        else:
            taxes = r["taxes"]
        nopat = ebit - taxes
        r.update(revenue=rev, ebit=ebit, ebitda=ebit + da, da=da, capex=capex,
                 delta_nwc=dnwc, taxes=taxes, nopat=nopat,
                 fcff=nopat + da - capex - dnwc + r.get("other_adj", 0.0))
        rows[i] = r
    comp["rows"] = rows


def apply_overlay(model, knobs, *, scenario_ids=None, anchor=None):
    """Return a NEW model with Layer A knobs applied and re-valued.

    anchor: "exact" -> pure engine values; "approx" -> stated + (E(k) - E(0))
    on equity. Defaults to the model's reproduction grade.
    """
    knobs = {k: v for k, v in (knobs or {}).items() if v is not None}
    base_model = copy.deepcopy(model)
    if anchor is None:
        anchor = reproduce(base_model)["grade"]
    if anchor == "none" and set(knobs) - {"bridge", "shares_mult"}:
        raise EngineError("model is not reproducible by the engine; only bridge/share knobs are live")
    e0 = value_model(copy.deepcopy(base_model))
    m = copy.deepcopy(base_model)
    for scn in m.get("scenarios") or []:
        if scenario_ids and scn["id"] not in scenario_ids:
            continue
        disc = scn["discounting"]
        w = knobs.get("wacc")
        if isinstance(w, dict):
            w = w.get(scn["id"])
        # An absolute WACC is applied as a shift so segment WACCs (SOTP) keep
        # their spread to the scenario rate.
        shift = (float(w) - float(disc["wacc"])) if w is not None else 0.0
        shift += float(knobs.get("wacc_shift") or 0.0)
        disc["wacc"] = float(disc["wacc"]) + shift
        if knobs.get("bridge"):
            scn.setdefault("bridge_overrides", {}).update(knobs["bridge"])
        if knobs.get("shares_mult"):
            scn["shares"]["used"] = float(scn["shares"]["used"]) * float(knobs["shares_mult"])
        tax_rate = (scn.get("tax") or {}).get("rate")
        for comp in scn.get("components") or []:
            if comp.get("kind", "dcf") == "fixed":
                continue
            cd = comp.get("discounting") or {}
            if cd.get("wacc") is not None and shift:
                cd["wacc"] = float(cd["wacc"]) + shift
            rows0 = copy.deepcopy(comp.get("rows") or [])
            if any(knobs.get(k) for k in ("rev_growth_shift", "ebit_margin_shift")) or \
                    knobs.get("capex_intensity_mult") not in (None, 1, 1.0) or \
                    knobs.get("tax_rate") is not None:
                _apply_operating(comp, knobs, scn.get("year1_locked", True), tax_rate)
            term = comp.get("terminal") or {}
            method = term.get("method", "none")
            if method in ("normalized_gordon", "gordon") and _explicit(rows0):
                g0 = float(term["g"])
                g1 = g0
                if knobs.get("g") is not None:
                    g1 = float(knobs["g"])
                if knobs.get("g_shift"):
                    g1 = g1 + float(knobs["g_shift"])
                if g1 != g0 or comp.get("rows") != rows0:
                    stored = term.get("fcf_next")
                    f_new = _terminal_F(term, comp["rows"], g1)
                    if stored is not None:
                        f_new = stored + f_new - _terminal_F(term, rows0, g0)
                    term["fcf_next"] = f_new
                    term["g"] = g1
                    for k in ("nopat_next", "da_next", "capex_next", "dnwc_next"):
                        term.pop(k, None)
            elif method == "exit_multiple" and knobs.get("exit_multiple") is not None:
                term["multiple"] = float(knobs["exit_multiple"])
    ek = value_model(m)
    # Preserve the source's flooring convention: legacy models that stated a
    # negative value per share keep reporting the unfloored value.
    stated_neg = {x["id"] for x in model.get("scenarios") or []
                  if ((x.get("results") or {}).get("value_per_share") or 0) < 0}
    for sk in ek["scenarios"]:
        if sk["id"] in stated_neg:
            sk["results"]["value_per_share"] = sk["results"]["value_per_share_raw"]
            price = (m.get("market") or {}).get("price")
            sk["results"]["upside"] = (sk["results"]["value_per_share"] / price - 1.0) if price else None
    if anchor == "approx" or anchor == "none":
        for s0, sk in zip(e0["scenarios"], ek["scenarios"]):
            stated = next(x for x in model["scenarios"] if x["id"] == s0["id"]).get("results") or {}
            if stated.get("equity") is None:
                continue
            d_eq = sk["results"]["equity"] - s0["results"]["equity"]
            eq = stated["equity"] + d_eq
            r = sk["results"]
            ratio = r["value_per_share_raw"] / r["value_per_ordinary"] if r["value_per_ordinary"] else 1.0
            r["equity"] = eq
            r["value_per_ordinary"] = eq / r["shares_used"]
            r["value_per_share_raw"] = r["value_per_ordinary"] * ratio
            r["value_per_share"] = (r["value_per_share_raw"] if s0["id"] in stated_neg
                                    else max(r["value_per_share_raw"], 0.0))
            price = (m.get("market") or {}).get("price")
            r["upside"] = (r["value_per_share"] / price - 1.0) if price else None
            r["anchored"] = True
        m["headline"]["value_per_share"] = headline_value(m)
        m["headline"]["probability_weighted"] = probability_weighted(m)
    return m


# --------------------------------------------------------------------------
# Canonical comparison metrics (identical definition for every model)
# --------------------------------------------------------------------------

def consolidated_rows(scn):
    """Sum enterprise-level DCF components period by period."""
    comps = [c for c in scn.get("components") or []
             if c.get("kind", "dcf") == "dcf" and c.get("level", "enterprise") == "enterprise"
             and _explicit(c.get("rows"))]
    if scn.get("consolidated_rows"):
        return _explicit(scn["consolidated_rows"])
    if not comps:
        return []
    if len(comps) == 1:
        return _explicit(comps[0]["rows"])
    base = [dict(r) for r in _explicit(comps[0]["rows"])]
    for c in comps[1:]:
        rows = _explicit(c["rows"])
        for i, r in enumerate(rows[:len(base)]):
            for k in ("revenue", "ebitda", "ebit", "taxes", "nopat", "da", "capex",
                      "delta_nwc", "other_adj", "fcff"):
                if r.get(k) is not None and base[i].get(k) is not None:
                    base[i][k] = base[i][k] + r[k]
    return base


def _safe_div(a, b):
    try:
        return a / b if (a is not None and b) else None
    except (TypeError, ZeroDivisionError):
        return None


def derive(model, *, compare_price=None):
    """Canonical metrics computed the same way for every model.

    Uses the model's STATED results for headline values (legacy numbers are
    authoritative); engine-only for ratios that need rows.
    """
    scns = model.get("scenarios") or []
    market = model.get("market") or {}
    price = market.get("price")
    vps = {}
    for role in ("bear", "base", "bull"):
        s = scenario_by_role(model, role)
        vps[role] = (s.get("results") or {}).get("value_per_share") if s else None
    pw = None
    if scns and all(s.get("probability") is not None for s in scns) and \
            all((s.get("results") or {}).get("value_per_share") is not None for s in scns):
        tp = sum(float(s["probability"]) for s in scns)
        if abs(tp - 1.0) <= 1e-6:
            pw = sum(float(s["probability"]) * max(s["results"]["value_per_share"], 0.0)
                     for s in scns)
    headline = (model.get("headline") or {}).get("value_per_share")
    if headline is None:
        headline = pw if (model.get("headline") or {}).get("method") == "prob_weighted" else vps["base"]
    base = scenario_by_role(model, "base") or (scns[0] if scns else None)
    out = {
        "value_ps": {**vps, "pw": pw, "headline": headline},
        "price_model": price,
        "price_ts": market.get("price_ts"),
        "upside_model": (headline / price - 1.0) if (headline is not None and price) else None,
        "compare_price": compare_price,
        "upside_compare": (headline / compare_price - 1.0) if (headline is not None and compare_price) else None,
        "quote_currency": (model.get("listing") or {}).get("quote_currency"),
        "listed_unit": (model.get("listing") or {}).get("listed_unit", "common"),
    }
    if base:
        r = base.get("results") or {}
        disc = base.get("discounting") or {}
        out.update(
            wacc=disc.get("wacc"),
            ev=r.get("ev"),
            equity=r.get("equity"),
            tv_pct_ev=r.get("tv_share_of_ev"),
            shares_used=r.get("shares_used") or (base.get("shares") or {}).get("used"),
        )
        terms = [c.get("terminal") or {} for c in base.get("components") or []
                 if c.get("kind", "dcf") != "fixed"]
        main_term = terms[0] if terms else {}
        out["g"] = main_term.get("g")
        out["terminal_method"] = main_term.get("method")
        rows = consolidated_rows(base)
        out["horizon_years"] = len(rows) or None
        if rows:
            first, last = rows[0], rows[-1]
            hist = _explicit_actuals(model)
            start_rev = hist[-1]["revenue"] if hist and hist[-1].get("revenue") else first.get("revenue")
            n = len(rows) if (hist and hist[-1].get("revenue")) else len(rows) - 1
            if start_rev and last.get("revenue") and start_rev > 0 and last["revenue"] > 0 and n > 0:
                out["rev_cagr"] = (last["revenue"] / start_rev) ** (1.0 / n) - 1.0
            out["terminal_ebit_margin"] = _safe_div(last.get("ebit"), last.get("revenue"))
            out["terminal_capex_da"] = _safe_div(last.get("capex"), last.get("da"))
            out["yr1_revenue"] = first.get("revenue")
            out["yr1_period"] = first.get("period")
            out["yr1_period_end"] = first.get("period_end")
            ebitda_n = last.get("ebitda")
            tv_total = sum((c.get("results") or {}).get("tv") or 0.0
                           for c in base.get("components") or [] if c.get("kind", "dcf") == "dcf")
            g = out.get("g") or 0.0
            if ebitda_n and tv_total:
                out["implied_exit_ev_ebitda"] = tv_total / (ebitda_n * (1 + g))
            if first.get("ebitda") and r.get("ev"):
                out["ev_ebitda_y1"] = r["ev"] / first["ebitda"]
        out["margin_basis"] = (model.get("basis") or {}).get("margin_basis")
    sd = market.get("shares_diluted")
    if sd and out.get("shares_used"):
        out["dilution_pct"] = out["shares_used"] / sd - 1.0
    gi = _revenue_guidance(model)
    if gi:
        lo, hi = gi.get("low"), gi.get("high")
        mid = (lo + hi) / 2.0 if (lo is not None and hi is not None) else None
        out["yr1_guide_mid"] = mid
        if mid and out.get("yr1_revenue"):
            out["yr1_vs_guide"] = out["yr1_revenue"] / mid - 1.0
        ins = gi.get("inside") or {}
        out["yr1_inside"] = all(ins.values()) if ins else None
    checks = model.get("checks") or []
    out["checks"] = {
        "pass": sum(1 for c in checks if c.get("status") == "pass"),
        "fail": sum(1 for c in checks if c.get("status") == "fail"),
        "warn": sum(1 for c in checks if c.get("status") == "warn"),
        "total": len(checks),
    }
    arch = model.get("archetype") or {}
    out["archetype"] = arch.get("kind")
    out["decisive"] = (arch.get("decisive") or {}).get("label")
    out["scenario_count"] = len(scns)
    return out


def _explicit_actuals(model):
    return [r for r in ((model.get("historicals") or {}).get("rows") or []) if r.get("revenue") is not None]


def _revenue_guidance(model):
    for gi in model.get("guidance") or []:
        if "revenue" in (gi.get("metric") or "").lower() or "sales" in (gi.get("metric") or "").lower():
            return gi
    return None


def reverse_margin_shift(model, target_price=None, *, lo=-0.5, hi=0.5, tol=1e-6):
    """Generic 'what must be true': the year-2+ EBIT margin shift on the BASE
    scenario that makes its value equal the price. None if unreachable."""
    base = scenario_by_role(model, "base")
    price = target_price or (model.get("market") or {}).get("price")
    if not base or not price:
        return None

    def f(dm):
        m = apply_overlay(model, {"ebit_margin_shift": dm}, scenario_ids=[base["id"]])
        return scenario_by_role(m, "base")["results"]["value_per_share_raw"] - price

    try:
        flo, fhi = f(lo), f(hi)
    except EngineError:
        return None
    if flo * fhi > 0:
        return None
    for _ in range(80):
        mid = (lo + hi) / 2
        fm = f(mid)
        if abs(fm) < tol:
            return mid
        if (fm > 0) == (fhi > 0):
            hi, fhi = mid, fm
        else:
            lo, flo = mid, fm
    return (lo + hi) / 2
