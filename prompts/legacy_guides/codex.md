### Legacy Codex models (`codex_dcf_models/`)

Codex built each model with a Python script that defines inputs and computes the
cases, then rendered the workbook with a proprietary JS runtime (`render_*.mjs`,
`@oai/artifact-tool`) that **cannot be re-run here** — ignore the .mjs files except as
documentation. The four models use different conventions:

**MU** (`build_mu_dcf.py`, `outputs/mu_20260930/*.json`)
- Memory archetype: DRAM/NAND bit volume × price, per-scenario gross margins.
- `build_mu_dcf.py` uses only the stdlib. Inputs are a dict `I` (e.g. `I["price"] = 1067.59`);
  scenarios `SC` = Bear/Base/Bull dicts with `wacc`, `g`, 10-year arrays (`dramvol`,
  `dramprice`, `nandvol`, `nandprice`, `dramgm`, `nandgm`), `qgrowth`, `capex`, `capacity`,
  `opexgrowth`, `story`. `calc(case)` returns `years[]` (per-year dicts with `year, rev,
  ebit, nopat, da, capex, dwc, fcf, pv, …`) plus scalars. Its `validate()` writes files —
  do NOT call it; call `calc()` directly (importing the module must not trigger writes —
  check the `__main__` guard first; if importing has side effects, exec only the
  needed definitions or parse with `ast`).
- `case_results.json`: `{"Bear"|"Base"|"Bull": {pv, pvtv, ev, netcash, price (= fair value
  per share), upside, tvshare, terminalrev, terminalebit, terminalda, terminalcapex,
  terminalwc, terminalfcf, holderg, requiredmargin}}` — the stated results. No WACC/g/price
  inside: take those from `I`/`SC`.
- MU's fiscal year ends late August/early September — use real fiscal period ends.
- `requiredmargin` is a reverse-DCF result (margin the price requires) → `reverse_dcf`.
- `calc(case)` with parameters makes a natural `legacy_adapter.py` (e.g. scenario WACC, g,
  prices/margins as shifts).

**BIOA** (`build_bioa_dcf.py`, `BIOA_MODEL.md`, `outputs/bioa_20260928/*.json`)
- Risk-adjusted drug pipeline with a finite life and **no terminal value** → components of
  kind `rnpv` (or `dcf` with `terminal.method: "none"`) — products DME and CV with
  probabilities of success, 24 periods.
- `model_results.json`: list of 3 dicts with integer `case` 1/2/3 (= Bear/Base/Bull):
  `price` (fair value per share), `ev`, `equity`, `cash`, `options`, `reverse`,
  `required_p2`, `dme_pv`, `cv_pv`, `dme_pos`, `cv_pos`, `need`, `newshares`, `prefund`,
  `upside`, `cash_2029`, `rows` (keyed by DCF-sheet ROW NUMBER → 24-period arrays; labels for
  those rows are in `workbook_spec.json` → `sheets.DCF.cells["A<row>"]`), `inputs` (33 keys:
  price 7.37, shares 45.897, cash, debt, …), `assumptions` (wacc 0.12, dme_launch, …).
- Options are valued as a Black-Scholes **claim** (a bridge item, kind `options_claim`), not
  as shares; price floored at 0 when equity is negative.
- Funding need → `newshares` / `prefund`: model as `shares.method: "burn_funded"` with
  proceeds if the legacy did so; otherwise record in notes.
- Reverse DCF = implied DME approval probability (`required_p2`).
- `BIOA_MODEL.md` is the memo → report.md and narrative. `validation.json` records the
  LibreOffice recalculation (1,809 cells, max diff 4.7e-11) → a legacy check.

**CEG** (`build_ceg_dcf.py`, `ceg_dcf.xlsx`) and **SpaceX / SPCX** (`build_spacex_dcf.py`,
`spacex_dcf.xlsx`)
- Older (Aug 13) openpyxl builds with formulas and `fullCalcOnLoad`, so **no cached
  values**. Prefer the build script's own Python computation if it computes values (read it
  as text; only exec pure-computation parts — the script writes the workbook when run). If
  values exist only as formulas, recalculate with LibreOffice into a separate outdir with an
  isolated profile:
  ```bash
  mkdir -p /tmp/recalc_$$ && soffice -env:UserInstallation=file:///tmp/lo_profile_$$ --headless \
    --calc --convert-to xlsx --outdir /tmp/recalc_$$ legacy/FILE.xlsx
  ```
  and read with `openpyxl.load_workbook(..., data_only=True)`.
- CEG: TWh × margin per MWh; `DCF!E19` "Value per share"; Bear/Base/Bull EV, equity and
  value per share at `DCF!A25:D27` (Base is formulas, Bear/Bull hardcoded).
- SpaceX: sum-of-the-parts; `DCF` row 64 "Value per common share". Use several components
  (one per segment, own WACC if given). SpaceX is private — `listing.listed_unit: "private"`
  and the price is whatever reference value the model compares against (state it).
