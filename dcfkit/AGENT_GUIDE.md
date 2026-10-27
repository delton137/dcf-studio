# DCF Studio output contract — guide for model-building agents

Your run directory (the current working directory) already contains `dcfkit/`.
**Read `dcfkit/example_model.py` first** — it is a complete, passing model.py
for a fictional company and the template to follow. `dcfkit/example_dcf.json`
is what it produces.

## Files you must leave in the run directory

| File | What |
|---|---|
| `model.py` | The single source of truth. Standard library + `dcfkit` only. Exposes `build(overrides=None) -> dict`; `python3 model.py` writes `dcf.json`. |
| `dcf.json` | Produced by running `python3 model.py`. **Never edit it by hand.** |
| `report.md` | The written report (methodology §12): number and gap, decisive variable, errors corrected, measured vs assumed, strongest opposing case, what would change your mind. **Write it last, from the final `dcf.json` numbers** — it must state the headline value per share exactly as in `dcf.json`. |
| `sources/` | Raw filings/JSON you fetched (keep them; model.py may read from here). |
| `fetch_*.py` (optional) | Any scripts that download data. Network access belongs here, never in model.py. |

Then run, and iterate until it prints `OK`:

```bash
python3 model.py && python3 dcfkit/validate.py dcf.json
```

## model.py rules

1. `import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))` then
   `from dcfkit import engine as E`.
2. Your archetype engine (methodology §2) turns drivers into **rows**, one per
   fiscal year, built with `E.make_row(...)` (it applies the tax guard and FCF identity).
3. Terminal: `E.normalized_terminal(rows, g, nwc_pct_of_revenue=...)` (capex = D&A×(1+g),
   normalized N+1 FCF). Other methods: `{"method": "exit_multiple", "multiple": 12,
   "multiple_metric": "ebitda"}`, `"finite_annuity"`, `"gordon"`, `"none"` (finite-life assets).
4. Assemble the dict (see the example) and finish `build()` with `E.value_model(model)`;
   the engine fills every `results` block. Do not compute EV/equity/per-share yourself
   — then the web app's what-if engine reproduces your model exactly. If you truly need
   valuation logic the engine lacks, set `engine_override_reason` and explain.
5. `build(overrides)`: `overrides` keys are exactly your `inputs[].key`s. Unknown keys
   **must raise**. Deep-copy defaults; never mutate module-level state (a state leak
   between calls fails validation).
6. Deterministic, no network, no wall-clock (`datetime.now()`), no randomness.
   Reading files under `sources/` is fine.

## Fixed conventions

- Money flows: reporting currency, **millions**. Share counts: ordinary shares, **millions**.
  Convert $K/$bn inputs on the way in.
- `capex`, `da`, `taxes` are **positive** numbers. `delta_nwc > 0` means cash invested.
- `fcff = nopat + da − capex − delta_nwc + other_adj` (`make_row` does this).
- Bridge items: signed `equity_effect` — cash `+`, debt `−`, leases `−`. Mark judgement
  calls `debatable: true` with a `rationale`; include/exclude per scenario via
  `bridge_overrides` (the UI lets the user flip them).
- `market.price` is per **listed unit** in **quote currency**. For ADRs/ADSs set
  `listing.listed_unit` and `ordinary_per_listed_unit` (ordinary shares per ADS; e.g. TSM 5)
  and `market.fx_spot` (reporting → quote currency). Per-share results come out per
  listed unit automatically.
- Periods are keyed by `period_end` (ISO date). For non-December fiscal years use the
  real fiscal year-end dates and labels like `FY2027`; set `basis.fiscal_year_end`.
- `basis.valuation_date` = the balance-sheet date of the cash/debt in your bridge.
  `discounting.stub_fraction` = share of the first projected fiscal year that lies after
  that date (e.g. 0.5 after a Q2 balance sheet). Optionally give `stub_fcff` (the
  remaining-period FCF) when cash flow is seasonal. The first projected row is the
  **full** fiscal year (so it can be checked against full-year guidance).
- Scenarios: `bear`, `base`, `bull` (role + id), `probability` on all or none.
  Year 1 is anchored to guidance in every scenario (`year1_locked: true`).
- Sum-of-the-parts: several `components` in each scenario, each with its own
  `discounting.wacc` and `terminal`. Stakes/holdings: `kind: "fixed"`. Drug pipelines:
  `kind: "rnpv"` with `probability`. Equity-level items (e.g. a stake valued per share
  already): `level: "equity"`.
- Equity-funded cash burners: `shares.method = "burn_funded"`, put `new_shares` into
  `shares.used` and the cash raised into `shares.proceeds` (otherwise the burn is
  counted twice). OTM warrants/milestone shares → `excluded_instruments` with the
  per-share impact if they vest.
- Pre-revenue / binary names: still give bear/base/bull (scenario values), set
  `headline.method = "prob_weighted"` and add a `net_cash_floor` in `alt_valuations`.

## What the app shows from your JSON (fill these well)

- `inputs[]` — the knobs users can turn in the UI. Declare 4–12, always including the
  **decisive driver** (`decisive: true`), the archetype drivers (e.g. asset turn, ASM
  growth, GP/unit), WACC and g for base, and debatable bridge toggles. Give realistic
  `min`/`max`/`step`, `scope` (scenario ids or `["all"]`) and `expected_sign`
  (`+` if raising the input raises value). Namespacing per scenario like
  `base.wacc`, `bull.asset_turn` works well. The validator moves each knob min→max
  and fails dead knobs or wrong signs.
- `drivers[]` + `rows[].drivers{}` — archetype operating metrics per year (units, ARPU,
  asset turn, segment revenue `seg_rev:Datacenter` ...). Charted in the UI.
- `archetype` (kind, engine identity, `decisive` variable with an `anchor`), `identity_check`.
- `historicals.rows` (`is_actual: true`) for at least the last 2–3 fiscal years, and
  `share_count_series`.
- `guidance[]` with `model{scenario: value}` and `inside{scenario: bool}`.
- `reverse_dcf[]` — what the price implies for the decisive driver, and an anchor.
- `grids[]` — at least WACC × g for base (`z[i][j]` for `y.values[i]`, `x.values[j]`).
- `checks[]` — ids required: `engine_identity`, `inside_guidance`, `terminal_capex`,
  `tax_guard`, `fcf_identity`, `monotonic`, `wacc_monotonic`. Recommended:
  `components_sum`, `segments_reconcile`, `balance_sheet_foots`, `non_gaap_recon`,
  `fcf_derivation`, `ppe_rollforward`, `ytd_floor` (use status `na` + reason if not
  applicable). A `fail` needs a `diagnosis`.
- `assumptions[]` with `status` measured / derived / guided / assumed and `source_id`.
- `sources[]` with accession numbers and URLs; cite them via `source_id`.
- `narrative` — `headline` is one sentence: the number and the gap.

## Common validation failures

- `scale` / `market_cap`: units are not millions, or the ADR ratio/FX is wrong.
- `idempotent`: you edited dcf.json, or model.py is non-deterministic.
- `purity`: `build()` mutated a module-level dict — deep-copy.
- `live_knobs`: an input doesn't feed the model, or its `expected_sign` is wrong.
- `stub`: `stub_fraction` left at 1 although the valuation date is mid-year.
- `reproduction`: you computed results yourself instead of calling `E.value_model`.
- `report_consistency`: report.md was written before the final numbers — regenerate it.
