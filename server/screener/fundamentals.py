"""SEC XBRL frames -> per-company screening fundamentals.

Frames give one value per filer per calendar-aligned period. Rules:
  * income-statement TTM = latest 4 contiguous discrete quarters, chained by
    their real start/end dates (52/53-week and non-December years are fine);
    the fiscal Q4 (never filed alone) is imputed as FY - (Q1+Q2+Q3).
  * cash-flow TTM = FY + Q1(this year) - Q1(last year): 10-Qs report cash flow
    year-to-date, so frames only hold the fiscal Q1. Otherwise the latest FY.
  * balance sheet = latest instant.
Every value records its basis, period end and source tag.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta

from server.screener.sources import DAY, frame

G = "us-gaap"
DURATION = {
    # group: ([(taxonomy, tag, unit)], combine)  combine: max | first
    "revenue": ([(G, "Revenues", "USD"), (G, "RevenueFromContractWithCustomerExcludingAssessedTax", "USD"),
                 (G, "RevenueFromContractWithCustomerIncludingAssessedTax", "USD"), (G, "SalesRevenueNet", "USD"),
                 (G, "RevenuesNetOfInterestExpense", "USD")], "max"),
    "ebit": ([(G, "OperatingIncomeLoss", "USD")], "first"),
    "pretax": ([(G, "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
                 "USD"), (G, "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments", "USD")], "first"),
    "net_income": ([(G, "NetIncomeLoss", "USD")], "first"),
    "interest": ([(G, "InterestExpense", "USD"), (G, "InterestExpenseNonoperating", "USD")], "first"),
    "da": ([(G, "DepreciationDepletionAndAmortization", "USD"), (G, "DepreciationAndAmortization", "USD")], "first"),
    "ocf": ([(G, "NetCashProvidedByUsedInOperatingActivities", "USD")], "first"),
    "capex": ([(G, "PaymentsToAcquirePropertyPlantAndEquipment", "USD"),
               (G, "PaymentsToAcquireProductiveAssets", "USD")], "first"),
    "sbc": ([(G, "ShareBasedCompensation", "USD"), (G, "AllocatedShareBasedCompensationExpense", "USD")], "first"),
    "diluted_shares": ([(G, "WeightedAverageNumberOfDilutedSharesOutstanding", "shares")], "first"),
}
INCOME_GROUPS = ("revenue", "ebit", "pretax", "net_income", "interest", "da", "diluted_shares")
CASHFLOW_GROUPS = ("ocf", "capex", "sbc")
INSTANT_TAGS = [
    (G, "CashCashEquivalentsAndShortTermInvestments", "USD"), (G, "CashAndCashEquivalentsAtCarryingValue", "USD"),
    (G, "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "USD"),
    (G, "ShortTermInvestments", "USD"), (G, "MarketableSecuritiesCurrent", "USD"),
    (G, "AvailableForSaleSecuritiesDebtSecuritiesCurrent", "USD"),
    (G, "LongTermDebt", "USD"), (G, "LongTermDebtNoncurrent", "USD"), (G, "LongTermDebtCurrent", "USD"),
    (G, "DebtCurrent", "USD"), (G, "LongTermDebtAndCapitalLeaseObligations", "USD"),
    (G, "LongTermDebtAndCapitalLeaseObligationsCurrent", "USD"), (G, "ShortTermBorrowings", "USD"),
    (G, "CommercialPaper", "USD"), (G, "MinorityInterest", "USD"), (G, "PreferredStockValue", "USD"),
    (G, "ConvertibleNotesPayable", "USD"), (G, "ConvertibleDebtNoncurrent", "USD"), (G, "SeniorNotes", "USD"),
    (G, "NotesPayable", "USD"), (G, "LongTermNotesPayable", "USD"), (G, "OtherLongTermDebtNoncurrent", "USD"),
    ("dei", "EntityCommonStockSharesOutstanding", "shares"),
]


# --------------------------------------------------------------------------
# periods & fetching
# --------------------------------------------------------------------------

def periods(today=None):
    today = today or date.today()
    q = (today.month - 1) // 3  # quarters fully ended this year
    y = today.year
    quarters = []
    yy, qq = y, q
    for _ in range(13):
        if qq == 0:
            yy, qq = yy - 1, 4
        quarters.append((f"CY{yy}Q{qq}", _qend(yy, qq)))
        qq -= 1
    annual = [(f"CY{y - k}", date(y - k, 12, 31)) for k in (0, 1, 2, 3)]
    instants = [(f"{p}I", e) for p, e in quarters[:5]]
    return {"quarters": quarters, "annual": annual, "instants": instants}


def _qend(y, q):
    return {1: date(y, 3, 31), 2: date(y, 6, 30), 3: date(y, 9, 30), 4: date(y, 12, 31)}[q]


def _ttl(period_end, today):
    return 30 * DAY if (today - period_end).days > 200 else 20 * 3600


def fetch_plan(today=None):
    today = today or date.today()
    p = periods(today)
    jobs = []
    for group, (tags, _) in DURATION.items():
        for tax, tag, unit in tags:
            for label, end in p["quarters"] + p["annual"]:
                jobs.append((tax, tag, unit, label, _ttl(end, today)))
    for tax, tag, unit in INSTANT_TAGS:
        for label, end in p["instants"]:
            jobs.append((tax, tag, unit, label, _ttl(end, today)))
    return jobs


def fetch_all(progress=None, today=None, force=False):
    """Fetch every frame in the plan. Returns {(tax, tag, unit, label): rows}.
    force=True re-fetches recent periods (old, settled periods stay cached)."""
    jobs = fetch_plan(today)
    out = {}
    for i, (tax, tag, unit, label, ttl) in enumerate(jobs):
        if force and ttl < DAY:
            ttl = 0
        out[(tax, tag, unit, label)] = frame(tax, tag, unit, label, ttl=ttl)
        if progress:
            progress(i + 1, len(jobs), f"{tag} {label}")
    return out


# --------------------------------------------------------------------------
# per-company assembly
# --------------------------------------------------------------------------

def _d(s):
    return date.fromisoformat(s[:10])


def index_frames(frames):
    """-> facts[cik][(tax,tag)][label] = {start,end,val,accn} ; names[cik]"""
    facts = defaultdict(lambda: defaultdict(dict))
    names = {}
    for (tax, tag, unit, label), rows in frames.items():
        for r in rows:
            cik = int(r["cik"])
            names.setdefault(cik, r.get("entityName"))
            facts[cik][(tax, tag)][label] = {"start": r.get("start"), "end": r["end"], "val": float(r["val"]),
                                             "accn": r.get("accn")}
    return facts, names


def _group_series(cf, group, labels):
    """Per period label, combine the group's tags. -> list of {start,end,val,tag,label}."""
    tags, combine = DURATION[group]
    out = []
    for label in labels:
        cands = [(t, cf[(tax, t)][label]) for tax, t, _ in tags if label in cf.get((tax, t), {})]
        if not cands:
            continue
        if combine == "max":
            tag, f = max(cands, key=lambda c: c[1]["val"])
            disagree = len(cands) > 1 and sorted(c[1]["val"] for c in cands)[-2] < 0.9 * f["val"]
        else:
            tag, f = cands[0]
            disagree = False
        if not f.get("start"):
            continue
        out.append({"start": _d(f["start"]), "end": _d(f["end"]), "val": f["val"], "tag": tag, "label": label,
                    "disagree": disagree})
    return out


def _contiguous(a, b):
    """True if quarter b immediately follows quarter a."""
    return -3 <= (b["start"] - a["end"]).days <= 8


def impute_q4(qs, ann):
    """Add the fiscal quarter missing from each annual period (usually Q4)."""
    qs = list(qs)
    for A in ann:
        inside = sorted((q for q in qs if q["start"] >= A["start"] - timedelta(days=7)
                         and q["end"] <= A["end"] + timedelta(days=7)), key=lambda q: q["end"])
        if len(inside) != 3:
            continue
        val = A["val"] - sum(q["val"] for q in inside)
        if (inside[0]["start"] - A["start"]).days > 45:          # missing first quarter
            start, end = A["start"], inside[0]["start"] - timedelta(days=1)
        elif (A["end"] - inside[-1]["end"]).days > 45:            # missing last quarter (the usual Q4)
            start, end = inside[-1]["end"] + timedelta(days=1), A["end"]
        else:
            gap = next((i for i in range(2) if not _contiguous(inside[i], inside[i + 1])), None)
            if gap is None:
                continue
            start, end = inside[gap]["end"] + timedelta(days=1), inside[gap + 1]["start"] - timedelta(days=1)
        if not 60 <= (end - start).days <= 125:
            continue
        qs.append({"start": start, "end": end, "val": val, "tag": A["tag"], "label": f"{A['label']}-imputed",
                   "imputed": True, "disagree": False})
    return sorted(qs, key=lambda q: q["end"])


def _chain(qs):
    """Longest run of contiguous quarters ending at the latest quarter."""
    qs = [q for q in qs if 60 <= (q["end"] - q["start"]).days <= 125]
    if not qs:
        return []
    qs = sorted({q["end"]: q for q in qs}.values(), key=lambda q: q["end"])
    chain = [qs[-1]]
    for q in reversed(qs[:-1]):
        if _contiguous(q, chain[0]):
            chain.insert(0, q)
        elif q["end"] < chain[0]["start"] - timedelta(days=10):
            break
    return chain


def ttm_income(qs, ann, *, average=False):
    """-> {val, basis, end, prior, prior_end, tag, imputed} or None.
    average=True for share counts (mean of the 4 quarters, not the sum)."""
    ann = sorted(ann, key=lambda a: a["end"])
    qs = impute_q4(qs, ann) if not average else qs
    chain = _chain(qs)
    agg = (lambda xs: sum(x["val"] for x in xs) / len(xs)) if average else (lambda xs: sum(x["val"] for x in xs))
    if len(chain) >= 4 and 350 <= (chain[-1]["end"] - chain[-4]["start"]).days <= 380:
        last4 = chain[-4:]
        res = {"val": agg(last4), "basis": "TTM", "end": chain[-1]["end"].isoformat(), "tag": chain[-1]["tag"],
               "imputed": any(q.get("imputed") for q in last4), "disagree": any(q.get("disagree") for q in last4),
               "prior": None, "prior_end": None, "latest_q": chain[-1]["val"]}
        if len(chain) >= 8:
            res["prior"] = agg(chain[-8:-4])
            res["prior_end"] = chain[-5]["end"].isoformat()
        if average and len(chain) >= 5:
            res["year_ago_q"] = chain[-5]["val"]
        return res
    if ann:
        a = ann[-1]
        return {"val": a["val"], "basis": "FY", "end": a["end"].isoformat(), "tag": a["tag"], "imputed": False,
                "disagree": a.get("disagree", False), "prior": ann[-2]["val"] if len(ann) > 1 else None,
                "prior_end": ann[-2]["end"].isoformat() if len(ann) > 1 else None}
    return None


def shares_yoy(qs):
    """Latest quarter's diluted weighted shares vs the quarter ending ~1 year earlier."""
    qs = sorted((q for q in qs if 60 <= (q["end"] - q["start"]).days <= 125), key=lambda q: q["end"])
    if not qs:
        return {}
    last = qs[-1]
    prev = min(qs[:-1], key=lambda q: abs((last["end"] - q["end"]).days - 365), default=None)
    if prev is None or abs((last["end"] - prev["end"]).days - 365) > 25:
        return {"latest_q": last["val"]}
    return {"latest_q": last["val"], "year_ago_q": prev["val"]}


def ttm_cashflow(qs, ann):
    ann = sorted(ann, key=lambda a: a["end"])
    if not ann:
        return None
    A = ann[-1]
    q1 = next((q for q in qs if abs((q["start"] - (A["end"] + timedelta(days=1))).days) <= 10
               and 60 <= (q["end"] - q["start"]).days <= 125), None)
    pq1 = next((q for q in qs if abs((q["start"] - A["start"]).days) <= 10
                and 60 <= (q["end"] - q["start"]).days <= 125), None)
    if q1 and pq1:
        return {"val": A["val"] + q1["val"] - pq1["val"], "basis": "FY+Q1", "end": q1["end"].isoformat(),
                "tag": A["tag"]}
    return {"val": A["val"], "basis": "FY", "end": A["end"].isoformat(), "tag": A["tag"]}


def _latest_instant(cf, tax, tag):
    vals = cf.get((tax, tag), {})
    if not vals:
        return None
    f = max(vals.values(), key=lambda f: f["end"])
    return {"val": f["val"], "end": _d(f["end"])}


def balance_sheet(cf):
    out, flags = {}, []
    inst = {t: _latest_instant(cf, tax, t) for tax, t, _ in INSTANT_TAGS}
    dates = [v["end"] for k, v in inst.items() if v and k not in ("EntityCommonStockSharesOutstanding",)]
    if not dates:
        return {"cash": None, "debt": None, "minority": None, "preferred": None, "bs_end": None}, ["missing:balance"]
    latest = max(dates)

    def get(t):
        v = inst.get(t)
        return v["val"] if v and (latest - v["end"]).days <= 100 else None

    # cash
    if get("CashCashEquivalentsAndShortTermInvestments") is not None:
        cash = get("CashCashEquivalentsAndShortTermInvestments")
    else:
        base = get("CashAndCashEquivalentsAtCarryingValue")
        if base is None:
            base = get("CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents")
            if base is not None:
                flags.append("cash_incl_restricted")
        sti = next((get(t) for t in ("ShortTermInvestments", "MarketableSecuritiesCurrent",
                                     "AvailableForSaleSecuritiesDebtSecuritiesCurrent") if get(t) is not None), 0.0)
        cash = None if base is None else base + (sti or 0.0)
    if cash is None:
        flags.append("missing:cash")
    # debt (never double count)
    ltd = get("LongTermDebt")
    if ltd is None:
        nc, cur = get("LongTermDebtNoncurrent"), get("LongTermDebtCurrent")
        if cur is None:
            cur = get("DebtCurrent")
        if nc is not None:
            ltd = nc + (cur or 0.0)
        else:
            lc, lcc = get("LongTermDebtAndCapitalLeaseObligations"), get("LongTermDebtAndCapitalLeaseObligationsCurrent")
            if lc is not None:
                ltd = lc + (lcc or 0.0)
            elif cur is not None:
                ltd = cur
                flags.append("debt_partial")
    if ltd is None:
        # last resort: issuers that only tag notes (convertibles, senior notes) -- first found, never summed
        alt = next(((t, get(t)) for t in ("ConvertibleNotesPayable", "ConvertibleDebtNoncurrent", "SeniorNotes",
                                          "LongTermNotesPayable", "NotesPayable", "OtherLongTermDebtNoncurrent")
                    if get(t) is not None), None)
        if alt:
            ltd = alt[1]
            flags.append("debt_from_notes")
    stb = get("ShortTermBorrowings")
    if stb is None:
        stb = get("CommercialPaper")
    if ltd is None and stb is None:
        debt = 0.0
        flags.append("debt_none_reported")
    else:
        debt = (ltd or 0.0) + (stb or 0.0)
    out.update(cash=cash, debt=debt, minority=get("MinorityInterest"), preferred=get("PreferredStockValue"),
               bs_end=latest.isoformat())
    sh = inst.get("EntityCommonStockSharesOutstanding")
    out["shares_out"] = sh["val"] if sh else None
    out["shares_out_end"] = sh["end"].isoformat() if sh else None
    return out, flags


def build_company(cf, p):
    """All screening fundamentals for one company (raw USD / shares)."""
    qlabels = [l for l, _ in p["quarters"]]
    alabels = [l for l, _ in p["annual"]]
    res, flags = {}, []
    for g in INCOME_GROUPS:
        qs = _group_series(cf, g, qlabels)
        ann = _group_series(cf, g, alabels)
        res[g] = ttm_income(qs, ann, average=(g == "diluted_shares"))
        if g == "diluted_shares" and res[g] is not None:
            res[g].update(shares_yoy(qs))
    for g in CASHFLOW_GROUPS:
        res[g] = ttm_cashflow(_group_series(cf, g, qlabels), _group_series(cf, g, alabels))
    bs, bflags = balance_sheet(cf)
    res.update(bs)
    flags += bflags
    if res.get("ebit") is None and res.get("pretax") is not None:
        # no OperatingIncomeLoss tag (e.g. NKE): EBIT ~ pre-tax income + interest expense
        e = dict(res["pretax"])
        it = res.get("interest")
        if it and it["basis"] == e["basis"] and it["end"] == e["end"]:
            e["val"] += it["val"]
            if e.get("prior") is not None and it.get("prior") is not None:
                e["prior"] += it["prior"]
        e["tag"] = "pretax+interest"
        res["ebit"] = e
        flags.append("ebit_from_pretax")
    rev = res.get("revenue")
    if rev is None:
        flags.append("missing:revenue")
    else:
        if rev.get("disagree"):
            flags.append("rev_tag_disagree")
        if rev["basis"] == "FY":
            flags.append("annual_only")
    if rev is None and res.get("ocf") is None and res.get("ebit") is None:
        flags.append("no_fundamentals")
    for g in ("ocf", "capex", "ebit"):
        if res.get(g) is None:
            flags.append(f"missing:{g}")
    if res.get("capex") and res["capex"]["val"] < 0:
        res["capex"]["val"] = abs(res["capex"]["val"])
        flags.append("capex_sign")
    res["flags"] = flags
    return res
