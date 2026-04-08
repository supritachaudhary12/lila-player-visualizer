# Architecture

## What I Built and Why

A Next.js 15 web app that turns raw parquet telemetry from **Lila Black** into an interactive minimap visualizer. Two modes:
- **Single-match** — load one match, scrub a timeline, or view full paths
- **Multi-match** — aggregate 10–796 matches into heatmaps and event clusters

**Why Next.js:** The server component model lets me read preprocessed JSON off disk at request time with no database. API routes handle the heavier aggregation work server-side, keeping the client bundle small. No external dependencies beyond React itself.

**Why SVG (not Canvas):** Layer toggling, hover tooltips, and per-element event handling are trivial in SVG. Canvas would require manual hit-testing. For ~5,000 points per match the SVG approach is fast enough; multi-match data is pre-aggregated into 64×64 bins so the DOM stays bounded.

**Why preprocess to JSON:** PyArrow reads `.nakama-0` parquet files natively in Python. Doing this once offline means the Node.js server never needs a parquet library, and each API response is a simple file read.

---

## Data Flow

```
data/raw/**/*.nakama-0          (1,243 parquet files)
        │
        ▼  scripts/preprocess_data.py
        │  - parse filename → user_id, match_id
        │  - decode event bytes → UTF-8 strings
        │  - detect bots (numeric user_id) vs humans (UUID user_id)
        │  - group by match_id, sort by timestamp
        │
        ├──▶  data/processed/summary.json        (796 match index entries)
        └──▶  data/processed/matches/{id}.json   (one file per match)

                        │
                        ▼  app/page.tsx  (Next.js Server Component)
                        │  - reads summary.json
                        │  - loads default match JSON
                        │  - serializes to props (strings/numbers only)
                        │
                        ▼  MatchViewer.tsx  (Client Component)
                        │  - manages UI state (mode, layers, selected match)
                        │  - fetches /api/match on match selection
                        │  - fetches /api/matches for multi-match aggregation
                        │
                        ▼  MatchMap.tsx  (Client Component)
                           - receives rows or aggregated multi-match data
                           - runs worldToMinimap() on each coordinate
                           - renders SVG paths, circles, heatmap cells
                           - handles zoom/pan + tooltips
```

**Multi-match API aggregation** (`/api/matches`): To stay memory-bounded when loading hundreds of matches, the route processes them in two tiers — the first 10 matches return full raw paths (for sampling); remaining matches contribute only to a sparse 64×64 heatmap grid. Event markers are capped at 2,000 total.

---

## Coordinate Mapping: World → Minimap

Each minimap image is 1024×1024 pixels. The game world uses a right-handed 3D coordinate system where `x` and `z` are the horizontal plane and `y` is elevation (irrelevant for 2D plotting).

The conversion in `lib/coordUtils.ts`:

```
u = (worldX - originX) / scale      // normalize to [0, 1]
v = (worldZ - originZ) / scale      // normalize to [0, 1]

pixelX = u × 1024
pixelY = (1 - v) × 1024             // flip Y: image origin is top-left, world origin is bottom-left
```

Per-map calibration values in `lib/mapConfig.ts`:

| Map | scale | originX | originZ |
|---|---|---|---|
| AmbroseValley | 900 | −370 | −473 |
| GrandRift | 581 | −290 | −290 |
| Lockdown | 1000 | −500 | −500 |

**How these were determined:** The `data/raw/README.md` documented the expected world-space bounds for each map. I derived `originX`/`originZ` as the minimum corner of each map's play area, and `scale` as the total world-space extent that maps to the full 1024px minimap. The Y-axis flip was discovered empirically — without it, all positions appear mirrored vertically against the minimap image.

---

## Assumptions Made Where Data Was Ambiguous

| Ambiguity | What I Saw | How I Handled It |
|---|---|---|
| Bot detection | Some user_ids are UUIDs (humans), others are plain integers | Classified integer user_ids as bots; UUID user_ids as humans |
| Timestamp epoch | Timestamps parse to dates in 1970 (Unix epoch near-zero) | Treated them as match-relative milliseconds; used them only for ordering and timeline scrubbing, not wall-clock display |
| `event` column encoding | Column arrived as raw bytes, not strings | Decoded with UTF-8 during preprocessing; unknown byte sequences fall back to `"Unknown"` |
| Map origin calibration | README gave coordinate ranges but no explicit pixel mapping | Derived origin + scale from documented world bounds; validated by spot-checking known event clusters against minimap landmarks |
| Missing map on some rows | A small number of rows had a null or unrecognized `map_id` | Dropped those rows during preprocessing |

---

## Major Tradeoffs

| Decision | Alternative Considered | What I Chose and Why |
|---|---|---|
| Preprocess to JSON vs. read parquet at runtime | Stream parquet directly in Node.js API routes | Preprocess offline — Node parquet libraries are less mature; one-time cost, zero runtime overhead |
| Server-side aggregation vs. client-side | Send all raw rows to client, aggregate in browser | Server-side — 796 matches × ~100 rows each is ~80K rows; browser computation is fine for single matches but unnecessary for multi-match where heatmap bins are the final product |
| SVG vs. Canvas | Canvas for better performance at high point counts | SVG — point counts per match stay under ~5K; SVG gives free hover events, accessibility, and simpler layer composition |
| 64×64 heatmap bins vs. finer grid | 128×128 or per-pixel density | 64×64 — enough granularity to show hotspots clearly; finer grids produce sparse data at the per-match scale available |
| No database | SQLite or Postgres for match queries | Flat JSON files — 796 matches × ~70 KB each fits comfortably in a directory; no query complexity warranted a database |
