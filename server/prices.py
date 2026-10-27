"""Common comparison price: one quote per ticker, used to compute upside for
every model of that ticker regardless of when the model was built."""
from __future__ import annotations

from datetime import datetime, timezone

import httpx

from server.store import get_price, set_price

UA = {"User-Agent": "Mozilla/5.0 (DCF Studio; personal research)"}
SYMBOL_MAP = {"BRK.B": "BRK-B", "BF.B": "BF-B"}


def quote_symbol(ticker):
    """The listed symbol the models actually price (e.g. NOVOB models value the NVO ADR)."""
    from collections import Counter

    from server.store import MODELS, read_json
    t = ticker.upper()
    if t in SYMBOL_MAP:
        return SYMBOL_MAP[t]
    syms = Counter()
    for dj in (MODELS / t).glob("*/dcf.json"):
        sym = ((read_json(dj) or {}).get("listing") or {}).get("symbol")
        if sym:
            syms[sym.upper()] += 1
    return syms.most_common(1)[0][0] if syms else t


def fetch_yahoo(ticker):
    sym = quote_symbol(ticker)
    r = httpx.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}",
                  params={"range": "5d", "interval": "1d"}, headers=UA, timeout=15)
    r.raise_for_status()
    meta = r.json()["chart"]["result"][0]["meta"]
    price = float(meta["regularMarketPrice"])
    ts = datetime.fromtimestamp(meta["regularMarketTime"], timezone.utc).isoformat(timespec="seconds")
    return {"price": price, "ts": ts, "source": f"yahoo:{sym}", "currency": meta.get("currency")}


def refresh(tickers):
    out = {}
    for t in tickers:
        try:
            q = fetch_yahoo(t)
            set_price(t, q["price"], q["ts"], q["source"])
            out[t] = q
        except Exception as exc:
            out[t] = {"error": f"{type(exc).__name__}: {exc}", "previous": get_price(t)}
    return out
