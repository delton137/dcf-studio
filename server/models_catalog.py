"""Live model catalog for the three CLIs, so the run launcher always offers the
models each CLI can actually use today.

* Claude Code: no list command, but `--model <alias>` (fable/opus/sonnet/haiku)
  always resolves to the newest model of that family. We read the resolution
  from the stream-json `init` event -- the first line, emitted before any API
  request -- and kill the process immediately, so probing costs nothing.
* Codex: ~/.codex/models_cache.json, which Codex itself keeps up to date
  (models with visibility "list", ordered by priority, each with its own
  reasoning levels).
* Grok: `grok models` (default + available models).

Cached in data/models_catalog.json; refreshed in the background at startup and
when older than 12 h, or on demand (POST /api/config/models/refresh).
A config default of "latest" resolves to the newest model at run time.
"""
from __future__ import annotations

import json
import os
import re
import signal
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from server.store import DATA, read_json, write_json

CATALOG = DATA / "models_catalog.json"
MAX_AGE_H = 12
CLAUDE_ALIASES = ["fable", "opus", "sonnet", "haiku"]
CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"]
GROK_EFFORTS = ["low", "medium", "high"]
AGY_EFFORTS = ["low", "medium", "high", "xhigh", "max"]
CODEX_CACHE = Path.home() / ".codex" / "models_cache.json"

_lock = threading.Lock()
_thread: threading.Thread | None = None


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------
# discovery
# --------------------------------------------------------------------------

def _claude_resolve(alias, timeout=20):
    """Model id an alias resolves to, read from the init event; no API call is made."""
    p = subprocess.Popen(
        ["claude", "-p", "--model", alias, "--output-format", "stream-json", "--verbose",
         "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--tools", ""],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
        start_new_session=True, env={k: v for k, v in os.environ.items() if k != "CLAUDECODE"})
    try:
        p.stdin.write("ping")
        p.stdin.close()
        deadline = time.time() + timeout
        for line in p.stdout:
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get("type") == "system" and e.get("subtype") == "init":
                return e.get("model")
            if time.time() > deadline:
                break
        return None
    finally:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def discover_claude():
    resolved = {}
    threads = [threading.Thread(target=lambda a=a: resolved.__setitem__(a, _claude_resolve(a))) for a in CLAUDE_ALIASES]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    opts = []
    for a in CLAUDE_ALIASES:
        r = resolved.get(a)
        if r:
            opts.append({"id": a, "label": f"{a} → {r}", "resolved": r, "kind": "alias",
                         "efforts": CLAUDE_EFFORTS, "default_effort": "high",
                         "note": "alias: always the newest model of this family"})
    for o in list(opts):
        opts.append({"id": o["resolved"], "label": o["resolved"], "kind": "model", "efforts": CLAUDE_EFFORTS,
                     "default_effort": "high", "note": "pinned version"})
    if not opts:
        raise RuntimeError("could not resolve any Claude model alias (is `claude` logged in?)")
    return {"models": opts, "latest": opts[0]["id"], "cli_default": None, "source": "claude --model <alias> init event"}


def discover_codex():
    d = json.loads(CODEX_CACHE.read_text())
    models = sorted((m for m in d.get("models") or [] if m.get("visibility") == "list"),
                    key=lambda m: m.get("priority", 999))
    opts = []
    for m in models:
        efforts = [lv["effort"] for lv in m.get("supported_reasoning_levels") or []] or ["low", "medium", "high"]
        opts.append({"id": m["slug"], "label": m.get("display_name") or m["slug"], "kind": "model",
                     "efforts": efforts, "default_effort": m.get("default_reasoning_level"),
                     "note": (m.get("description") or "")[:160] or None})
    if not opts:
        raise RuntimeError("no listed models in ~/.codex/models_cache.json")
    return {"models": opts, "latest": opts[0]["id"], "cli_default": None,
            "source": f"~/.codex/models_cache.json (fetched {d.get('fetched_at', '?')[:19]})"}


def discover_grok():
    out = subprocess.run(["grok", "models"], capture_output=True, text=True, timeout=60).stdout
    default = None
    m = re.search(r"Default model:\s*(\S+)", out)
    if m:
        default = m.group(1)
    names = re.findall(r"^\s*[*-]\s+(\S+)", out, re.M)
    if not names:
        raise RuntimeError(f"could not parse `grok models` output: {out[:200]!r}")
    opts = [{"id": n, "label": n + (" (CLI default)" if n == default else ""), "kind": "model",
             "efforts": GROK_EFFORTS, "default_effort": "high", "note": None} for n in names]
    return {"models": opts, "latest": default or names[0], "cli_default": default, "source": "grok models"}


def discover_agy():
    env = {k: v for k, v in os.environ.items()
           if k not in ("ANTIGRAVITY_LS_ADDRESS", "ANTIGRAVITY_CSRF_TOKEN", "ANTIGRAVITY_CONVERSATION_ID",
                        "ANTIGRAVITY_TRAJECTORY_ID", "ANTIGRAVITY_SOURCE_METADATA", "ANTIGRAVITY_AGENT")}
    out = subprocess.run(["agy", "models"], capture_output=True, text=True, timeout=60, env=env).stdout
    groups: dict[str, dict] = {}
    for raw in out.splitlines():
        line = raw.split("\r")[-1].strip()
        if not line or line.startswith(("Fetching", "Available", "Usage:")):
            continue
        parts = re.split(r"\t+|\s{2,}", line, maxsplit=1)
        mid = parts[0].strip()
        label = (parts[1].strip() if len(parts) > 1 else mid)
        m = re.match(r"^(.+)-(low|medium|high|xhigh|max)$", mid, re.I)
        if m:
            base_id, eff = m.group(1), m.group(2).lower()
            base_label = re.sub(r"\s*\((?:low|medium|high|xhigh|max)\)\s*$", "", label, flags=re.I).strip() or base_id
            g = groups.setdefault(base_id, {"id": base_id, "label": base_label, "efforts": []})
            if eff not in g["efforts"]:
                g["efforts"].append(eff)
        else:
            groups.setdefault(mid, {"id": mid, "label": label, "efforts": ["low", "medium", "high"]})
    if not groups:
        raise RuntimeError(f"could not parse `agy models` output: {out[:200]!r}")
    opts = []
    for g in groups.values():
        effs = [e for e in AGY_EFFORTS if e in g["efforts"]] or g["efforts"]
        def_eff = "high" if "high" in effs else (effs[-1] if effs else "medium")
        opts.append({"id": g["id"], "label": g["label"], "kind": "model",
                     "efforts": effs, "default_effort": def_eff, "note": None})
    return {"models": opts, "latest": opts[0]["id"], "cli_default": None, "source": "agy models"}


DISCOVER = {"claude": discover_claude, "codex": discover_codex, "grok": discover_grok, "agy": discover_agy}


# --------------------------------------------------------------------------
# catalog
# --------------------------------------------------------------------------

def refresh():
    prev = read_json(CATALOG, {}) or {}
    cat = {"fetched_at": _now(), "backends": {}}
    results = {}

    def run(src):
        try:
            results[src] = {**DISCOVER[src](), "fetched_at": _now(), "error": None}
        except Exception as exc:
            old = (prev.get("backends") or {}).get(src) or {}
            results[src] = {**old, "error": f"{type(exc).__name__}: {exc}"[:300]}

    threads = [threading.Thread(target=run, args=(s,)) for s in DISCOVER]
    for t in threads:
        t.start()
    for t in threads:
        t.join(90)
    cat["backends"] = results
    write_json(CATALOG, cat)
    return cat


def refresh_background():
    global _thread
    with _lock:
        if _thread and _thread.is_alive():
            return False
        _thread = threading.Thread(target=refresh, daemon=True)
        _thread.start()
        return True


def refreshing():
    return bool(_thread and _thread.is_alive())


def catalog():
    cat = read_json(CATALOG, None)
    stale = True
    if isinstance(cat, dict) and cat.get("fetched_at"):
        age = datetime.now(timezone.utc) - datetime.fromisoformat(cat["fetched_at"])
        stale = age.total_seconds() > MAX_AGE_H * 3600
    if stale:
        refresh_background()
    return cat if isinstance(cat, dict) else {"fetched_at": None, "backends": {}}


def resolve_model(source, configured):
    """'latest' (or empty) -> the newest model the CLI offers right now."""
    if configured and configured != "latest":
        return configured
    b = (catalog().get("backends") or {}).get(source) or {}
    if b.get("latest"):
        return b["latest"]
    return {"claude": "opus", "codex": "gpt-6.1-sol", "grok": "grok-4.7", "agy": "gemini-4-argon"}[source]   # last-resort fallback


def model_options(source):
    return ((catalog().get("backends") or {}).get(source) or {}).get("models") or []
