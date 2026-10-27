"""/api/screener/* routes."""
from __future__ import annotations

import asyncio
from collections import Counter
from typing import Any, Optional

from fastapi import APIRouter, Body, HTTPException
from pydantic import BaseModel

from server.screener import extras as X
from server.screener import refresh as R
from server.screener import screens as SC
from server.screener import table as T
from server.screener import universes as U
from server.screener.metrics import DEFAULT_PARAMS

router = APIRouter(prefix="/api/screener")

FLAG_HELP = {
    "financial": "bank/insurer/REIT: EV and FCF metrics not meaningful",
    "stale_period": "latest fiscal period ended > 135 days ago",
    "annual_only": "no usable quarters in SEC frames; latest fiscal year used (Refine gives exact TTM cash flow)",
    "no_fundamentals": "no US-GAAP data in SEC frames (foreign IFRS filers, funds, SPACs)",
    "shares_scale": "price × shares far from Nasdaq market cap (share-class or units issue)",
    "multi_class": "several listed share classes; fundamentals are company-wide",
    "secondary_class": "not the most-traded share class of this company",
    "ev_nonpositive": "net cash exceeds market cap",
    "rev_tag_disagree": "revenue tags disagree by > 10% (largest used)",
    "ebit_from_pretax": "no operating-income tag; EBIT ≈ pre-tax income + interest",
    "fcf_no_capex": "no capex tag; FCF = operating cash flow (overstated if capex-heavy)",
    "debt_none_reported": "no debt tags reported (often truly debt-free)",
    "debt_from_notes": "debt taken from notes/convertible tags",
    "debt_partial": "only current debt found",
    "cash_incl_restricted": "cash includes restricted cash",
    "capex_sign": "capex reported negative (absolute value used)",
    "missing": "a line item isn't reported in SEC frames (which one follows the colon, e.g. missing:capex)",
}


@router.get("/status")
def status():
    st = R.status()
    st["jobs"] = X.job_status()
    st["params"] = DEFAULT_PARAMS
    return st


class RefreshReq(BaseModel):
    force: bool = False


@router.post("/refresh")
def refresh(req: RefreshReq = RefreshReq()):
    return {"started": R.start_background(force=req.force)}


@router.get("/fields")
def fields():
    groups = []
    for key, label, group, typ, desc in SC.FIELDS:
        if group not in groups:
            groups.append(group)
    return {"fields": [{"key": k, "label": l, "group": g, "type": t, "desc": d} for k, l, g, t, d in SC.FIELDS],
            "groups": groups, "flags": FLAG_HELP, "params": DEFAULT_PARAMS}


@router.get("/presets")
def presets():
    return SC.PRESETS


class QueryReq(BaseModel):
    screen: dict[str, Any] = {}
    limit: Optional[int] = None


@router.post("/query")
async def query(req: QueryReq):
    try:
        return await asyncio.to_thread(SC.query, req.screen, limit=req.limit)
    except (KeyError, ValueError) as exc:
        raise HTTPException(422, str(exc))


@router.get("/rows/{symbol}")
def row(symbol: str):
    sym = symbol.upper()
    _, rows = SC.rows_with_extras()
    r = next((x for x in rows if x["symbol"] == sym), None)
    if r is None:
        raise HTTPException(404, f"{sym} not in the screener table")
    fund = T.fundamentals().get(str(r.get("cik"))) if r.get("cik") is not None else None
    from server.store import read_json
    refine = read_json(SC.REFINE / f"{r.get('cik')}.json") if r.get("cik") is not None else None
    return {"row": r, "fundamentals": fund, "refine": refine,
            "flags_help": {f: FLAG_HELP.get(f.split(":")[0], f) for f in r.get("flags") or []}}


@router.get("/sectors")
def sectors():
    rows = T.table().get("rows") or []
    sec = Counter(r.get("sector") or "—" for r in rows)
    ind = Counter((r.get("sector") or "—", r.get("industry") or "—") for r in rows)
    return {"sectors": [{"name": s, "count": c} for s, c in sec.most_common()],
            "industries": [{"sector": s, "name": i, "count": c} for (s, i), c in ind.most_common()]}


class Symbols(BaseModel):
    symbols: list[str]


@router.post("/enrich")
def enrich(req: Symbols):
    started, n = X.start_enrich(req.symbols)
    return {"started": started, "count": n}


@router.post("/refine")
def refine(req: Symbols):
    rows = {r["symbol"]: r for r in T.table().get("rows") or []}
    started, n = X.start_refine(req.symbols, rows)
    return {"started": started, "count": n}


# ------------------------------------------------------------- saved screens

@router.get("/screens")
def screens():
    return SC.list_saved()


class SaveScreen(BaseModel):
    name: str
    screen: dict[str, Any]
    note: Optional[str] = None


@router.put("/screens/{slug}")
def save_screen(slug: str, req: SaveScreen):
    return SC.save(req.name, req.screen, req.note)


@router.delete("/screens/{slug}")
def delete_screen(slug: str):
    return {"deleted": SC.delete(slug)}


# ------------------------------------------------------------- universes

@router.get("/universes")
def universes():
    return {"builtin": U.BUILTIN, "lists": U.list_all()}


@router.get("/universes/{slug}")
def get_universe(slug: str):
    u = U.get(slug)
    if not u:
        raise HTTPException(404, slug)
    return u


class UniverseReq(BaseModel):
    name: str
    members: list[Any] = []
    kind: str = "custom"


@router.put("/universes/{slug}")
def put_universe(slug: str, req: UniverseReq):
    return U.save({"slug": slug, "name": req.name, "kind": req.kind, "members": req.members})


@router.post("/universes/{slug}/members")
def add_members(slug: str, req: Symbols):
    try:
        return U.add_members(slug, req.symbols)
    except KeyError:
        raise HTTPException(404, slug)


@router.delete("/universes/{slug}")
def delete_universe(slug: str):
    return {"deleted": U.delete(slug)}


# ------------------------------------------------------------- agent jobs

class AgentReq(BaseModel):
    kind: str                                  # shortlist | theme
    screen: dict[str, Any] = {}
    query: Optional[str] = None                # theme description, e.g. "AI data-center power equipment"
    objective: Optional[str] = None            # extra guidance for a shortlist
    top_n: int = 10
    cli: str = "claude"
    model: Optional[str] = None
    effort: Optional[str] = None
    list_name: Optional[str] = None


@router.post("/agent")
def agent_start(req: AgentReq):
    from server.screener import agent as A
    try:
        if req.kind == "shortlist":
            vid = A.submit_shortlist(req.screen, top_n=req.top_n, objective=req.objective, cli=req.cli,
                                     model=req.model, effort=req.effort)
        elif req.kind == "theme":
            if not (req.query or "").strip():
                raise ValueError("theme query required")
            vid = A.submit_theme(req.query, list_name=req.list_name, cli=req.cli, model=req.model,
                                 effort=req.effort)
        else:
            raise ValueError("kind must be shortlist or theme")
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    return {"version_id": vid}


@router.get("/agent")
def agent_list():
    from server.screener import agent as A
    return A.list_runs()


@router.get("/agent/{vid}")
def agent_result(vid: str):
    from server.screener import agent as A
    res = A.result(vid)
    if res is None:
        raise HTTPException(404, vid)
    return res
