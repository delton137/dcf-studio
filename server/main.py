"""DCF Studio API.  uv run uvicorn server.main:app --host 127.0.0.1 --port 8765"""
from __future__ import annotations

import asyncio
import json
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response, StreamingResponse
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from server import backends as B
from server import prices as PR
from server import whatif as W
from server.runner import CONFIG, RUNNER, cfg
from server.store import (MODELS, ROOT, SOURCES, STORE, TERMINAL_STATUSES, find_run_dir, find_version_dir,
                          get_price, load_dcf, run_json_paths,
                          read_json, set_price)


@asynccontextmanager
async def lifespan(app):
    await RUNNER.start()
    from server.screener import refresh as SR
    from server.screener import universes as SU
    SU.ensure_seeds()
    from server import models_catalog as MC
    MC.refresh_background()
    age = SR.table_age_hours()
    if age is None or age > float(cfg("screener", "auto_refresh_hours", 20)):
        SR.start_background()
    yield
    W.shutdown()
    await RUNNER.stop()


app = FastAPI(title="DCF Studio", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=2048)

from server.screener.api import router as screener_router  # noqa: E402

app.include_router(screener_router)


def _vdir(vid):
    p = find_run_dir(vid)
    if p is None:
        raise HTTPException(404, f"version {vid} not found")
    return p


# --------------------------------------------------------------------------
# config / summary / versions
# --------------------------------------------------------------------------

@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/config")
def config():
    from server import models_catalog as MC
    cat = MC.catalog()
    out = {}
    for s in SOURCES:
        b = (cat.get("backends") or {}).get(s) or {}
        opts = b.get("models") or []
        setting = cfg(f"backends.{s}", "model")
        efforts = []
        for o in opts:
            efforts += [e for e in o.get("efforts") or [] if e not in efforts]
        out[s] = {**B.BACKENDS[s], "available": B.available(s), "version": B.version(s),
                  "models": [o["id"] for o in opts], "model_options": opts, "efforts": efforts,
                  "default_model": MC.resolve_model(s, setting), "default_model_setting": setting,
                  "latest": b.get("latest"), "cli_default": b.get("cli_default"),
                  "default_effort": cfg(f"backends.{s}", "effort"),
                  "catalog": {"fetched_at": b.get("fetched_at"), "source": b.get("source"), "error": b.get("error")},
                  "paused": RUNNER.paused.get(s)}
    return {"backends": out, "runs": CONFIG.get("runs", {}), "imports": CONFIG.get("imports", {}),
            "overlay_knobs": __import__("dcfkit.engine", fromlist=["x"]).OVERLAY_KNOBS}


@app.post("/api/config/models/refresh")
async def refresh_models():
    from server import models_catalog as MC
    cat = await asyncio.to_thread(MC.refresh)
    return {"fetched_at": cat.get("fetched_at"),
            "errors": {s: b.get("error") for s, b in (cat.get("backends") or {}).items() if b.get("error")}}


@app.get("/api/summary")
def summary():
    return {"tickers": STORE.summary()}


@app.get("/api/tickers/{ticker}")
def ticker(ticker: str):
    versions = STORE.versions(ticker)
    if not versions:
        raise HTTPException(404, f"no versions for {ticker}")
    company = next((v["company"] for v in versions if v["company"]), None)
    return {"ticker": ticker.upper(), "company": company, "compare_price": get_price(ticker), "versions": versions}


@app.get("/api/tickers/{ticker}/compare")
def compare(ticker: str, versions: Optional[str] = None):
    """Full dcf.json for the latest version of each source (or the given ids)."""
    vs = STORE.versions(ticker)
    if versions:
        ids = versions.split(",")
    else:
        ids = [v["version_id"] for v in vs if v["latest"]]
    out = []
    for vid in ids:
        d = load_dcf(vid)
        if d is not None:
            out.append({"summary": STORE.get(vid), "dcf": d})
    return {"ticker": ticker.upper(), "compare_price": get_price(ticker), "models": out}


@app.get("/api/versions/{vid}")
def version(vid: str):
    p = _vdir(vid)
    return {"summary": STORE.get(vid), "dcf": load_dcf(vid), "run": _public_run(read_json(p / "run.json", {})),
            "validation": read_json(p / "validation.json")}


def _public_run(meta):
    meta = dict(meta or {})
    meta.pop("job", None)
    return meta


SKIP_DIRS = {"dcfkit", "__pycache__", ".git"}


@app.get("/api/versions/{vid}/files")
def files(vid: str):
    p = _vdir(vid)
    out = []
    for f in sorted(p.rglob("*")):
        rel = f.relative_to(p)
        if f.is_file() and not (set(rel.parts[:-1]) & SKIP_DIRS) and not rel.name.startswith(".tmp"):
            out.append({"path": str(rel), "size": f.stat().st_size})
    return out


@app.get("/api/versions/{vid}/file")
def file(vid: str, path: str):
    p = _vdir(vid)
    f = (p / path).resolve()
    if not str(f).startswith(str(p.resolve()) + "/") or not f.is_file():
        raise HTTPException(404, "no such file")
    mt = mimetypes.guess_type(f.name)[0] or "text/plain"
    if f.suffix in (".py", ".md", ".jsonl", ".log", ".txt", ".csv", ".toml"):
        mt = "text/plain; charset=utf-8"
    return FileResponse(f, media_type=mt)


@app.get("/api/versions/{vid}/report")
def report(vid: str):
    p = _vdir(vid)
    f = p / "report.md"
    return PlainTextResponse(f.read_text() if f.exists() else "", media_type="text/markdown")


@app.get("/api/versions/{vid}/export.xlsx")
def export_xlsx(vid: str):
    from server.xlsx_export import export
    p = _vdir(vid)
    data = export(load_dcf(vid, with_derived=False))
    return Response(data, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{p.parent.name}_{vid}.xlsx"'})


# --------------------------------------------------------------------------
# what-if
# --------------------------------------------------------------------------

class WhatIf(BaseModel):
    knobs: dict[str, Any] = {}
    overrides: dict[str, Any] = {}
    scenario_ids: Optional[list[str]] = None


@app.post("/api/versions/{vid}/whatif")
async def whatif(vid: str, body: WhatIf):
    _vdir(vid)
    try:
        return await asyncio.to_thread(W.recompute, vid, knobs=body.knobs, overrides=body.overrides,
                                       scenario_ids=body.scenario_ids)
    except (ValueError, KeyError, TimeoutError, RuntimeError) as exc:
        raise HTTPException(422, str(exc))


class SaveWhatIf(WhatIf):
    name: str
    note: Optional[str] = None


@app.get("/api/versions/{vid}/whatifs")
def whatifs(vid: str):
    return W.list_saved(vid)


@app.post("/api/versions/{vid}/whatifs")
async def save_whatif(vid: str, body: SaveWhatIf):
    _vdir(vid)
    try:
        return await asyncio.to_thread(W.save, vid, body.name, body.knobs, body.overrides, body.note)
    except (ValueError, KeyError, TimeoutError, RuntimeError) as exc:
        raise HTTPException(422, str(exc))


@app.post("/api/versions/{vid}/promote")
async def promote(vid: str, body: SaveWhatIf):
    _vdir(vid)
    try:
        return await asyncio.to_thread(W.promote, vid, body.name, body.knobs, body.overrides, body.note)
    except (ValueError, KeyError, TimeoutError, RuntimeError) as exc:
        raise HTTPException(422, str(exc))


@app.delete("/api/versions/{vid}/whatifs/{slug}")
def delete_whatif(vid: str, slug: str):
    return {"deleted": W.delete(vid, slug)}


# --------------------------------------------------------------------------
# runs
# --------------------------------------------------------------------------

class RunRequest(BaseModel):
    ticker: str
    sources: list[str]
    mode: str = "new"                              # new | update
    parent_versions: dict[str, str] = {}           # source -> version id (update mode)
    instructions: Optional[str] = None
    models: dict[str, str] = {}
    efforts: dict[str, str] = {}


@app.post("/api/runs")
def start_runs(req: RunRequest):
    ticker = req.ticker.strip().upper()
    if not ticker or not ticker.replace(".", "").replace("-", "").isalnum():
        raise HTTPException(400, "bad ticker")
    started = []
    versions = STORE.versions(ticker) if (MODELS / ticker).exists() else []
    for src in req.sources:
        if src not in SOURCES:
            raise HTTPException(400, f"unknown source {src}")
        if not B.available(src):
            raise HTTPException(400, f"{src} CLI not found on PATH")
        mode, parent = req.mode, None
        if mode == "update":
            pid = req.parent_versions.get(src)
            if pid:
                parent = STORE.get(pid)
            else:
                parent = next((v for v in versions if v["latest"] and v["source"] == src), None)
            if parent is None:
                mode = "new"
        vid = RUNNER.submit_run(ticker=ticker, source=src, mode=mode, parent=parent,
                                instructions=req.instructions, model=req.models.get(src),
                                effort=req.efforts.get(src))
        started.append({"version_id": vid, "source": src, "mode": mode,
                        "parent_version": parent["version_id"] if parent else None})
    STORE.invalidate(ticker)
    return {"runs": started}


@app.get("/api/runs")
def runs(active: bool = False, kind: Optional[str] = None, limit: int = 200):
    out = []
    for rj in run_json_paths():
        m = read_json(rj, {}) or {}
        if m.get("origin") not in ("run", "import"):
            continue
        if active and m.get("status") in TERMINAL_STATUSES:
            continue
        if kind and m.get("kind") != kind:
            continue
        if not active and m.get("origin") == "import" and m.get("cli") is None:
            continue  # deterministic imports aren't "runs"
        pub = _public_run(m)
        val = read_json(rj.parent / "validation.json")
        pub["validation"] = {"ok": val.get("ok"), **(val.get("summary") or {})} if val else None
        out.append(pub)
    out.sort(key=lambda m: m.get("created_at") or "", reverse=True)
    return out[:limit]


@app.get("/api/runs/{vid}")
def run(vid: str):
    p = _vdir(vid)
    return {"run": _public_run(read_json(p / "run.json", {})), "validation": read_json(p / "validation.json"),
            "summary": STORE.get(vid)}


def _read_events(p, after):
    f = p / "events.jsonl"
    out = []
    if f.exists():
        with open(f) as fh:
            for i, line in enumerate(fh, 1):
                if i > after:
                    try:
                        out.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    return out


@app.get("/api/runs/{vid}/events.json")
def run_events(vid: str, after: int = 0):
    return _read_events(_vdir(vid), after)


@app.get("/api/runs/{vid}/events")
async def run_events_sse(vid: str, after: int = 0):
    p = _vdir(vid)

    async def gen():
        seq = after
        idle = 0
        while True:
            evs = await asyncio.to_thread(_read_events, p, seq)
            for ev in evs:
                seq = max(seq, ev.get("seq", seq))
                yield f"id: {seq}\nevent: log\ndata: {json.dumps(ev)}\n\n"
            meta = read_json(p / "run.json", {}) or {}
            if meta.get("status") in TERMINAL_STATUSES and not evs:
                idle += 1
                if idle > 2:
                    yield f"event: end\ndata: {json.dumps({'status': meta.get('status')})}\n\n"
                    return
            else:
                idle = 0
            if not evs:
                yield ": keepalive\n\n"
            await asyncio.sleep(0.7)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/runs/{vid}/cancel")
async def cancel(vid: str):
    _vdir(vid)
    await RUNNER.cancel(vid)
    return {"cancelled": True}


# --------------------------------------------------------------------------
# prices
# --------------------------------------------------------------------------

@app.get("/api/prices/{ticker}")
def price(ticker: str):
    return get_price(ticker) or {}


@app.post("/api/prices/refresh")
async def refresh_prices(tickers: Optional[list[str]] = Body(None, embed=True)):
    tickers = tickers or [t["ticker"] for t in STORE.summary()]
    return await asyncio.to_thread(PR.refresh, tickers)


@app.put("/api/prices/{ticker}")
def put_price(ticker: str, price: float = Body(..., embed=True)):
    from server.store import now_iso
    set_price(ticker, price, now_iso(), "manual")
    return get_price(ticker)


# --------------------------------------------------------------------------
# legacy imports
# --------------------------------------------------------------------------

@app.get("/api/imports")
def imports():
    from server.importer import inventory as I
    return I.status()


class ImportRequest(BaseModel):
    legacy_ids: list[str] = []
    all: bool = False


@app.post("/api/imports/run")
def run_imports(req: ImportRequest):
    from server.importer import inventory as I
    return I.launch(req.legacy_ids, all_=req.all)


# --------------------------------------------------------------------------
# frontend
# --------------------------------------------------------------------------

DIST = ROOT / "web" / "dist"
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        f = DIST / full_path
        if full_path and f.is_file():
            return FileResponse(f)
        return FileResponse(
            DIST / "index.html",
            headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"},
        )
