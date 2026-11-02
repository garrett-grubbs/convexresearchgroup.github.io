"""Build the stock lookup data: data/stocks/index.json plus one JSON per ticker.

Universe: every NYSE/Nasdaq/AMEX common stock above MIN_MCAP (default $250M), from the
Nasdaq stock screener, falling back to S&P 500 + Nasdaq 100 from Wikipedia, then to the cached
universe.json. Extra tickers can be forced in via scripts/stocks_extra.json, e.g. ["SPCX"].

Output goes to OUT_DIR (default data/stocks). In production the workflow points OUT_DIR at a
checkout of the `stock-data` branch, which is force-pushed as a single commit each run so the
site repo's history doesn't grow. The site reads it from raw.githubusercontent.com.

Per ticker (Yahoo Finance via yfinance):
  tape        last, prior close, gap, volume vs 30d avg, ATR move, returns, relative perf vs SPY and sector ETF
  levels      52w high/low, 20/50/200d SMA, RSI(14), 20d high/low, 1y closes for the chart
  positioning short % float, days to cover, short interest change, institutional ownership
  options     front expiry ATM IV, put/call volume and OI, unusual strikes, implied move into earnings
  catalysts   next earnings, ex-dividend, analyst target, recent headlines
  risk        1y beta and correlation to SPY, 20d realized vol

Usage:
  python scripts/fetch_stocks.py            full refresh (run daily before the open)
  python scripts/fetch_stocks.py --quotes   fast price/volume refresh of index.json only (intraday)
  python scripts/fetch_stocks.py --options 500   refresh options for the 500 largest names (midday)
"""

import json
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.abspath(os.environ.get("OUT_DIR") or os.path.join(ROOT, "data", "stocks"))
UNIVERSE = os.path.join(DIR, "universe.json")
EXTRA = os.path.join(ROOT, "scripts", "stocks_extra.json")
INDEX = os.path.join(DIR, "index.json")
MIN_MCAP = float(os.environ.get("MIN_MCAP", 250e6))
DEEP_BUDGET_MIN = float(os.environ.get("DEEP_BUDGET_MIN", 240))  # stop deep pulls after this, keep old data
WORKERS = int(os.environ.get("WORKERS", 6))

SECTOR_ETF = {
    "Information Technology": "XLK", "Financials": "XLF", "Health Care": "XLV",
    "Consumer Discretionary": "XLY", "Consumer Staples": "XLP", "Energy": "XLE",
    "Industrials": "XLI", "Materials": "XLB", "Utilities": "XLU", "Real Estate": "XLRE",
    "Communication Services": "XLC",
}
# yfinance's own sector names -> GICS names (for extra tickers not in the Wikipedia lists)
YF_SECTOR = {
    "Technology": "Information Technology", "Financial Services": "Financials", "Healthcare": "Health Care",
    "Consumer Cyclical": "Consumer Discretionary", "Consumer Defensive": "Consumer Staples",
    "Energy": "Energy", "Industrials": "Industrials", "Basic Materials": "Materials",
    "Utilities": "Utilities", "Real Estate": "Real Estate", "Communication Services": "Communication Services",
}
# Screener rows that aren't common stock (they carry the parent's market cap)
import re as _re
NON_COMMON = _re.compile(r"\b(notes?|debentures?|preferred|pfd|depositary|units?|warrants?|rights|subordinated|"
                         r"baby bonds?|exchangeable|zones|trust preferred|due \d{4})\b|%", _re.I)

# Nasdaq screener sector names -> GICS names
NQ_SECTOR = {
    "Technology": "Information Technology", "Finance": "Financials", "Health Care": "Health Care",
    "Consumer Discretionary": "Consumer Discretionary", "Consumer Staples": "Consumer Staples", "Energy": "Energy",
    "Industrials": "Industrials", "Basic Materials": "Materials", "Utilities": "Utilities",
    "Real Estate": "Real Estate", "Telecommunications": "Communication Services",
}


def yf_sym(t):
    return t.replace(".", "-")


def rnd(x, d=2):
    try:
        if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))):
            return None
        return round(float(x), d)
    except (TypeError, ValueError):
        return None


# ------------------------------------------------------------------ universe
def load_universe():
    cached = {}
    if os.path.exists(UNIVERSE):
        with open(UNIVERSE) as f:
            cached = {r["t"]: r for r in json.load(f)}
    fresh = {}
    try:
        import urllib.request
        req = urllib.request.Request(
            "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
                     "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9"})
        with urllib.request.urlopen(req, timeout=60) as r:
            rows = json.loads(r.read().decode())["data"]["rows"]
        for r in rows:
            t = (r.get("symbol") or "").strip().replace("/", ".")
            try:
                mcap = float(r.get("marketCap") or 0)
            except ValueError:
                mcap = 0
            if not t or mcap < MIN_MCAP or any(ch in t for ch in "^ $") or len(t) > 6:
                continue
            if NON_COMMON.search(r.get("name") or ""):
                continue  # notes, preferreds, units, warrants, rights, depositary shares
            name = (r.get("name") or t).replace(" Common Stock", "").replace(" Class A Ordinary Shares", " Class A").strip()
            fresh[t] = {"t": t, "n": name, "sector": NQ_SECTOR.get(r.get("sector") or "", ""),
                        "sub": r.get("industry") or "", "mcapHint": mcap, "idx": []}
        print(f"Nasdaq screener: {len(fresh)} stocks above ${MIN_MCAP / 1e6:.0f}M")
    except Exception as e:
        print(f"Nasdaq screener failed: {e}", file=sys.stderr)
        fresh = {}
    if len(fresh) < 400:
      fresh = {}
      try:
        import io
        import pandas as pd
        import urllib.request

        def tables(url):
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (CRG site bot)"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return pd.read_html(io.StringIO(r.read().decode()))

        for tb in tables("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"):
            if "Symbol" in tb.columns and "GICS Sector" in tb.columns:
                for _, r in tb.iterrows():
                    fresh[str(r["Symbol"]).strip()] = {"t": str(r["Symbol"]).strip(), "n": str(r["Security"]),
                                                       "sector": str(r["GICS Sector"]), "sub": str(r.get("GICS Sub-Industry", "")),
                                                       "idx": ["SPX"]}
                break
        for tb in tables("https://en.wikipedia.org/wiki/Nasdaq-100"):
            cols = [c for c in tb.columns if str(c).lower() in ("ticker", "symbol")]
            if cols and len(tb) > 80:
                tc = cols[0]
                name_c = next((c for c in tb.columns if str(c).lower() in ("company", "security")), None)
                sec_c = next((c for c in tb.columns if "sector" in str(c).lower()), None)
                sub_c = next((c for c in tb.columns if "sub-industry" in str(c).lower()), None)
                for _, r in tb.iterrows():
                    t = str(r[tc]).strip()
                    if t in fresh:
                        fresh[t]["idx"].append("NDX")
                    else:
                        fresh[t] = {"t": t, "n": str(r[name_c]) if name_c else t, "sector": str(r[sec_c]) if sec_c else "",
                                    "sub": str(r[sub_c]) if sub_c else "", "idx": ["NDX"]}
                break
      except Exception as e:
        print(f"Universe refresh failed, using cache: {e}", file=sys.stderr)

    uni = fresh if len(fresh) > 400 else cached
    if os.path.exists(EXTRA):
        with open(EXTRA) as f:
            for t in json.load(f):
                t = t.strip().upper()
                uni.setdefault(t, cached.get(t) or {"t": t, "n": t, "sector": "", "sub": "", "idx": []})
    if uni:
        with open(UNIVERSE, "w") as f:
            json.dump(sorted(uni.values(), key=lambda r: r["t"]), f, separators=(",", ":"))
    return uni


# ------------------------------------------------------------------ history-based stats
def series_stats(df, spy, sect):
    """df: DataFrame with Open/High/Low/Close/Volume for one ticker (daily, ~1y)."""
    import numpy as np
    df = df.dropna(subset=["Close"])
    if len(df) < 30:
        return None
    c, h, l, o, v = df["Close"], df["High"], df["Low"], df["Open"], df["Volume"]
    last, prev = float(c.iloc[-1]), float(c.iloc[-2])
    tr = np.maximum(h - l, np.maximum((h - c.shift()).abs(), (l - c.shift()).abs()))
    atr = float(tr.rolling(14).mean().iloc[-1])
    vol30 = float(v.iloc[-31:-1].mean()) if len(v) > 31 else float(v.mean())
    delta = c.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    rsi = float(100 - 100 / (1 + gain.iloc[-1] / loss.iloc[-1])) if loss.iloc[-1] else 100.0
    rets = c.pct_change().dropna()
    hv20 = float(rets.iloc[-20:].std() * math.sqrt(252) * 100)

    def ret(n):
        return rnd((last / float(c.iloc[-1 - n]) - 1) * 100) if len(c) > n else None

    this_year = c[c.index.year == c.index[-1].year]
    before = c[c.index.year < c.index[-1].year]
    ytd_base = float(before.iloc[-1]) if len(before) else float(this_year.iloc[0])

    beta = corr = rel_spy = rel_sec = None
    if spy is not None:
        sr = spy.pct_change().reindex(rets.index).dropna()
        common = rets.reindex(sr.index).dropna()
        sr = sr.reindex(common.index)
        if len(common) > 60 and sr.var() > 0:
            beta = rnd(common.cov(sr) / sr.var())
            corr = rnd(common.corr(sr))
        s1m = spy.dropna()
        if len(s1m) > 21:
            rel_spy = rnd((last / float(c.iloc[-22]) - 1) * 100 - (float(s1m.iloc[-1]) / float(s1m.iloc[-22]) - 1) * 100)
    if sect is not None and len(sect.dropna()) > 21:
        s = sect.dropna()
        rel_sec = rnd((last / float(c.iloc[-22]) - 1) * 100 - (float(s.iloc[-1]) / float(s.iloc[-22]) - 1) * 100)

    sma = lambda n: rnd(c.iloc[-n:].mean()) if len(c) >= n else None
    hi52, lo52 = float(h.max()), float(l.min())
    return {
        "asOf": c.index[-1].date().isoformat(),
        "last": rnd(last), "prev": rnd(prev), "chg": rnd(last - prev), "chgPct": rnd((last / prev - 1) * 100),
        "open": rnd(o.iloc[-1]), "high": rnd(h.iloc[-1]), "low": rnd(l.iloc[-1]),
        "gapPct": rnd((float(o.iloc[-1]) / prev - 1) * 100),
        "vol": int(v.iloc[-1]) if not math.isnan(v.iloc[-1]) else None, "avgVol30": int(vol30),
        "relVol": rnd(float(v.iloc[-1]) / vol30) if vol30 else None,
        "avgDollarVol30": int(vol30 * float(c.iloc[-31:-1].mean())) if len(c) > 31 else None,
        "atr14": rnd(atr), "atrPct": rnd(atr / last * 100), "moveAtr": rnd((last - prev) / atr) if atr else None,
        "r1w": ret(5), "r1m": ret(21), "r3m": ret(63), "ytd": rnd((last / ytd_base - 1) * 100), "r1y": ret(len(c) - 1),
        "relSpy1m": rel_spy, "relSector1m": rel_sec,
        "hi52": rnd(hi52), "lo52": rnd(lo52), "fromHi52": rnd((last / hi52 - 1) * 100), "fromLo52": rnd((last / lo52 - 1) * 100),
        "hi20": rnd(h.iloc[-20:].max()), "lo20": rnd(l.iloc[-20:].min()),
        "sma20": sma(20), "sma50": sma(50), "sma200": sma(200), "rsi14": rnd(rsi, 1),
        "hv20": rnd(hv20, 1), "beta1y": beta, "corrSpy1y": corr,
        "closes": [[d.date().isoformat(), rnd(x)] for d, x in c.items()],
    }


# ------------------------------------------------------------------ per-ticker Yahoo calls
def with_retry(fn, tries=3):
    for i in range(tries):
        try:
            return fn()
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1) + (5 if "429" in str(e) or "Too Many" in str(e) else 0))


def ts_date(x):
    try:
        if x is None:
            return None
        if isinstance(x, (int, float)):
            return datetime.fromtimestamp(x, timezone.utc).date().isoformat()
        if hasattr(x, "isoformat"):
            return x.isoformat()[:10]
        return str(x)[:10]
    except Exception:
        return None


def options_block(tk, last, earnings):
    out = {}
    exps = with_retry(lambda: tk.options) or ()
    today = date.today()
    exps = [e for e in exps if (date.fromisoformat(e) - today).days >= 2]
    if not exps or not last:
        return None

    def chain_stats(exp):
        ch = with_retry(lambda: tk.option_chain(exp))
        calls, puts = ch.calls.fillna(0), ch.puts.fillna(0)
        if calls.empty or puts.empty:
            return None
        k = min(calls["strike"], key=lambda s: abs(s - last))
        c_atm = calls[calls["strike"] == k].iloc[0]
        p_atm = puts.iloc[(puts["strike"] - k).abs().argsort()[:1]].iloc[0]
        mid = lambda r: (r["bid"] + r["ask"]) / 2 if r["bid"] > 0 and r["ask"] > 0 else r["lastPrice"]
        straddle = float(mid(c_atm) + mid(p_atm))
        iv = [x for x in (c_atm["impliedVolatility"], p_atm["impliedVolatility"]) if x and x > 0.01]
        return {
            "expiry": exp, "dte": (date.fromisoformat(exp) - today).days, "strike": rnd(k),
            "atmIv": rnd(sum(iv) / len(iv) * 100, 1) if iv else None,
            "straddle": rnd(straddle), "impliedMovePct": rnd(straddle / last * 100),
            "callVol": int(calls["volume"].sum()), "putVol": int(puts["volume"].sum()),
            "callOi": int(calls["openInterest"].sum()), "putOi": int(puts["openInterest"].sum()),
            "_calls": calls, "_puts": puts,
        }

    front = chain_stats(exps[0])
    if not front:
        return None
    pcv = front["putVol"] / front["callVol"] if front["callVol"] else None
    pco = front["putOi"] / front["callOi"] if front["callOi"] else None
    unusual = []
    for side, dfx in (("C", front["_calls"]), ("P", front["_puts"])):
        u = dfx[(dfx["volume"] >= 500) & (dfx["volume"] > dfx["openInterest"])]
        for _, r in u.nlargest(3, "volume").iterrows():
            unusual.append({"type": side, "strike": rnd(r["strike"]), "vol": int(r["volume"]), "oi": int(r["openInterest"]),
                            "iv": rnd(r["impliedVolatility"] * 100, 1)})
    unusual.sort(key=lambda r: -r["vol"])
    out["front"] = {k: v for k, v in front.items() if not k.startswith("_")}
    out["front"]["pcVol"] = rnd(pcv)
    out["front"]["pcOi"] = rnd(pco)
    out["unusual"] = unusual[:4]

    # implied move into earnings: first expiry on/after the earnings date, if within ~70 days
    if earnings:
        ed = date.fromisoformat(earnings)
        if 0 <= (ed - today).days <= 70:
            exp_e = next((e for e in exps if date.fromisoformat(e) >= ed), None)
            if exp_e:
                st = front if exp_e == front["expiry"] else chain_stats(exp_e)
                if st:
                    out["earnings"] = {"expiry": exp_e, "impliedMovePct": st["impliedMovePct"], "atmIv": st["atmIv"]}
    return out


def news_block(tk, sym, name):
    """Yahoo's per-ticker feed (tk.news) often comes back empty, so fall back to Yahoo search.
    Search results can be loosely related, so headlines naming the company or ticker rank first."""
    import re
    import yfinance as yf
    raw = with_retry(lambda: tk.news) or []
    if not raw:
        raw = with_retry(lambda: yf.Search(sym, max_results=1, news_count=12).news) or []
    base = re.sub(r"[,.]|\b(inc|corp|corporation|co|company|holdings|group|ltd|plc|class [a-z]|the)\b", " ",
                  (name or "").lower())
    keys = [w for w in base.split() if len(w) > 2][:2]
    items = []
    for n in raw:
        c = n.get("content", n)
        title = c.get("title")
        url = (c.get("canonicalUrl") or {}).get("url") or (c.get("clickThroughUrl") or {}).get("url") or n.get("link")
        pub = (c.get("provider") or {}).get("displayName") or n.get("publisher")
        when = c.get("pubDate") or ts_date(n.get("providerPublishTime"))
        related = n.get("relatedTickers") or []
        if not (title and url and str(url).startswith("http")):
            continue
        tl = title.lower()
        named = bool(re.search(r"\b" + re.escape(sym.lower()) + r"\b", tl)) or any(k in tl for k in keys)
        if not named and not (related and related[0] == sym):
            continue
        items.append((0 if named else 1, {"title": title, "url": url, "source": pub,
                                          "date": str(when)[:10] if when else None}))
    items.sort(key=lambda x: (x[0], -(int((x[1]["date"] or "0").replace("-", "")))))
    return [i for _, i in items][:5]


def deep_fields(t):
    import yfinance as yf
    tk = yf.Ticker(yf_sym(t))
    info = with_retry(lambda: tk.info) or {}
    earnings = None
    try:
        cal = with_retry(lambda: tk.calendar) or {}
        ed = cal.get("Earnings Date") if isinstance(cal, dict) else None
        if ed:
            earnings = ts_date(ed[0] if isinstance(ed, (list, tuple)) else ed)
    except Exception:
        pass
    if not earnings:
        earnings = ts_date(info.get("earningsTimestamp") or info.get("earningsTimestampStart"))
    if earnings and earnings < date.today().isoformat():
        earnings = None

    pre = info.get("preMarketPrice")
    post = info.get("postMarketPrice")
    out = {
        "quoteType": info.get("quoteType"),
        "name": info.get("longName") or info.get("shortName"),
        "yfSector": info.get("sector"), "industry": info.get("industry"),
        "mcap": info.get("marketCap"), "exchange": info.get("fullExchangeName") or info.get("exchange"),
        "pre": {"price": rnd(pre), "chgPct": rnd(info.get("preMarketChangePercent"))} if pre else None,
        "post": {"price": rnd(post), "chgPct": rnd(info.get("postMarketChangePercent"))} if post else None,
        "positioning": {
            "shortPctFloat": rnd((info.get("shortPercentOfFloat") or 0) * 100) if info.get("shortPercentOfFloat") else None,
            "daysToCover": rnd(info.get("shortRatio")),
            "sharesShort": info.get("sharesShort"), "sharesShortPrior": info.get("sharesShortPriorMonth"),
            "shortChgPct": rnd((info["sharesShort"] / info["sharesShortPriorMonth"] - 1) * 100)
            if info.get("sharesShort") and info.get("sharesShortPriorMonth") else None,
            "shortAsOf": ts_date(info.get("dateShortInterest")),
            "instPct": rnd((info.get("heldPercentInstitutions") or 0) * 100) if info.get("heldPercentInstitutions") else None,
            "floatShares": info.get("floatShares"),
        },
        "valuation": {
            "pe": rnd(info.get("trailingPE"), 1), "fwdPe": rnd(info.get("forwardPE"), 1),
            "divYield": rnd(info.get("dividendYield"), 2),
            "target": rnd(info.get("targetMeanPrice")), "rating": info.get("recommendationKey"),
            "analysts": info.get("numberOfAnalystOpinions"),
        },
        "catalysts": {"earnings": earnings, "exDiv": ts_date(info.get("exDividendDate"))},
    }
    try:
        out["options"] = options_block(tk, info.get("regularMarketPrice") or info.get("currentPrice"), earnings)
    except Exception as e:
        out["options"] = None
        print(f"{t} options: {e}", file=sys.stderr)
    try:
        out["news"] = news_block(tk, yf_sym(t), out.get("name"))
    except Exception:
        out["news"] = []
    return out


# ------------------------------------------------------------------ main
def download(symbols, period):
    import yfinance as yf
    data = yf.download(symbols, period=period, interval="1d", auto_adjust=False, group_by="ticker",
                       progress=False, threads=True)
    missing = [s for s in symbols if s not in data.columns.get_level_values(0) or data[s]["Close"].dropna().empty]
    if missing:  # retry stragglers one at a time (avoids yfinance's sqlite cache lock)
        time.sleep(3)
        again = yf.download(missing, period=period, interval="1d", auto_adjust=False, group_by="ticker",
                            progress=False, threads=False)
        import pandas as pd
        if len(missing) == 1:
            again.columns = pd.MultiIndex.from_product([missing, again.columns])
        data = pd.concat([data.drop(columns=[m for m in missing if m in data.columns.get_level_values(0)], level=0), again], axis=1)
    return data


def index_row(meta, s, deep=None):
    deep = deep or {}
    sector = meta.get("sector") or YF_SECTOR.get(deep.get("yfSector") or "", "")
    return {"t": meta["t"], "n": deep.get("name") or meta.get("n"), "sector": sector, "sub": meta.get("sub") or deep.get("industry"),
            "mcap": deep.get("mcap") or meta.get("mcapHint"), "last": s["last"], "chgPct": s["chgPct"], "r1m": s["r1m"], "ytd": s["ytd"],
            "relVol": s["relVol"], "asOf": s["asOf"]}


def quotes_only():
    with open(INDEX) as f:
        idx = json.load(f)
    rows = idx["stocks"]
    syms = [yf_sym(r["t"]) for r in rows]
    data = download(syms, "2mo")
    n = 0
    for r in rows:
        s = yf_sym(r["t"])
        try:
            df = data[s].dropna(subset=["Close"])
            if len(df) < 2:
                continue
            last, prev = float(df["Close"].iloc[-1]), float(df["Close"].iloc[-2])
            v = df["Volume"]
            avg = float(v.iloc[-31:-1].mean()) if len(v) > 5 else None
            r.update({"last": rnd(last), "chgPct": rnd((last / prev - 1) * 100),
                      "relVol": rnd(float(v.iloc[-1]) / avg) if avg else r.get("relVol"),
                      "asOf": df.index[-1].date().isoformat()})
            n += 1
        except Exception:
            continue
    idx["quotesUpdated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with open(INDEX, "w") as f:
        json.dump(idx, f, separators=(",", ":"))
    print(f"Refreshed {n}/{len(rows)} quotes")


def full():
    os.makedirs(DIR, exist_ok=True)
    uni = load_universe()
    if not uni:
        sys.exit("No universe available")
    tickers = sorted(uni)
    syms = [yf_sym(t) for t in tickers]
    extra = ["SPY"] + sorted(set(SECTOR_ETF.values()))
    print(f"Downloading history for {len(syms)} tickers")
    import pandas as pd
    allsyms = syms + extra
    parts = [download(allsyms[i:i + 400], "1y") for i in range(0, len(allsyms), 400)]
    hist = pd.concat(parts, axis=1) if len(parts) > 1 else parts[0]
    spy = hist["SPY"]["Close"] if "SPY" in hist.columns.get_level_values(0) else None

    stats = {}
    for t, s in zip(tickers, syms):
        try:
            etf = SECTOR_ETF.get(uni[t].get("sector", ""))
            sect = hist[etf]["Close"] if etf and etf in hist.columns.get_level_values(0) else None
            st = series_stats(hist[s], spy, sect)
            if st:
                stats[t] = st
        except Exception as e:
            print(f"{t} history: {e}", file=sys.stderr)
    print(f"History stats for {len(stats)} tickers")

    # deep pulls (info, options, news): largest names first, within a time budget
    order = sorted(stats, key=lambda t: -(uni[t].get("mcapHint") or 0))
    deep = {}
    started = time.time()
    deadline = started + DEEP_BUDGET_MIN * 60

    def guarded(t):
        if time.time() > deadline:
            return None
        return deep_fields(t)

    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = {ex.submit(guarded, t): t for t in order}
        for i, f in enumerate(as_completed(futs), 1):
            t = futs[f]
            try:
                r = f.result()
                if r is not None:
                    deep[t] = r
            except Exception as e:
                print(f"{t} deep: {e}", file=sys.stderr)
            if i % 250 == 0:
                print(f"  deep {i}/{len(order)} ({time.time() - started:.0f}s)", flush=True)
    print(f"Deep fields for {len(deep)}/{len(order)} tickers in {time.time() - started:.0f}s", flush=True)

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    rows = []
    for t, st in list(stats.items()):
        path = os.path.join(DIR, yf_sym(t) + ".json")
        d = deep.get(t)
        if d and d.get("quoteType") and d["quoteType"] != "EQUITY":
            del stats[t]  # Yahoo says it's not a common stock
            continue
        if d is None and os.path.exists(path):  # keep yesterday's deep data rather than blanking it
            with open(path) as f:
                old = json.load(f)
            d = {k: old.get(k) for k in ("name", "yfSector", "industry", "mcap", "exchange", "positioning",
                                         "valuation", "catalysts", "options", "news")}
            d["stale"] = True
        d = d or {}
        meta = uni[t]
        sector = meta.get("sector") or YF_SECTOR.get(d.get("yfSector") or "", "")
        rec = {"t": t, "n": d.get("name") or meta.get("n"), "sector": sector, "sub": meta.get("sub") or d.get("industry"),
               "sectorEtf": SECTOR_ETF.get(sector), "idx": meta.get("idx", []), "updated": now, **st, **d}
        if t in deep:
            rec["optionsUpdated"] = now
        rec.pop("yfSector", None)
        rec.pop("quoteType", None)
        with open(path, "w") as f:
            json.dump(rec, f, separators=(",", ":"))
        rows.append(index_row(meta, st, d))
    # drop files for names that left the universe
    keep = {yf_sym(t) + ".json" for t in stats} | {"index.json", "universe.json"}
    for fn in os.listdir(DIR):
        if fn.endswith(".json") and fn not in keep:
            os.remove(os.path.join(DIR, fn))

    rows.sort(key=lambda r: -(r.get("mcap") or 0))
    with open(INDEX, "w") as f:
        json.dump({"updated": now, "quotesUpdated": now, "stocks": rows}, f, separators=(",", ":"))
    print(f"Wrote {len(rows)} stocks")


def options_only(n):
    """Midday refresh: re-pull the options block for the n largest names, using the latest quote."""
    with open(INDEX) as f:
        rows = json.load(f)["stocks"]
    top = sorted(rows, key=lambda r: -(r.get("mcap") or 0))[:n]
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    def one(r):
        import yfinance as yf
        path = os.path.join(DIR, yf_sym(r["t"]) + ".json")
        if not os.path.exists(path):
            return False
        with open(path) as f:
            rec = json.load(f)
        earnings = (rec.get("catalysts") or {}).get("earnings")
        opt = options_block(yf.Ticker(yf_sym(r["t"])), r.get("last") or rec.get("last"), earnings)
        if opt is None:
            return False
        rec["options"] = opt
        rec["optionsUpdated"] = now
        with open(path, "w") as f:
            json.dump(rec, f, separators=(",", ":"))
        return True

    started, ok = time.time(), 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        for fut in as_completed([ex.submit(one, r) for r in top]):
            try:
                ok += bool(fut.result())
            except Exception as e:
                print(f"options: {e}", file=sys.stderr)
    print(f"Refreshed options for {ok}/{len(top)} names in {time.time() - started:.0f}s")


if __name__ == "__main__":
    if "--quotes" in sys.argv:
        quotes_only()
    elif "--options" in sys.argv:
        options_only(int(sys.argv[sys.argv.index("--options") + 1]))
    else:
        full()
