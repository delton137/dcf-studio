"""Polite HTTP clients for the free data sources, with a TTL file cache.

SEC: <= 8 req/s and a User-Agent that contains a contact email (SEC fair-access
policy; www.sec.gov answers 403 without one). Nasdaq: browser User-Agent, slow.
Every response body is cached under data/screener/raw/ so refreshes are cheap.
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

import httpx

from server.runner import cfg
from server.store import DATA, write_json

RAW = DATA / "screener" / "raw"
BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"


class RateLimiter:
    def __init__(self, per_second):
        self.interval = 1.0 / per_second
        self.lock = threading.Lock()
        self.next = 0.0

    def wait(self):
        with self.lock:
            now = time.monotonic()
            if now < self.next:
                time.sleep(self.next - now)
                now = time.monotonic()
            self.next = now + self.interval


_LIMITS = {"sec": RateLimiter(8), "nasdaq": RateLimiter(1), "yahoo": RateLimiter(2)}


class FetchError(RuntimeError):
    pass


def sec_user_agent():
    ua = cfg("runs", "sec_user_agent", "") or ""
    if "@" not in ua:
        raise FetchError("config.toml [runs] sec_user_agent must contain a contact email (SEC fair-access policy)")
    return ua


def _headers(kind):
    if kind == "sec":
        return {"User-Agent": sec_user_agent(), "Accept-Encoding": "gzip, deflate"}
    if kind == "nasdaq":
        return {"User-Agent": BROWSER_UA, "Accept": "application/json", "Origin": "https://www.nasdaq.com",
                "Referer": "https://www.nasdaq.com/"}
    return {"User-Agent": "Mozilla/5.0"}


def get_json(kind, url, *, params=None, cache_key=None, ttl=None, retries=4, timeout=60):
    """GET a JSON document, served from the cache when younger than `ttl` seconds.

    Returns None for a 404 (e.g. a frame that doesn't exist yet). A stale cached
    copy is returned if the network fails.
    """
    path = RAW / f"{cache_key}.json" if cache_key else None
    if path and path.exists() and ttl is not None and time.time() - path.stat().st_mtime < ttl:
        try:
            return json.loads(path.read_text())
        except json.JSONDecodeError:
            pass
    last = None
    for attempt in range(retries):
        _LIMITS[kind].wait()
        try:
            r = httpx.get(url, params=params, headers=_headers(kind), timeout=timeout, follow_redirects=True)
        except httpx.HTTPError as exc:
            last = exc
            time.sleep(1.5 * (attempt + 1))
            continue
        if r.status_code == 404:
            if path:
                write_json(path, None)
            return None
        if r.status_code in (429, 500, 502, 503, 504):
            last = FetchError(f"{r.status_code} from {url}")
            time.sleep(float(r.headers.get("Retry-After") or 2 * (attempt + 1)))
            continue
        if r.status_code == 403:
            raise FetchError(f"403 from {url} (blocked; check User-Agent)")
        r.raise_for_status()
        data = r.json()
        if path:
            write_json(path, data)
        return data
    if path and path.exists():
        try:
            return json.loads(path.read_text())
        except json.JSONDecodeError:
            pass
    raise FetchError(f"failed after {retries} attempts: {url}: {last}")


def cache_age(cache_key):
    p = RAW / f"{cache_key}.json"
    return time.time() - p.stat().st_mtime if p.exists() else None
