"""Screener agent jobs on the existing runner: a shortlist (pick the names most
worth a full DCF) or a theme universe (map a theme to listed symbols).

Run dirs: data/screener/agent/SCREEN_<stamp>_<cli>/ with run.json, prompt.md,
inputs (screen.csv / universe_index.csv), check_output.py and the outputs.
"""
from __future__ import annotations

import csv
import json
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from server.runner import RUNNER, cfg
from server.screener import screens as SC
from server.screener import table as T
from server.screener import universes as U
from server.store import AGENT_RUNS, ROOT, now_iso, read_json, write_json

CHECKER = Path(__file__).with_name("agent_validate.py")
PROMPTS = ROOT / "prompts"
CSV_COLS = ["symbol", "name", "sector", "industry", "market_cap", "price", "ev", "revenue", "rev_growth",
            "op_margin", "fcf", "fcf_margin", "fcf_yield", "ev_ebit", "ev_sales", "pe", "implied_growth",
            "implied_gap", "implied_rev_cagr", "rule_of_40", "sbc_pct", "dilution", "net_cash_pct",
            "earnings_date", "days_to_earnings", "pct_below_high", "mom_12m", "n_models", "model_upside",
            "revenue_basis", "cashflow_basis", "data_age_days", "flags"]
MAX_ROWS = 150


def _fmt(v):
    if isinstance(v, float):
        return f"{v:.4g}"
    if isinstance(v, list):
        return ";".join(v)
    return "" if v is None else str(v)


def _new_dir(cli):
    AGENT_RUNS.mkdir(parents=True, exist_ok=True)
    base = f"SCREEN_{datetime.now():%Y%m%d-%H%M%S}_{cli}"
    vid, n = base, 1
    while (AGENT_RUNS / vid).exists():
        vid = f"{base}-{n}"
        n += 1
    path = AGENT_RUNS / vid
    path.mkdir()
    shutil.copy(CHECKER, path / "check_output.py")
    return vid, path


def _submit(vid, path, kind, prompt, cli, model, effort, extra):
    from server.models_catalog import resolve_model
    if cli == "claude":
        model = model or cfg("screener", "agent_model", "sonnet")
    else:
        model = resolve_model(cli, model or cfg(f"backends.{cli}", "model"))
    effort = effort or cfg("screener", "agent_effort", "medium")
    (path / "prompt.md").write_text(prompt)
    job = {"vid": vid, "ticker": "_SCREENER", "cli": cli, "model": model, "effort": effort,
           "validation_mode": kind, "producer": cli, "max_budget_usd": cfg("screener", "agent_budget_usd", 3)}
    meta = {"id": vid, "ticker": "_SCREENER", "source": cli, "origin": "run", "kind": kind, "status": "queued",
            "created_at": now_iso(), "started_at": None, "finished_at": None, "cli": cli, "model": model,
            "effort": effort, "pid": None, "parent_version": None, "instructions": extra.get("instructions"),
            "exit_code": None, "error": None, "usage": {}, "attempts": [], "screener": extra, "job": job}
    write_json(path / "run.json", meta)
    RUNNER.agent_queue.put_nowait(job)
    return vid


def submit_shortlist(screen, *, top_n=10, objective=None, cli="claude", model=None, effort=None):
    res = SC.query(screen)
    rows = res["rows"][:MAX_ROWS]
    if not rows:
        raise ValueError("the screen matches no stocks")
    top_n = max(1, min(int(top_n or 10), 25))
    vid, path = _new_dir(cli)
    with open(path / "screen.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(CSV_COLS)
        for r in rows:
            w.writerow([_fmt(r.get(c)) for c in CSV_COLS])
    fields = {f[0]: f for f in SC.FIELDS}
    lines = ["# screen.csv columns", "", "Money in $M; percentages as fractions (0.15 = 15%). Screening-grade: "
             "as-reported GAAP from SEC XBRL frames, levered FCF, fundamentals may lag the price by a quarter.", ""]
    for c in CSV_COLS:
        f = fields.get(c)
        lines.append(f"- `{c}` — {f[1] if f else c}{(': ' + f[4]) if f and f[4] else ''}")
    from server.screener.api import FLAG_HELP
    lines += ["", "## flags", ""] + [f"- `{k}` — {v}" for k, v in FLAG_HELP.items()]
    (path / "fields.md").write_text("\n".join(lines) + "\n")
    write_json(path / "screen.json", {"screen": screen, "top_n": top_n, "matched": res["matched"],
                                      "rows_given": len(rows), "params": res["params"], "asof": res["asof"]})
    name = screen.get("name") or "custom screen"
    prompt = (PROMPTS / "screen_shortlist.md").read_text().format(
        workdir=str(path), top_n=top_n, n_rows=len(rows), matched=res["matched"], screen_name=name,
        objective=(objective or "none given — use your judgement").strip(),
        today=datetime.now().date().isoformat())
    return _submit(vid, path, "shortlist", prompt, cli, model, effort,
                   {"screen": screen, "top_n": top_n, "objective": objective, "instructions": objective})


def submit_theme(query, *, list_name=None, cli="claude", model=None, effort=None):
    rows = T.table().get("rows") or []
    if not rows:
        raise ValueError("screener table is empty -- refresh the data first")
    vid, path = _new_dir(cli)
    with open(path / "universe_index.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["symbol", "name", "sector", "industry", "market_cap", "country"])
        for r in sorted(rows, key=lambda r: -(r.get("market_cap") or 0)):
            if "secondary_class" in (r.get("flags") or []):
                continue
            w.writerow([r["symbol"], r["name"], r.get("sector"), r.get("industry"),
                        _fmt(r.get("market_cap")), r.get("country")])
    prompt = (PROMPTS / "screen_theme.md").read_text().format(
        workdir=str(path), query=query.strip(), today=datetime.now().date().isoformat())
    return _submit(vid, path, "theme", prompt, cli, model, effort,
                   {"query": query.strip(), "list_name": list_name, "instructions": query.strip()})


def validate_dir(path, mode):
    """Run the canonical checker (not the run dir's copy) and persist validation.json."""
    p = subprocess.run([sys.executable, str(CHECKER), mode, "--json"], cwd=str(path), capture_output=True,
                       text=True, timeout=120)
    try:
        res = json.loads(p.stdout)
    except json.JSONDecodeError:
        res = {"mode": mode, "ok": False, "summary": {"fail": 1, "warn": 0, "pass": 0}, "reproduction": None,
               "items": [{"level": "fail", "id": "checker", "message": (p.stderr or p.stdout)[-1500:]}]}
    write_json(Path(path) / "validation.json", res)
    return res


def finalize_theme(path):
    path = Path(path)
    meta = read_json(path / "run.json", {}) or {}
    doc = read_json(path / "universe.json") or {}
    extra = meta.get("screener") or {}
    name = extra.get("list_name") or doc.get("name") or extra.get("query") or "theme"
    members = [{"symbol": m.get("symbol"), "name": m.get("name"),
                "note": " · ".join(x for x in (m.get("exposure"), m.get("note")) if x)}
               for m in doc.get("members") or []]
    saved = U.save({"slug": U.slugify(name), "name": name, "kind": "agent", "members": members,
                    "source": {"by": "agent", "run_id": path.name, "query": extra.get("query"),
                               "cli": meta.get("cli"), "model": meta.get("model"),
                               "description": doc.get("description")}})
    from server.store import update_run
    update_run(path, result_list=saved["slug"])
    return saved["slug"]


def list_runs(limit=50):
    out = []
    for rj in AGENT_RUNS.glob("*/run.json"):
        m = read_json(rj, {}) or {}
        m.pop("job", None)
        out.append(m)
    out.sort(key=lambda m: m.get("created_at") or "", reverse=True)
    return out[:limit]


def result(vid):
    path = AGENT_RUNS / vid
    if not path.is_dir():
        return None
    meta = read_json(path / "run.json", {}) or {}
    meta.pop("job", None)
    report = path / "report.md"
    return {"run": meta, "validation": read_json(path / "validation.json"),
            "shortlist": read_json(path / "shortlist.json"), "universe": read_json(path / "universe.json"),
            "screen": read_json(path / "screen.json"),
            "report": report.read_text() if report.exists() else None}
