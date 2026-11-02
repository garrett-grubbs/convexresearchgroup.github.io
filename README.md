# Convex Research Group

Site: https://convexresearchgroup.com (GitHub Pages, `main` branch).

## How it updates itself

| What | How | When |
|---|---|---|
| Market Monitor (rates, curve, credit, equities, sectors, commodities, FX) | `.github/workflows/markets.yml` runs `scripts/fetch_markets.py` → `data/markets.json` | Every 30 min, weekdays 8am to 6pm ET |
| Market Pulse box | `scripts/market_pulse.py` → `data/pulse.json` (needs `ANTHROPIC_API_KEY` repo secret; hidden if absent) | After the open (10:00 ET) and close (4:15 ET) |
| Research archive | `.github/workflows/research.yml` runs `scripts/build_research.py` → `data/research.json` | Whenever a PDF lands in `notes/` |

## Publishing a note

Upload the PDF to `notes/` (rename it on your computer first, not in GitHub). Filenames like
`Morning Note October 30 CRG.pdf` or `Week of November 2 Trade Ideas CRG.pdf` set the date and type automatically.
Anything else is filed as a Deep Dive.

To set a summary, tag, title or date by hand, edit `data/research-meta.json`. If the API key secret is set,
a one-line summary is drafted automatically for new notes and saved there.

## Data sources

FRED (St. Louis Fed) for Treasuries, policy rates, breakevens and ICE BofA credit spreads; Yahoo Finance for everything else (delayed).
