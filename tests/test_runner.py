"""End-to-end runner test with a fake `claude` CLI: first turn produces a model
that fails validation (no report.md), the fix turn resumes the session and
repairs it. Exercises prompt rendering, subprocess streaming, event
normalization, provenance stamping, canonical validation and the fix loop."""
import asyncio
import json
import os
import stat
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

FAKE = r'''#!/usr/bin/env python3
import json, os, shutil, sys
args = sys.argv[1:]
prompt = sys.stdin.read()
resume = args[args.index("--resume") + 1] if "--resume" in args else None
def emit(o): print(json.dumps(o), flush=True)
emit({"type": "system", "subtype": "init", "session_id": "sess-123", "model": "fake", "tools": ["Bash"]})
if resume is None:
    shutil.copy("dcfkit/example_model.py", "model.py")
    emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Bash",
          "input": {"command": "python3 model.py"}}]}})
    os.system(sys.executable + " model.py > /dev/null")
    emit({"type": "user", "message": {"content": [{"type": "tool_result", "content": "wrote dcf.json"}]}})
    emit({"type": "result", "subtype": "success", "result": "done (forgot report)", "total_cost_usd": 0.5,
          "usage": {"input_tokens": 10, "output_tokens": 5}})
else:
    assert resume == "sess-123" and "report.md missing" in prompt, prompt[:500]
    hv = json.load(open("dcf.json"))["headline"]["value_per_share"]
    open("report.md", "w").write(f"# fixed\n\nHeadline ${hv:.2f}\n")
    emit({"type": "assistant", "message": {"content": [{"type": "text", "text": "added report.md"}]}})
    emit({"type": "result", "subtype": "success", "result": "fixed", "total_cost_usd": 0.25,
          "usage": {"input_tokens": 3, "output_tokens": 2}})
'''


def test_run_fix_loop(monkeypatch, tmp_path):
    bindir = tmp_path / "bin"
    bindir.mkdir()
    fake = bindir / "claude"
    fake.write_text(FAKE)
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{bindir}:{os.environ['PATH']}")

    from server import runner as R
    from server import store
    from server.store import find_version_dir, read_json

    # never touch the real data/ (store may already be imported by other tests)
    data = tmp_path / "data"
    for name, sub in (("DATA", ""), ("MODELS", "models"), ("PRICES", "prices"), ("WHATIFS", "whatifs")):
        monkeypatch.setattr(store, name, data / sub if sub else data)
    monkeypatch.setattr(R, "MODELS", data / "models")

    monkeypatch.setattr(R, "_quote", lambda t: {"price": 42.1, "ts": "2026-09-30", "source": "test"})
    vid = R.RUNNER.submit_run(ticker="EXMPL", source="claude", mode="new", instructions="test")
    job = R.RUNNER.run_queue.get_nowait()
    asyncio.run(R.RUNNER._execute(job))

    path = find_version_dir(vid)
    meta = read_json(path / "run.json")
    assert meta["status"] == "valid", (meta, read_json(path / "validation.json"))
    assert len(meta["attempts"]) == 2 and meta["attempts"][1]["resume"] == "sess-123"
    assert meta["usage"]["cost_usd"] == 0.75
    assert "42.1" in (path / "prompt.md").read_text()
    kinds = [json.loads(ln)["kind"] for ln in open(path / "events.jsonl")]
    assert {"system", "tool", "tool_result", "result", "status", "text"} <= set(kinds)
    d = read_json(path / "dcf.json")
    assert d["provenance"]["version_id"] == vid and d["provenance"]["producer"] == "claude"


FAKE_AGY = r'''#!/usr/bin/env python3
import json, os, shutil, sys
args = sys.argv[1:]
msg = json.loads(sys.stdin.readline())
assert msg["event"] == "user"
prompt = msg["message"]["content"]
resume = args[args.index("--conversation") + 1] if "--conversation" in args else None
def emit(o): print(json.dumps(o), flush=True)
emit({"event": "init", "conversation_id": "conv-789", "init": {"cwd": os.getcwd(), "tools": ["run_command"]}})
if resume is None:
    shutil.copy("dcfkit/example_model.py", "model.py")
    emit({"event": "step_update", "step_update": {"conversation_id": "conv-789", "step_index": 1, "state": "ACTIVE",
          "step_type": "tool", "tool_name": "run_command",
          "tool_info": {"name": "run_command", "parameters": {"CommandLine": "python3 model.py"}}}})
    os.system(sys.executable + " model.py > /dev/null")
    emit({"event": "step_update", "step_update": {"conversation_id": "conv-789", "step_index": 1, "state": "DONE",
          "step_type": "tool", "tool_name": "run_command",
          "tool_info": {"name": "run_command", "parameters": {"CommandLine": "python3 model.py"},
                        "output": "wrote dcf.json"}}})
    emit({"event": "step_update", "step_update": {"conversation_id": "conv-789", "step_index": 2, "state": "DONE",
          "step_type": "agent_response", "text_delta": "done (forgot report)",
          "usage": {"input_tokens": 100, "output_tokens": 20, "thinking_tokens": 5, "cache_read_tokens": 50}}})
    emit({"event": "result", "result": {"conversation_id": "conv-789", "status": "SUCCESS",
          "response": "done (forgot report)", "duration_seconds": 1.2, "num_turns": 1,
          "usage": {"input_tokens": 100, "output_tokens": 20, "thinking_tokens": 5, "cache_read_tokens": 50}}})
else:
    assert resume == "conv-789" and "report.md missing" in prompt, prompt[:500]
    hv = json.load(open("dcf.json"))["headline"]["value_per_share"]
    open("report.md", "w").write(f"# fixed\n\nHeadline ${hv:.2f}\n")
    emit({"event": "step_update", "step_update": {"conversation_id": "conv-789", "step_index": 3, "state": "ACTIVE",
          "step_type": "agent_response", "thinking_delta": "fixing report", "text_delta": "added "}})
    emit({"event": "step_update", "step_update": {"conversation_id": "conv-789", "step_index": 3, "state": "DONE",
          "step_type": "agent_response", "text_delta": "report.md",
          "usage": {"input_tokens": 40, "output_tokens": 10, "thinking_tokens": 3, "cache_read_tokens": 80}}})
    emit({"event": "result", "result": {"conversation_id": "conv-789", "status": "SUCCESS",
          "response": "added report.md", "duration_seconds": 0.8, "num_turns": 2,
          "usage": {"input_tokens": 140, "output_tokens": 30, "thinking_tokens": 8, "cache_read_tokens": 130}}})
'''


def test_agy_run_fix_loop(monkeypatch, tmp_path):
    bindir = tmp_path / "bin"
    bindir.mkdir()
    fake = bindir / "agy"
    fake.write_text(FAKE_AGY)
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    monkeypatch.setenv("PATH", f"{bindir}:{os.environ['PATH']}")

    from server import runner as R
    from server import store
    from server.store import find_version_dir, read_json

    data = tmp_path / "data"
    for name, sub in (("DATA", ""), ("MODELS", "models"), ("PRICES", "prices"), ("WHATIFS", "whatifs")):
        monkeypatch.setattr(store, name, data / sub if sub else data)
    monkeypatch.setattr(R, "MODELS", data / "models")

    monkeypatch.setattr(R, "_quote", lambda t: {"price": 42.1, "ts": "2026-09-30", "source": "test"})
    vid = R.RUNNER.submit_run(ticker="EXMPL", source="agy", mode="new", instructions="test")
    job = R.RUNNER.run_queue.get_nowait()
    asyncio.run(R.RUNNER._execute(job))

    path = find_version_dir(vid)
    meta = read_json(path / "run.json")
    assert meta["status"] == "valid", (meta, read_json(path / "validation.json"))
    assert len(meta["attempts"]) == 2 and meta["attempts"][1]["resume"] == "conv-789"
    assert meta["usage"]["input_tokens"] == 140 and meta["usage"]["output_tokens"] == 30
    kinds = [json.loads(ln)["kind"] for ln in open(path / "events.jsonl")]
    assert {"system", "tool", "tool_result", "thinking", "result", "status", "text"} <= set(kinds)
    d = read_json(path / "dcf.json")
    assert d["provenance"]["version_id"] == vid and d["provenance"]["producer"] == "agy"
