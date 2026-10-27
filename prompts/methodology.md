# DCF methodology

You are building a discounted cash flow model for **{TICKER}**. Work from
primary sources only, verify everything, and tell me plainly when the answer
is "the market and I disagree and here is exactly why."

### 1. Get the primary sources. Never model from memory or from a summary.

- Look up the CIK: `https://www.sec.gov/files/company_tickers.json`
- Pull the filing index: `https://data.sec.gov/submissions/CIK{10-digit}.json`
- Fetch the **most recent 10-Q or 10-K**, and the **8-K earnings release**
  (usually EX-99.1, sometimes EX-99.2 for a shareholder letter or investor
  update — the guidance often lives there, not in the press release).
- Pull `https://data.sec.gov/api/xbrl/companyfacts/CIK{10-digit}.json` for the
  multi-year history and the **share-count series** (critical — see §6).
- Foreign private issuers file **20-F / 6-K**, not 10-K/10-Q, and are often not
  XBRL-tagged. Some issuers have a **non-December fiscal year** — check, and
  state which calendar quarter you are actually looking at.
- Set a real `User-Agent` header on SEC requests or you will be blocked.
- Get the **current share price and share count** from a market source, and
  timestamp it. A model quoting a stale price is worthless.

### 2. Identify the business archetype BEFORE choosing an engine.

The single biggest modelling error is applying a generic revenue-growth ×
margin template to a business whose value is driven by something else. Pick the
engine that matches the economics:

| Archetype | Engine | Why |
|---|---|---|
| Capital-intensive / infrastructure | `revenue = avg net PP&E × asset turn` | Value turns on capital productivity |
| Asset-light services | `revenue growth × operating margin` | PP&E is irrelevant |
| Airline / transport | `capacity × (unit revenue − unit cost)` | Input prices move costs independently of demand |
| Manufacturer | `units × gross profit per unit` | Per-unit contribution is the whole question |
| Advertising platform | `users × ARPU` | Standard platform identity |
| Utility / generator | `output × gross margin per unit` | Revenue includes zero-margin resale |
| Multi-segment with opposite economics | **Sum-of-the-parts, segment-specific WACC** | A blended rate hides the only thing that matters |
| Pre-revenue / binary regulatory | **Do not lead with a DCF.** Use scenario probabilities, a net-cash floor, and a reverse DCF | There is nothing to extrapolate |

**Verify the identity against actuals before projecting.** e.g. confirm
`DAU × ARPU = reported revenue`, or `ASMs × TRASM = reported revenue`. If the
identity doesn't reproduce the filing, your engine is wrong.

### 3. Anchor the first forecast year to GUIDANCE, not to an annualised quarter.

Annualising a single quarter is the second most common error. Instead:

- Take management's guidance (EPS, EBITDA, deliveries, revenue — whatever they
  give) and **solve backwards** for the driver your engine needs.
- Cross-check that solved figure against **actual year-to-date results**. If your
  full-year number is below the H1 actual, you have made an arithmetic error.
- Make **every scenario respect guidance in year 1** — bear and bull should
  diverge from year 2 onward, not year 1, because the current year is largely
  locked.
- Put an explicit `inside guidance? YES/NO` check in the model and keep it live.

Watch for **seasonality** (a Q1 winter peak for a power generator, a Q2 travel
peak for an airline) and for guidance given on an **adjusted** basis while your
model computes something closer to GAAP.

### 4. Strip out what is not recurring — and know which basis you are on.

Before projecting a margin, decompose the reported number:

- **One-off items**: favourable prior-period development (insurers), one-time
  ramp costs, restructuring, impairments, legal settlements, debt-extinguishment
  losses, unrealised mark-to-market gains on hedges or investments.
- **Non-operating gains masquerading as earnings**: a private-stake revaluation
  can be the entire reported profit.
- **Policy assets**: regulatory credits are not operating margin. Show the
  economics with and without them.
- **Subsidised or related-party revenue**: a development-services contract with
  a partner is not recurring product margin.

State explicitly which basis your margin path is on (reported vs adjusted vs
ex-credits) and **compare like with like** when checking against guidance.

### 5. Handle stock-based compensation correctly. This is a classic double-count.

SBC is normally **already deducted inside operating income**. Verify this from
the company's own Adjusted EBITDA reconciliation: if SBC is an *add-back* to get
from operating income to EBITDA, then it is inside EBIT.

- **Do NOT** subtract a separate SBC line from NOPAT if the margin path already
  reflects it. That charges it twice.
- **Do NOT** project "Adjusted EBITDA margin" as if it were an economic margin —
  it adds SBC back and can overstate profitability by 10–15 points.
- **DO** capture the dilution through a growing share count.

### 6. Model dilution and the share count explicitly.

For any company that funds itself with equity, the per-share answer is dominated
by the share count, not the enterprise value.

- Pull the **historical share-count series** from XBRL and show the trend. A
  company that went from 717M to 987M shares in 21 months will keep going.
- Estimate the **cumulative cash burn** until FCF turns positive, subtract
  identified capital (cash, announced facilities), and issue shares at the
  current price for the remainder.
- Handle **floating consideration** correctly: an acquisition priced at
  "$X billion in stock at a 7-day VWAP" issues *more* shares if the price falls.
  That is a feedback loop, not a fixed add.
- **Out-of-the-money warrants and milestone shares are not shares.** Exclude
  them and state why, but show what happens if they vest.
- Use **fully diluted** shares where disclosed.

### 7. Get the enterprise value bridge right.

```
EV = market cap + total debt − cash
```

Cash *reduces* EV; debt *increases* it. Then judgement calls that matter:

- **Operating leases** are debt-like for airlines, retailers and datacentre
  tenants. Rating agencies capitalise them. Include them, and show both ways.
- **Restricted cash and regulatory reserves are not distributable.** For an
  insurer, a large part of "cash" backs claims. For a nuclear operator,
  decommissioning trusts are legally ring-fenced against the retirement
  obligation — netting them can inflate value by dollars per share.
- **Air-traffic liability / deferred revenue** is an obligation, not cash.
- Where a treatment is debatable, **quantify it in dollars per share** and let
  the reader choose.

### 8. Enforce terminal-value discipline. This is where most DCFs break.

- **Terminal capex must equal maintenance capex**: `capex = D&A × (1 + g)`.
  Otherwise the perpetuity capitalises a permanent build. Assert it in every
  scenario.
- **Normalise the terminal cash flow**: `FCF = NOPAT − g × D&A − ΔWC`. Raw
  final-year FCF is often depressed by a decade of front-loaded capex.
- **Guard the tax**: `IF(EBIT > 0, EBIT × rate, 0)` — no tax benefit on losses.
- **Report TV as a share of EV.** If it is 70%+, say so; the answer is an
  assumption about the terminal state, not a projection.
- **Measure depreciation life from the company's own accounts**
  (`PP&E ÷ annualised D&A`) rather than assuming one.

### 9. Lead with the REVERSE DCF, not the point estimate.

For anything other than a stable business, "what must be true to justify the
price?" is far more useful than a single number.

- Solve for the decisive driver: terminal margin, terminal asset turn, units,
  gross profit per unit.
- **Anchor the answer against something measured** — the company's own history,
  a directly comparable operator you have measured from *their* filings, or a
  physical constraint (megawatts, aircraft, plant capacity).
- Make sure the reverse DCF **scales costs with the driver**. If you scale
  volume without scaling capex, the grid is meaningless and too generous.
- If the grid cannot reach the market price under any plausible combination,
  **say that plainly** and name the gap — do not tune assumptions until the
  model agrees with the tape.

### 10. Verify everything. Automate the checks.

Write and run an explicit check suite. Minimum:

1. Revenue/expense components **sum to reported totals**
2. Segment figures **reconcile to consolidated** (expect intersegment
   eliminations for vertically integrated firms — segment *revenue* may not sum
   while segment *earnings* do)
3. Balance sheet **foots**: assets = liabilities + equity
4. Non-GAAP reconciliations reproduce (EBITDA, adjusted EBITDA, adjusted EPS)
5. Cash-flow derivations reproduce (FCF = OCF − capex)
6. The engine identity holds (units × price = revenue)
7. Terminal capex/D&A = 1 + g, **every scenario**
8. Guarded tax holds **under stress** (force margins negative and confirm no tax
   benefit appears)
9. FCF identity: `NOPAT + D&A − capex − ΔWC`
10. PP&E roll-forward is continuous: `close = open + capex − D&A`, and next
    year's open equals this year's close
11. Monotonicity: bear < base < bull; higher WACC lowers value **(note: for a
    cash-burning business a higher WACC can RAISE value — flag it rather than
    treating it as a bug)**
12. Year-1 output sits **inside guidance**
13. **The model is reproducible**: `python3 model.py` regenerates `dcf.json`
    exactly, and `python3 dcfkit/validate.py dcf.json` passes (it re-runs your
    model, moves every declared input from min to max, and re-values every
    scenario through the shared engine)

When a check fails, **diagnose it — do not silence it.** Several of the most
important findings come from a failing check.

### 11. Deliverables

- **`model.py`** — the single source of truth, heavily commented with the
  reasoning, the sources (accession numbers), and every judgement call. Standard
  library + `dcfkit` only. It exposes `build(overrides=None)` and its declared
  `inputs` are the knobs a user can turn in the web app — so make the decisive
  driver and the archetype drivers inputs.
- **`dcf.json`** — written by `python3 model.py`, in the DCF Studio format
  (see the Output contract below and `dcfkit/AGENT_GUIDE.md`). Never hand-edit it.
- **`report.md`** — the written report (§12).
- No spreadsheet is needed: DCF Studio generates a live-formula workbook from
  `dcf.json`.
- Prove the knobs are live: the validator moves every input and fails dead ones.

### 12. How to report

- Lead with the **number and the gap**, then the **one variable that decides it**.
- **State errors you made and corrected.** They are usually the most
  informative part of the work.
- Distinguish **what is measured** from **what is assumed**.
- Give the **strongest version of the opposing case** and say what would change
  your mind — name the specific metric and threshold.
- If the model cannot justify the market price, say so, and say what the market
  must be pricing that you are not.
- Never tune assumptions to reach a predetermined answer.
