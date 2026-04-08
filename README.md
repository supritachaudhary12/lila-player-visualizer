# Player Journey Visualizer

A web-based analytics tool for exploring LILA BLACK gameplay data — player movement paths, combat events, and match timelines plotted on map minimaps.

## Stack

- **Next.js 15** (App Router) + **TypeScript**
- No UI library — minimal CSS modules

## Project Structure

```
player-journey-visualizer/
├── app/              # Next.js App Router pages and layouts
├── components/       # Reusable React components
├── lib/              # Shared utilities and data helpers
├── scripts/          # One-off data processing scripts
├── data/             # Raw parquet files (5 days of match data)
│   └── raw/
│       ├── February_10/ … February_14/
│       └── README.md     ← data format & schema docs
└── public/           # Static assets
    └── minimaps/     # Map images (AmbroseValley, GrandRift, Lockdown)
```

## Setup

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Data

See [`data/raw/README.md`](data/raw/README.md) for the full data schema, event types, map coordinate systems, and coordinate-to-minimap conversion formulas.

Key facts:
- 3 maps: AmbroseValley, GrandRift, Lockdown
- ~89,000 events across 1,243 files (Feb 10–14, 2026)
- Files are Apache Parquet (no extension); use `x` and `z` for 2D map plotting
