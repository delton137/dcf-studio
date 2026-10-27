# Task: convert a legacy DCF model into the DCF Studio format

You are a conversion agent running **non-interactively** inside DCF Studio. There
is no human to answer questions: make careful, documented decisions and finish.

- Ticker: **{ticker}** · legacy source: **{source}** (`{legacy_id}`) · quality: {quality}
- Notes: {notes}
- Working directory: `{workdir}` — write only here.
- Legacy files (read-only **copies**, in `legacy/`):
{files}

The originals live elsewhere; never touch them. **Never run legacy `build_*.py`
scripts** (several write workbooks into other people's folders) — read them as
text if you need their constants. Do not fetch anything from the internet.

## Goal

A **faithful** `dcf.json` of what the legacy model concluded at the time, so it can
be compared apples-to-apples with other AIs' models. Do not re-model, update data,
or "fix" its judgement calls — record them. Where the legacy model has a bug or an
inconsistency, keep its numbers and describe the issue in
`provenance.imported_from.notes`.

## Read first

`dcfkit/AGENT_GUIDE.md` (format + conventions), `dcfkit/schema.py` (every field),
`dcfkit/example_dcf.json` (a complete example), `dcfkit/engine.py` (`make_row`,
`normalized_terminal`, `value_model`, `reproduce`, `detect_convention`).

## Deliverables

1. **`convert.py`** — programmatic extraction: import the legacy module from
   `legacy/` (`sys.path.insert(0, "legacy")`) and call its functions, or read
   workbook cells with openpyxl. Never hand-transcribe a number that can be read
   or computed. It builds the dict and writes `dcf.json`.
2. **`dcf.json`** — must pass `python3 dcfkit/validate.py dcf.json --mode imported`
   with **0 FAIL** (warnings are fine but read them).
3. **`report.md`** — first line `> Imported from <files> (<source>, legacy date <date>)`,
   then a faithful summary of the legacy narrative (README / memo / module
   docstrings and comments): the verdict, the decisive variable, key judgement calls,
   errors the original author recorded, and what the checks found. Keep the
   original author's conclusions; don't add your own opinions.
4. **`legacy_adapter.py`** — only when the legacy module exposes parameters (e.g.
   `project(name, wacc=..., g=..., spread_shift=...)`, `include_leases`). It defines
   `build(overrides=None) -> dict` that returns the complete dcf dict recomputed
   **through the legacy module** with those parameters (reuse convert.py's builder),
   and the dict's `inputs[]` declares each supported override (`key`, `label`,
   `unit`, `value` = legacy default, `min`/`max`/`step`, `scope`, `group`,
   `expected_sign`, `decisive` for the decisive driver). Unknown keys must raise.
   Legacy solvers sometimes mutate module dicts (e.g. `SCENARIOS`) — deep-copy and
   restore so repeated calls never leak state. Self-test it: `build()` equals
   dcf.json (ignoring `provenance`), each input min→max moves the value of a
   scenario in its scope, and a second `build()` after an override equals the first.
   If there are no parameters, skip this file and leave `inputs` empty.

## Mapping rules

- `provenance`: `producer: "import"`, `validation_mode: "imported"`, `ticker`, `company`,
  `imported_from`: `{{path: "<legacy files, comma-separated, relative to DCF_models/>",
  source: "{source}", generation, fidelity ("full" = rows + bridge + results reproduce,
  "rows" = rows present, "headline" = only per-share values), source_scale, convention_detected,
  quality: "{quality}", legacy_created (ISO date of the legacy model), notes}}`.
- **Results are the legacy's STATED numbers.** For each scenario put the legacy's EV,
  equity and value per share into `results` (do NOT let `E.value_model` overwrite them
  in the final dict). Then measure how well the engine reproduces them:
  `E.reproduce(model)` and `E.detect_convention(model)`. Aim for grade `exact`: the
  usual fixes are setting `terminal.fcf_next` to the legacy's terminal numerator
  (= TV × (WACC − g)), matching the discount convention (end vs mid-year), the stub,
  the bridge items, and the share count actually used. If it can't be exact, explain
  why in `imported_from.notes` (e.g. per-year WACC, NOL schedule).
- Units: flows in **millions** of reporting currency (convert $K/$bn), shares in millions.
  Per-share values are per **listed unit** in quote currency: for ADS/ADR names set
  `listing.listed_unit`, `ordinary_per_listed_unit`, `market.fx_spot` so that the engine's
  per-share output equals the legacy per-ADS value.
- Scenarios: ids/roles `bear`, `base`, `bull` (map "Base"/"base"/index order). Extra
  scenarios → role `other`. Probabilities only if the legacy model states them.
- `headline.method`: `prob_weighted` if the legacy leads with a probability-weighted
  value, `floor` for a net-cash floor lead, else `base_dcf`.
- Legacy check suites (`verify()`, `checks()`, `run_checks()`) → `checks[]` with
  `produced_by: "legacy"` (call them; they return `(name, ok, detail)` tuples).
- Reverse-DCF functions → `reverse_dcf[]`; sensitivity functions/sheets → `grids[]`;
  cross-checks (net-cash floor, exit multiple, P/E) → `alt_valuations[]`.
- Historicals: from module constants or the workbook's actuals, where clean.
- Narrative: from the module docstring / README / memo: `headline` = the legacy verdict
  in one sentence; fill `decisive_variable`, `thesis`, `bear_case`, `bull_case`,
  `change_my_mind`, `errors_corrected` where the legacy text supports it.
- `market.price` / `price_ts` = the legacy model's own price and date (not today's).
  `basis.as_of` = the legacy model's data date.
- Sources: accession numbers / filings cited in the legacy code or README.

## Source-specific guide

{guide}

## Finish

Run `python3 convert.py && python3 dcfkit/validate.py dcf.json --mode imported`
(and the legacy_adapter self-test) until there are 0 FAILs. End with a 4-line
summary: legacy base & headline value per share vs imported, reproduction grade and
residual, anything you could not map.
