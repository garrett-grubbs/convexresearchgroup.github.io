"""Write data/pulse.json: a 3-bullet read of the day's moves, drafted by Claude
from data/markets.json only. Skips quietly if ANTHROPIC_API_KEY isn't set.

The prompt restricts it to describing the numbers it is given: no forecasts,
no trade recommendations, no outside news it can't verify.
"""

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "markets.json")
OUT = os.path.join(ROOT, "data", "pulse.json")

PROMPT = """You write the "Market Pulse" box for Convex Research Group, an independent equity and rates research publication.

Using ONLY the JSON data below, write exactly 3 bullets on what moved today across rates, credit, equities and commodities.
Rules:
- Each bullet is one sentence, max 28 words, and cites specific numbers from the data (yields in %, changes in bp, prices, % moves).
- Lead with the most notable move. Connect moves across asset classes only when the data shows it (e.g. curve steepening alongside a rally in small caps).
- Describe; do not forecast, recommend trades, or mention news, events or people not present in the data.
- No dashes or em dashes. No hype words. Write like a sell side desk note.
Return JSON only: {"headline": "<6 to 10 word headline>", "bullets": ["...", "...", "..."]}

DATA:
"""


def compact(data):
    """Trim the payload to what the model needs (drop long histories)."""
    d = json.loads(json.dumps(data))
    d.get("rates", {}).pop("history", None)
    d.get("rates", {}).pop("curve", None)
    d.get("markets", {}).pop("spxHistory", None)
    return d


WINDOWS_ET = [(10, 0), (16, 15)]  # after the open settles, after the close


def due():
    """True once per window: the latest ET window start has passed and the
    current pulse was generated before it. Lets a 30-min cron call this freely."""
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    now = datetime.now(et)
    if now.weekday() >= 5:
        return False
    starts = [now.replace(hour=h, minute=m, second=0, microsecond=0) for h, m in WINDOWS_ET]
    passed = [s for s in starts if s <= now]
    if not passed:
        return False
    try:
        with open(OUT) as f:
            gen = datetime.fromisoformat(json.load(f)["generated"])
    except Exception:
        return True
    return gen < passed[-1]


def main():
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        print("No ANTHROPIC_API_KEY; skipping pulse.")
        return
    if "--force" not in sys.argv and not due():
        print("Pulse not due.")
        return
    with open(SRC) as f:
        data = json.load(f)
    body = json.dumps({
        "model": os.environ.get("CRG_MODEL", "claude-sonnet-5-5"),
        "max_tokens": 500,
        "messages": [{"role": "user", "content": PROMPT + json.dumps(compact(data))}],
    }).encode()
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, headers={
        "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            text = json.loads(r.read().decode())["content"][0]["text"].strip()
        text = text[text.find("{"): text.rfind("}") + 1]
        pulse = json.loads(text)
        assert isinstance(pulse.get("bullets"), list) and pulse["bullets"]
    except Exception as e:
        print(f"Pulse generation failed, keeping previous: {e}", file=sys.stderr)
        return
    pulse["generated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    pulse["dataAsOf"] = data.get("updated")
    with open(OUT, "w") as f:
        json.dump(pulse, f, indent=1)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
