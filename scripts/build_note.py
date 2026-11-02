"""Render a CRG Morning Note PDF from a JSON content file.

    python scripts/build_note.py content.json            -> notes/Morning Note <Month D> CRG.pdf
    python scripts/build_note.py content.json --out x.pdf

Content schema (all text is plain; **bold** spans are allowed inside text):
{
  "date": "2026-11-03",
  "published": "6:00 AM ET",
  "tone": "Risk-On",
  "summary": {"lead": "Bold opening sentence.", "body": "Rest of the summary paragraph."},
  "overnight": [{"label": "Asia", "text": "..."}, {"label": "Europe", ...}, {"label": "FX", ...},
                {"label": "Commodities", ...}, {"label": "U.S. Futures", ...}],
  "rates": {
    "rows": [["2Y Treasury", "4.61%", "-6bp", "note"], ...],
    "commentary": "...",
    "fed": {"rows": [["FOMC, Dec 8-9", "3.75-4.00%", "~70% hold", "note"]]},   (optional)
    "credit": "..."
  },
  "commodities": {"rows": [["Brent Crude", "$104.73/bbl", "-11.0%", "note"], ...]},
  "sector_commentary": "...",
  "sectors": {"rows": [["Energy (XLE)", "-3.5%", "read"], ...]},
  "equity_setup": ["paragraph 1", "paragraph 2"],
  "theme": {"title": "...", "body": "..."},
  "events": [{"label": "8:30 AM ET  ISM Manufacturing", "text": "..."}, ...]
}
"""

import json
import os
import re
import sys
from datetime import date
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (KeepTogether, ListFlowable, ListItem, Paragraph, SimpleDocTemplate,
                                Spacer, Table, TableStyle)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAVY = colors.HexColor("#1B2A4A")
NAVY2 = colors.HexColor("#2E4A7D")
ZEBRA = colors.HexColor("#F2F2F2")
GRID = colors.HexColor("#1B2A4A")

# Times New Roman look. Liberation Serif is metric-compatible and covers Unicode;
# fall back to the built-in Times if it's not installed.
SERIF, SERIF_B, SERIF_I = "Times-Roman", "Times-Bold", "Times-Italic"
_lib = "/usr/share/fonts/truetype/liberation/"
if os.path.exists(_lib + "LiberationSerif-Regular.ttf"):
    pdfmetrics.registerFont(TTFont("Serif", _lib + "LiberationSerif-Regular.ttf"))
    pdfmetrics.registerFont(TTFont("Serif-Bold", _lib + "LiberationSerif-Bold.ttf"))
    pdfmetrics.registerFont(TTFont("Serif-Italic", _lib + "LiberationSerif-Italic.ttf"))
    pdfmetrics.registerFont(TTFont("Serif-BoldItalic", _lib + "LiberationSerif-BoldItalic.ttf"))
    from reportlab.pdfbase.pdfmetrics import registerFontFamily
    registerFontFamily("Serif", normal="Serif", bold="Serif-Bold", italic="Serif-Italic", boldItalic="Serif-BoldItalic")
    SERIF, SERIF_B, SERIF_I = "Serif", "Serif-Bold", "Serif-Italic"

body = ParagraphStyle("body", fontName=SERIF, fontSize=10.5, leading=13.2)
cell = ParagraphStyle("cell", parent=body, fontSize=10, leading=12)
cellh = ParagraphStyle("cellh", parent=cell, fontName=SERIF_B, textColor=colors.white)
h2 = ParagraphStyle("h2", fontName=SERIF_B, fontSize=13, leading=16, textColor=NAVY, spaceBefore=10, spaceAfter=4)
foot = ParagraphStyle("foot", parent=body, fontName=SERIF_I, fontSize=8.5, textColor=colors.HexColor("#555555"))


def rich(text):
    """Escape text, then turn **x** into bold."""
    t = escape(str(text or ""))
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", t)


def section(title):
    t = Table([[Paragraph(escape(title.upper()), h2)]], colWidths=[7.5 * inch])
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 1.2, NAVY), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 2), ("TOPPADDING", (0, 0), (-1, -1), 6)]))
    return t


def table(header, rows, widths, note_col=None):
    data = [[Paragraph(escape(h), cellh) for h in header]]
    for r in rows:
        data.append([Paragraph(rich(c), cell) for c in r])
    t = Table(data, colWidths=[w * inch for w in widths], repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.6, GRID),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]
    if note_col is not None:
        style.append(("BACKGROUND", (note_col, 1), (note_col, -1), ZEBRA))
    t.setStyle(TableStyle(style))
    return t


def bullets(items):
    return ListFlowable(
        [ListItem(Paragraph(f"<b>{rich(i['label'])}:</b> {rich(i['text'])}", body), leftIndent=18, value="circle")
         for i in items],
        bulletType="bullet", start="●", bulletFontSize=7, leftIndent=18, bulletOffsetY=-1,
    )


def header(c):
    d = date.fromisoformat(c["date"])
    left = [
        Paragraph('<font size="17"><b>CONVEX RESEARCH GROUP</b></font>',
                  ParagraphStyle("hl", fontName=SERIF_B, textColor=colors.white, leading=21)),
        Paragraph("<i>Equity and fixed income research, independently sourced</i>",
                  ParagraphStyle("hs", fontName=SERIF_I, fontSize=10, textColor=colors.HexColor("#D6DEEA"), leading=13)),
    ]
    rs = ParagraphStyle("hr", fontName=SERIF, fontSize=10, leading=13, alignment=TA_RIGHT, textColor=colors.HexColor("#E3E9F2"))
    right = [
        Paragraph("<b>Morning Note</b>", ParagraphStyle("hr1", parent=rs, fontName=SERIF_B, fontSize=14, leading=17, textColor=colors.white)),
        Paragraph(f"<b>{d.strftime('%A, %B %-d, %Y')}</b>", ParagraphStyle("hr2", parent=rs, fontName=SERIF_B, textColor=colors.white)),
        Paragraph(f"Published: {escape(c.get('published', '6:00 AM ET'))}", rs),
        Paragraph(f"<i>Tone: {escape(c.get('tone', ''))}</i>", rs),
    ]
    t = Table([[left, right]], colWidths=[4.6 * inch, 2.9 * inch], rowHeights=[0.95 * inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), NAVY), ("BACKGROUND", (1, 0), (1, 0), NAVY2),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (0, 0), 16), ("RIGHTPADDING", (1, 0), (1, 0), 12),
        ("BOX", (0, 0), (-1, -1), 0.8, colors.black),
    ]))
    return t


def build(c, out):
    s = []
    s.append(header(c))
    s.append(Spacer(1, 8))
    sm = c["summary"]
    s.append(Paragraph(f"<b>{rich(sm['lead'])}</b> {rich(sm['body'])}", body))

    s += [section("Overnight Macro"), Spacer(1, 4), bullets(c["overnight"])]

    r = c["rates"]
    s += [section("Rates & Credit Snapshot"), Spacer(1, 4),
          table(["Instrument", "Level", "Move", "Note"], r["rows"], [1.7, 1.25, 1.25, 3.3], note_col=3)]
    if r.get("commentary"):
        s += [Spacer(1, 4), Paragraph(rich(r["commentary"]), body)]
    if r.get("fed", {}).get("rows"):
        s += [Spacer(1, 4), table(["Meeting", "Current Range", "Market-Implied", "Note"], r["fed"]["rows"],
                                  [2.2, 1.6, 1.6, 2.1], note_col=3)]
    if r.get("credit"):
        s += [Spacer(1, 4), Paragraph(f"<b>Credit:</b> {rich(r['credit'])}", body)]

    s += [section("Commodities & Sector Tables"), Spacer(1, 4),
          table(["Commodity", "Level", "Chg", "Note"], c["commodities"]["rows"], [1.7, 1.6, 1.0, 3.2], note_col=3)]
    if c.get("sector_commentary"):
        s += [Spacer(1, 4), Paragraph(rich(c["sector_commentary"]), body)]
    s += [Spacer(1, 4), table(["Sector / Name", "Chg", "Read"], c["sectors"]["rows"], [2.9, 1.3, 3.3], note_col=2)]

    s += [section("Equity Setup"), Spacer(1, 4)]
    for p in c["equity_setup"]:
        s += [Paragraph(rich(p), body), Spacer(1, 5)]

    th = c["theme"]
    s.append(KeepTogether([section("One Theme"), Spacer(1, 4),
                           Paragraph(f"<b>{rich(th['title'])}</b> {rich(th['body'])}", body)]))

    s += [section("Events to Watch"), Spacer(1, 4), bullets(c["events"])]

    def on_page(canvas, doc):
        canvas.saveState()
        canvas.setFont(SERIF_I, 8.5)
        canvas.setFillColor(colors.HexColor("#555555"))
        canvas.drawCentredString(letter[0] / 2, 0.45 * inch,
                                 "Convex Research Group  |  For informational purposes only. Not investment advice. "
                                 "All data as of time of publication.")
        canvas.restoreState()

    # platypus frames pad 6pt per side; offset so text and 7.5in tables share one edge
    doc = SimpleDocTemplate(out, pagesize=letter, leftMargin=0.5 * inch - 6, rightMargin=0.5 * inch - 6,
                            topMargin=0.5 * inch, bottomMargin=0.75 * inch,
                            title=f"CRG Morning Note {c['date']}", author="Convex Research Group")
    doc.build(s, onFirstPage=on_page, onLaterPages=on_page)


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    with open(args[0]) as f:
        c = json.load(f)
    d = date.fromisoformat(c["date"])
    out = args[args.index("--out") + 1] if "--out" in args else os.path.join(
        ROOT, "notes", f"Morning Note {d.strftime('%B %-d')} CRG.pdf")
    build(c, out)
    print(out)


if __name__ == "__main__":
    main()
