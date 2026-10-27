# DCF Studio HTTP API

Base: `http://127.0.0.1:8765/api` (localhost only). All JSON. The unified model
format is `dcfkit/dcf.schema.json` (pydantic source: `dcfkit/schema.py`); a full
example is `dcfkit/example_dcf.json`.

## Core types

**VersionSummary** (one model version = one directory under `data/models/<TICKER>/<version_id>/`)
```jsonc
{
  "version_id": "20261001-081801_claude",   // <stamp>_<source>[-import|-edit]
  "ticker": "MU", "company": "Micron Technology",
  "source": "claude" | "codex" | "grok",     // CLI family that built it (imports keep the legacy family)
  "origin": "run" | "import" | "app_edit",
  "status": "queued|running|validating|fixing|valid|invalid|failed|cancelled|interrupted",
  "kind": "new|update|import", "created_at": "...", "finished_at": "...",
  "cli": "claude", "model": "opus", "effort": "high", "parent_version": null, "error": null,
  "usage": {"cost_usd": 1.23, "input_tokens": 0, "output_tokens": 0},
  "has_dcf": true, "as_of": "2026-09-30", "quality": "verified" | "unverified",
  "validation": {"ok": true, "fail": 0, "warn": 2, "pass": 5} | null,
  "reproducibility": "exact" | "approx" | "none" | null,   // can the engine reproduce it? (gates Layer-A what-ifs)
  "has_model_py": true,                                   // Layer-B what-ifs available
  "superseded": false, "latest": true,                    // latest per (ticker, source)
  "derived": Derived | null
}
```

**Derived** — canonical comparison metrics, computed identically for every model
(`dcfkit/engine.py::derive`). Per-share values are per listed unit in quote currency.
```jsonc
{
  "value_ps": {"bear": 5.49, "base": 38.81, "bull": 95.31, "pw": 44.61, "headline": 44.61},
  "price_model": 42.1, "price_ts": "2026-09-30", "upside_model": 0.06,
  "compare_price": 40.0, "upside_compare": 0.115,          // vs the app's common price for the ticker
  "quote_currency": "USD", "listed_unit": "common",
  "wacc": 0.09, "g": 0.025, "terminal_method": "normalized_gordon",
  "ev": 2580.7, "equity": 1940.7, "tv_pct_ev": 0.648, "shares_used": 50.0,   // $M, M shares (base)
  "horizon_years": 10, "rev_cagr": 0.083, "terminal_ebit_margin": 0.143, "margin_basis": "gaap",
  "terminal_capex_da": 1.025, "implied_exit_ev_ebitda": 9.2, "ev_ebitda_y1": 13.6,
  "yr1_revenue": 1086.0, "yr1_period": "FY2026", "yr1_period_end": "2026-12-31",
  "yr1_guide_mid": 1080.0, "yr1_vs_guide": 0.0056, "yr1_inside": true,
  "dilution_pct": 0.0,
  "checks": {"pass": 8, "fail": 0, "warn": 0, "total": 8},
  "archetype": "manufacturer", "decisive": "Terminal gross profit per unit", "scenario_count": 3
}
```
Any field may be missing/null for imported models with less detail.

## Endpoints

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{ok}` |
| GET | `/config` | `{backends: {claude|codex|grok: {label, available, version, models[], efforts[], default_model, default_effort, paused}}, runs, imports, overlay_knobs: {knob: description}}` |
| GET | `/summary` | `{tickers: [{ticker, company, compare_price: {price, ts, source}|null, latest: {claude: VersionSummary|null, codex: ..., grok: ...}, versions_count, active_runs, building: {claude: bool, codex: bool, grok: bool}}]}` |
| GET | `/tickers/{T}` | `{ticker, company, compare_price, versions: VersionSummary[]}` (newest first) |
| GET | `/tickers/{T}/compare?versions=id1,id2` | `{ticker, compare_price, models: [{summary, dcf}]}` — default = latest per source |
| GET | `/versions/{vid}` | `{summary, dcf (with dcf.derived), run, validation}` |
| GET | `/versions/{vid}/files` | `[{path, size}]` |
| GET | `/versions/{vid}/file?path=model.py` | raw file |
| GET | `/versions/{vid}/report` | markdown text |
| GET | `/versions/{vid}/export.xlsx` | standardized workbook (live formulas) |
| POST | `/versions/{vid}/whatif` | body `{knobs?: {...}, overrides?: {...}, scenario_ids?: [...]}` → `{dcf, derived, layers: ["B","A"], grade, anchored, warnings[]}` (422 with `detail` on bad input) |
| GET | `/versions/{vid}/whatifs` | saved what-ifs `[{name, slug, knobs, overrides, note, created_at, derived, layers}]` |
| POST | `/versions/{vid}/whatifs` | body `{name, knobs, overrides, note?}` → saved entry |
| DELETE | `/versions/{vid}/whatifs/{slug}` | `{deleted}` |
| POST | `/versions/{vid}/promote` | body `{name, knobs, overrides, note?}` → `{version_id, validation}` — creates an `app_edit` version (origin `app_edit`, same source, `parent_version` = vid) that appears in version lists and comparisons |
| POST | `/runs` | body `{ticker, sources: ["claude","codex","grok"], mode: "new"|"update", parent_versions?: {source: vid}, instructions?, models?: {source: model}, efforts?: {source: effort}}` → `{runs: [{version_id, source, mode, parent_version}]}`. Update mode with no parent for a source falls back to new. |
| GET | `/runs?active=true` | run metadata list (run.json contents + `validation: {ok, fail, warn, pass}|null`), newest first |
| GET | `/runs/{vid}` | `{run, validation, summary}` |
| GET | `/runs/{vid}/events?after=N` | **SSE**: `event: log` data = RunEvent; final `event: end` data `{status}` |
| GET | `/runs/{vid}/events.json?after=N` | RunEvent[] |
| POST | `/runs/{vid}/cancel` | `{cancelled}` |
| GET | `/prices/{T}` | `{price, ts, source}` or `{}` |
| POST | `/prices/refresh` | body `{tickers?: [...]}` (default all) → `{T: {price, ts, source, currency} | {error, previous}}` |
| PUT | `/prices/{T}` | body `{price}` manual override |
| GET | `/imports` | legacy-import inventory `{items: [ImportItem], summary}` |
| POST | `/imports/run` | body `{legacy_ids?: [...], all?: bool}` → `{launched: [...]}` |

**What-if knobs (Layer A)** — `knobs` object keys: `wacc` (absolute), `wacc_shift`, `g`
(absolute), `g_shift`, `exit_multiple`, `bridge` (`{bridge_id: bool}`), `shares_mult`
(all exact); `rev_growth_shift`, `ebit_margin_shift`, `capex_intensity_mult`, `tax_rate`
(generic overlay, approximate, applied from year 2). Layer A needs
`reproducibility` exact/approx (approx → applied as deltas on stated values); with `none`
only `bridge`/`shares_mult` work.

**Layer B** — `overrides` keys are `dcf.inputs[].key` (each input has `label, unit, type
(float|int|bool|enum), value (default), min, max, step, options, scope, group, decisive,
expected_sign, description`). Requires `has_model_py`.

**RunEvent** (`events.jsonl` line)
```jsonc
{"seq": 12, "ts": "...", "attempt": 0,           // attempt 0 = main turn, 1.. = validation-fix turns
 "kind": "status|system|text|thinking|tool|tool_result|result|error",
 "text": "...", "tool": "Bash", "ok": true}
```

**ImportItem**
```jsonc
{"legacy_id": "claude:wm_model", "source": "claude|codex|grok", "ticker": "WM",
 "files": ["Claude_DCFs/wm_model.py", "Claude_DCFs/WM_DCF.xlsx"], "generation": "claude_wm",
 "quality": "verified|unverified", "superseded_by": null,
 "status": "pending|queued|running|valid|invalid|failed", "version_id": null,
 "crosscheck": {"legacy_vps": 1.0, "imported_vps": 1.0, "match": true} | null}
```

## Screener (`/api/screener/*`)

Free data: Nasdaq listings (price, market cap, sector), SEC XBRL frames (fundamentals), Nasdaq
earnings calendar, Yahoo charts (Enrich), SEC companyconcept (Refine). Money in **$M**; percent
fields are **fractions** (0.15 = 15%) except `pct_change` (percentage points) and `rule_of_40` (points).

| Method | Path | Returns |
|---|---|---|
| GET | `/status` | `{state: idle|running|error, stage, detail, frames_done, frames_total, table_asof, table_rows, last_ok, error, jobs: {enrich|refine: {state, done, total, errors}}, params}` |
| POST | `/refresh` | body `{force?}` → `{started}` (background; poll `/status`) |
| GET | `/fields` | `{fields: [{key, label, group, type: text|price|pctpt|money|mult|pct|num|int|date|flags, desc}], groups[], flags: {flag: help}, params}` |
| GET | `/presets` | `[{id, name, group, desc, screen, needs_enrich?}]` |
| POST | `/query` | body `{screen, limit?}` → `{asof, total, matched, rows[], unmatched[], params}` |
| GET | `/rows/{symbol}` | `{row, fundamentals (per-field val/basis/end/tag), refine, flags_help}` |
| GET | `/sectors` | `{sectors: [{name, count}], industries: [{sector, name, count}]}` |
| POST | `/enrich` | body `{symbols}` (≤200) → `{started, count}`; Yahoo 52-week high/low, `pct_below_high`, `mom_3m/6m/12m` |
| POST | `/refine` | body `{symbols}` (≤200) → `{started, count}`; exact TTM cash flow (`cashflow_basis` → `TTM-exact`) |
| GET | `/screens` · PUT/DELETE `/screens/{slug}` | saved screens `{slug, name, note, screen, saved_at}`; PUT body `{name, screen, note?}` |
| GET | `/universes` | `{builtin: [{id, name, desc}], lists: [{slug, name, kind: custom|agent, source, count, updated_at}]}` |
| GET/PUT/DELETE | `/universes/{slug}` | list doc `{slug, name, kind, source, members: [{symbol, name?, note?}]}`; PUT body `{name, members, kind?}` |
| POST | `/universes/{slug}/members` | body `{symbols}` → updated list |
| POST | `/agent` | body `{kind: shortlist|theme, screen?, top_n?, objective?, query?, list_name?, cli, model?, effort?}` → `{version_id}` (an agent run: follow it with the existing `/api/runs/{id}` + SSE log) |
| GET | `/agent` · `/agent/{id}` | runs list · `{run, validation, shortlist: {picks: [{symbol, rank, thesis, why_now, key_risk, what_the_dcf_must_answer}]}, universe, screen, report}` |

**screen** = `{name?, universe, filters: [{f, op, v}], sort: [{f, dir: asc|desc}], params?: {r, g_t, target_margin}}`.
Universes: `us1b` (default: market cap ≥ $1B with SEC fundamentals, primary share class), `all`, `models`,
`sector:<name>`, `industry:<name>`, `list:<slug>`. Operators: `>= <= > < == between [lo,hi] in not_in
is_null not_null is_true is_false has_flag no_flag contains`.

**Screener row** (key fields): `symbol, name, sector, industry, country, kind (common|adr), cik, price,
pct_change, volume, market_cap, ev, revenue, revenue_basis (TTM|FY), revenue_end, rev_growth, ebit,
op_margin, net_income, ebitda, ocf, capex, fcf, cashflow_basis (FY+Q1|FY|TTM-exact), fcf_margin, fcf_yield,
sbc_pct, cash, debt, net_cash, net_cash_pct, ev_sales, ev_ebit, ev_ebitda, pe, rule_of_40, dilution, shares,
implied_growth, implied_edge (null|below_range|above_range), implied_gap, implied_rev_cagr, data_age_days,
earnings_date, earnings_time, eps_forecast, days_to_earnings, [enrich] high_52w, low_52w, pct_below_high,
mom_3m, mom_6m, mom_12m, [coverage] ticker, n_models, has_claude, has_codex, has_grok, model_upside,
model_age_days, flags[]`.
