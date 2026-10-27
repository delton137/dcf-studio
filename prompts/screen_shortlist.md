# Task: pick the stocks most worth a full DCF

Today is {today}. You are running **non-interactively** inside DCF Studio's stock screener. There is
no human to answer questions: make documented judgement calls and finish.

- Working directory: `{workdir}` — write only here.
- `screen.csv`: the top {n_rows} of {matched} stocks that passed the screen "{screen_name}"
  (`screen.json` has the filters). Column meanings and data-quality flags are in `fields.md`.
  These are **screening-grade** numbers (as-reported GAAP from SEC XBRL, levered FCF; fundamentals can
  lag the price by a quarter).
- Objective from the user: {objective}

## What to do

Pick **up to {top_n}** stocks where a full, rigorous DCF is most likely to change an investment
decision — typically where the price implies a very different future from what the business is
delivering (`implied_growth` vs `rev_growth`, `implied_gap`), high-quality compounders at a modest
implied growth, or a near-term catalyst (`days_to_earnings`). Rules:

- Prefer clean data; treat rows with flags like `stale_period`, `annual_only`, `shares_scale`,
  `fcf_no_capex` with care and say so if you still pick them.
- You may do brief web research (recent results, guidance, news, catalysts) on your ~20 finalists to
  avoid value traps — cite what you used. Don't invent numbers.
- `n_models` / `model_upside` show existing DCF Studio models; a stock with a recent model is a lower
  priority unless something material changed.

## Output

1. `shortlist.json`:
   ```json
   {{"picks": [{{"symbol": "XYZ", "rank": 1,
                "thesis": "why the market and the fundamentals might disagree (40-1500 chars)",
                "why_now": "catalyst or reason to model it now",
                "key_risk": "the main way this is a value trap",
                "what_the_dcf_must_answer": "the decisive variable a full model should pin down"}}]}}
   ```
   Ranks 1..N, best first, symbols exactly as in `screen.csv`.
2. `report.md`: a ranked table (symbol, implied vs actual growth, FCF yield, EV/EBIT, catalyst) and one
   short paragraph per pick, plus the notable names you rejected and why.

Then run `python3 check_output.py shortlist` and fix until it prints `OK`. Finish with a 3-line summary.
