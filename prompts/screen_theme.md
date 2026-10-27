# Task: build a theme universe — "{query}"

Today is {today}. You are running **non-interactively** inside DCF Studio's stock screener. There is
no human to answer questions: make documented judgement calls and finish.

- Working directory: `{workdir}` — write only here.
- `universe_index.csv` lists every US-listed common stock / ADR the screener knows (symbol, name, sector,
  industry, market cap $M, country), largest first.

## What to do

Identify the listed companies with **material exposure** to the theme "{query}": pure plays and
companies where the theme is a significant segment or growth driver (not incidental exposure). Use your
knowledge plus web research where useful (segment disclosures, industry reports). Map each company to its
symbol **exactly as it appears in `universe_index.csv`** — companies not listed there can't be included.
Aim for roughly 10–80 members, quality over quantity.

## Output

`universe.json`:
```json
{{"name": "short list name",
  "description": "one paragraph: what the theme covers and how members were chosen",
  "members": [{{"symbol": "XYZ", "name": "Company", "exposure": "pure | major | partial",
               "note": "one line on how the company is exposed (max 400 chars)"}}]}}
```

Then run `python3 check_output.py theme` and fix until it prints `OK`. Finish with a 3-line summary.
