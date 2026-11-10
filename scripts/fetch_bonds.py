"""Build data/bonds.json for the Bonds tab.

Sources (no API keys):
  FRED (St. Louis Fed)    Treasury curve, TIPS real yields, breakevens, 5y5y, term premium,
                          fed funds, SOFR, ICE BofA credit spreads and yields by rating
  TreasuryDirect          auction results (same day) and the announced auction schedule
  Yahoo Finance           bond ETF prices and distribution yields

Run by .github/workflows/bonds.yml. Each block falls back to the previous file's
values if its source fails, so one outage never blanks the tab.
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "bonds.json")
HIST_OUT = os.path.join(ROOT, "data", "bond_history.json")
UA = {"User-Agent": "Mozilla/5.0 (CRG site bot)"}

NOMINAL = [("DGS1MO", "1M", 1 / 12), ("DGS3MO", "3M", .25), ("DGS6MO", "6M", .5), ("DGS1", "1Y", 1), ("DGS2", "2Y", 2),
           ("DGS3", "3Y", 3), ("DGS5", "5Y", 5), ("DGS7", "7Y", 7), ("DGS10", "10Y", 10), ("DGS20", "20Y", 20), ("DGS30", "30Y", 30)]
REAL = {"5Y": "DFII5", "7Y": "DFII7", "10Y": "DFII10", "20Y": "DFII20", "30Y": "DFII30"}
RATES = {
    "DFEDTARL": "Fed funds target, lower", "DFEDTARU": "Fed funds target, upper", "DFF": "Effective fed funds",
    "SOFR": "SOFR", "T5YIE": "5Y breakeven", "T10YIE": "10Y breakeven", "T5YIFR": "5y5y forward inflation",
    "THREEFYTP10": "10Y term premium (Kim-Wright)", "T10Y2Y": "2s10s", "T10Y3M": "3m10y",
    "MORTGAGE30US": "30Y mortgage rate",
}
CREDIT = [  # (OAS series, effective-yield series or None, label, bucket)
    ("BAMLC0A1CAAA", None, "AAA", "IG"), ("BAMLC0A2CAA", None, "AA", "IG"), ("BAMLC0A3CA", None, "A", "IG"),
    ("BAMLC0A4CBBB", None, "BBB", "IG"), ("BAMLC0A0CM", "BAMLC0A0CMEY", "IG index", "IG"),
    ("BAMLH0A1HYBB", None, "BB", "HY"), ("BAMLH0A2HYB", None, "B", "HY"), ("BAMLH0A3HYC", None, "CCC and below", "HY"),
    ("BAMLH0A0HYM2", "BAMLH0A0HYM2EY", "HY index", "HY"), ("BAMLEMCBPIOAS", None, "EM corporate", "EM"),
]
ETFS = [("SHY", "1-3Y Treasuries"), ("IEI", "3-7Y Treasuries"), ("IEF", "7-10Y Treasuries"), ("TLT", "20Y+ Treasuries"),
        ("TIP", "TIPS"), ("AGG", "U.S. aggregate"), ("LQD", "IG corporates"), ("HYG", "HY corporates"),
        ("JNK", "HY corporates"), ("BKLN", "Leveraged loans"), ("EMB", "EM sovereigns"), ("MUB", "Munis")]


def rnd(x, d=2):
    try:
        return None if x is None else round(float(x), d)
    except (TypeError, ValueError):
        return None


def get(url, timeout=40):
    req = urllib.request.Request(url, headers=UA)
    for i in range(3):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode()
        except Exception:
            if i == 2:
                raise
            time.sleep(2 * (i + 1))


def fred(sid, start):
    import csv
    import io
    rows = []
    text = get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={start.isoformat()}")
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 2 or row[0].lower() in ("date", "observation_date"):
            continue
        try:
            rows.append((row[0], float(row[1])))
        except ValueError:
            continue
    return rows


def on_or_before(rows, target):
    best = None
    for d, v in rows:
        if d <= target:
            best = v
        else:
            break
    return best


def summary(rows, bp=True):
    """Latest level plus changes (bp for rate series) and, if history allows, 5y percentile."""
    if not rows:
        return None
    d, v = rows[-1]
    ld = date.fromisoformat(d)
    k = 100 if bp else 1

    def chg(days):
        p = on_or_before(rows, (ld - timedelta(days=days)).isoformat())
        return rnd((v - p) * k, 1) if p is not None else None

    five = [x for dd, x in rows if dd >= (ld - timedelta(days=5 * 365)).isoformat()]
    pct = rnd(sum(1 for x in five if x <= v) / len(five) * 100, 0) if len(five) > 250 else None
    return {"value": rnd(v, 3), "asOf": d, "chg1d": rnd((v - rows[-2][1]) * k, 1) if len(rows) > 1 else None,
            "chg1w": chg(7), "chg1m": chg(30), "chg1y": chg(365), "pct5y": pct,
            "lo5y": rnd(min(five), 3) if five else None, "hi5y": rnd(max(five), 3) if five else None}


# ------------------------------------------------------------------ FRED blocks
def build_rates():
    start1 = date.today() - timedelta(days=400)
    start5 = date.today() - timedelta(days=5 * 365 + 30)
    raw = {}
    wanted = [s for s, _, _ in NOMINAL] + list(REAL.values()) + list(RATES)
    for sid in wanted:
        try:
            raw[sid] = fred(sid, start5)  # 5 years for every series so the 5Y range and percentile are real
        except Exception as e:
            print(f"FRED {sid}: {e}", file=sys.stderr)

    out = {"series": {}, "curve": None}
    for sid, label in RATES.items():
        s = summary(raw.get(sid))
        if s:
            out["series"][sid] = {"label": label, **s}

    # derived spreads from the nominal curve
    def spread(a, b, label, key):
        ra, rb = raw.get(a), raw.get(b)
        if not ra or not rb:
            return
        mb = dict(rb)
        rows = [(d, mb[d] - x) for d, x in ra if d in mb]  # b minus a, in percent
        s = summary(rows)
        if s:
            out["series"][key] = {"label": label, **s}
    spread("DGS5", "DGS30", "5s30s", "S5S30")
    spread("DGS2", "DGS5", "2s5s", "S2S5")

    if all(raw.get(s) for s, _, _ in NOMINAL):
        latest = max(raw[s][-1][0] for s, _, _ in NOMINAL)
        ld = date.fromisoformat(latest)
        snap = lambda t: [rnd(on_or_before(raw[s], t.isoformat()), 3) for s, _, _ in NOMINAL]
        real = lambda t: [rnd(on_or_before(raw[REAL[lab]], t.isoformat()), 3) if lab in REAL and raw.get(REAL[lab]) else None
                          for _, lab, _ in NOMINAL]
        out["curve"] = {"tenors": [lab for _, lab, _ in NOMINAL], "asOf": latest,
                        "nominal": snap(ld), "nominal1m": snap(ld - timedelta(days=30)),
                        "real": real(ld)}
        # nominal tenor changes (bp)
        out["tenors"] = []
        for sid, lab, _ in NOMINAL:
            s = summary(raw[sid])
            r = summary(raw.get(REAL.get(lab))) if lab in REAL else None
            out["tenors"].append({"tenor": lab, "nominal": s, "real": r})
    # histories for charts (weekly-thinned 5y for term premium and 2s10s)
    hist = {}
    for sid in ("THREEFYTP10", "T10Y2Y", "T5YIFR"):
        rows = raw.get(sid) or []
        hist[sid] = [[d, rnd(v, 3)] for i, (d, v) in enumerate(rows) if i % 5 == 0 or i == len(rows) - 1]
    out["history"] = hist
    return out


def build_credit():
    start = date.today() - timedelta(days=5 * 365 + 30)
    rows, hist = [], {}
    for oas, ey, label, bucket in CREDIT:
        try:
            r = fred(oas, start)
        except Exception as e:
            print(f"FRED {oas}: {e}", file=sys.stderr)
            continue
        s = summary(r)
        if not s:
            continue
        rec = {"id": oas, "label": label, "bucket": bucket, "oas": s}
        if ey:
            try:
                rec["yield"] = summary(fred(ey, date.today() - timedelta(days=400)))
            except Exception as e:
                print(f"FRED {ey}: {e}", file=sys.stderr)
        rows.append(rec)
        if oas in ("BAMLC0A0CM", "BAMLH0A0HYM2"):
            hist[oas] = [[d, rnd(v * 100, 0)] for i, (d, v) in enumerate(r) if i % 5 == 0 or i == len(r) - 1]
    return {"ratings": rows, "history": hist} if rows else None


# ------------------------------------------------------------------ Treasury auctions
TD = "https://www.treasurydirect.gov/TA_WS/securities/"


def build_auctions():
    """TreasuryDirect's auction service: results post within minutes of each auction."""
    def num(x):
        try:
            return float(str(x).replace(",", ""))
        except (TypeError, ValueError):
            return None

    def norm(r):
        st = (r.get("securityType") or "").strip()
        if (r.get("cashManagementBill") or "").lower() == "yes":
            return None
        tips = (r.get("inflationProtected") or "").lower() == "yes"
        frn = (r.get("floatingRate") or "").lower() == "yes"
        kind = "TIPS" if tips else "FRN" if frn else st
        reopen = (r.get("reopening") or "").lower() == "yes"
        # coupons: name reopenings by their original tenor (a "9-Year 10-Month" reopening is the 10Y);
        # bills: use the actual term (a 13-week reopening of a 26-week bill is a 13W bill)
        base_term = ((r.get("securityTerm") if st == "Bill" else r.get("originalSecurityTerm"))
                     or r.get("securityTerm") or "").strip()
        short = base_term.replace("-Year", "Y").replace("-Week", "W").replace("-Month", "M").replace(" ", "")
        label = f"{short} {kind}" + (" reopening" if reopen and st != "Bill" else "")
        if st == "Bill":
            yld = num(r.get("investmentRate")) or num(r.get("highRate"))
        elif frn:
            yld = num(r.get("highDiscountMargin"))
        else:
            yld = num(r.get("highYield"))
        ind = num(r.get("indirectBiddersCompetitiveParAwarded"))
        dirc = num(r.get("directBiddersCompetitiveParAwarded"))
        pd_ = num(r.get("primaryDealersCompetitiveParAwarded"))
        comp = sum(x for x in (ind, dirc, pd_) if x) or None
        pct = lambda x: rnd(x / comp * 100, 1) if comp and x is not None else None
        return {
            "date": (r.get("competitiveAuctionCloseDate") or r.get("auctionDate") or "")[:10],
            "time": r.get("competitiveAuctionCloseTime"), "issue": (r.get("issueDate") or "")[:10],
            "cusip": r.get("cusip"), "type": kind, "term": base_term, "label": label, "reopening": reopen,
            "size": num(r.get("offeringAmount")), "highYield": yld, "yieldIsMargin": frn,
            "btc": num(r.get("bidToCoverRatio")),
            "indirectPct": pct(ind), "directPct": pct(dirc), "dealerPct": pct(pd_),
        }

    done = [x for x in (norm(r) for r in json.loads(get(TD + "auctioned?format=json&days=550", 90))) if x and x["btc"]]
    done.sort(key=lambda r: r["date"], reverse=True)
    up = [x for x in (norm(r) for r in json.loads(get(TD + "upcoming?format=json", 60))) if x and x["date"]]
    up.sort(key=lambda r: (r["date"], r["time"] or ""))

    def avg(xs):
        xs = [x for x in xs if x is not None]
        return rnd(sum(xs) / len(xs), 2) if xs else None

    coupons = [r for r in done if r["type"] != "Bill"]
    cutoff = (date.today() - timedelta(days=35)).isoformat()
    recent = []
    for r in coupons:
        if r["date"] < cutoff:
            break
        prior = [p for p in coupons if p["type"] == r["type"] and p["term"] == r["term"] and p["date"] < r["date"]][:6]
        r["btcAvg6"] = avg([p["btc"] for p in prior])
        r["indirectAvg6"] = avg([p["indirectPct"] for p in prior])
        r["dealerAvg6"] = avg([p["dealerPct"] for p in prior])
        r["priorYield"] = prior[0]["highYield"] if prior else None
        recent.append(r)
    bills = [r for r in done if r["type"] == "Bill"][:10]
    return {"recent": recent[:14], "bills": bills, "upcoming": up[:16]}


# ------------------------------------------------------------------ compare tool history
HISTORY = [  # (FRED id, label, group); all are yields or rates in percent
    ("DGS1MO", "1M T-bill", "Treasuries"), ("DGS3MO", "3M T-bill", "Treasuries"), ("DGS6MO", "6M T-bill", "Treasuries"),
    ("DGS1", "1Y Treasury", "Treasuries"), ("DGS2", "2Y Treasury", "Treasuries"), ("DGS3", "3Y Treasury", "Treasuries"),
    ("DGS5", "5Y Treasury", "Treasuries"), ("DGS7", "7Y Treasury", "Treasuries"), ("DGS10", "10Y Treasury", "Treasuries"),
    ("DGS20", "20Y Treasury", "Treasuries"), ("DGS30", "30Y Treasury", "Treasuries"),
    ("DFII5", "5Y real (TIPS)", "Real yields"), ("DFII7", "7Y real (TIPS)", "Real yields"),
    ("DFII10", "10Y real (TIPS)", "Real yields"), ("DFII20", "20Y real (TIPS)", "Real yields"), ("DFII30", "30Y real (TIPS)", "Real yields"),
    ("T5YIE", "5Y breakeven", "Inflation"), ("T10YIE", "10Y breakeven", "Inflation"), ("T5YIFR", "5y5y forward", "Inflation"),
    ("DFF", "Effective fed funds", "Policy and funding"), ("SOFR", "SOFR", "Policy and funding"),
    ("THREEFYTP10", "10Y term premium", "Policy and funding"),
    ("MORTGAGE30US", "30Y mortgage", "Mortgages"), ("MORTGAGE15US", "15Y mortgage", "Mortgages"),
    ("BAMLC0A1CAAAEY", "AAA corporate yield", "Corporate yields"), ("BAMLC0A2CAAEY", "AA corporate yield", "Corporate yields"),
    ("BAMLC0A3CAEY", "A corporate yield", "Corporate yields"), ("BAMLC0A4CBBBEY", "BBB corporate yield", "Corporate yields"),
    ("BAMLC0A0CMEY", "IG index yield", "Corporate yields"), ("BAMLH0A1HYBBEY", "BB high yield", "Corporate yields"),
    ("BAMLH0A2HYBEY", "B high yield", "Corporate yields"), ("BAMLH0A3HYCEY", "CCC high yield", "Corporate yields"),
    ("BAMLH0A0HYM2EY", "HY index yield", "Corporate yields"), ("BAMLEMCBPIEY", "EM corporate yield", "Corporate yields"),
]
WEEKLY = {"MORTGAGE30US", "MORTGAGE15US", "THREEFYTP10"}


def build_history():
    start = date.today() - timedelta(days=5 * 365 + 10)
    got = {}
    for sid, label, group in HISTORY:
        try:
            rows = fred(sid, start)
            if rows:
                got[sid] = (label, group, dict(rows))
        except Exception as e:
            print(f"history {sid}: {e}", file=sys.stderr)
    if not got:
        return None
    daily = [sid for sid in got if sid not in WEEKLY]
    # weekdays only (fed funds prints seven days a week); ICE BofA corporate series only go back 3 years on FRED
    dates = sorted({d for sid in daily for d in got[sid][2] if date.fromisoformat(d).weekday() < 5})
    series = {}
    for sid, (label, group, m) in got.items():
        vals, last = [], None
        for d in dates:
            v = m.get(d)
            if sid in WEEKLY:  # carry weekly prints forward so they plot as a continuous line
                last = v if v is not None else last
                v = last
            vals.append(rnd(v, 3))
        series[sid] = {"label": label, "group": group, "v": vals}
    return {"updated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "dates": dates, "series": series}


# ------------------------------------------------------------------ bond ETFs
def build_etfs():
    import yfinance as yf
    syms = [t for t, _ in ETFS]
    hist = yf.download(syms, period="1y", interval="1d", auto_adjust=False, group_by="ticker", progress=False, threads=False)
    out = []
    for t, name in ETFS:
        try:
            c = hist[t]["Close"].dropna()
            last, prev = float(c.iloc[-1]), float(c.iloc[-2])
            before = c[c.index.year < c.index[-1].year]
            base = float(before.iloc[-1]) if len(before) else float(c.iloc[0])
            info = {}
            try:
                info = yf.Ticker(t).info or {}
            except Exception:
                pass
            y = info.get("yield")
            out.append({"t": t, "name": name, "last": rnd(last), "chgPct": rnd((last / prev - 1) * 100),
                        "r1m": rnd((last / float(c.iloc[-22]) - 1) * 100) if len(c) > 22 else None,
                        "ytd": rnd((last / base - 1) * 100),
                        "yield": rnd(y * 100 if y and y < 1 else y, 2), "asOf": c.index[-1].date().isoformat()})
        except Exception as e:
            print(f"ETF {t}: {e}", file=sys.stderr)
    return out or None


def main():
    prev = {}
    if os.path.exists(OUT):
        with open(OUT) as f:
            prev = json.load(f)
    data = dict(prev)
    for key, fn in (("rates", build_rates), ("credit", build_credit), ("auctions", build_auctions), ("etfs", build_etfs)):
        try:
            v = fn()
            if v:
                data[key] = v
                print(f"{key}: ok")
        except Exception as e:
            print(f"{key} failed, keeping previous: {e}", file=sys.stderr)
    try:
        h = build_history()
        if h:
            with open(HIST_OUT, "w") as f:
                json.dump(h, f, separators=(",", ":"))
            print(f"history: {len(h['series'])} series x {len(h['dates'])} days")
    except Exception as e:
        print(f"history failed, keeping previous: {e}", file=sys.stderr)
    data["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
