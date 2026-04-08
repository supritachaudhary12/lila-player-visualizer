/**
 * Shared data types used across server components and client components.
 * Contains only plain-serializable shapes — no class instances, no Date objects.
 */

// ── Multi-match aggregated response types ─────────────────────────────────────

/** One non-empty cell of the 64×64 server-side heatmap grid. */
export interface HeatmapBin {
  bx:    number;
  by:    number;
  count: number;
}

/** One individual event point in minimap pixel space. */
export interface EventPoint {
  x:        number;
  y:        number;
  event:    string;
  match_id: string;
}

/** One point in a server-side path sample (already in minimap pixel space). */
export interface PathPoint {
  x:  number;
  y:  number;
  ts: string;
}

/** Path sample for one player in one match (server provides first PATH_MATCHES only). */
export interface MatchPath {
  match_id: string;
  user_id:  string;
  isBot:    boolean;
  points:   PathPoint[];
}

export type HeatmapType = "traffic" | "kills" | "deaths";

/**
 * Shape returned by GET /api/matches.
 * No raw rows — only pre-aggregated, size-bounded data.
 */
export interface MultiMatchData {
  heatmapTraffic: HeatmapBin[];
  heatmapKills:   HeatmapBin[];
  heatmapDeaths:  HeatmapBin[];
  events:         EventPoint[];
  paths:          MatchPath[];
  matchCount:     number;
  totalCount:     number;
}

// ── Summary entry ─────────────────────────────────────────────────────────────

export interface SummaryEntry {
  match_id:      string;
  map_id:        string;
  date:          string;
  min_ts:        string;
  max_ts:        string;
  total_players: number;
  human_players: number;
  bot_players:   number;
}

// ── Single-match analysis mode ────────────────────────────────────────────────

export type SingleMode = "playback" | "movement";

// ── Layer flags ───────────────────────────────────────────────────────────────

/**
 * Visibility flags for single-match rendering.
 *
 * showMovement / showEvents / showHeatmap are top-level layer toggles.
 * The remaining flags are sub-options that are only meaningful when the
 * corresponding top-level toggle is on.
 *
 * All three top-level layers are independent — any combination is valid.
 * Playback (time scrubbing) is a separate orthogonal control in MatchViewer.
 */
export interface LayerFlags {
  // ── Top-level layer toggles ─────────────────────────────────────────────────
  showMovement: boolean;
  showEvents:   boolean;
  showHeatmap:  boolean;
  // ── Movement sub-flags ──────────────────────────────────────────────────────
  humanPaths: boolean;  // include human player data
  botPaths:   boolean;  // include bot player data
  showPaths:  boolean;  // render polyline trails
  showDots:   boolean;  // render individual position circles
  // ── Event sub-flags ─────────────────────────────────────────────────────────
  kills:  boolean;
  deaths: boolean;
  loot:   boolean;
  storm:  boolean;
}

/** Per-mode default layers. */
export const DEFAULT_LAYERS: Record<SingleMode, LayerFlags> = {
  playback: {
    showMovement: true,
    showEvents:   true,
    showHeatmap:  false,
    humanPaths:   true,
    botPaths:     true,
    showPaths:    true,
    showDots:     false,
    kills:        true,
    deaths:       true,
    loot:         true,
    storm:        true,
  },
  movement: {
    showMovement: true,
    showEvents:   true,
    showHeatmap:  false,
    humanPaths:   true,
    botPaths:     true,
    showPaths:    true,
    showDots:     false,
    kills:        true,
    deaths:       true,
    loot:         true,
    storm:        true,
  },
};
