/**
 * app/api/matches/route.ts
 *
 * GET /api/matches?mapId=AmbroseValley
 *
 * Processes up to MAX_MATCHES match files one at a time, aggregating data
 * into bins.  Raw rows are discarded immediately after each file is processed
 * so peak memory stays bounded.
 *
 * Response:
 *   {
 *     heatmap:    { bx, by, count }[]          – 64×64 grid over 1024×1024 px
 *     events:     { bx, by, event, count }[]   – 32×32 cluster grid
 *     paths:      { match_id, points }[]        – first PATH_MATCHES only
 *     matchCount: number
 *     totalCount: number
 *   }
 */

export const runtime = "nodejs";

import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import { MAP_CONFIGS, MapId } from "@/lib/mapConfig";
import { worldToMinimap } from "@/lib/coordUtils";

const MATCHES_DIR  = path.join(process.cwd(), "data", "processed", "matches");
const SUMMARY_PATH = path.join(process.cwd(), "data", "processed", "summary.json");

const MAX_MATCHES  = 9999;  // load all matches
const PATH_MATCHES = 10;  // how many matches to include raw paths for
const HEATMAP_BINS = 64;  // grid resolution over the 1024×1024 minimap

type SummaryEntry = { match_id: string; map_id: string; date?: string; bot_players?: number };

interface HeatmapBin  { bx: number; by: number; count: number }
interface EventPoint  { x: number; y: number; event: string; match_id: string }
interface PathPoint   { x: number; y: number; ts: string }
interface MatchPath   { match_id: string; user_id: string; isBot: boolean; points: PathPoint[] }

const MOVEMENT_EVENTS  = new Set(["Position", "BotPosition"]);
const MAX_EVENT_POINTS = 2000; // cap total individual events across all matches

export async function GET(req: NextRequest) {
  const mapId       = req.nextUrl.searchParams.get("mapId") ?? "";
  const datesParam  = req.nextUrl.searchParams.get("dates") ?? "";
  const dateFilter  = datesParam ? new Set(datesParam.split(",").map(decodeURIComponent)) : null;

  console.log("[api/matches] mapId:", mapId || "(all)", "| dates:", datesParam || "(all)");

  if (!fs.existsSync(SUMMARY_PATH)) {
    console.error("[api/matches] summary.json not found");
    return Response.json(
      { error: "summary.json not found. Ensure data/processed/ is committed and deployed." },
      { status: 500 }
    );
  }

  if (!fs.existsSync(MATCHES_DIR)) {
    console.error("[api/matches] matches directory not found");
    return Response.json(
      { error: "Matches directory not found. Ensure data/processed/matches/ is committed and deployed." },
      { status: 500 }
    );
  }

  // ── Load and filter summary ──────────────────────────────────────────────────
  const summary: SummaryEntry[] = JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf-8"));
  const filtered = summary.filter((m) =>
    (!mapId || m.map_id === mapId) &&
    (!dateFilter || dateFilter.has(m.date ?? ""))
  );

  // For path sampling (first PATH_MATCHES), interleave bot-containing matches so
  // human and bot paths both appear even when bots are rare.
  const withBots    = filtered.filter((m) => (m.bot_players ?? 0) > 0);
  const withoutBots = filtered.filter((m) => (m.bot_players ?? 0) === 0);
  const pathWindow: SummaryEntry[] = [];
  let bi = 0, hi = 0;
  while (pathWindow.length < PATH_MATCHES && (bi < withBots.length || hi < withoutBots.length)) {
    if (hi < withoutBots.length) pathWindow.push(withoutBots[hi++]);
    if (pathWindow.length < PATH_MATCHES && bi < withBots.length) pathWindow.push(withBots[bi++]);
  }
  // Remaining matches (beyond PATH_MATCHES) only contribute to heatmap/events
  const rest  = filtered.filter((m) => !pathWindow.includes(m)).slice(0, MAX_MATCHES - pathWindow.length);
  const batch = [...pathWindow, ...rest].slice(0, MAX_MATCHES);

  console.log(`[api/matches] filtered=${filtered.length} batch=${batch.length}`);

  const config = MAP_CONFIGS[mapId as MapId] ?? null;

  // ── Accumulators ─────────────────────────────────────────────────────────────
  // heatmap: key = bx * (HEATMAP_BINS + 1) + by  (no collision since bx,by < 64)
  const heatTraffic = new Map<number, number>(); // movement positions
  const heatKills   = new Map<number, number>(); // Kill / BotKill
  const heatDeaths  = new Map<number, number>(); // Killed / BotKilled / KilledByStorm
  const eventPts: EventPoint[] = [];
  const paths: MatchPath[] = [];

  const KILL_EVENTS  = new Set(["Kill",   "BotKill"]);
  const DEATH_EVENTS = new Set(["Killed", "BotKilled", "KilledByStorm"]);
  let loaded = 0;

  const HBIN_STEP = HEATMAP_BINS + 1;          // 65 — avoids bx/by aliasing
  const BIN_PX    = 1024 / HEATMAP_BINS;       // 16 px per heatmap cell

  // ── Process one file at a time — raw rows go out of scope each iteration ─────
  for (let i = 0; i < batch.length; i++) {
    const { match_id } = batch[i];
    const fp = path.join(MATCHES_DIR, `${match_id}.json`);
    if (!fs.existsSync(fp)) {
      console.warn(`[api/matches] missing file: ${match_id}.json`);
      continue;
    }

    const raw: Array<Record<string, unknown>> = JSON.parse(fs.readFileSync(fp, "utf-8"));
    const buildPath = i < PATH_MATCHES;
    // Per-player path accumulator: key = user_id
    const playerPoints = new Map<string, { isBot: boolean; points: PathPoint[] }>();

    for (const r of raw) {
      if (!config) continue; // can't project without a map config

      const event = String(r.event ?? "").trim();

      const { x: px, y: py } = worldToMinimap(
        Number(r.x ?? 0),
        Number(r.z ?? 0),
        config
      );

      // ── Heatmap bins ────────────────────────────────────────────────────────
      const bx = Math.floor(px / BIN_PX);
      const by = Math.floor(py / BIN_PX);
      if (bx >= 0 && bx < HEATMAP_BINS && by >= 0 && by < HEATMAP_BINS) {
        const key = bx * HBIN_STEP + by;
        if (MOVEMENT_EVENTS.has(event)) {
          heatTraffic.set(key, (heatTraffic.get(key) ?? 0) + 1);
        } else if (KILL_EVENTS.has(event)) {
          heatKills.set(key,   (heatKills.get(key)   ?? 0) + 1);
        } else if (DEATH_EVENTS.has(event)) {
          heatDeaths.set(key,  (heatDeaths.get(key)  ?? 0) + 1);
        }
      }

      // ── Individual event point (non-movement events only) ───────────────────
      if (event && !MOVEMENT_EVENTS.has(event) && eventPts.length < MAX_EVENT_POINTS) {
        eventPts.push({ x: Math.round(px), y: Math.round(py), event, match_id });
      }

      // ── Path sample (movement events only, grouped by player) ───────────────
      if (buildPath && MOVEMENT_EVENTS.has(event)) {
        const userId = String(r.user_id ?? "");
        if (!playerPoints.has(userId)) {
          playerPoints.set(userId, { isBot: Boolean(r.is_bot), points: [] });
        }
        playerPoints.get(userId)!.points.push({ x: px, y: py, ts: String(r.ts ?? "") });
      }
    }

    // raw[] falls out of scope here — eligible for GC before next file loads
    if (buildPath) {
      for (const [user_id, { isBot, points }] of playerPoints) {
        if (points.length > 0) {
          paths.push({ match_id, user_id, isBot, points });
        }
      }
    }
    loaded++;
  }

  console.log(`[api/matches] loaded=${loaded} trafficCells=${heatTraffic.size} killCells=${heatKills.size} deathCells=${heatDeaths.size} eventPts=${eventPts.length}`);

  // ── Serialise heatmap accumulators ───────────────────────────────────────────
  function serializeHeat(map: Map<number, number>): HeatmapBin[] {
    const out: HeatmapBin[] = [];
    for (const [key, count] of map) {
      out.push({ bx: Math.floor(key / HBIN_STEP), by: key % HBIN_STEP, count });
    }
    return out;
  }

  return Response.json({
    heatmapTraffic: serializeHeat(heatTraffic),
    heatmapKills:   serializeHeat(heatKills),
    heatmapDeaths:  serializeHeat(heatDeaths),
    events:         eventPts,
    paths,
    matchCount:     loaded,
    totalCount:     filtered.length,
  });
}
