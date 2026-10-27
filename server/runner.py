"""Agent run orchestration: queue -> CLI subprocess -> validate -> fix loop.

State lives on disk (run.json, events.jsonl) so the UI can follow a run across
page reloads and a server restart marks orphaned runs `interrupted`.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import signal
import time
import tomllib
from datetime import datetime
from pathlib import Path

from server import backends as B
from server import prompts as P
from server.store import (MODELS, ROOT, STORE, TERMINAL_STATUSES, create_version, find_run_dir,
                          find_version_dir, now_iso, run_json_paths,
                          read_json, update_run, write_json)
from server.validation import format_failures, run_validation

CONFIG = tomllib.loads((ROOT / "config.toml").read_text())


def cfg(section, key, default=None):
    cur = CONFIG
    for part in section.split("."):
        cur = cur.get(part, {})
    return cur.get(key, default)


def _pid_alive(pid):
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


class EventLog:
    """Append-only normalized event log (events.jsonl) + raw stream (raw.jsonl)."""

    def __init__(self, path):
        self.path = Path(path)
        self.seq = 0
        f = self.path / "events.jsonl"
        if f.exists():
            with open(f) as fh:
                self.seq = sum(1 for _ in fh)

    def write(self, ev, attempt=0):
        self.seq += 1
        ev = {"seq": self.seq, "ts": now_iso(), "attempt": attempt, **ev}
        with open(self.path / "events.jsonl", "a") as fh:
            fh.write(json.dumps(ev, default=str) + "\n")
        return ev

    def raw(self, line):
        with open(self.path / "raw.jsonl", "a") as fh:
            fh.write(line if line.endswith("\n") else line + "\n")


class Runner:
    def __init__(self):
        self.run_queue: asyncio.Queue = asyncio.Queue()
        self.import_queue: asyncio.Queue = asyncio.Queue()
        self.agent_queue: asyncio.Queue = asyncio.Queue()   # screener shortlists / theme lists
        self.procs: dict[str, asyncio.subprocess.Process] = {}
        self.cancelled: set[str] = set()
        self.paused: dict[str, str] = {}  # source -> fatal reason
        self._tasks = []

    # ------------------------------------------------------------------ setup
    async def start(self):
        self.recover()
        for _ in range(int(cfg("runs", "max_concurrent", 3))):
            self._tasks.append(asyncio.create_task(self._worker(self.run_queue)))
        for _ in range(int(cfg("runs", "max_concurrent_imports", 4))):
            self._tasks.append(asyncio.create_task(self._worker(self.import_queue)))
        for _ in range(int(cfg("screener", "max_concurrent_agents", 2))):
            self._tasks.append(asyncio.create_task(self._worker(self.agent_queue)))

    async def stop(self):
        for vid in list(self.procs):
            await self.cancel(vid, reason="server shutdown", status="interrupted")
        for t in self._tasks:
            t.cancel()

    def recover(self):
        """Mark runs whose process died with the previous server as interrupted;
        re-queue runs that never started."""
        MODELS.mkdir(parents=True, exist_ok=True)
        for rj in run_json_paths():
            meta = read_json(rj) or {}
            st = meta.get("status")
            if st in TERMINAL_STATUSES or st is None:
                continue
            path = rj.parent
            if st == "queued" and meta.get("job"):
                q = {"import": self.import_queue, "shortlist": self.agent_queue,
                     "theme": self.agent_queue}.get(meta.get("kind"), self.run_queue)
                q.put_nowait(meta["job"])
            elif not _pid_alive(meta.get("pid")):
                update_run(path, status="interrupted", finished_at=now_iso(),
                           error="server restarted while the run was in progress")

    # ------------------------------------------------------------------ submit
    def submit_run(self, *, ticker, source, mode="new", parent=None, instructions=None, model=None,
                   effort=None):
        """Create the version dir, write the prompt, enqueue. Returns the version id."""
        from server.models_catalog import resolve_model
        model = resolve_model(source, model or cfg(f"backends.{source}", "model"))
        effort = effort or cfg(f"backends.{source}", "effort")
        vid, path = create_version(ticker, source, "run", run_meta={
            "kind": mode, "cli": source, "model": model, "effort": effort,
            "parent_version": parent["version_id"] if parent else None, "instructions": instructions})
        ua = cfg("runs", "sec_user_agent", "")
        quote = _quote(ticker)
        if mode == "update" and parent:
            self._stage_previous(parent, path)
            prompt = P.update_model(ticker, str(path), parent=parent, instructions=instructions, sec_user_agent=ua,
                                    quote=quote)
        else:
            prompt = P.new_model(ticker, str(path), instructions=instructions, sec_user_agent=ua, quote=quote)
        (path / "prompt.md").write_text(prompt)
        job = {"vid": vid, "ticker": ticker.upper(), "cli": source, "model": model, "effort": effort,
               "validation_mode": "native", "producer": source,
               "max_budget_usd": cfg(f"backends.{source}", "max_budget_usd")}
        update_run(path, job=job)
        self.run_queue.put_nowait(job)
        return vid

    def submit_import(self, item, *, ts=None):
        """A Sonnet conversion agent for one legacy Claude/Codex model."""
        model = cfg("imports", "model", "sonnet")
        effort = cfg("imports", "effort", "medium")
        vid, path = create_version(item["ticker"], item["source"], "import", ts=ts, run_meta={
            "kind": "import", "cli": "claude", "model": model, "effort": effort,
            "legacy": {k: item[k] for k in ("legacy_id", "files", "source", "generation") if k in item}})
        legacy = path / "legacy"
        legacy.mkdir()
        for f in item["files"]:
            src = ROOT.parent / f
            if src.is_dir():
                shutil.copytree(src, legacy / src.name)
            else:
                shutil.copy2(src, legacy / src.name)
        (path / "prompt.md").write_text(P.import_legacy(str(path), item))
        job = {"vid": vid, "ticker": item["ticker"].upper(), "cli": "claude", "model": model, "effort": effort,
               "validation_mode": "imported", "producer": "import",
               "max_budget_usd": cfg("imports", "max_budget_usd")}
        update_run(path, job=job)
        self.import_queue.put_nowait(job)
        return vid

    def _stage_previous(self, parent, path):
        src = find_version_dir(parent["version_id"])
        prev = path / "previous"
        prev.mkdir()
        for name in ("dcf.json", "report.md", "model.py", "legacy_adapter.py", "convert.py"):
            if (src / name).exists():
                shutil.copy2(src / name, prev / name)
        for d in ("legacy",):
            if (src / d).is_dir():
                shutil.copytree(src / d, prev / d)

    # ------------------------------------------------------------------ execute
    async def _worker(self, queue):
        while True:
            job = await queue.get()
            try:
                await self._execute(job)
            except Exception as exc:  # never let one run kill the worker
                path = find_run_dir(job["vid"])
                if path:
                    update_run(path, status="failed", finished_at=now_iso(), error=f"{type(exc).__name__}: {exc}")
            finally:
                queue.task_done()

    async def _execute(self, job):
        vid = job["vid"]
        path = find_run_dir(vid)
        if path is None or vid in self.cancelled:
            return
        if job["cli"] in self.paused:
            update_run(path, status="failed", finished_at=now_iso(),
                       error=f"{job['cli']} paused: {self.paused[job['cli']]}")
            return
        log = EventLog(path)
        update_run(path, status="running", started_at=now_iso())
        log.write({"kind": "status", "text": f"starting {job['cli']} ({job['model']}, effort {job['effort']})"})
        usage_total = {}
        attempts = []
        prompt = (path / "prompt.md").read_text()
        res = await self._turn(job, path, log, prompt, resume=None, attempt=0)
        attempts.append(res)
        _merge_usage(usage_total, res["usage"])
        if vid in self.cancelled:
            update_run(path, status="cancelled", finished_at=now_iso(), attempts=attempts, usage=usage_total)
            return
        if res.get("fatal"):
            self.paused[job["cli"]] = res["fatal"]
            update_run(path, status="failed", finished_at=now_iso(), attempts=attempts, usage=usage_total,
                       error=f"account-level error: {res['fatal']} — {job['cli']} paused until restart")
            return
        max_fix = int(cfg("runs", "fix_attempts", 2))
        for attempt in range(1, max_fix + 2):
            update_run(path, status="validating", attempts=attempts, usage=usage_total)
            log.write({"kind": "status", "text": "validating"})
            agent_mode = job["validation_mode"] not in ("native", "imported")
            if agent_mode:
                from server.screener.agent import validate_dir
                val = await asyncio.to_thread(validate_dir, path, job["validation_mode"])
            else:
                self._stamp_provenance(job, path)
                val = await asyncio.to_thread(run_validation, path, job["validation_mode"])
            s = val.get("summary") or {}
            log.write({"kind": "status", "ok": bool(val.get("ok")),
                       "text": f"validation: {s.get('fail', '?')} fail, {s.get('warn', '?')} warn"})
            if val.get("ok") or attempt > max_fix or vid in self.cancelled:
                break
            update_run(path, status="fixing")
            if agent_mode:
                fix = P.fix_agent_output(str(path), format_failures(val), attempt, max_fix, job["validation_mode"])
            else:
                fix = P.fix_validation(str(path), format_failures(val), attempt, max_fix)
            res = await self._turn(job, path, log, fix, resume=res.get("session_id"), attempt=attempt)
            attempts.append(res)
            _merge_usage(usage_total, res["usage"])
        if vid in self.cancelled:
            status = "cancelled"
        else:
            status = "valid" if val.get("ok") else "invalid"
        update_run(path, status=status, finished_at=now_iso(), attempts=attempts, usage=usage_total,
                   error=None if status == "valid" else (attempts[-1].get("error") or None))
        if status == "valid" and job["validation_mode"] == "theme":
            from server.screener.agent import finalize_theme
            try:
                slug = await asyncio.to_thread(finalize_theme, path)
                log.write({"kind": "status", "ok": True, "text": f"saved theme list '{slug}'"})
            except Exception as exc:
                log.write({"kind": "error", "text": f"could not save theme list: {exc}"})
        log.write({"kind": "status", "ok": status == "valid", "text": f"finished: {status}"})
        if not job["ticker"].startswith("_"):
            STORE.invalidate(job["ticker"])

    async def _turn(self, job, path, log, prompt, *, resume, attempt):
        inv = B.build_invocation(job["cli"], workdir=path, prompt=prompt, model=job["model"],
                                 effort=job["effort"], max_budget_usd=job.get("max_budget_usd"), resume=resume)
        if inv.prompt_file:
            Path(inv.prompt_file).write_text(prompt)
        env = dict(os.environ, **inv.env)
        for k in ("CLAUDECODE", "ANTIGRAVITY_LS_ADDRESS", "ANTIGRAVITY_CSRF_TOKEN",
                  "ANTIGRAVITY_CONVERSATION_ID", "ANTIGRAVITY_TRAJECTORY_ID",
                  "ANTIGRAVITY_SOURCE_METADATA", "ANTIGRAVITY_AGENT"):
            env.pop(k, None)  # allow nested claude / agy when the server runs inside an agent session
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        norm = B.Normalizer(job["cli"])
        t0 = time.time()
        out = {"attempt": attempt, "resume": resume, "started_at": now_iso(), "exit_code": None,
               "usage": {}, "session_id": resume}
        try:
            proc = await asyncio.create_subprocess_exec(
                *inv.argv, cwd=str(path), env=env, start_new_session=True,
                stdin=asyncio.subprocess.PIPE if inv.stdin_text is not None else asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, limit=64 * 1024 * 1024)
        except FileNotFoundError as exc:
            out["error"] = f"CLI not found: {exc}"
            log.write({"kind": "error", "text": out["error"]}, attempt)
            return out
        self.procs[job["vid"]] = proc
        update_run(path, pid=proc.pid)
        if inv.stdin_text is not None:
            proc.stdin.write(inv.stdin_text.encode())
            await proc.stdin.drain()
            proc.stdin.close()
        stderr_chunks = []

        async def pump_stderr():
            with open(path / "stderr.log", "ab") as fh:
                while True:
                    chunk = await proc.stderr.read(65536)
                    if not chunk:
                        break
                    fh.write(chunk)
                    stderr_chunks.append(chunk)

        async def pump_stdout():
            while True:
                line = await proc.stdout.readline()
                if not line:
                    break
                text = line.decode("utf-8", "replace")
                log.raw(text)
                try:
                    raw = json.loads(text)
                except json.JSONDecodeError:
                    if text.strip():
                        log.write({"kind": "system", "text": text.strip()[:2000]}, attempt)
                    continue
                for ev in norm.feed(raw):
                    log.write(ev, attempt)

        timeout = float(cfg("runs", "timeout_minutes", 90)) * 60
        try:
            await asyncio.wait_for(asyncio.gather(pump_stdout(), pump_stderr(), proc.wait()), timeout)
        except asyncio.TimeoutError:
            out["error"] = f"timed out after {timeout / 60:.0f} min"
            log.write({"kind": "error", "text": out["error"]}, attempt)
            _killpg(proc.pid)
            await proc.wait()
        self.procs.pop(job["vid"], None)
        out["exit_code"] = proc.returncode
        out["duration_s"] = round(time.time() - t0, 1)
        out["session_id"] = norm.session_id or resume
        out["usage"] = norm.usage
        stderr = b"".join(stderr_chunks).decode("utf-8", "replace")
        fatal = B.fatal_reason(stderr) if proc.returncode else None
        if fatal:
            out["fatal"] = fatal
        if proc.returncode not in (0, None) and not out.get("error"):
            out["error"] = f"exit {proc.returncode}: {stderr.strip()[-600:]}"
            log.write({"kind": "error", "text": out["error"]}, attempt)
        update_run(path, pid=None, session_id=out["session_id"])
        return out

    def _stamp_provenance(self, job, path):
        """The app owns provenance; keep the agent's changelog."""
        d = read_json(path / "dcf.json")
        if not isinstance(d, dict):
            return
        meta = read_json(path / "run.json", {}) or {}
        prov = d.get("provenance") or {}
        prov.update({
            "ticker": prov.get("ticker") or job["ticker"],
            "company": prov.get("company") or job["ticker"],
            "version_id": job["vid"], "run_id": job["vid"],
            "producer": job["producer"], "cli": job["cli"], "model": job["model"],
            "created_at": meta.get("created_at"),
            "parent_version": meta.get("parent_version"),
            "validation_mode": job["validation_mode"],
        })
        try:
            from dcfkit.engine import ENGINE_VERSION
            prov["dcfkit_version"] = ENGINE_VERSION
        except ImportError:
            pass
        prov.setdefault("schema_version", "1.0")
        d["provenance"] = prov
        d.pop("derived", None)
        write_json(path / "dcf.json", d)

    # ------------------------------------------------------------------ cancel
    async def cancel(self, vid, *, reason="cancelled by user", status="cancelled"):
        self.cancelled.add(vid)
        path = find_run_dir(vid)
        proc = self.procs.get(vid)
        if proc and proc.returncode is None:
            _killpg(proc.pid, signal.SIGTERM)
            try:
                await asyncio.wait_for(proc.wait(), 8)
            except asyncio.TimeoutError:
                _killpg(proc.pid, signal.SIGKILL)
        if path:
            meta = read_json(path / "run.json", {}) or {}
            if meta.get("status") not in TERMINAL_STATUSES:
                update_run(path, status=status, finished_at=now_iso(), error=reason)
                EventLog(path).write({"kind": "status", "ok": False, "text": reason})
        return True


def _quote(ticker):
    """Fresh reference quote for the prompt (also becomes the compare price)."""
    from server.prices import fetch_yahoo
    from server.store import set_price
    try:
        q = fetch_yahoo(ticker)
        set_price(ticker, q["price"], q["ts"], q["source"])
        return q
    except Exception:
        return None


def _killpg(pid, sig=signal.SIGTERM):
    try:
        os.killpg(os.getpgid(pid), sig)
    except (ProcessLookupError, PermissionError):
        pass


def _merge_usage(total, u):
    for k, v in (u or {}).items():
        if isinstance(v, (int, float)) and v is not None:
            total[k] = round((total.get(k) or 0) + v, 6)


RUNNER = Runner()
