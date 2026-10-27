"""One-time migration: prefix version ids with their ticker so ids are globally
unique (MU_20261001-092946_claude). Run with the server STOPPED and no active runs:

    uv run python -m server.migrate_ids [--dry-run]
"""
from __future__ import annotations

import sys

from server.store import MODELS, TERMINAL_STATUSES, WHATIFS, read_json, write_json


def plan():
    out = []
    for tdir in sorted(p for p in MODELS.iterdir() if p.is_dir()):
        for v in sorted(p for p in tdir.iterdir() if p.is_dir()):
            if not v.name.startswith(tdir.name + "_"):
                out.append((tdir.name, v.name, f"{tdir.name}_{v.name}"))
    return out


def main(dry=False):
    active = [rj for rj in MODELS.glob("*/*/run.json")
              if (read_json(rj, {}) or {}).get("status") in ("running", "validating", "fixing")]
    if active and not dry:
        sys.exit(f"refusing: {len(active)} runs not finished, e.g. {active[0]}")
    moves = plan()
    mapping = {(t, old): new for t, old, new in moves}
    print(f"{len(moves)} versions to rename")
    if dry:
        for m in moves[:10]:
            print("  ", m)
        return
    for t, old, new in moves:
        (MODELS / t / old).rename(MODELS / t / new)
        w = WHATIFS / old
        if w.is_dir():
            w.rename(WHATIFS / new)
    for tdir in MODELS.iterdir():
        if not tdir.is_dir():
            continue
        t = tdir.name
        for v in tdir.iterdir():
            rj = v / "run.json"
            meta = read_json(rj)
            if isinstance(meta, dict):
                changed = False
                if (t, meta.get("id")) in mapping:
                    meta["id"] = mapping[(t, meta["id"])]
                    changed = True
                if (t, meta.get("parent_version")) in mapping:
                    meta["parent_version"] = mapping[(t, meta["parent_version"])]
                    changed = True
                if isinstance(meta.get("job"), dict) and (t, meta["job"].get("vid")) in mapping:
                    meta["job"]["vid"] = mapping[(t, meta["job"]["vid"])]
                    changed = True
                if changed:
                    write_json(rj, meta)
            dj = v / "dcf.json"
            d = read_json(dj)
            if isinstance(d, dict) and isinstance(d.get("provenance"), dict):
                prov = d["provenance"]
                changed = False
                for k in ("version_id", "run_id", "parent_version"):
                    if (t, prov.get(k)) in mapping:
                        prov[k] = mapping[(t, prov[k])]
                        changed = True
                if changed:
                    write_json(dj, d)
    print("done")


if __name__ == "__main__":
    main(dry="--dry-run" in sys.argv)
