"""Market session runner: keeps the site's data fresh through the trading day.

GitHub's cron is best effort and routinely skips or delays frequent schedules by hours,
so instead of one short job every 30 minutes, a single job starts early and loops,
refreshing on a fixed clock. Several cron start times exist only as backups: the
workflow's concurrency group lets one session run while one more waits, so if a
session ends (6-hour job limit) or a start is skipped, the next one picks up.

Each tick (every 30 min, :00 and :30 ET, 7:00am to 6:00pm ET on weekdays):
  - markets.json (FRED + Yahoo) and the Market Pulse box when due
  - stock lookup prices (index.json on the stock-data branch)
Once per day, at or after the listed time:
  - 08:30  stock pre-market prices, 500 largest names
  - 12:30  stock options refresh, 500 largest names
  - bonds at 07:00, 13:30 (after the 1pm auction results), 16:30
"""

import os
import subprocess
import sys
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.environ.get("OUT_DIR") or os.path.join(ROOT, "stockdata")
START, END = (7, 0), (18, 0)
MAX_RUN_MIN = float(os.environ.get("MAX_RUN_MIN", 340))  # stay under GitHub's 6-hour job limit
DAILY = [("premarket", (8, 30)), ("options", (12, 30))]
BONDS_AT = [(7, 0), (13, 30), (16, 30)]


def log(msg):
    print(f"[{datetime.now(ET):%H:%M:%S} ET] {msg}", flush=True)


def sh(cmd, check=False):
    log("$ " + cmd)
    r = subprocess.run(cmd, shell=True, cwd=ROOT)
    if r.returncode and check:
        raise RuntimeError(f"failed: {cmd}")
    return r.returncode == 0


def at(now, hm):
    return now.replace(hour=hm[0], minute=hm[1], second=0, microsecond=0)


def commit_main(msg):
    sh("git add data/")
    if subprocess.run("git diff --cached --quiet", shell=True, cwd=ROOT).returncode == 0:
        log("nothing to commit")
        return
    sh(f'git commit -q -m "{msg}"')
    for i in range(4):
        if sh("git pull -q --rebase origin main") and sh("git push -q origin HEAD:main"):
            return
        time.sleep(10 * (i + 1))
    log("push failed after retries; will try again next tick")


STATE = os.path.join(ROOT, "data", "session-state.json")


def load_done(today):
    """Once-a-day jobs already run today, so a follow-on session doesn't repeat them."""
    import json
    try:
        with open(STATE) as f:
            st = json.load(f)
        return set(st["done"]) if st.get("date") == today else set()
    except Exception:
        return set()


def save_done(today, done):
    import json
    with open(STATE, "w") as f:
        json.dump({"date": today, "done": sorted(done)}, f)


def recently_updated(minutes=12):
    """True if markets.json was refreshed in the last few minutes (a session just handed off)."""
    import json
    try:
        with open(os.path.join(ROOT, "data", "markets.json")) as f:
            upd = datetime.fromisoformat(json.load(f)["updated"])
        return (datetime.now(ET) - upd).total_seconds() < minutes * 60
    except Exception:
        return False


def tick(now, done):
    log("tick")
    sh("python scripts/fetch_markets.py")
    sh("python scripts/market_pulse.py")
    bonds_due = [hm for hm in BONDS_AT if at(now, hm) <= now and f"bonds{hm}" not in done]
    if bonds_due:
        for hm in bonds_due:
            done.add(f"bonds{hm}")
        sh("python scripts/fetch_bonds.py")

    # stock lookup: prices every tick, plus the once-a-day extras when they come due
    extra = None
    for name, hm in DAILY:
        if name not in done and at(now, hm) <= now:
            done.add(name)
            extra = name
            break
    save_done(now.date().isoformat(), done)
    commit_main("Update market data")
    sh(f'scripts/stockdata_sync.sh pull "{OUT_DIR}"')
    if os.path.exists(os.path.join(OUT_DIR, "index.json")):
        ok = sh("python scripts/fetch_stocks.py --quotes")
        if extra == "premarket":
            ok = sh("python scripts/fetch_stocks.py --premarket 500") and ok
        elif extra == "options":
            ok = sh("python scripts/fetch_stocks.py --options 500") and ok
        if ok:
            sh(f'scripts/stockdata_sync.sh push-if-unchanged "{OUT_DIR}"')
    else:
        log("no stock index yet; skipping stock prices")


def main():
    started = time.time()
    now = datetime.now(ET)
    if now.weekday() >= 5:
        log("weekend; nothing to do")
        return
    if now >= at(now, END):
        log("after the session; nothing to do")
        return
    # anything whose time already passed before this session started still runs once today
    done = load_done(now.date().isoformat())
    skip_first = recently_updated()
    while True:
        now = datetime.now(ET)
        if now >= at(now, END):
            log("session over")
            break
        if now >= at(now, START):
            if skip_first:
                log("previous session just refreshed; waiting for the next slot")
            else:
                tick(now, done)
        skip_first = False
        # next :00 or :30
        nxt = now.replace(second=0, microsecond=0) + timedelta(minutes=30 - now.minute % 30)
        if nxt < at(now, START):
            nxt = at(now, START)
        if (time.time() - started) / 60 + (nxt - datetime.now(ET)).total_seconds() / 60 > MAX_RUN_MIN:
            log("near the job time limit; handing off to the next session run")
            break
        wait = max(0, (nxt - datetime.now(ET)).total_seconds())
        log(f"sleeping {wait / 60:.1f} min until {nxt:%H:%M}")
        time.sleep(wait)


if __name__ == "__main__":
    main()
