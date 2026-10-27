"""Headless invocation builders + stream normalizers for the four CLIs.

Adapted from the proven builders in Dan's metascience-observatory
`llm_backend.py`. Two rules carried over:

* the prompt NEVER goes on argv (128 KB MAX_ARG_STRLEN) -- stdin or a file;
* autonomous runs get NO MCP servers / connectors and a tool allowlist: this
  machine has a brokerage connector configured, and an unattended
  bypass-permissions agent must never see it.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from dataclasses import dataclass, field

# Built-in tools a DCF build needs. Everything else (Artifact publishing,
# cron/remote triggers, push notifications, worktrees ...) stays off.
CLAUDE_TOOLS = ["Bash", "Read", "Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch", "Task",
                "TaskCreate", "TaskGet", "TaskList", "TaskUpdate"]
GROK_DENIED_TOOLS = ["scheduler_create", "scheduler_delete", "scheduler_list", "image_gen", "image_edit",
                     "image_to_video", "reference_to_video", "ask_user_question", "send_feedback",
                     "enter_plan_mode", "exit_plan_mode", "use_tool", "search_tool", "workflow"]
CODEX_DISABLED_FEATURES = ["shell_snapshot", "apps", "image_generation", "view_image", "browser_use",
                           "browser_use_external", "in_app_browser", "plugins", "skill_search",
                           "tool_suggest", "computer_use", "sleep_tool"]

GROK_ENV = {
    "GROK_FOLDER_TRUST": "0",
    "GROK_CLAUDE_SKILLS_ENABLED": "false", "GROK_CURSOR_SKILLS_ENABLED": "false",
    "GROK_CLAUDE_MCPS_ENABLED": "false", "GROK_CURSOR_MCPS_ENABLED": "false",
}

#: stderr substrings meaning the ACCOUNT cannot serve requests (retrying won't help)
FATAL_MARKERS = ("402", "payment required", "usage balance exhausted", "insufficient_quota",
                 "credit balance", "401 unauthorized", "invalid api key", "invalid_api_key",
                 "not logged in", "please run /login", "authentication_error", "run codex login",
                 "usage limit reached", "please sign in", "authentication failed")

# Model lists are discovered live from each CLI (server/models_catalog.py).
BACKENDS = {
    "claude": {"label": "Claude Code", "binary": "claude"},
    "codex": {"label": "Codex", "binary": "codex"},
    "grok": {"label": "Grok Build", "binary": "grok"},
    "agy": {"label": "Antigravity", "binary": "agy"},
}


@dataclass
class Invocation:
    argv: list[str]
    stdin_text: str | None
    env: dict = field(default_factory=dict)
    prompt_file: str | None = None


def available(source):
    return shutil.which(BACKENDS[source]["binary"]) is not None


def version(source):
    try:
        p = subprocess.run([BACKENDS[source]["binary"], "--version"], capture_output=True, text=True, timeout=20)
        return (p.stdout or p.stderr).strip().splitlines()[0]
    except Exception:
        return None


def build_invocation(source, *, workdir, prompt, model, effort, max_budget_usd=None, resume=None):
    """argv for one headless turn. `resume` = a session id from an earlier run in
    the same workdir (used for validation-fix follow-ups, keeps the context).
    The subprocess must always be started with cwd=workdir."""
    if source == "claude":
        argv = ["claude", "-p"] + (["--resume", resume] if resume else []) + [
                "--model", model, "--effort", effort,
                "--permission-mode", "bypassPermissions",
                "--output-format", "stream-json", "--verbose",
                "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
                "--tools", ",".join(CLAUDE_TOOLS)]
        if max_budget_usd:
            argv += ["--max-budget-usd", str(max_budget_usd)]
        return Invocation(argv=argv, stdin_text=prompt)
    if source == "codex":
        head = ["codex", "exec", "resume", resume] if resume else ["codex", "exec", "-C", str(workdir)]
        argv = head + ["--json", "--ignore-user-config", "--skip-git-repo-check", "-m", model,
                "-c", f'model_reasoning_effort="{effort}"',
                "-c", "tools.web_search=true",
                "--dangerously-bypass-approvals-and-sandbox"]
        for f in CODEX_DISABLED_FEATURES:
            argv += ["--disable", f]
        argv += ["-"]
        return Invocation(argv=argv, stdin_text=prompt)
    if source == "grok":
        pf = str(workdir / ("prompt_followup.md" if resume else "prompt.md"))
        argv = ["grok"] + (["--resume", resume] if resume else []) + ["--prompt-file", pf, "--cwd", str(workdir), "-m", model, "--effort", effort,
                "--permission-mode", "bypassPermissions", "--output-format", "streaming-messages-json",
                "--verbatim", "--disallowed-tools", ",".join(GROK_DENIED_TOOLS)]
        return Invocation(argv=argv, stdin_text=None, env=dict(GROK_ENV), prompt_file=pf)
    if source == "agy":
        argv = ["agy"] + (["--conversation", resume] if resume else []) + [
                "--dangerously-skip-permissions", "--disable-slash-commands",
                "--input-format", "stream-json", "--output-format", "stream-json",
                "--model", model]
        if effort and not re.search(r"-(?:low|medium|high|xhigh|max)$", model or "", re.I):
            argv += ["--effort", effort]
        argv += ["-p", ""]
        stdin_line = json.dumps({"event": "user", "message": {"content": prompt}}) + "\n"
        return Invocation(argv=argv, stdin_text=stdin_line)
    raise ValueError(f"unknown source {source!r}")


def fatal_reason(stderr):
    low = (stderr or "").lower()
    for m in FATAL_MARKERS:
        if m in low:
            return m
    return None


# --------------------------------------------------------------------------
# stream normalization -> display events
#   {kind: text|tool|tool_result|result|system|error, text, tool?, ok?}
# --------------------------------------------------------------------------

def _trunc(s, n=4000):
    s = s if isinstance(s, str) else json.dumps(s, default=str)
    return s if len(s) <= n else s[:n] + f"... [{len(s) - n} more chars]"


def _tool_input_text(name, inp):
    if not isinstance(inp, dict):
        return _trunc(inp, 1500)
    for k in ("command", "cmd", "CommandLine", "file_path", "path", "Path", "TargetFile", "DirectoryPath",
              "SearchPath", "url", "Url", "query", "Query", "pattern", "Pattern", "prompt", "Prompt",
              "description", "toolSummary"):
        if inp.get(k):
            desc = inp.get("description") or inp.get("toolSummary")
            extra = f"  ({desc})" if k in ("command", "CommandLine") and desc else ""
            return _trunc(str(inp[k]), 1500) + extra
    return _trunc(inp, 1500)


def _grok_result_text(content):
    """Grok wraps terminal output as JSON with byte arrays."""
    text = content
    if isinstance(content, list):
        text = "".join(p.get("text", "") for p in content if isinstance(p, dict))
    if isinstance(text, str) and text.lstrip().startswith("{"):
        try:
            obj = json.loads(text)
        except json.JSONDecodeError:
            return text
        if isinstance(obj, dict):
            out = obj.get("output_for_prompt") or obj.get("output")
            if isinstance(out, list):
                try:
                    out = bytes(out).decode("utf-8", "replace")
                except (TypeError, ValueError):
                    out = str(out)
            if out is not None:
                return str(out)
    return text if isinstance(text, str) else json.dumps(text)


class Normalizer:
    """Turns one raw JSON line into zero or more display events; tracks usage."""

    def __init__(self, source):
        self.source = source
        self.usage = {}
        self.session_id = None
        self.final_text = None
        self.is_error = False
        self._agy_steps = {}
        self._agy_step_usage = {}

    def feed(self, raw):
        if self.source == "codex":
            return self._codex(raw)
        if self.source == "agy":
            return self._agy(raw)
        return self._anthropic_like(raw)

    def _anthropic_like(self, e):
        t = e.get("type")
        out = []
        if t == "system" and e.get("subtype") == "init":
            self.session_id = e.get("session_id")
            out.append({"kind": "system", "text": f"session {self.session_id} · model {e.get('model')} · "
                                                  f"{len(e.get('tools') or [])} tools"})
        elif t == "assistant":
            for b in (e.get("message") or {}).get("content") or []:
                if b.get("type") == "text" and b.get("text", "").strip():
                    out.append({"kind": "text", "text": b["text"]})
                elif b.get("type") == "tool_use":
                    out.append({"kind": "tool", "tool": b.get("name"), "text": _tool_input_text(b.get("name"), b.get("input"))})
        elif t == "user":
            for b in (e.get("message") or {}).get("content") or []:
                if isinstance(b, dict) and b.get("type") == "tool_result":
                    txt = _grok_result_text(b.get("content")) if self.source == "grok" else b.get("content")
                    if isinstance(txt, list):
                        txt = "".join(p.get("text", "") for p in txt if isinstance(p, dict))
                    out.append({"kind": "tool_result", "ok": not b.get("is_error"), "text": _trunc(txt or "", 3000)})
        elif t == "result":
            self.is_error = bool(e.get("is_error"))
            self.final_text = e.get("result")
            u = e.get("usage") or {}
            self.usage = {"input_tokens": u.get("input_tokens"), "output_tokens": u.get("output_tokens"),
                          "cache_read_input_tokens": u.get("cache_read_input_tokens"),
                          "cost_usd": e.get("total_cost_usd"), "num_turns": e.get("num_turns"),
                          "duration_ms": e.get("duration_ms")}
            out.append({"kind": "result", "ok": not self.is_error,
                        "text": _trunc(e.get("result") or e.get("subtype") or "", 6000)})
        return out

    def _codex(self, e):
        t = e.get("type")
        out = []
        if t == "thread.started":
            self.session_id = e.get("thread_id")
            out.append({"kind": "system", "text": f"thread {self.session_id}"})
        elif t in ("item.started", "item.completed"):
            it = e.get("item") or {}
            ty = it.get("type")
            if ty == "agent_message" and t == "item.completed":
                self.final_text = it.get("text")
                out.append({"kind": "text", "text": it.get("text", "")})
            elif ty == "reasoning" and t == "item.completed" and it.get("text"):
                out.append({"kind": "thinking", "text": _trunc(it["text"], 2000)})
            elif ty == "command_execution":
                if t == "item.started":
                    out.append({"kind": "tool", "tool": "shell", "text": _trunc(it.get("command", ""), 1500)})
                else:
                    out.append({"kind": "tool_result", "ok": it.get("exit_code") == 0,
                                "text": _trunc(it.get("aggregated_output") or f"exit {it.get('exit_code')}", 3000)})
            elif ty == "file_change" and t == "item.completed":
                files = ", ".join(c.get("path", "?") for c in it.get("changes") or [])
                out.append({"kind": "tool", "tool": "edit", "text": files})
            elif ty == "web_search" and t == "item.completed":
                out.append({"kind": "tool", "tool": "web_search", "text": it.get("query", "")})
            elif ty == "mcp_tool_call" and t == "item.completed":
                out.append({"kind": "tool", "tool": f"{it.get('server')}.{it.get('tool')}", "text": ""})
            elif ty == "todo_list" and t == "item.completed":
                items = it.get("items") or []
                out.append({"kind": "system", "text": "todo: " + "; ".join(
                    ("✓ " if x.get("completed") else "· ") + x.get("text", "") for x in items)})
            elif ty == "error":
                out.append({"kind": "error", "text": it.get("message", "")})
        elif t == "turn.completed":
            u = e.get("usage") or {}
            for k in ("input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens"):
                self.usage[k] = (self.usage.get(k) or 0) + (u.get(k) or 0)
            out.append({"kind": "result", "ok": True, "text": _trunc(self.final_text or "", 6000)})
        elif t in ("turn.failed", "error"):
            self.is_error = True
            err = e.get("error")
            msg = err.get("message") if isinstance(err, dict) else (err or e.get("message"))
            out.append({"kind": "error", "text": str(msg)})
        return out

    def _agy(self, e):
        ev = e.get("event")
        out = []
        if ev == "init":
            self.session_id = e.get("conversation_id") or self.session_id
            init = e.get("init") or {}
            out.append({"kind": "system",
                        "text": f"session {self.session_id} · {len(init.get('tools') or [])} tools"})
        elif ev == "step_update":
            su = e.get("step_update") or {}
            self.session_id = su.get("conversation_id") or e.get("conversation_id") or self.session_id
            idx = su.get("step_index")
            st = su.get("step_type")
            state = su.get("state")
            rec = self._agy_steps.setdefault(
                idx, {"text": [], "thinking": [], "tool_emitted": False, "done_emitted": False})
            if su.get("thinking_delta"):
                rec["thinking"].append(su["thinking_delta"])
            elif su.get("thinking") and not rec["thinking"]:
                rec["thinking"].append(su["thinking"])
            if su.get("text_delta"):
                rec["text"].append(su["text_delta"])
            elif su.get("text") and not rec["text"]:
                rec["text"].append(su["text"])
            if state == "DONE" and isinstance(su.get("usage"), dict):
                self._agy_step_usage[idx] = su["usage"]
            if st == "agent_response" and state == "DONE" and not rec["done_emitted"]:
                rec["done_emitted"] = True
                th = "".join(rec["thinking"]).strip()
                if th:
                    out.append({"kind": "thinking", "text": _trunc(th, 2000)})
                tx = "".join(rec["text"]).strip()
                if tx:
                    self.final_text = tx
                    out.append({"kind": "text", "text": "".join(rec["text"])})
            elif st == "tool":
                ti = su.get("tool_info") or {}
                tname = su.get("tool_name") or ti.get("name") or "tool"
                if not rec["tool_emitted"]:
                    rec["tool_emitted"] = True
                    out.append({"kind": "tool", "tool": tname,
                                "text": _tool_input_text(tname, ti.get("parameters") or {})})
                if state in ("DONE", "ERROR", "FAILED", "CANCELLED") and not rec["done_emitted"]:
                    rec["done_emitted"] = True
                    err = su.get("error_message") or ti.get("error")
                    ok = state == "DONE" and not err
                    res_txt = ti.get("output") if ti.get("output") is not None else (err or "")
                    out.append({"kind": "tool_result", "ok": ok, "text": _trunc(res_txt, 3000)})
            elif su.get("error_message") and state in ("DONE", "ERROR", "FAILED"):
                out.append({"kind": "error", "text": str(su["error_message"])})
        elif ev == "result":
            r = e.get("result") or {}
            self.session_id = r.get("conversation_id") or e.get("conversation_id") or self.session_id
            status = (r.get("status") or "").upper()
            self.is_error = bool(r.get("is_error")) or (status not in ("", "SUCCESS", "OK"))
            self.final_text = r.get("response") or r.get("output_text") or self.final_text
            if self._agy_step_usage:
                u = {}
                for su_u in self._agy_step_usage.values():
                    for k in ("input_tokens", "output_tokens", "cache_read_tokens", "thinking_tokens"):
                        if isinstance(su_u.get(k), (int, float)):
                            u[k] = (u.get(k) or 0) + su_u[k]
            else:
                u = r.get("usage") or {}
            dur_s = r.get("duration_seconds")
            self.usage = {
                "input_tokens": u.get("input_tokens") or u.get("prompt_tokens"),
                "output_tokens": u.get("output_tokens") or u.get("completion_tokens"),
                "cache_read_input_tokens": u.get("cache_read_tokens") or u.get("cache_read_input_tokens"),
                "reasoning_output_tokens": u.get("thinking_tokens") or u.get("reasoning_output_tokens"),
                "cost_usd": r.get("total_cost_usd") or r.get("cost_usd"),
                "num_turns": r.get("num_turns"),
                "duration_ms": round(dur_s * 1000) if isinstance(dur_s, (int, float)) else r.get("duration_ms"),
            }
            txt = self.final_text or r.get("error") or r.get("status") or ""
            out.append({"kind": "result", "ok": not self.is_error, "text": _trunc(txt, 6000)})
        return out
