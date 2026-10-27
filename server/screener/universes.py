"""Universes: built-in sets plus named lists (custom or agent-built themes).

Lists live in data/screener/universes/<slug>.json:
  {schema, slug, name, kind: custom|agent, created_at, updated_at,
   source: {by, run_id, query, cli, model}, members: [{symbol, name, note}]}
"""
from __future__ import annotations

import re

from server.store import DATA, now_iso, read_json, write_json

DIR = DATA / "screener" / "universes"
SCHEMA = "dcf-studio.universe/1"

SEEDS = {
    "ai-compute-semis": ("AI compute & semis",
                         "NVDA AMD AVGO MRVL MU SNDK TSM ASML ON AMKR COHR GLW"),
    "ai-infra-power": ("AI infra & power",
                       "CRWV NBIS IREN APLD CORZ CBRS CEG BE ETN GEV VRT"),
    "psychedelics-biotech": ("Psychedelics & biotech",
                             "ATAI CMPS DFTX GHRS HELP MRNA SNY NVO"),
    "consumer-other": ("Consumer & other",
                       "NKE LULU MCD WMT WM UNH UAL RKLB SPCX AMZN META PYPL RDDT RIVN JOBY DELL"),
}


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")[:60] or "list"


def ensure_seeds():
    DIR.mkdir(parents=True, exist_ok=True)
    for slug, (name, syms) in SEEDS.items():
        p = DIR / f"{slug}.json"
        if not p.exists():
            save({"slug": slug, "name": name, "kind": "custom",
                  "source": {"by": "seed", "query": "tickers already modelled in DCF Studio"},
                  "members": [{"symbol": s} for s in syms.split()]})


def list_all():
    ensure_seeds()
    out = []
    for p in sorted(DIR.glob("*.json")):
        u = read_json(p)
        if isinstance(u, dict):
            out.append({k: u.get(k) for k in ("slug", "name", "kind", "source", "created_at", "updated_at")}
                       | {"count": len(u.get("members") or [])})
    return out


def get(slug):
    return read_json(DIR / f"{slugify(slug)}.json")


def save(u):
    slug = slugify(u.get("slug") or u.get("name"))
    prev = get(slug) or {}
    members, seen = [], set()
    for m in u.get("members") or []:
        sym = (m.get("symbol") if isinstance(m, dict) else str(m)).strip().upper().replace("/", ".")
        if sym and sym not in seen:
            seen.add(sym)
            entry = {"symbol": sym}
            if isinstance(m, dict):
                for k in ("name", "note"):
                    if m.get(k):
                        entry[k] = str(m[k])[:400]
            members.append(entry)
    doc = {"schema": SCHEMA, "slug": slug, "name": (u.get("name") or slug)[:80], "kind": u.get("kind", "custom"),
           "created_at": prev.get("created_at") or now_iso(), "updated_at": now_iso(),
           "source": u.get("source") or prev.get("source") or {"by": "user"}, "members": members}
    write_json(DIR / f"{slug}.json", doc)
    return doc


def delete(slug):
    p = DIR / f"{slugify(slug)}.json"
    if p.exists():
        p.unlink()
        return True
    return False


def add_members(slug, symbols):
    u = get(slug)
    if not u:
        raise KeyError(slug)
    u["members"] = (u.get("members") or []) + [{"symbol": s} for s in symbols]
    return save(u)


# --------------------------------------------------------------------------

BUILTIN = [
    {"id": "us1b", "name": "US filers ≥ $1B", "desc": "common/ADR shares, market cap ≥ $1B, with SEC fundamentals"},
    {"id": "all", "name": "All US listings", "desc": "every common/ADR listing on Nasdaq/NYSE/AMEX"},
    {"id": "models", "name": "My DCF models", "desc": "tickers with at least one DCF Studio model"},
]


def resolve(universe, rows, *, min_mcap=1000, model_symbols=()):
    """Filter table rows to a universe id. Returns (rows, unmatched_symbols)."""
    u = universe or "us1b"
    if u == "all":
        return rows, []
    if u == "us1b":
        return [r for r in rows if (r.get("market_cap") or 0) >= min_mcap and r.get("revenue") is not None
                and "secondary_class" not in r.get("flags", [])], []
    if u == "models":
        want = set(model_symbols)
        return [r for r in rows if r["symbol"] in want], sorted(want - {r["symbol"] for r in rows})
    if u.startswith("sector:"):
        v = u.split(":", 1)[1]
        return [r for r in rows if (r.get("sector") or "—") == v], []
    if u.startswith("industry:"):
        v = u.split(":", 1)[1]
        return [r for r in rows if (r.get("industry") or "—") == v], []
    if u.startswith("list:"):
        doc = get(u.split(":", 1)[1]) or {}
        want = [m["symbol"] for m in doc.get("members") or []]
        have = {r["symbol"]: r for r in rows}
        return [have[s] for s in want if s in have], [s for s in want if s not in have]
    raise KeyError(f"unknown universe {u!r}")
