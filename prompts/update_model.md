# Task: update the existing DCF model for {ticker}

Today is {today}. You are running **non-interactively** inside DCF Studio. There
is no human to answer questions: make reasonable, documented judgement calls and
finish the job end to end.

`previous/` holds the model you are updating (version `{parent_version}`, built by
{parent_source}, data as of **{parent_as_of}**): its `dcf.json`, `report.md` and
— if it has one — `model.py`{legacy_note}.

Your job:

1. Find everything material published since {parent_as_of}: new 10-Q/10-K/8-K
   (earnings releases, guidance changes), share-count changes, debt/cash changes,
   and the current price. Save downloads under `sources/` (SEC requests need the
   User-Agent header `{sec_user_agent}`).
2. Start from `previous/model.py` if it exists (copy it to `./model.py`), keep its
   engine and judgement calls unless the new evidence demands a change, and
   update the numbers. If there is no `previous/model.py`, write a fresh model in
   this format, using the previous model's assumptions and reasoning as a
   reference — but re-derive every number from primary sources.
3. Record every material change in `provenance.changelog` inside `build()`'s
   output: `[{{"summary": "...", "detail": "why", "old": ..., "new": ...}}]` —
   e.g. new guidance, revised WACC, updated share count, price.
4. In `report.md`, open with **What changed since {parent_as_of}** and how the
   value moved and why.

- Working directory: `{workdir}`. `dcfkit/` holds the output contract, engine,
  validator and a complete worked example (`dcfkit/AGENT_GUIDE.md`,
  `dcfkit/example_model.py`).
{price_section}{extra_section}
{methodology}

# Output contract

Follow `dcfkit/AGENT_GUIDE.md` exactly, then run

```bash
python3 model.py && python3 dcfkit/validate.py dcf.json
```

and iterate until it prints `OK`. Fix failures in `model.py`, never by editing
`dcf.json`. Do not modify anything inside `dcfkit/`.

Finish with a short summary of what changed and the new bear / base / bull values.
