#!/usr/bin/env python3
"""Check a screener agent's output. Standard library only (copied into each run
dir as check_output.py).

    python3 check_output.py shortlist      # validates shortlist.json + report.md vs screen.csv
    python3 check_output.py theme          # validates universe.json vs universe_index.csv
    add --json for machine-readable output. Exit 0 = OK.
"""
import csv
import json
import os
import sys


def _symbols(path):
    with open(path, newline="", encoding="utf-8") as fh:
        return {row["symbol"].strip().upper() for row in csv.DictReader(fh) if row.get("symbol")}


def check(mode, d="."):
    items = []

    def add(level, cid, msg):
        items.append({"level": level, "id": cid, "message": msg})

    if mode == "shortlist":
        src, out = os.path.join(d, "screen.csv"), os.path.join(d, "shortlist.json")
        meta = {}
        try:
            meta = json.load(open(os.path.join(d, "screen.json")))
        except (OSError, json.JSONDecodeError):
            pass
        top_n = int(meta.get("top_n") or 10)
        valid = _symbols(src)
        try:
            doc = json.load(open(out))
        except (OSError, json.JSONDecodeError) as exc:
            add("fail", "json", f"shortlist.json missing or not valid JSON: {exc}")
            doc = None
        if isinstance(doc, dict):
            picks = doc.get("picks")
            if not isinstance(picks, list) or not picks:
                add("fail", "picks", "shortlist.json needs a non-empty 'picks' list")
            else:
                if len(picks) > top_n:
                    add("fail", "count", f"{len(picks)} picks; at most {top_n}")
                seen = set()
                for i, p in enumerate(picks, 1):
                    sym = str(p.get("symbol", "")).strip().upper()
                    if sym not in valid:
                        add("fail", "symbol", f"pick {i}: {sym!r} is not a symbol in screen.csv")
                    if sym in seen:
                        add("fail", "duplicate", f"pick {i}: {sym} listed twice")
                    seen.add(sym)
                    if p.get("rank") != i:
                        add("fail", "rank", f"pick {i}: rank must be {i} (picks ordered best first)")
                    for k, lo, hi in (("thesis", 40, 1500), ("why_now", 10, 800), ("key_risk", 10, 800)):
                        v = str(p.get(k) or "")
                        if not lo <= len(v) <= hi:
                            add("fail", k, f"pick {i} ({sym}): '{k}' must be {lo}-{hi} characters")
        elif doc is not None:
            add("fail", "json", "shortlist.json must be an object")
        rp = os.path.join(d, "report.md")
        if not os.path.exists(rp) or os.path.getsize(rp) < 200:
            add("fail", "report", "report.md missing or too short")
    elif mode == "theme":
        src, out = os.path.join(d, "universe_index.csv"), os.path.join(d, "universe.json")
        valid = _symbols(src)
        try:
            doc = json.load(open(out))
        except (OSError, json.JSONDecodeError) as exc:
            add("fail", "json", f"universe.json missing or not valid JSON: {exc}")
            doc = None
        if isinstance(doc, dict):
            if not str(doc.get("name") or "").strip():
                add("fail", "name", "universe.json needs a 'name'")
            members = doc.get("members")
            if not isinstance(members, list) or not 3 <= len(members) <= 200:
                add("fail", "members", "universe.json needs 3-200 'members'")
            else:
                seen = set()
                bad = []
                for m in members:
                    sym = str((m or {}).get("symbol", "")).strip().upper()
                    if sym not in valid:
                        bad.append(sym)
                    if sym in seen:
                        add("fail", "duplicate", f"{sym} listed twice")
                    seen.add(sym)
                    if len(str((m or {}).get("note") or "")) > 400:
                        add("fail", "note", f"{sym}: note longer than 400 characters")
                if bad:
                    add("fail", "symbol", f"not in universe_index.csv: {bad[:30]}")
        elif doc is not None:
            add("fail", "json", "universe.json must be an object")
    else:
        add("fail", "mode", f"unknown mode {mode!r}")
    fails = sum(1 for i in items if i["level"] == "fail")
    if not fails:
        items.append({"level": "pass", "id": mode, "message": "output OK"})
    return {"mode": mode, "ok": not fails,
            "summary": {"fail": fails, "warn": sum(1 for i in items if i["level"] == "warn"),
                        "pass": sum(1 for i in items if i["level"] == "pass")},
            "reproduction": None, "items": items}


if __name__ == "__main__":
    mode = next((a for a in sys.argv[1:] if not a.startswith("--")), "shortlist")
    res = check(mode)
    if "--json" in sys.argv:
        print(json.dumps(res, indent=1))
    else:
        for i in res["items"]:
            print(f"{i['level'].upper():5} {i['id']}: {i['message']}")
        print("OK" if res["ok"] else "FIX THE FAILURES ABOVE")
    sys.exit(0 if res["ok"] else 1)
