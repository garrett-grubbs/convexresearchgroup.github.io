"""Pull market data and write data/markets.json for the CRG site.

Sources (no API keys needed):
  - FRED public CSV endpoint for Treasury yields, fed funds, breakevens, credit spreads
  - Yahoo Finance (via yfinance) for equities, sectors, commodities, FX, vol, crypto

Run by .github/workflows/markets.yml on a schedule. Any single source failing
leaves the rest of the file intact (the previous value is kept), so one bad
fetch never blanks the dashboard.
"""

import csv
import io
import json
import os
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "markets.json")

# ---------------------------------------------------------------- FRED
FRED_SERIES = {
    # curve points
    "DGS1MO": "1M", "DGS3MO": "3M", "DGS6MO": "6M", "DGS1": "1Y", "DGS2": "2Y",
    "DGS3": "3Y", "DGS5": "5Y", "DGS7": "7Y", "DGS10": "10Y", "DGS20": "20Y", "DGS30": "30Y",
    # policy, real rates, inflation
    "DFF": "Effective Fed Funds", "DFEDTARL": "FF Target Lower", "DFEDTARU": "FF Target Upper",
    "DFII10": "10Y Real (TIPS)", "T10YIE": "10Y Breakeven",
    # curve spreads
    "T10Y2Y": "2s10s", "T10Y3M": "3m10y",
    # credit (ICE BofA OAS)
    "BAMLC0A0CM": "IG OAS", "BAMLH0A0HYM2": "HY OAS",
}
CURVE_ORDER = ["DGS1MO", "DGS3MO", "DGS6MO", "DGS1", "DGS2", "DGS3", "DGS5", "DGS7", "DGS10", "DGS20", "DGS30"]
CURVE_YEARS = [1 / 12, 0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30]


def fetch_fred(series_id, start):
    url = f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}&cosd={start.isoformat()}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (CRG site bot)"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                text = r.read().decode()
            break
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
    rows = []
    for row in csv.reader(io.StringIO(text)):
        if len(row) < 2 or row[0].lower() in ("date", "observation_date"):
            continue
        try:
            rows.append((row[0], float(row[1])))
        except ValueError:
            continue  # FRED uses "." for missing
    return rows


def value_on_or_before(rows, target):
    """Last observation on or before target date (rows sorted ascending)."""
    best = None
    for d, v in rows:
        if d <= target:
            best = (d, v)
        else:
            break
    return best


def build_fred():
    start = date.today() - timedelta(days=400)
    raw = {}
    for sid in FRED_SERIES:
        try:
            raw[sid] = fetch_fred(sid, start)
        except Exception as e:
            print(f"FRED {sid} failed: {e}", file=sys.stderr)
    out = {"series": {}, "curve": None, "history": {}}

    for sid, label in FRED_SERIES.items():
        rows = raw.get(sid)
        if not rows:
            continue
        last_d, last_v = rows[-1]
        prev = rows[-2][1] if len(rows) > 1 else None
        ld = date.fromisoformat(last_d)
        wk = value_on_or_before(rows, (ld - timedelta(days=7)).isoformat())
        mo = value_on_or_before(rows, (ld - timedelta(days=30)).isoformat())
        yr = value_on_or_before(rows, (ld - timedelta(days=365)).isoformat())
        out["series"][sid] = {
            "label": label,
            "value": last_v,
            "asOf": last_d,
            # changes in basis points (all FRED series here are in percent)
            "chg1dBp": round((last_v - prev) * 100, 1) if prev is not None else None,
            "chg1wBp": round((last_v - wk[1]) * 100, 1) if wk else None,
            "chg1mBp": round((last_v - mo[1]) * 100, 1) if mo else None,
            "chg1yBp": round((last_v - yr[1]) * 100, 1) if yr else None,
        }

    # yield curve today vs 1M ago vs 1Y ago
    if all(raw.get(s) for s in CURVE_ORDER):
        latest = max(raw[s][-1][0] for s in CURVE_ORDER)
        ld = date.fromisoformat(latest)
        snaps = {}
        for key, target in (("today", ld), ("1m", ld - timedelta(days=30)), ("1y", ld - timedelta(days=365))):
            pts = []
            for s in CURVE_ORDER:
                v = value_on_or_before(raw[s], target.isoformat())
                pts.append(v[1] if v else None)
            snaps[key] = {"date": target.isoformat(), "yields": pts}
        out["curve"] = {
            "tenors": [FRED_SERIES[s] for s in CURVE_ORDER],
            "years": CURVE_YEARS,
            **snaps,
        }

    # 1Y daily history for small charts (thinned to keep the JSON light)
    for sid in ("DGS2", "DGS10", "T10Y2Y", "BAMLC0A0CM", "BAMLH0A0HYM2", "T10YIE"):
        rows = raw.get(sid)
        if rows:
            cutoff = (date.today() - timedelta(days=366)).isoformat()
            out["history"][sid] = [[d, v] for d, v in rows if d >= cutoff]
    return out


# ---------------------------------------------------------------- Yahoo
YAHOO = {
    "equities": [
        ("^GSPC", "S&P 500"), ("^NDX", "Nasdaq 100"), ("^DJI", "Dow Jones"), ("^RUT", "Russell 2000"),
        ("^STOXX50E", "Euro Stoxx 50"), ("^N225", "Nikkei 225"), ("^HSI", "Hang Seng"),
    ],
    "sectors": [
        ("XLK", "Technology"), ("XLF", "Financials"), ("XLV", "Health Care"), ("XLY", "Cons. Discretionary"),
        ("XLP", "Cons. Staples"), ("XLE", "Energy"), ("XLI", "Industrials"), ("XLB", "Materials"),
        ("XLU", "Utilities"), ("XLRE", "Real Estate"), ("XLC", "Communication"),
    ],
    "commodities": [
        ("CL=F", "WTI Crude"), ("BZ=F", "Brent Crude"), ("NG=F", "Nat Gas"),
        ("GC=F", "Gold"), ("SI=F", "Silver"), ("HG=F", "Copper"),
    ],
    "fx": [
        ("DX-Y.NYB", "DXY"), ("EURUSD=X", "EUR/USD"), ("USDJPY=X", "USD/JPY"),
        ("GBPUSD=X", "GBP/USD"), ("BTC-USD", "Bitcoin"),
    ],
    "vol": [("^VIX", "VIX"), ("^MOVE", "MOVE")],
}


def build_yahoo():
    import yfinance as yf  # imported here so FRED still runs if yfinance is missing

    tickers = [t for group in YAHOO.values() for t, _ in group]
    # threads=False avoids yfinance's sqlite cache lock ("database is locked")
    hist = yf.download(
        tickers, period="1y", interval="1d", auto_adjust=False,
        group_by="ticker", progress=False, threads=False,
    )
    out = {}
    spx_spark = None
    for group, items in YAHOO.items():
        out[group] = []
        for t, name in items:
            try:
                closes = hist[t]["Close"].dropna()
            except Exception:
                continue
            if len(closes) < 2:
                continue
            last = float(closes.iloc[-1])
            prev = float(closes.iloc[-2])
            wk = float(closes.iloc[-6]) if len(closes) > 5 else None
            this_year = closes[closes.index.year == closes.index[-1].year]
            ytd_base = closes[closes.index.year < closes.index[-1].year]
            ytd_ref = float(ytd_base.iloc[-1]) if len(ytd_base) else float(this_year.iloc[0])
            pct = lambda a, b: round((a / b - 1) * 100, 2) if b else None
            out[group].append({
                "ticker": t, "name": name, "last": round(last, 4),
                "chg": round(last - prev, 4), "chgPct": pct(last, prev),
                "wkPct": pct(last, wk) if wk else None, "ytdPct": pct(last, ytd_ref),
                "asOf": closes.index[-1].date().isoformat(),
                # last 30 closes for the homepage sparklines
                "spark": [round(float(v), 4) for v in closes.iloc[-30:]],
            })
            if t == "^GSPC":
                tail = closes.iloc[-130:]
                spx_spark = [[d.date().isoformat(), round(float(v), 2)] for d, v in tail.items()]
    if spx_spark:
        out["spxHistory"] = spx_spark
    return out


# ---------------------------------------------------------------- main
def main():
    previous = {}
    if os.path.exists(OUT):
        with open(OUT) as f:
            previous = json.load(f)

    data = dict(previous)
    try:
        fred = build_fred()
        if fred["series"]:
            data["rates"] = fred
    except Exception as e:
        print(f"FRED block failed: {e}", file=sys.stderr)
    try:
        y = build_yahoo()
        if any(y.get(k) for k in YAHOO):
            data["markets"] = y
    except Exception as e:
        print(f"Yahoo block failed: {e}", file=sys.stderr)

    if not data.get("rates") and not data.get("markets"):
        print("No data fetched; leaving file unchanged.", file=sys.stderr)
        sys.exit(0)

    data["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
