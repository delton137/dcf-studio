#!/usr/bin/env python3
"""Validate a DCF Studio model directory / dcf.json.

    python3 dcfkit/validate.py dcf.json                 # native mode (new agent runs)
    python3 dcfkit/validate.py dcf.json --mode imported # legacy conversions
    python3 dcfkit/validate.py dcf.json --json          # machine-readable

Native mode also exercises model.py next to dcf.json (idempotency, purity,
live knobs). Exit code 0 = no failures (warnings allowed), 1 = failures.

Fix every FAIL. Do not edit dcf.json by hand -- change model.py and re-run it.
"""
from __future__ import annotations

import argparse
import ast
import copy
import datetime as dt
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from dcfkit import engine as E  # noqa: E402

try:
    from pydantic import ValidationError
    from dcfkit.schema import DCF
except ImportError:  # pragma: no cover
    DCF = None

REQUIRED_CHECKS = {
    "engine_identity": "the archetype identity reproduces reported actuals (e.g. units x price = revenue)",
    "inside_guidance": "year-1 output inside guidance, every scenario",
    "terminal_capex": "terminal capex = D&A x (1+g), every scenario",
    "tax_guard": "no tax benefit on losses under stress",
    "fcf_identity": "FCF = NOPAT + D&A - capex - dNWC",
    "monotonic": "bear < base < bull",
    "wacc_monotonic": "higher WACC lowers value (warn allowed for cash burners)",
}
RECOMMENDED_CHECKS = {
    "components_sum": "revenue/expense components sum to reported totals",
    "segments_reconcile": "segments reconcile to consolidated",
    "balance_sheet_foots": "assets = liabilities + equity",
    "non_gaap_recon": "non-GAAP reconciliations reproduce",
    "fcf_derivation": "reported FCF = OCF - capex",
    "ppe_rollforward": "PP&E roll-forward continuous",
    "ytd_floor": "full-year >= year-to-date actual",
}
FORBIDDEN_IMPORTS = {"urllib", "http", "socket", "ssl", "subprocess", "requests", "ftplib", "smtplib",
                     "asyncio", "multiprocessing", "threading", "ctypes"}
ROW_FIELDS = ("revenue", "ebit", "taxes", "nopat", "da", "capex", "delta_nwc")
MODEL_TIMEOUT = 120


class Report:
    def __init__(self, mode):
        self.mode = mode
        self.items = []

    def add(self, level, cid, msg):
        self.items.append({"level": level, "id": cid, "message": msg})

    def fail(self, cid, msg, *, imported_level="warn"):
        self.add("fail" if self.mode == "native" else imported_level, cid, msg)

    def hard(self, cid, msg):
        self.add("fail", cid, msg)

    def warn(self, cid, msg):
        self.add("warn", cid, msg)

    def ok(self, cid, msg=""):
        self.add("pass", cid, msg)

    @property
    def failures(self):
        return [i for i in self.items if i["level"] == "fail"]

    def summary(self):
        c = {"fail": 0, "warn": 0, "pass": 0}
        for i in self.items:
            c[i["level"]] += 1
        return c


def _close(a, b, rel=1e-6, abs_=0.011):
    return abs(a - b) <= max(abs_, rel * max(abs(a), abs(b)))


def _date(s):
    return dt.date.fromisoformat(str(s)[:10])


# --------------------------------------------------------------------------
# structural / arithmetic checks on the JSON
# --------------------------------------------------------------------------

def check_schema(d, rep):
    if DCF is None:
        rep.warn("schema", "pydantic not installed; schema not checked")
        return True
    try:
        DCF.model_validate(d)
    except ValidationError as exc:
        for e in exc.errors()[:40]:
            loc = ".".join(str(x) for x in e["loc"])
            rep.hard("schema", f"{loc}: {e['msg']}")
        return False
    rep.ok("schema")
    return True


def check_rows(d, rep):
    bad = 0
    for s in d["scenarios"]:
        for c in s.get("components") or []:
            if c.get("kind", "dcf") == "fixed":
                continue
            rows = [r for r in c.get("rows") or [] if not r.get("is_actual")]
            if not rows:
                rep.fail("rows", f"{s['id']}/{c['id']}: no projection rows", imported_level="warn")
                continue
            if c.get("kind", "dcf") == "dcf":
                missing = [f for f in ROW_FIELDS if any(r.get(f) is None for r in rows)]
                if missing:
                    rep.fail("rows", f"{s['id']}/{c['id']}: rows missing {missing}")
            prev = None
            for r in rows:
                tag = f"{s['id']}/{c['id']}/{r['period']}"
                if all(r.get(k) is not None for k in ("ebit", "taxes", "nopat")):
                    if not _close(r["nopat"], r["ebit"] - r["taxes"]):
                        rep.fail("row_identity", f"{tag}: nopat != ebit - taxes"); bad += 1
                    if r["taxes"] < -1e-9:
                        rep.fail("row_sign", f"{tag}: taxes must be >= 0 (got {r['taxes']:.2f})"); bad += 1
                    if r["ebit"] <= 0 and r["taxes"] > 1e-6:
                        rep.warn("tax_guard", f"{tag}: taxes {r['taxes']:.2f} on EBIT {r['ebit']:.2f}")
                if all(r.get(k) is not None for k in ("nopat", "da", "capex", "delta_nwc")):
                    f = r["nopat"] + r["da"] - r["capex"] - r["delta_nwc"] + (r.get("other_adj") or 0)
                    if not _close(f, r["fcff"]):
                        rep.fail("row_identity", f"{tag}: fcff {r['fcff']:.2f} != nopat+da-capex-dnwc {f:.2f}"); bad += 1
                for k in ("capex", "da"):
                    if r.get(k) is not None and r[k] < -1e-9:
                        rep.fail("row_sign", f"{tag}: {k} must be >= 0 (outflows are positive)"); bad += 1
                pe = _date(r["period_end"])
                if prev is not None:
                    gap = (pe - prev).days
                    if not (300 <= gap <= 430):
                        rep.fail("periods", f"{tag}: period_end gap {gap} days (expect annual periods)")
                prev = pe
    if not bad:
        rep.ok("row_identity")


def check_terminal(d, rep):
    for s in d["scenarios"]:
        w = s["discounting"]["wacc"]
        for c in s.get("components") or []:
            t = c.get("terminal") or {}
            m = t.get("method")
            if m in ("normalized_gordon", "gordon"):
                ww = (c.get("discounting") or {}).get("wacc") or w
                if ww - t["g"] < E.MIN_SPREAD:
                    rep.hard("terminal", f"{s['id']}/{c['id']}: WACC - g < 1%")
                if t["g"] > 0.04:
                    rep.warn("terminal_g", f"{s['id']}/{c['id']}: g = {t['g']:.3f} > 4%")
            if m == "normalized_gordon" and t.get("capex_next") is not None and t.get("da_next"):
                ratio = t["capex_next"] / t["da_next"]
                if abs(ratio - (1 + t["g"])) > 1e-6:
                    rep.fail("terminal_capex", f"{s['id']}/{c['id']}: capex_next/da_next = {ratio:.4f} != 1+g")
        tvs = (s.get("results") or {}).get("tv_share_of_ev")
        if tvs is not None and tvs > 0.75:
            rep.warn("tv_share", f"{s['id']}: terminal value is {tvs:.0%} of EV -- the answer is a terminal-state assumption")


def check_market(d, rep):
    mk, ls = d["market"], d["listing"]
    ratio = ls.get("ordinary_per_listed_unit", 1.0)
    implied_cap = mk["price"] * mk["shares_diluted"] / ratio
    if mk.get("market_cap"):
        if abs(implied_cap / mk["market_cap"] - 1) > 0.05:
            rep.fail("market_cap", f"price x diluted shares / ratio = {implied_cap:,.0f} vs market_cap "
                                   f"{mk['market_cap']:,.0f} (>5%): check units (millions) and ADR ratio")
    if mk.get("local_price"):
        exp = mk["local_price"] * mk.get("fx_spot", 1.0) * ratio
        if abs(exp / mk["price"] - 1) > 0.03:
            rep.fail("adr_ratio", f"local price x fx x ratio = {exp:.2f} vs price {mk['price']:.2f}")
    base = E.scenario_by_role(d, "base")
    r = base.get("results") or {}
    fx = mk.get("fx_spot", 1.0)
    if r.get("ev") is not None and implied_cap > 0:
        x = r["ev"] * fx / implied_cap
        if r["ev"] <= 0:
            rep.warn("scale", f"base EV is {r['ev']:,.1f} (non-positive): fine for a cash burner, "
                              f"otherwise check signs")
        elif x > 30:
            rep.hard("scale", f"base EV / market cap = {x:.3g}: almost certainly a units error "
                              f"(flows must be in MILLIONS of reporting currency)")
        elif x < 0.01:
            eq = (r.get("equity") or 0.0) * fx / implied_cap
            if abs(eq) < 0.01:
                rep.hard("scale", f"base EV and equity are both < 1% of market cap ({x:.3g}, {eq:.3g}): "
                                  f"almost certainly a units error (flows must be in MILLIONS)")
            else:
                rep.warn("scale", f"base EV is only {x:.2%} of market cap (equity {eq:.0%}): fine for a "
                                  f"cash-rich business, otherwise check units")
    vps = r.get("value_per_share")
    if vps:
        x = vps / mk["price"]
        if x > 20 or (0 < x < 0.02):
            rep.warn("scale", f"base value/price = {x:.3g}; check units, ADR ratio, FX")
    ps = [s.get("probability") for s in d["scenarios"]]
    if any(p is not None for p in ps):
        if any(p is None for p in ps):
            rep.hard("probabilities", "give a probability for every scenario or for none")
        elif abs(sum(ps) - 1) > 1e-6:
            rep.hard("probabilities", f"probabilities sum to {sum(ps):.4f}")


def check_stub(d, rep):
    vd = _date(d["basis"]["valuation_date"])
    for s in d["scenarios"]:
        rows = [r for c in s.get("components") or [] for r in (c.get("rows") or []) if not r.get("is_actual")]
        if not rows:
            continue
        first_end = min(_date(r["period_end"]) for r in rows)
        if first_end <= vd:
            rep.fail("stub", f"{s['id']}: first projected period ends {first_end} on/before valuation_date {vd}")
        period_start = first_end - dt.timedelta(days=365)
        if s["discounting"].get("stub_fraction", 1.0) >= 0.999 and (vd - period_start).days > 30:
            rep.warn("stub", f"{s['id']}: valuation_date {vd} is {(vd - period_start).days} days into the first "
                             f"period but stub_fraction = 1 (year-to-date cash is counted twice)")
        break


def check_reproduction(d, rep):
    res = E.reproduce(d, exact_tol=1e-6 if rep.mode == "native" else 1e-3)
    grade = res["grade"]
    if rep.mode == "native":
        if grade != "exact":
            msg = f"engine does not reproduce stated results (residual {res.get('residual')}; {res.get('error', '')}). " \
                  f"Call dcfkit.engine.value_model(model) at the end of build()."
            if d.get("engine_override_reason"):
                rep.warn("reproduction", msg + f" Override: {d['engine_override_reason']}")
            else:
                rep.hard("reproduction", msg)
        else:
            rep.ok("reproduction")
    else:
        lvl = {"exact": "pass", "approx": "warn", "none": "warn"}[grade]
        rep.add(lvl, "reproduction", f"grade={grade} residual={res.get('residual')} {res.get('error', '')}")
    return res


def check_order(d, rep):
    v = {s["role"]: s["results"]["value_per_share"] for s in d["scenarios"] if s["role"] in ("bear", "base", "bull")}
    if all(k in v for k in ("bear", "base", "bull")) and not (v["bear"] <= v["base"] <= v["bull"]):
        rep.warn("monotonic", f"bear/base/bull not ordered: {v}")


def check_guidance(d, rep):
    agent_checks = {c["id"]: c for c in d.get("checks") or []}
    for g in d.get("guidance") or []:
        outside = [k for k, v in (g.get("inside") or {}).items() if not v]
        if outside:
            diag = (agent_checks.get("inside_guidance") or {}).get("diagnosis")
            if diag:
                rep.warn("inside_guidance", f"{g['metric']} {g['period']}: outside in {outside} -- diagnosed: {diag}")
            else:
                rep.fail("inside_guidance", f"{g['metric']} {g['period']}: year-1 outside guidance in {outside} "
                                            f"(add a diagnosis on check 'inside_guidance' if deliberate)")


def check_shares(d, rep):
    for s in d["scenarios"]:
        sh = s["shares"]
        if sh.get("method") == "burn_funded" and not (sh.get("proceeds") or sh.get("proceeds_in_bridge")):
            rep.fail("burn_funded", f"{s['id']}: burn-funded shares need the issuance proceeds in equity "
                                    f"(otherwise cash burn is counted twice)")
        if sh["used"] < 0.5 * d["market"]["shares_diluted"]:
            rep.warn("shares", f"{s['id']}: shares.used {sh['used']} is < half of diluted {d['market']['shares_diluted']}")


def check_agent_checks(d, rep):
    if rep.mode != "native":
        return
    ids = {c["id"]: c for c in d.get("checks") or []}
    for cid, desc in REQUIRED_CHECKS.items():
        if cid not in ids:
            rep.hard("required_checks", f"missing check id {cid!r}: {desc}")
    missing_rec = [c for c in RECOMMENDED_CHECKS if c not in ids]
    if missing_rec:
        rep.warn("recommended_checks", f"consider adding: {missing_rec} (use status 'na' if not applicable)")
    for c in d.get("checks") or []:
        if c["status"] == "fail" and not c.get("diagnosis"):
            rep.hard("check_diagnosis", f"check {c['id']} fails without a diagnosis -- diagnose it, don't silence it")


def check_content(d, rep):
    if rep.mode != "native":
        return
    if not d.get("sources"):
        rep.hard("sources", "no sources: cite the filings (accession numbers) every number came from")
    if not (d.get("narrative") or {}).get("headline"):
        rep.hard("narrative", "narrative.headline is empty")
    if len(d.get("inputs") or []) < 3:
        rep.hard("inputs", "declare at least 3 inputs (knobs) including the decisive driver")
    elif not any(i.get("decisive") for i in d["inputs"]):
        rep.hard("inputs", "mark the decisive driver input with decisive: true")
    if not d.get("reverse_dcf"):
        rep.fail("reverse_dcf", "lead with a reverse DCF on the decisive driver")
    if not d.get("grids"):
        rep.warn("grids", "no sensitivity grid")
    if not d.get("historicals", {}).get("rows"):
        rep.warn("historicals", "no historical rows")


# --------------------------------------------------------------------------
# model.py checks (native)
# --------------------------------------------------------------------------

_PROBE = r"""
import json, sys, copy
sys.path.insert(0, '.')
import model as M
out = {}
def vals(m):
    return {s['id']: s['results']['value_per_share_raw'] if s['results'].get('value_per_share_raw') is not None
            else s['results']['value_per_share'] for s in m['scenarios']}
def strip(m):
    m = copy.deepcopy(m); m.pop('provenance', None); m.pop('derived', None); return m
a = M.build()
out['default'] = strip(a)
out['default_empty'] = strip(M.build({})) == out['default']
out['default_vals'] = vals(a)
# purity: a non-default build must not leak into the next default build
out['pure'] = True
for inp in a.get('inputs') or []:
    if inp.get('type', 'float') in ('float', 'int') and inp.get('max') is not None:
        M.build({inp['key']: inp['max']})
        out['pure'] = strip(M.build()) == out['default']
        break
knobs = {}
for inp in a.get('inputs') or []:
    k = inp['key']; r = {}
    try:
        if inp.get('type') == 'bool':
            lo, hi = False, True
        elif inp.get('type') == 'enum':
            opts = inp.get('options') or []
            lo, hi = (opts[0], opts[-1]) if opts else (inp['value'], inp['value'])
        else:
            lo = inp.get('min'); hi = inp.get('max')
            if lo is None or hi is None:
                v = float(inp['value']); lo, hi = v * 0.9, v * 1.1
        r['lo'] = vals(M.build({k: lo})); r['hi'] = vals(M.build({k: hi}))
        r['noop'] = strip(M.build({k: inp['value']})) == out['default']
    except Exception as exc:
        r['error'] = f'{type(exc).__name__}: {exc}'
    knobs[k] = r
out['knobs'] = knobs
out['pure'] = out['pure'] and strip(M.build()) == out['default']
try:
    M.build({'__definitely_not_an_input__': 1}); out['unknown_raises'] = False
except Exception:
    out['unknown_raises'] = True
print('__PROBE__' + json.dumps(out))
"""


def _imports(path):
    tree = ast.parse(open(path).read(), path)
    mods = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            mods |= {a.name.split(".")[0] for a in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            mods.add(node.module.split(".")[0])
    return mods


def _strip(m):
    m = copy.deepcopy(m)
    m.pop("provenance", None)
    m.pop("derived", None)
    return m


def _canon(x):
    if isinstance(x, float):
        return round(x, 9) if math.isfinite(x) else str(x)
    if isinstance(x, dict):
        return {k: _canon(v) for k, v in sorted(x.items())}
    if isinstance(x, list):
        return [_canon(v) for v in x]
    return x


def check_model_py(d, model_dir, rep):
    path = os.path.join(model_dir, "model.py")
    if not os.path.exists(path):
        rep.hard("model_py", "model.py not found next to dcf.json")
        return
    try:
        mods = _imports(path)
    except SyntaxError as exc:
        rep.hard("model_py", f"model.py does not parse: {exc}")
        return
    vendored = os.path.join(model_dir, "dcfkit", "engine.py")
    if os.path.exists(vendored) and os.path.realpath(os.path.dirname(vendored)) != os.path.realpath(HERE):
        text = open(vendored, encoding="utf-8", errors="replace").read()
        import re as _re
        m = _re.search(r'ENGINE_VERSION\s*=\s*"([^"]+)"', text)
        vv = m.group(1) if m else None
        if vv == E.ENGINE_VERSION:
            if text != open(os.path.join(HERE, "engine.py"), encoding="utf-8").read():
                rep.hard("dcfkit_modified", "dcfkit/engine.py in the run directory was modified -- restore it; "
                                            "put model-specific logic in model.py (or set engine_override_reason)")
        else:
            rep.warn("dcfkit_version", f"model was built with dcfkit engine {vv}; current is {E.ENGINE_VERSION}")
    std = set(getattr(sys, "stdlib_module_names", ())) | {"dcfkit", "__future__"}
    local = {os.path.splitext(f)[0] for f in os.listdir(model_dir) if f.endswith(".py")}
    bad = sorted(m for m in mods if (m not in std and m not in local) or m in FORBIDDEN_IMPORTS)
    if bad:
        rep.hard("model_py_imports", f"model.py imports {bad}: model.py must be stdlib + dcfkit only and "
                                     f"must not touch the network (fetch data in a separate script, save it "
                                     f"under sources/, and read it from there)")
    tmp = tempfile.mkdtemp(prefix="dcfval-")
    try:
        work = os.path.join(tmp, "m")
        shutil.copytree(model_dir, work, ignore=shutil.ignore_patterns(
            "events.jsonl", "*.log", "__pycache__", ".git", "node_modules", "*.xlsx"))
        for f in ("dcf.json",):
            if os.path.exists(os.path.join(work, f)):
                os.remove(os.path.join(work, f))
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1", PYTHONHASHSEED="0")
        outs = []
        for _ in range(2):
            p = subprocess.run([sys.executable, "model.py"], cwd=work, capture_output=True, text=True,
                               timeout=MODEL_TIMEOUT, env=env)
            if p.returncode != 0:
                rep.hard("model_py_run", f"`python3 model.py` failed: {p.stderr.strip()[-1500:]}")
                return
            j = os.path.join(work, "dcf.json")
            if not os.path.exists(j):
                rep.hard("model_py_run", "`python3 model.py` did not write dcf.json")
                return
            outs.append(json.load(open(j)))
        if _canon(_strip(outs[0])) != _canon(_strip(outs[1])):
            rep.hard("idempotent", "two runs of model.py produce different dcf.json (non-determinism)")
        elif _canon(_strip(outs[0])) != _canon(_strip(d)):
            rep.hard("idempotent", "dcf.json differs from what model.py produces -- re-run `python3 model.py` "
                                   "(never edit dcf.json by hand)")
        else:
            rep.ok("idempotent")
        p = subprocess.run([sys.executable, "-c", _PROBE], cwd=work, capture_output=True, text=True,
                           timeout=MODEL_TIMEOUT * 3, env=env)
        line = next((ln for ln in p.stdout.splitlines() if ln.startswith("__PROBE__")), None)
        if p.returncode != 0 or line is None:
            rep.hard("build_api", f"build(overrides) probe failed: {p.stderr.strip()[-1500:]}")
            return
        pr = json.loads(line[len("__PROBE__"):])
        if _canon(pr["default"]) != _canon(_strip(d)):
            rep.hard("build_api", "build() output differs from dcf.json")
        if not pr["default_empty"]:
            rep.hard("build_api", "build({}) differs from build()")
        if not pr["pure"]:
            rep.hard("purity", "build() after build(overrides) differs from the first build(): build() "
                               "mutates module-level state (deep-copy your defaults)")
        if not pr["unknown_raises"]:
            rep.hard("unknown_override", "build({'<unknown>': 1}) must raise (catches typo'd knobs)")
        dead = []
        for inp in d.get("inputs") or []:
            k = inp["key"]
            r = pr["knobs"].get(k) or {}
            if "error" in r:
                rep.hard("live_knobs", f"input {k!r}: build() raised {r['error']}")
                continue
            if not r.get("noop", True):
                rep.hard("live_knobs", f"input {k!r}: build({{{k!r}: its declared value}}) != build() -- "
                                       f"declared value is not the default")
            scope = inp.get("scope") or ["all"]
            ids = [s for s in r["lo"] if scope == ["all"] or s in scope]
            if scope == ["all"]:
                base = E.scenario_by_role(d, "base")
                ids = [base["id"]] if base else ids
            moved = [s for s in ids if not _close(r["lo"][s], r["hi"][s], rel=1e-7, abs_=1e-9)]
            if not moved:
                dead.append(k)
                continue
            sign = inp.get("expected_sign", "?")
            s0 = moved[0]
            direction = "+" if r["hi"][s0] > r["lo"][s0] else "-"
            if sign in "+-" and direction != sign and inp.get("type") != "enum":
                rep.hard("live_knobs", f"input {k!r}: value moves {direction} as the input rises, "
                                       f"expected_sign is {sign}")
        if dead:
            rep.hard("live_knobs", f"dead knobs (min vs max does not move value in scope): {dead}")
        elif d.get("inputs"):
            rep.ok("live_knobs", f"{len(d['inputs'])} inputs live")
    except subprocess.TimeoutExpired:
        rep.hard("model_py_run", f"model.py exceeded {MODEL_TIMEOUT}s")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _spellings(v):
    out = set()
    for fmt in ("{:.2f}", "{:,.2f}", "{:.1f}", "{:,.1f}", "{:.0f}", "{:,.0f}"):
        out.add(fmt.format(v))
    return out


def check_files(model_dir, rep, d=None):
    if rep.mode != "native":
        return
    path = os.path.join(model_dir, "report.md")
    if not os.path.exists(path):
        rep.hard("report", "report.md missing (PROMPT §12 narrative)")
        return
    if d is None:
        return
    text = open(path, encoding="utf-8", errors="replace").read()
    h = (d.get("headline") or {}).get("value_per_share")
    if h is None:
        base = E.scenario_by_role(d, "base")
        h = (base or {}).get("results", {}).get("value_per_share")
    if h is not None and not any(sp in text for sp in _spellings(h)):
        rep.hard("report_consistency", f"report.md does not state the headline value per share from dcf.json "
                                       f"({h:,.2f}, method {(d.get('headline') or {}).get('method')}) -- the "
                                       f"report must be written from the FINAL model numbers")


# --------------------------------------------------------------------------

def validate(path, mode="native", run_model=True):
    rep = Report(mode)
    try:
        d = json.load(open(path))
    except (OSError, json.JSONDecodeError) as exc:
        rep.hard("json", f"cannot read {path}: {exc}")
        return rep, None
    if not check_schema(d, rep):
        return rep, None
    check_rows(d, rep)
    check_terminal(d, rep)
    check_market(d, rep)
    check_stub(d, rep)
    repro = check_reproduction(d, rep)
    check_order(d, rep)
    check_guidance(d, rep)
    check_shares(d, rep)
    check_agent_checks(d, rep)
    check_content(d, rep)
    model_dir = os.path.dirname(os.path.abspath(path))
    check_files(model_dir, rep, d)
    if mode == "native" and run_model:
        check_model_py(d, model_dir, rep)
    return rep, repro


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path", nargs="?", default="dcf.json")
    ap.add_argument("--mode", choices=["native", "imported"], default="native")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--no-model", action="store_true", help="skip model.py execution checks")
    a = ap.parse_args(argv)
    rep, repro = validate(a.path, a.mode, run_model=not a.no_model)
    summ = rep.summary()
    if a.json:
        print(json.dumps({"mode": a.mode, "ok": not rep.failures, "summary": summ,
                          "reproduction": repro, "items": rep.items}, indent=1, default=str))
    else:
        for i in rep.items:
            if i["level"] != "pass":
                print(f"{i['level'].upper():5} {i['id']}: {i['message']}")
        print(f"\n{summ['fail']} fail, {summ['warn']} warn, {summ['pass']} pass  "
              f"[{a.mode}] -> {'OK' if not rep.failures else 'FIX THE FAILURES ABOVE'}")
    return 0 if not rep.failures else 1


if __name__ == "__main__":
    sys.exit(main())
