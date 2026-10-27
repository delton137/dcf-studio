"""Render the prompt templates in prompts/."""
from __future__ import annotations

from datetime import date
from pathlib import Path

from server.store import ROOT

PROMPTS = ROOT / "prompts"


def _read(name):
    return (PROMPTS / name).read_text()


def _extra(instructions):
    if not instructions or not instructions.strip():
        return ""
    return ("\n## Additional instructions from the user (take these into account)\n\n"
            + instructions.strip() + "\n")


def _price(ticker, quote):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?range=5d&interval=1d"
    how = (f"To refresh it: `curl -s -A 'Mozilla/5.0' '{url}'` → `chart.result[0].meta.regularMarketPrice` "
           f"and `regularMarketTime` (Unix seconds). Do not estimate or remember a price.")
    if quote and quote.get("price"):
        return (f"- Reference quote fetched by DCF Studio: **{quote['price']} {quote.get('currency') or ''}** at "
                f"{quote['ts']} ({quote['source']}). Use it for `market.price` / `price_ts` unless you "
                f"fetch a fresher one. {how}\n")
    return f"- No reference quote could be fetched by DCF Studio. {how}\n"


def new_model(ticker, workdir, *, instructions=None, sec_user_agent="", today=None, quote=None):
    methodology = _read("methodology.md").replace("{TICKER}", ticker)
    return _read("new_model.md").format(
        ticker=ticker, today=(today or date.today()).isoformat(), workdir=workdir,
        price_section=_price(ticker, quote),
        extra_section=_extra(instructions), methodology=methodology, sec_user_agent=sec_user_agent)


def update_model(ticker, workdir, *, parent, instructions=None, sec_user_agent="", today=None, quote=None):
    """parent: summary dict of the parent version (version_id, source, origin, as_of)."""
    methodology = _read("methodology.md").replace("{TICKER}", ticker)
    legacy_note = ""
    if parent.get("origin") == "import":
        legacy_note = (" plus `legacy/` with the original legacy files it was converted from "
                       "(a different, older format — use them for reasoning, not as a template)")
    return _read("update_model.md").format(
        ticker=ticker, today=(today or date.today()).isoformat(), workdir=workdir,
        parent_version=parent["version_id"], parent_source=parent.get("source"),
        parent_as_of=parent.get("as_of") or "the previous model's date", legacy_note=legacy_note,
        price_section=_price(ticker, quote),
        extra_section=_extra(instructions), methodology=methodology, sec_user_agent=sec_user_agent)


def fix_validation(workdir, failures, attempt, max_attempts):
    return _read("fix_validation.md").format(workdir=workdir, failures=failures, attempt=attempt,
                                             max_attempts=max_attempts)


def fix_agent_output(workdir, failures, attempt, max_attempts, mode):
    return _read("fix_agent_output.md").format(workdir=workdir, failures=failures, attempt=attempt,
                                               max_attempts=max_attempts, mode=mode)


def import_legacy(workdir, item):
    guide = _read(f"legacy_guides/{item['source']}.md")
    files = "\n".join(f"- `legacy/{Path(f).name}`" for f in item["files"])
    return _read("import_legacy.md").format(
        workdir=workdir, ticker=item["ticker"], source=item["source"], files=files,
        legacy_id=item["legacy_id"], notes=item.get("notes") or "none", guide=guide,
        quality=item.get("quality", "verified"))
