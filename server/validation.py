"""Run the CANONICAL validator (dcf_studio/dcfkit, never the run dir's vendored
copy, which the agent could edit) and persist validation.json."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from server.store import ROOT, write_json

VALIDATOR = ROOT / "dcfkit" / "validate.py"


def run_validation(path, mode="native", timeout=900):
    path = Path(path)
    dcf = path / "dcf.json"
    if not dcf.exists():
        res = {"mode": mode, "ok": False, "summary": {"fail": 1, "warn": 0, "pass": 0},
               "reproduction": None,
               "items": [{"level": "fail", "id": "dcf_json", "message": "dcf.json was not produced"}]}
        write_json(path / "validation.json", res)
        return res
    try:
        p = subprocess.run([sys.executable, str(VALIDATOR), str(dcf), "--mode", mode, "--json"],
                           capture_output=True, text=True, timeout=timeout, cwd=str(path))
        res = json.loads(p.stdout)
    except subprocess.TimeoutExpired:
        res = {"mode": mode, "ok": False, "summary": {"fail": 1, "warn": 0, "pass": 0}, "reproduction": None,
               "items": [{"level": "fail", "id": "timeout", "message": f"validator exceeded {timeout}s"}]}
    except json.JSONDecodeError:
        res = {"mode": mode, "ok": False, "summary": {"fail": 1, "warn": 0, "pass": 0}, "reproduction": None,
               "items": [{"level": "fail", "id": "validator_crash",
                          "message": (p.stderr or p.stdout)[-2000:]}]}
    write_json(path / "validation.json", res)
    return res


def format_failures(res, limit=60):
    lines = [f"{i['level'].upper()} {i['id']}: {i['message']}" for i in res.get("items", [])
             if i["level"] in ("fail", "warn")]
    return "\n".join(lines[:limit])
