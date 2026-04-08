# Lila Player Journey Visualizer

An interactive minimap visualizer for player movement data from **Lila Black** — an extraction-style shooter. Supports single-match playback, multi-match heatmaps, and event overlays across three maps.

**Live demo:** [https://lila-player-visualizer-three.vercel.app/](https://lila-player-visualizer-three.vercel.app/)

---

## Tech Stack

| Layer | Tech | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) | Server components read processed JSON off disk without a database; API routes handle server-side aggregation |
| UI | React 19 + TypeScript | Component model fits layered SVG overlays; strict TypeScript catches coordinate-unit bugs early |
| Visualization | SVG (hand-rolled) | Full control over minimap overlays with no charting dependency; SVG `<filter>` gives free Gaussian blur on heatmaps |
| Data preprocessing | Python + PyArrow | PyArrow reads `.nakama-0` parquet files natively; pandas groupby handles match aggregation cleanly |
| Styling | Inline styles + CSS Modules | Keeps visual state co-located with component logic; no design system overhead |

---

## Setup

### Prerequisites

- Node.js 18+
- Python 3.9+ with `pyarrow` and `pandas`

### 1. Install JS dependencies

```bash
npm install
```

### 2. Preprocess the raw data

The app reads from `data/processed/`. Run the preprocessing script once before starting the dev server:

```bash
pip install pyarrow pandas
python scripts/preprocess_data.py
```

This walks `data/raw/` (1,243 parquet files across 5 date folders), converts them to JSON, and writes:
- `data/processed/summary.json` — index of all 796 matches
- `data/processed/matches/{match_id}.json` — one file per match

Expected runtime: ~2–3 minutes on a modern machine.

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Build for production

```bash
npm run build
npm start
```

---

## Environment Variables

None required. All data is read from local files relative to `process.cwd()`. No external services or API keys needed.

---

## Project Structure

```
├── app/
│   ├── page.tsx              # Server component — loads initial match + summary
│   ├── api/match/route.ts    # GET /api/match?matchId=<uuid>
│   └── api/matches/route.ts  # GET /api/matches?mapId=<map>&dates=<date,...>
├── components/
│   ├── MatchViewer.tsx       # UI orchestrator, all client-side state
│   └── MatchMap.tsx          # SVG minimap renderer + zoom/pan
├── lib/
│   ├── types.ts              # Shared TypeScript types
│   ├── coordUtils.ts         # World-to-minimap coordinate conversion
│   └── mapConfig.ts          # Per-map scale, origin, minimap image path
├── scripts/
│   └── preprocess_data.py    # Parquet → JSON pipeline
├── data/
│   ├── raw/                  # Source parquet files (not committed)
│   └── processed/            # Generated JSON (not committed)
└── public/minimaps/          # Map images (1024×1024 px)
```

---

## Features

- **Single-match playback** — scrub through a match timeline or view full movement paths
- **Multi-match heatmaps** — aggregate traffic / kill / death density across up to 796 matches
- **Layer toggles** — show/hide human paths, bot paths, kills, deaths, loot, storm deaths independently
- **Zoom + pan** — 0.5× to 6× on the minimap canvas
- **Hover tooltips** — event details on individual markers
- **Date filtering** — filter multi-match analysis by day (Feb 10–14)

---

## Data

See [`data/raw/README.md`](data/raw/README.md) for the full schema, event types, and coordinate system docs.

Key facts:
- 3 maps: AmbroseValley, GrandRift, Lockdown
- ~89,000 events across 1,243 files (Feb 10–14, 2026)
- 796 unique matches, 339 unique human players
- Use `x` and `z` for 2D map plotting; `y` is elevation (ignored)
