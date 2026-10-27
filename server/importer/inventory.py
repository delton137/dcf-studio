"""Legacy model inventory (Claude_DCFs, codex_dcf_models, grok_dcf_models) and
import orchestration.

Grok models are converted deterministically (server/importer/grok_xlsx.py);
Claude and Codex models by Sonnet conversion agents through the run queue.
Legacy folders are read-only: files are COPIED into each version's legacy/.
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path

from server.store import LEGACY_ROOT, MODELS, read_json

CLAUDE = LEGACY_ROOT / "Claude_DCFs"
CODEX = LEGACY_ROOT / "codex_dcf_models"
GROK = LEGACY_ROOT / "grok_dcf_models"

# module prefix -> (ticker, workbook, generation, superseded_by_prefix)
CLAUDE_MODELS = {
    "amd": ("AMD", "AMD_DCF.xlsx", "claude_g2"), "amkr": ("AMKR", "AMKR.xlsx", "claude_g1"),
    "apld": ("APLD", "APLD_DCF.xlsx", "claude_g2"), "avgo": ("AVGO", "AVGO_DCF_v2.xlsx", "claude_g2"),
    "bbai": ("BBAI", "BBAI_DCF.xlsx", "claude_g1"), "bbai2": ("BBAI", "BBAI_DCF_v2.xlsx", "claude_g2"),
    "be": ("BE", "BE_DCF.xlsx", "claude_g2"), "cbrs": ("CBRS", "CBRS_DCF.xlsx", "claude_g2"),
    "cbrs2": ("CBRS", "CBRS_DCF_v2.xlsx", "claude_g2"), "ceg": ("CEG", "CEG_DCF.xlsx", "claude_g1"),
    "ceg2": ("CEG", "CEG_DCF_v2.xlsx", "claude_g2"), "corz": ("CORZ", "CORZ_DCF.xlsx", "claude_g2"),
    "crwv": ("CRWV", "CRWV_DCF.xlsx", "claude_g1"), "dell": ("DELL", "DELL_DCF.xlsx", "claude_sotp"),
    "etn": ("ETN", "ETN_DCF.xlsx", "claude_g2"), "iren": ("IREN", "IREN.xlsx", "claude_g1"),
    "joby": ("JOBY", "JOBY_DCF.xlsx", "claude_g1"), "mcd": ("MCD", "MCD_DCF.xlsx", "claude_g3"),
    "meta": ("META", "META_DCF.xlsx", "claude_g1"), "mrna": ("MRNA", None, "claude_rnpv"),
    "mrvl": ("MRVL", "MRVL_DCF.xlsx", "claude_g2"), "mu": ("MU", "MU_DCF_v3.xlsx", "claude_g2"),
    "nke": ("NKE", "NKE_DCF.xlsx", "claude_g2"), "nvda": ("NVDA", "NVDA_DCF.xlsx", "claude_g1"),
    "on": ("ON", "ON.xlsx", "claude_g1"), "rddt": ("RDDT", "RDDT_DCF.xlsx", "claude_g1"),
    "rivn": ("RIVN", "RIVN.xlsx", "claude_g1"), "simo": ("SIMO", "SIMO_DCF.xlsx", "claude_g2"),
    "sndk": ("SNDK", "SNDK_DCF.xlsx", "claude_g2"), "sny": ("SNY", "SNY_DCF.xlsx", "claude_g2"),
    "spcx": ("SPCX", "SPCX.xlsx", "claude_g1"), "tsm": ("TSM", "TSM_DCF.xlsx", "claude_g2"),
    "ual": ("UAL", "UAL.xlsx", "claude_g1"), "unh": ("UNH", "UNH_DCF.xlsx", "claude_g1"),
    "wm": ("WM", "WM_DCF.xlsx", "claude_wm"), "wmt": ("WMT", "WMT_DCF.xlsx", "claude_g3"),
    "wrd": ("WRD", "WRD_DCF.xlsx", "claude_g2"),
}
CLAUDE_SUPERSEDED = {"bbai": "bbai2", "cbrs": "cbrs2", "ceg": "ceg2"}
# workbook-only items: (ticker, workbook, extra files, quality, note)
CLAUDE_WORKBOOKS = [
    ("AMZN", "AMZN_DCF.xlsx", [], "verified", "extracted Claude sheets from a hybrid workbook; no Python source"),
    ("NBIS", "NBIS_DCF.xlsx", ["nbis_bull.py", "build_nbis_bull.py"], "verified",
     "extracted DCF / Bull_Case / Goldman_Check sheets; nbis_bull.py is a side bull-case script"),
    ("SHAZ", "SHAZ.xlsx", [], "verified", "neocloud workbook; no Python source"),
    ("AVGO", "AVGO_DCF.xlsx", [], "unverified",
     "May-2026 snapshot: 0 formulas, hardcoded numbers; superseded by avgo_model + AVGO_DCF_v2"),
    ("PYPL", "PYPL_DCF.xlsx", [], "unverified", "earlier-AI single-sheet workbook, never put through checks"),
    ("NOVOB", "NOVOB_DCF.xlsx", [], "unverified", "earlier-AI single-sheet workbook (DCF_Q126 sheet)"),
]
# shared helpers some modules import / that hold extra checks
CLAUDE_EXTRAS = {
    "wm": ["verify_wm.py", "prove_wm_live.py"], "nke": ["verify_nke.py"], "etn": ["verify_etn.py"],
    "sny": ["verify_sny.py", "sny_upside.py"], "meta": ["meta_checks.py", "meta_tieout.py"],
    "crwv": ["crwv_q2_review.py"], "dell": ["verify_dell_workbook.py"], "mcd": ["verify_mcd_workbook.py"],
    "wmt": ["verify_wmt_workbook.py"], "wrd": ["verify_wrd_workbook.py"], "mu": ["memory_compare.py"],
}

CODEX_MODELS = [
    {"key": "mu", "ticker": "MU", "generation": "codex_json",
     "files": ["build_mu_dcf.py", "verify_mu_dcf.py", "render_mu_dcf.mjs", "mu_dcf.xlsx",
               "outputs/mu_20260930/case_results.json", "outputs/mu_20260930/native_verification.json",
               "outputs/mu_20260930/artifact_verification.json", "outputs/mu_20260930/workbook_spec.json"],
     "note": "memory: bit volume x price per scenario; case_results.json has no WACC/g/price -- those are "
             "in build_mu_dcf.py (I, SC)"},
    {"key": "bioa", "ticker": "BIOA", "generation": "codex_json",
     "files": ["build_bioa_dcf.py", "BIOA_MODEL.md", "render_bioa_dcf.mjs", "bioa_dcf.xlsx",
               "outputs/bioa_20260928/model_results.json", "outputs/bioa_20260928/validation.json",
               "outputs/bioa_20260928/workbook_spec.json", "sources/bioa/market_snapshot.json"],
     "note": "risk-adjusted drug pipeline, finite life, NO terminal value; options valued as a "
             "Black-Scholes claim; reverse DCF = implied approval probability"},
    {"key": "ceg", "ticker": "CEG", "generation": "codex_xlsx",
     "files": ["build_ceg_dcf.py", "ceg_dcf.xlsx"],
     "note": "TWh x margin per MWh; formula workbook without cached values (recalculate via the "
             "build script's own Python or LibreOffice)"},
    {"key": "spacex", "ticker": "SPCX", "generation": "codex_xlsx",
     "files": ["build_spacex_dcf.py", "spacex_dcf.xlsx"],
     "note": "SpaceX sum-of-the-parts (ticker SPCX as in the other folders); formula workbook without "
             "cached values"},
]


def _mtime(p):
    return datetime.fromtimestamp(Path(p).stat().st_mtime)


def claude_items():
    items = []
    for prefix, (ticker, wb, gen) in CLAUDE_MODELS.items():
        files = [f"{prefix}_model.py"]
        if wb:
            files.append(wb)
        build = f"build_{prefix}.py"
        if (CLAUDE / build).exists():
            files.append(build)
        files += [f for f in CLAUDE_EXTRAS.get(prefix, []) if (CLAUDE / f).exists()]
        if (CLAUDE / "verify_workbook.py").exists():
            files.append("verify_workbook.py")
        sup = CLAUDE_SUPERSEDED.get(prefix)
        items.append({
            "legacy_id": f"claude:{prefix}_model", "source": "claude", "ticker": ticker, "generation": gen,
            "files": [f"Claude_DCFs/{f}" for f in files], "quality": "verified",
            "superseded_by": f"claude:{sup}_model" if sup else None,
            "main": f"Claude_DCFs/{prefix}_model.py",
            "notes": "superseded by a later version of the same model" if sup else None,
        })
    for ticker, wb, extra, quality, note in CLAUDE_WORKBOOKS:
        items.append({
            "legacy_id": f"claude:{wb}", "source": "claude", "ticker": ticker, "generation": "claude_xlsx",
            "files": [f"Claude_DCFs/{f}" for f in [wb] + extra], "quality": quality,
            "superseded_by": "claude:avgo_model" if wb == "AVGO_DCF.xlsx" else None,
            "main": f"Claude_DCFs/{wb}", "notes": note,
        })
    return items


def codex_items():
    out = []
    for m in CODEX_MODELS:
        out.append({"legacy_id": f"codex:{m['key']}", "source": "codex", "ticker": m["ticker"],
                    "generation": m["generation"], "files": [f"codex_dcf_models/{f}" for f in m["files"]],
                    "quality": "verified", "superseded_by": None, "main": f"codex_dcf_models/{m['files'][0]}",
                    "notes": m["note"]})
    return out


def grok_items():
    out = []
    for x in sorted(GROK.glob("*_DCF_Model.xlsx")):
        t = x.name.split("_DCF_Model")[0]
        if t == "CRBS":
            continue  # byte-level duplicate of CBRS (ticker typo)
        out.append({"legacy_id": f"grok:{t}", "source": "grok", "ticker": t, "generation": "grok_xlsx",
                    "files": [f"grok_dcf_models/{x.name}"], "quality": "verified", "superseded_by": None,
                    "main": f"grok_dcf_models/{x.name}", "notes": "deterministic converter"})
    return out


def all_items():
    return claude_items() + codex_items() + grok_items()


def _existing_imports():
    """legacy main-file path -> list of run.json metas of import versions."""
    found = {}
    for rj in MODELS.glob("*/*import*/run.json"):
        meta = read_json(rj, {}) or {}
        blob = json.dumps(meta.get("legacy") or {})
        meta["_vid"] = rj.parent.name
        meta["_val"] = read_json(rj.parent / "validation.json")
        found[f"{rj.parent.parent.name}/{rj.parent.name}"] = (blob, meta)
    return found


def status():
    existing = _existing_imports()
    items = []
    for it in all_items():
        main_name = Path(it["main"]).name
        match = None
        for key, (blob, meta) in sorted(existing.items(), reverse=True):
            if not key.startswith(it["ticker"] + "/"):
                continue
            if f'"{it["legacy_id"]}"' in blob or re.search(rf'["/]{re.escape(main_name)}"', blob):
                match = meta
                break
        it = dict(it)
        if match:
            it["status"] = match.get("status")
            it["version_id"] = match["_vid"]
            val = match.get("_val") or {}
            it["validation"] = val.get("summary")
            it["reproducibility"] = (val.get("reproduction") or {}).get("grade")
            it["crosscheck"] = (match.get("legacy") or {}).get("crosscheck")
        else:
            it["status"], it["version_id"], it["crosscheck"] = "pending", None, None
        items.append(it)
    summ = {}
    for it in items:
        summ[it["status"]] = summ.get(it["status"], 0) + 1
    return {"items": items, "summary": summ}


def launch(legacy_ids, *, all_=False):
    from server.runner import RUNNER
    st = {it["legacy_id"]: it for it in status()["items"]}
    todo = [it for it in st.values() if it["status"] == "pending"] if all_ else \
        [st[i] for i in legacy_ids if i in st]
    launched = []
    grok = [it for it in todo if it["source"] == "grok"]
    if grok:
        from server.importer import grok_xlsx
        for it in grok:
            try:
                res = grok_xlsx.import_tickers([it["ticker"]])
                launched.append({"legacy_id": it["legacy_id"], "result": str(res)[:200]})
            except Exception as exc:
                launched.append({"legacy_id": it["legacy_id"], "error": str(exc)})
    for it in todo:
        if it["source"] == "grok":
            continue
        vid = RUNNER.submit_import(it, ts=_mtime(LEGACY_ROOT / it["main"]))
        launched.append({"legacy_id": it["legacy_id"], "version_id": vid})
    return {"launched": launched}
