# Task: build a DCF model for {ticker}

Today is {today}. You are running **non-interactively** inside DCF Studio, a local
web app that runs Claude Code, Codex and Grok on the same task and compares their
models. There is no human to answer questions: make reasonable, documented
judgement calls and finish the job end to end.

- Working directory: `{workdir}` — write everything here and nowhere else.
- `dcfkit/` (already present) holds the output contract, the shared valuation
  engine, the validator and a complete worked example. Read
  `dcfkit/AGENT_GUIDE.md` and `dcfkit/example_model.py` before you start coding.
- Save raw downloads under `sources/` (SEC requests need a real User-Agent header:
  `{sec_user_agent}`). Get a current price from a market data
  source and timestamp it.
{price_section}{extra_section}
{methodology}

# Output contract

Follow `dcfkit/AGENT_GUIDE.md` exactly. In short: `model.py` (stdlib + dcfkit,
`build(overrides=None)`, ends with `E.value_model(model)`), `dcf.json` written by
`python3 model.py`, and `report.md`. Then run

```bash
python3 model.py && python3 dcfkit/validate.py dcf.json
```

and iterate until it prints `OK`. Fix failures in `model.py`, never by editing
`dcf.json`. Do not modify anything inside `dcfkit/`.

When the validator passes, finish with a short summary: bear / base / bull value
per share vs the price, the decisive variable, and the validator result.
