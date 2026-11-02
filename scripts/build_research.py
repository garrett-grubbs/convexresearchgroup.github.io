"""Build data/research.json from the PDFs in notes/.

Drop a PDF into notes/ and push: this runs (via .github/workflows/research.yml),
works out the date / type / title from the filename, and adds it to the site.

Optional overrides live in data/research-meta.json, keyed by filename:
  "Morning Note October 30 CRG.pdf": {"summary": "...", "tag": "Rates", "title": "...", "date": "2026-10-30", "type": "deep-dive"}

If a note has no summary and ANTHROPIC_API_KEY is set, a one-line summary is
drafted from the PDF text and saved into research-meta.json (edit it there anytime).
"""

import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOTES = os.path.join(ROOT, "notes")
META = os.path.join(ROOT, "data", "research-meta.json")
OUT = os.path.join(ROOT, "data", "research.json")

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"]
MONTH_RE = re.compile(
    r"\b(" + "|".join(m[:3] + "(?:" + m[3:] + ")?" for m in MONTHS) + r")\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(20\d\d))?\b",
    re.I,
)
TYPE_LABELS = {"morning-note": "Morning Note", "trade-idea": "Trade Idea", "deep-dive": "Deep Dive"}
DEFAULT_TAGS = {"morning-note": "Macro", "trade-idea": "Trade", "deep-dive": "Research"}


def git_year(path):
    try:
        out = subprocess.run(
            ["git", "log", "--diff-filter=A", "--follow", "--format=%cs", "--", path],
            cwd=ROOT, capture_output=True, text=True, timeout=30,
        ).stdout.strip().splitlines()
        return int(out[-1][:4]) if out else None
    except Exception:
        return None


def parse(filename):
    stem = os.path.splitext(filename)[0]
    low = stem.lower()
    if "trade idea" in low:
        kind = "trade-idea"
    elif "morning" in low:
        kind = "morning-note"
    else:
        kind = "deep-dive"

    iso = None
    m = MONTH_RE.search(stem)
    if m:
        month = next(i for i, name in enumerate(MONTHS, 1) if name.startswith(m.group(1).lower()[:3]))
        year = int(m.group(3)) if m.group(3) else (git_year(os.path.join("notes", filename)) or date.today().year)
        try:
            iso = date(year, month, int(m.group(2))).isoformat()
        except ValueError:
            iso = None

    if kind == "morning-note" and iso:
        title = "Morning Note: " + date.fromisoformat(iso).strftime("%B %-d")
    elif kind == "trade-idea" and iso:
        title = "Trade Ideas: Week of " + date.fromisoformat(iso).strftime("%B %-d")
    else:
        title = re.sub(r"\b(convex research group|crg)\b", "", stem, flags=re.I)
        title = re.sub(r"\s+", " ", title).strip(" -_")
    return {"type": kind, "date": iso, "title": title}


def ai_summary(path):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    try:
        from pypdf import PdfReader
        text = "\n".join((p.extract_text() or "") for p in PdfReader(path).pages[:2])[:6000]
        body = json.dumps({
            "model": os.environ.get("CRG_MODEL", "claude-sonnet-5-5"),
            "max_tokens": 120,
            "messages": [{"role": "user", "content":
                "Write a one-sentence summary (max 30 words) of this market research note for a "
                "website archive listing. Plain text, no dashes, no hype, no investment advice.\n\n" + text}],
        }).encode()
        req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=body, headers={
            "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())["content"][0]["text"].strip()
    except Exception as e:
        print(f"AI summary failed for {path}: {e}", file=sys.stderr)
        return None


def main():
    meta = {}
    if os.path.exists(META):
        with open(META) as f:
            meta = json.load(f)
    meta_changed = False

    items = []
    for name in sorted(os.listdir(NOTES)):
        if not name.lower().endswith(".pdf"):
            continue
        info = parse(name)
        m = meta.setdefault(name, {})
        if not m.get("summary"):
            s = ai_summary(os.path.join(NOTES, name))
            if s:
                m["summary"] = s
                meta_changed = True
        info.update({k: v for k, v in m.items() if v and k in ("type", "date", "title", "summary", "tag")})
        kind = info["type"]
        items.append({
            "file": name,
            "href": "notes/" + urllib.parse.quote(name),
            "type": kind,
            "typeLabel": TYPE_LABELS.get(kind, "Research"),
            "date": info.get("date"),
            "title": info["title"],
            "summary": info.get("summary", ""),
            "tag": info.get("tag") or DEFAULT_TAGS.get(kind, "Research"),
        })

    items.sort(key=lambda r: r["date"] or "0000", reverse=True)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(items, f, indent=1)
    # keep meta tidy: drop empty entries, keep everything the user wrote
    meta = {k: v for k, v in meta.items() if v}
    if meta_changed or not os.path.exists(META):
        with open(META, "w") as f:
            json.dump(meta, f, indent=2, sort_keys=True)
    print(f"Wrote {len(items)} items to {OUT}")


if __name__ == "__main__":
    main()
