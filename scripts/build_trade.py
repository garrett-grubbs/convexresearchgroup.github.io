"""Render a CRG Weekly Trade Idea PDF from a JSON content file.

    python scripts/build_trade.py content.json            -> notes/Week of <Month D> Trade Ideas CRG.pdf
    python scripts/build_trade.py content.json --out x.pdf

Schema (plain text; **bold** allowed):
{
  "week_of": "2026-11-09", "published": "2026-11-10", "issue": 2,
  "title": "DAL: Long Delta Air Lines", "tagline": "...",
  "trades": [ {"label": "Equity", "name": "DAL: Delta Air Lines",
               "fields": [["Ticker","DAL"],["Direction","Long"], ... 12 pairs, laid out 3 per row]} ],
  "thesis": ["paragraph", ...],
  "thesis_bullets": ["...", ...],
  "charts": [{"path": "chart.png", "caption": "...", "source": "..."}],      (optional)
  "catalysts": [["Catalyst","Date","Bull case","Bear case"], ...],
  "scenarios_title": "Bull / Base / Bear Scenarios: DAL",
  "scenarios": [["Bull Case","25%","$105 to $110","trigger"], ...],
  "risks": ["**Lead.** text", ...],
  "management": [["Entry trigger","text"], ...],
  "sources": ["text", ...]                                                    (optional)
}
"""

import json
import os
import sys
from datetime import date

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (Image, KeepTogether, ListFlowable, ListItem, Paragraph, SimpleDocTemplate,
                                Spacer, Table, TableStyle)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_note import NAVY, NAVY2, SERIF, SERIF_B, SERIF_I, body, cell, cellh, rich, section  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W = 7.5 * inch
LABEL_BG = colors.HexColor("#E8ECF3")
GOLD = colors.HexColor("#D9B65A")
GRID = colors.HexColor("#C9CFD9")

title_st = ParagraphStyle("t", fontName=SERIF_B, fontSize=21, leading=25, textColor=NAVY)
tag_st = ParagraphStyle("tg", fontName=SERIF_I, fontSize=11, leading=14, textColor=colors.HexColor("#555555"))
lab = ParagraphStyle("lab", parent=cell, fontName=SERIF_B, textColor=NAVY)
cap = ParagraphStyle("cap", parent=body, fontName=SERIF_I, fontSize=8.5, leading=10.5, textColor=colors.HexColor("#555555"))
src = ParagraphStyle("src", parent=body, fontSize=8.5, leading=10.5, textColor=colors.HexColor("#555555"))


def fmt(d):
    return date.fromisoformat(d).strftime("%B %-d, %Y")


def header(c):
    left = [
        Paragraph('<font size="17"><b>CONVEX RESEARCH GROUP</b></font>',
                  ParagraphStyle("hl", fontName=SERIF_B, textColor=colors.white, leading=21)),
        Paragraph("<i>Equity and fixed income research, independently sourced</i>",
                  ParagraphStyle("hs", fontName=SERIF_I, fontSize=10, textColor=colors.HexColor("#D6DEEA"), leading=13)),
    ]
    rs = ParagraphStyle("hr", fontName=SERIF, fontSize=10, leading=13, alignment=TA_RIGHT, textColor=colors.HexColor("#E3E9F2"))
    right = [
        Paragraph("<b>Weekly Trade Idea</b>", ParagraphStyle("hr1", parent=rs, fontName=SERIF_B, fontSize=14, leading=17, textColor=colors.white)),
        Paragraph(f"<b>Week of {fmt(c['week_of'])}</b>", ParagraphStyle("hr2", parent=rs, fontName=SERIF_B, textColor=colors.white)),
        Paragraph(f"Issue No. {c['issue']}", rs),
        Paragraph(f"<i>Published: {fmt(c['published'])}</i>", rs),
    ]
    t = Table([[left, right]], colWidths=[4.6 * inch, 2.9 * inch], rowHeights=[0.95 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), NAVY), ("BACKGROUND", (1, 0), (1, 0), NAVY2),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (0, 0), 16), ("RIGHTPADDING", (1, 0), (1, 0), 12),
    ]))
    return t


def snapshot(tr):
    """Name bar plus label/value pairs, three per row (label columns shaded)."""
    pairs = tr["fields"]
    rows = [[Paragraph(f"<b>{rich(tr['name'])}</b>", ParagraphStyle("nb", parent=cell, fontName=SERIF_B, textColor=GOLD))] + [""] * 5]
    for i in range(0, len(pairs), 3):
        r = []
        for k, v in pairs[i:i + 3]:
            r += [Paragraph(rich(k), lab), Paragraph(rich(v), cell)]
        r += [""] * (6 - len(r))
        rows.append(r)
    t = Table(rows, colWidths=[1.0 * inch, 1.5 * inch, 1.1 * inch, 1.4 * inch, 1.05 * inch, 1.45 * inch])
    st = [("SPAN", (0, 0), (-1, 0)), ("BACKGROUND", (0, 0), (-1, 0), NAVY),
          ("GRID", (0, 1), (-1, -1), 0.5, GRID), ("BOX", (0, 0), (-1, -1), 0.6, NAVY),
          ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
          ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]
    for col in (0, 2, 4):
        st.append(("BACKGROUND", (col, 1), (col, -1), LABEL_BG))
    t.setStyle(TableStyle(st))
    return t


def grid(header_row, rows, widths):
    data = [[Paragraph(rich(h), cellh) for h in header_row]] + [[Paragraph(rich(c), cell) for c in r] for r in rows]
    t = Table(data, colWidths=[w * inch for w in widths], repeatRows=1)
    st = [("BACKGROUND", (0, 0), (-1, 0), NAVY), ("GRID", (0, 0), (-1, -1), 0.5, GRID),
          ("BOX", (0, 0), (-1, -1), 0.6, NAVY), ("VALIGN", (0, 0), (-1, -1), "TOP"),
          ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]
    st.append(("BACKGROUND", (0, 1), (0, -1), LABEL_BG))
    t.setStyle(TableStyle(st))
    return t


def bullets(items):
    return ListFlowable([ListItem(Paragraph(rich(i), body), leftIndent=16, value="circle") for i in items],
                        bulletType="bullet", start="•", bulletFontSize=9, leftIndent=16)


def build(c, out):
    s = [header(c), Spacer(1, 16), Paragraph(rich(c["title"]), title_st), Spacer(1, 3),
         Paragraph(rich(c["tagline"]), tag_st)]
    rule = Table([[""]], colWidths=[W], rowHeights=[4])
    rule.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 1.2, NAVY)]))
    s += [rule, Spacer(1, 8)]

    for tr in c["trades"]:
        s.append(KeepTogether([section(f"Trade Snapshot: {tr['label']}"), Spacer(1, 6), snapshot(tr), Spacer(1, 4)]))

    s += [section("Investment Thesis"), Spacer(1, 4)]
    for p in c["thesis"]:
        s += [Paragraph(rich(p), body), Spacer(1, 7)]
    if c.get("thesis_bullets"):
        s.append(bullets(c["thesis_bullets"]))

    for ch in c.get("charts", []):
        path = ch["path"] if os.path.isabs(ch["path"]) else os.path.join(ROOT, ch["path"])
        if not os.path.exists(path):
            continue
        img = Image(path)
        ratio = img.imageHeight / img.imageWidth
        img.drawWidth, img.drawHeight = W, W * ratio
        blk = [Spacer(1, 8), Paragraph(f"<b>{rich(ch['caption'])}</b>", ParagraphStyle("ct", parent=body, textColor=NAVY)),
               Spacer(1, 3), img]
        if ch.get("source"):
            blk.append(Paragraph(rich(ch["source"]), cap))
        s.append(KeepTogether(blk))

    s.append(KeepTogether([section("Key Catalysts"), Spacer(1, 6),
                           grid(["Catalyst", "Date", "Bull Case Impact", "Bear Case Impact"], c["catalysts"], [1.5, 1.0, 2.5, 2.5])]))
    s.append(KeepTogether([section(c.get("scenarios_title", "Bull / Base / Bear Scenarios")), Spacer(1, 6),
                           grid(["Scenario", "Probability", "Price Target", "Key Trigger"], c["scenarios"], [1.1, 0.95, 1.35, 4.1])]))
    s += [section("Key Risks"), Spacer(1, 4), bullets(c["risks"])]
    items = [Paragraph(f"<b>{rich(k)}:</b> {rich(v)}", body) for k, v in c["management"]]
    s.append(KeepTogether([section("Position Management"), Spacer(1, 4), items[0]]))  # heading stays with its first line
    for it in items[1:]:
        s += [Spacer(1, 3), it]
    if c.get("sources"):
        s += [Spacer(1, 8), Paragraph("<b>Sources:</b> " + "; ".join(rich(x) for x in c["sources"]), src)]

    def on_page(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(GRID)
        canvas.line(0.5 * inch, 0.62 * inch, letter[0] - 0.5 * inch, 0.62 * inch)
        canvas.setFont(SERIF_I, 8.5)
        canvas.setFillColor(colors.HexColor("#777777"))
        canvas.drawCentredString(letter[0] / 2, 0.45 * inch,
                                 "Convex Research Group  |  For informational purposes only. Not investment advice. "
                                 "All data as of time of publication.")
        canvas.restoreState()

    doc = SimpleDocTemplate(out, pagesize=letter, leftMargin=0.5 * inch - 6, rightMargin=0.5 * inch - 6,
                            topMargin=0.5 * inch, bottomMargin=0.8 * inch,
                            title=f"CRG Weekly Trade Idea {c['week_of']}", author="Convex Research Group")
    doc.build(s, onFirstPage=on_page, onLaterPages=on_page)


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    with open(args[0]) as f:
        c = json.load(f)
    out = args[args.index("--out") + 1] if "--out" in args else os.path.join(
        ROOT, "notes", f"Week of {date.fromisoformat(c['week_of']).strftime('%B %-d')} Trade Ideas CRG.pdf")
    build(c, out)
    print(out)


if __name__ == "__main__":
    main()
