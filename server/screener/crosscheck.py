"""Cross-check screener fundamentals against DCF Studio models: SEC-frames annual
revenue vs the `historicals` revenue in each modelled ticker's latest dcf.json.

    uv run python -m server.screener.crosscheck
"""
from __future__ import annotations

from datetime import date

from server.prices import quote_symbol
from server.screener import fundamentals as F
from server.screener import sources as S
from server.store import MODELS, STORE, read_json


def annual_revenue_by_cik():
    p = F.periods()
    frames = {}
    for tax, tag, unit in F.DURATION["revenue"][0]:
        for label, _ in p["annual"]:
            frames[(tax, tag, unit, label)] = S.frame(tax, tag, unit, label, ttl=10 ** 9)
    facts, _ = F.index_frames(frames)
    out = {}
    for cik, cf in facts.items():
        out[cik] = {a["end"]: a["val"] / 1e6 for a in F._group_series(cf, "revenue", [l for l, _ in p["annual"]])}
    return out


def run(tol=0.03):
    tick = S.sec_tickers()
    rev = annual_revenue_by_cik()
    report = []
    for t in STORE.summary():
        for v in t["latest"].values():
            if not v:
                continue
            d = read_json(MODELS / t["ticker"] / v["version_id"] / "dcf.json") or {}
            if (d.get("basis") or {}).get("reporting_currency", "USD") != "USD":
                continue
            hist = [r for r in (d.get("historicals") or {}).get("rows") or [] if r.get("revenue")]
            sym = quote_symbol(t["ticker"])
            info = tick.get(S.sec_key(sym))
            if not hist or not info:
                continue
            series = rev.get(info["cik"]) or {}
            for h in hist:
                end = date.fromisoformat(h["period_end"][:10])
                match = min(series.items(), key=lambda kv: abs((kv[0] - end).days), default=None)
                if not match or abs((match[0] - end).days) > 20:
                    continue
                diff = match[1] / h["revenue"] - 1 if h["revenue"] else None
                report.append({"ticker": t["ticker"], "version": v["version_id"], "period_end": h["period_end"],
                               "model_rev": h["revenue"], "sec_rev": match[1], "diff": diff,
                               "ok": diff is not None and abs(diff) <= tol})
    return report


if __name__ == "__main__":
    rep = run()
    ok = sum(1 for r in rep if r["ok"])
    print(f"{len(rep)} model-year comparisons: {ok} within 3%, {len(rep) - ok} outside")
    for r in sorted(rep, key=lambda r: -abs(r["diff"] or 0))[:15]:
        if not r["ok"]:
            print(f"  {r['ticker']:6} {r['period_end']}  model {r['model_rev']:>10,.0f}  SEC {r['sec_rev']:>10,.0f}  "
                  f"{(r['diff'] or 0):+.1%}  ({r['version']})")
