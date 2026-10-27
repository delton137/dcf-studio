"""Persistent Layer-B worker: imports one version's model.py (or
legacy_adapter.py) once and answers build(overrides) requests over stdin/stdout
as JSON lines. Run with cwd = the version directory."""
import importlib.util
import io
import json
import os
import sys

path, modfile = sys.argv[1], sys.argv[2]
os.chdir(path)
sys.path.insert(0, path)
real_stdout = sys.stdout
sys.stdout = sys.stderr  # model prints must not corrupt the protocol
spec = importlib.util.spec_from_file_location("model", os.path.join(path, modfile))
M = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(M)
    real_stdout.write(json.dumps({"ready": True}) + "\n")
except Exception as exc:
    real_stdout.write(json.dumps({"ready": False, "error": f"{type(exc).__name__}: {exc}"}) + "\n")
    real_stdout.flush()
    sys.exit(1)
real_stdout.flush()
for line in sys.stdin:
    try:
        req = json.loads(line)
        out = M.build(req.get("overrides") or {})
        resp = {"ok": True, "dcf": out}
    except Exception as exc:
        resp = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    real_stdout.write(json.dumps(resp, default=str) + "\n")
    real_stdout.flush()
