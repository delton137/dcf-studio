### Legacy Claude models (`Claude_DCFs/`)

Each modern model is a stdlib-only `<ticker>_model.py` that imports cleanly with no
side effects and is deterministic; it is the best source (the companion xlsx has
**no cached values** — every formula cell reads `None` with `data_only=True`).
Run legacy calls in-process from `convert.py`, but copy module dicts before
calling solvers. There is no single API; identify the generation:

| Gen | Files | Entry point → shape |
|---|---|---|
| G1 | amkr, crwv, iren, joby, on, rddt, rivn, ual, unh, nvda, meta; ceg/bbai/spcx (SCENARIOS is a list) | `value("Base")` → `{name, proj: {name, rows[], pv_sum, tv, pv_tv, ev, term_fcf, wacc, capex_da_terminal}, ev, equity, fmv, [shares, fmv_nodil, fmv_basic, net_debt_used]}` |
| G2 | amd, apld, avgo, bbai2, be, cbrs, cbrs2, ceg2, corz, mrvl, mu, simo, sndk, tsm, wrd | `project("base")` → `{rows[], tv, pv_fcf, pv_tv, ev, equity, fmv, tv_share, term_fcf, term_capex, term_da, upside, [net_debt/net_cash]}`, plus `ev_bridge()`, `reverse_dcf*()`, `verify()` → `[(name, ok, detail)]` |
| G2 variants | wm, nke, etn, sny | per-share key is `per_share` / `value_per_share` / `per_ads_usd`; NKE EV key `enterprise_value` |
| WM | wm | `project(scenario_name, wacc=None, terminal_growth=None, overrides=None)` returns **column arrays** `{years[10], revenue[10], revenue_cd, revenue_other, ebitda, dda, ebit, nopat, capex_maint, capex_growth, capex, delta_wc, fcf, pv_fcf, term_*, tv, pv_tv, ev, net_debt, bridge_extra, equity, per_share, wacc, g, tv_share_of_ev, upside}`; `sensitivity()` → `(wacc_list, g_list, grid[w][g])`; `reverse_dcf()` → float (implied yield); checks live in `verify_wm.py` (a script, not a function) |
| DELL (SOTP) | dell | `project(scenario="base", g, tax_rate, exclude_dfs=True, wacc_isg=None, wacc_csg=None)` → `{isg: {segment, rows[], wacc, tv, pv_fcf, pv_tv, ev, tv_share, term_*}, csg: {...}, ev, ev_isg, ev_csg, cash, debt, equity, fmv, upside, shares, implied_pe}` → two `dcf` components with segment WACCs; `reverse_dcf_isg_margin()`; `verify()` (76 checks) |
| G3 | mcd, wmt | dataclasses `Scenario`/`SegDrivers`/`YearOut`; `value(SCENARIOS["Base"])` → `{rows: [YearOut], terminal: {nopat_t, dandda_t, capex_t, dwc_t, fcf_t, tv, pv_tv}, pv_explicit, ev, net_debt, equity, per_share, tv_share_of_ev, upside}`; `checks(verbose)` |
| rNPV | mrna | `value("Base")` → `{base, intismeran, other, net_cash, equity, shares, per_share, bb, it, op}` — no EV; one `dcf` component for the base business + `rnpv` components; tax is a cumulative NOL shield (use `taxes=` explicitly in rows); finite 10-year tail with `max(TV,0)`; shares = basic grown 3 years |
| xlsx only | AMZN, NBIS, SHAZ, PYPL, NOVOB, AVGO (May) | see "Workbook-only" below |

Row keys are usually `year, ebit, tax, nopat, da, capex, dwc, fcf, pv` plus archetype
keys (`asm`, `spread`, `aircraft`, `mw`, `gm`, `om`, `seg_*` …) → put the archetype keys in
`rows[].drivers{}` and register them in `drivers[]`. Revenue may be absent from the
rows (e.g. UAL computes EBIT = ASM × spread) — derive it from drivers if the module can
(e.g. ASM × TRASM), otherwise leave `revenue` null (allowed in imported rows).

**Known conventions**
- Discounting is end-year `(1+wacc)^(i+1)` with no stub (stub_fraction 1).
- Terminal numerators vary (store `fcf_next` = the module's numerator × (1+g) as used):
  UAL `(NOPAT_N − g·DA_N)·(1+g)`; CRWV/JOBY/DELL/NVDA `(NOPAT_N − g·DA_N − rev_N·g·nwc%)·(1+g)`;
  MCD/META an explicit N+1 row; RDDT raw final FCF × (1+g).
- Names: WACC (`WACC`, `WACC_BASE`, `WACC_ISG/CSG`, `WACC_SEMI/SOFTWARE`, `WACC_SEGMENT`
  dict, per-scenario `WACC_BEAR/BASE/BULL` in CRWV/IREN/SNY, `Scenario.wacc`); g
  (`TERMINAL_GROWTH`, `G_TERMINAL`, `TERM_GROWTH`); price (`PRICE`, `PRICE_ADR` TSM,
  `PRICE_ADS_USD`/`PRICE_ORD_EUR` SNY); 10+ share-count names — read the module.
- Units: most $M; **$K** in APLD, BE, BBAI2, CBRS, CORZ, SIMO (divide by 1,000); TSM EV in
  **US$bn**; TSM flows in TWD with `fx_projection` 32.0 — check.
- Per-share basis: TSM per ADR (1 ADR = 5 ordinary), SIMO per ADS (4 ordinary per ADS),
  WRD per ADS (1 ADS = 3 ordinary), SNY per ADS in USD (1 ordinary = 2 ADS → 0.5;
  converts at the Q2 average EURUSD 1.163, not spot — record that).
- Horizons: usually 10 years, JOBY 15, ETN 7.
- CRWV: `value()` includes leases by default but `market_ev()` excludes them — note it.
- JOBY: burn-funded dilution adds shares but no proceeds (cash burn counted twice) —
  keep the legacy numbers, set `shares.method: "burn_funded"`, and describe the issue in notes.
- UAL/JOBY solvers mutate `SCENARIOS` without try/finally — deep-copy/restore.
- Some files have two `__main__` blocks; importing is harmless.

**Workbook-only items** (and when a module is missing): if the workbook has formulas,
recalculate it first with LibreOffice into a SEPARATE output dir (writing into the
input's own dir silently no-ops) and an isolated profile (other agents run
concurrently):
```bash
mkdir -p /tmp/recalc_$$ && soffice -env:UserInstallation=file:///tmp/lo_profile_$$ --headless \
  --calc --convert-to xlsx --outdir /tmp/recalc_$$ legacy/FILE.xlsx
```
then read `/tmp/recalc_$$/FILE.xlsx` with `openpyxl.load_workbook(..., data_only=True)` and
assert the cells you need are not `None`. Locate values by LABEL (labels vary: "FAIR VALUE
PER SHARE", "FAIR MARKET VALUE PER SHARE (dil…)", "VALUE PER SHARE", "FAIR VALUE PER ADS
(US$)", "FAIR MARKET VALUE / SHARE"). G0 workbooks (AVGO May, PYPL) have no formulas:
`B5` WACC, `B6` g, `B8` price, "FAIR MARKET VALUE / SHARE" ~B57, "Total Enterprise Value"
~B53, bear/base/bull summary at the bottom. Sensitivity grids and reverse-DCF results in
sheets are pasted numbers. Fidelity for these is usually "rows" or "headline".
