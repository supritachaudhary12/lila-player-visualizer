"use client";

/**
 * MatchMap.tsx
 *
 * Renders the minimap image with SVG layers stacked on top.
 *
 * Single-match mode  (isMultiMatch = false):
 *   Receives raw `rows` from the API.  All computation (tracks, events,
 *   hotspots, heatmap) happens client-side from those rows.
 *   Timeline / Playback filtering is applied here.
 *
 * Multi-match mode  (isMultiMatch = true):
 *   Receives `multiData` — server-aggregated bins and sampled paths.
 *   No raw rows are loaded or stored.  The heavy aggregation is done
 *   on the server; this component just renders what it receives.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Image from "next/image";
import { MAP_CONFIGS, MapId, MapConfig } from "@/lib/mapConfig";
import { worldToMinimap, PixelPoint } from "@/lib/coordUtils";
import { LayerFlags, HeatmapBin, EventPoint, MultiMatchData, HeatmapType } from "@/lib/types";

// ── Exported types ─────────────────────────────────────────────────────────────

/** Multi-match view modes — also used as the ViewMode type in MatchViewer. */
export type ViewMode = "movement" | "heatmap" | "both";

export interface MatchRow {
  user_id:  string;
  match_id: string;
  map_id:   string;
  x:        number;
  y:        number;
  z:        number;
  ts:       string;
  event:    string;
  is_bot:   boolean;
}

// ── Internal types ─────────────────────────────────────────────────────────────

type MatchRowMs = MatchRow & { tsMs: number };

interface Props {
  // Single-match raw rows — empty array in multi mode
  rows:          MatchRow[];
  // Multi-match pre-aggregated data from the server — undefined in single mode
  multiData?:    MultiMatchData;
  mapId:         MapId;
  isMultiMatch:  boolean;
  matchCount:    number;
  // Single-match props
  showTimeline:  boolean;     // true only in Playback mode
  layers:        LayerFlags;  // controls which layers render in single mode
  // Multi-match props
  multiViewMode:           ViewMode;
  heatmapType:             HeatmapType;
  matchLabels?:            Record<string, string>; // match_id → human-readable label
  matchDates?:             Record<string, string>; // match_id → formatted date
  onAnalyzeSingleMatch?:   (matchId: string) => void;
}

interface PlayerTrack {
  userId: string;
  label?: string;
  isBot:  boolean;
  points: PixelPoint[];
}

interface RichEventMarker {
  pt:     PixelPoint;
  event:  string;
  userId: string;
  isBot:  boolean;
}


interface TooltipData {
  pt:    PixelPoint;
  lines: string[];
}

// ── Event categorisation ──────────────────────────────────────────────────────

const MOVEMENT_EVENTS: Record<string, true> = {
  Position:    true,
  BotPosition: true,
};

const GAMEPLAY_EVENTS: Record<string, true> = {
  Kill:          true,
  BotKill:       true,
  Killed:        true,
  BotKilled:     true,
  Loot:          true,
  KilledByStorm: true,
};

type MarkerShape = "circle" | "x" | "dot" | "diamond";

const MARKER_STYLE: Record<string, { color: string; shape: MarkerShape }> = {
  Kill:          { color: "#ef4444", shape: "circle"  },
  BotKill:       { color: "#ef4444", shape: "circle"  },
  Killed:        { color: "#f8fafc", shape: "x"       },
  BotKilled:     { color: "#f8fafc", shape: "x"       },
  Loot:          { color: "#facc15", shape: "dot"     },
  KilledByStorm: { color: "#a855f7", shape: "diamond" },
};

// ── Time utilities ────────────────────────────────────────────────────────────

function tsToMs(ts: string): number {
  return new Date(ts.replace(" ", "T").slice(0, 23)).getTime();
}

function formatTime(ticks: number): string {
  const total = Math.floor(ticks);
  const m     = Math.floor(total / 60);
  const s     = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const TICK_INTERVAL_MS = 50;   // real-time step interval
const TOTAL_TICKS      = 200;  // total steps across any match duration

// ── Map display size ─────────────────────────────────────────────────────────
// SVG coordinate space is always 0–1024.  MAP_PX is the square map size at zoom=1.
// The map is shown inside a landscape viewport (MAP_W × MAP_H) with overflow:hidden.

const MAP_H     = 500;              // landscape viewport height (fixed)
const MAP_PX    = MAP_H;            // map square fits the viewport height at zoom=1
const MAP_SCALE = MAP_PX / 1024;    // SVG coord → CSS pixel at zoom=1
const MIN_ZOOM  = 0.5;
const MAX_ZOOM  = 6;

// ── Grid constants ────────────────────────────────────────────────────────────

const HEATMAP_BINS           = 64;
const BIN_PX                 = 1024 / HEATMAP_BINS;   // 16 px per heatmap cell

// ── Single-match data builders ────────────────────────────────────────────────

function buildTracks(rows: MatchRowMs[], config: MapConfig): PlayerTrack[] {
  const byPlayer: Record<string, MatchRowMs[]> = {};
  for (const row of rows) {
    if (!MOVEMENT_EVENTS[row.event]) continue;
    (byPlayer[row.user_id] ??= []).push(row);
  }
  return Object.entries(byPlayer).map(([userId, playerRows]) => {
    playerRows.sort((a, b) => a.tsMs - b.tsMs);
    return {
      userId,
      isBot:  playerRows[0].is_bot,
      points: playerRows.map((r) => worldToMinimap(r.x, r.z, config)),
    };
  });
}

function buildEventMarkers(rows: MatchRowMs[], config: MapConfig): RichEventMarker[] {
  return rows
    .filter((r) => GAMEPLAY_EVENTS[r.event])
    .map((r) => ({
      pt:     worldToMinimap(r.x, r.z, config),
      event:  r.event,
      userId: r.user_id,
      isBot:  r.is_bot,
    }));
}

function toPolylinePoints(pts: PixelPoint[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(" ");
}


const HEAT_COLOR: Record<HeatmapType, (ratio: number) => string> = {
  // cyan → yellow → red
  traffic: (r) => `hsl(${Math.round(200 * (1 - r))}, 100%, ${Math.round(50 + r * 15)}%)`,
  // bright orange → deep orange → vivid red
  kills:   (r) => `hsl(${Math.round(28 - r * 28)}, 100%, ${Math.round(55 + r * 15)}%)`,
  // indigo → violet → hot pink
  deaths:  (r) => `hsl(${Math.round(280 + r * 60)}, 100%, ${Math.round(45 + r * 35)}%)`,
};

// ── Marker shape renderer ─────────────────────────────────────────────────────

function renderMarker(pt: PixelPoint, style: { color: string; shape: MarkerShape }) {
  const { color, shape } = style;
  switch (shape) {
    case "circle":
      return <circle cx={pt.x} cy={pt.y} r={4}
        fill={color} fillOpacity={0.75} stroke="rgba(255,255,255,0.25)" strokeWidth={0.5} />;
    case "x": {
      const r = 5;
      return (
        <g stroke={color} strokeWidth={2} strokeOpacity={0.75} strokeLinecap="round">
          <line x1={pt.x-r} y1={pt.y-r} x2={pt.x+r} y2={pt.y+r} />
          <line x1={pt.x+r} y1={pt.y-r} x2={pt.x-r} y2={pt.y+r} />
        </g>
      );
    }
    case "dot":
      return <circle cx={pt.x} cy={pt.y} r={4}
        fill={color} fillOpacity={0.75} stroke="rgba(255,255,255,0.2)" strokeWidth={0.5} />;
    case "diamond": {
      const r = 5;
      return <path d={`M ${pt.x} ${pt.y-r} L ${pt.x+r} ${pt.y} L ${pt.x} ${pt.y+r} L ${pt.x-r} ${pt.y} Z`}
        fill={color} fillOpacity={0.75} stroke="rgba(255,255,255,0.2)" strokeWidth={0.5} />;
    }
  }
}

// ── Layer components ──────────────────────────────────────────────────────────

/**
 * HeatmapLayer — renders server-aggregated sparse bins.
 * Accepts the HeatmapBin[] array directly; no flat-grid allocation needed.
 */
function HeatmapLayer({ bins, max, type }: { bins: HeatmapBin[]; max: number; type: HeatmapType }) {
  if (max === 0) return null;
  const colorFn = HEAT_COLOR[type];
  return (
    <>
      <defs>
        <filter id="hm-blur" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <g filter="url(#hm-blur)">
        {bins.map(({ bx, by, count }, i) => {
          const ratio = count / max;
          return (
            <rect key={i} x={bx * BIN_PX} y={by * BIN_PX}
              width={BIN_PX} height={BIN_PX}
              fill={colorFn(ratio)} fillOpacity={0.6 + ratio * 0.4} />
          );
        })}
      </g>
    </>
  );
}

/**
 * MultiEventsLayer — renders individual event points for multi-match mode.
 * Dormant by default; hovering activates all events for the same match.
 */
function MultiEventsLayer({
  points,
  showKills,
  showDeaths,
  showLoot,
  showStorm,
  hoveredMatchId,
  onHoverMatch,
  setTooltip,
  matchLabels,
}: {
  points:         EventPoint[];
  showKills:      boolean;
  showDeaths:     boolean;
  showLoot:       boolean;
  showStorm:      boolean;
  hoveredMatchId: string | null;
  onHoverMatch:   (id: string | null) => void;
  setTooltip:     (data: TooltipData | null) => void;
  matchLabels?:   Record<string, string>;
}) {
  const anyHovered = hoveredMatchId !== null;
  return (
    <g>
      {points.map(({ x, y, event, match_id }, i) => {
        const style = MARKER_STYLE[event];
        if (!style) return null;
        if ((event === "Kill"   || event === "BotKill")   && !showKills)  return null;
        if ((event === "Killed" || event === "BotKilled") && !showDeaths) return null;
        if (event === "Loot"          && !showLoot)   return null;
        if (event === "KilledByStorm" && !showStorm)  return null;
        const isActive = hoveredMatchId === match_id;
        const opacity  = anyHovered ? (isActive ? 0.9 : 0.04) : 0.35;
        return (
          <g
            key={i}
            opacity={opacity}
            style={{ cursor: "pointer" }}
            onMouseEnter={() => {
              onHoverMatch(match_id);
              setTooltip({
                pt:    { x, y },
                lines: [event, matchLabels?.[match_id] ?? match_id.slice(0, 12)],
              });
            }}
            onMouseLeave={() => { onHoverMatch(null); setTooltip(null); }}
          >
            {/* Wide transparent hit target */}
            <circle cx={x} cy={y} r={10} fill="transparent" />
            {renderMarker({ x, y }, style)}
          </g>
        );
      })}
    </g>
  );
}

function PathsLayer({
  tracks,
  isMultiMatch,
  showHumans,
  showBots,
  showDots,
  hoveredUserId,
  hoveredMatchId,
  onHoverPath,
  onHoverMatch,
  setTooltip,
  onContextMenu,
  matchDates,
}: {
  tracks:         PlayerTrack[];
  isMultiMatch:   boolean;
  showHumans:     boolean;
  showBots:       boolean;
  showDots:       boolean;
  hoveredUserId:   string | null;
  hoveredMatchId:  string | null;
  onHoverPath:     (id: string | null) => void;
  onHoverMatch:    (id: string | null) => void;
  setTooltip:      (data: TooltipData | null) => void;
  onContextMenu?:  (matchId: string, label: string, clientX: number, clientY: number) => void;
  matchDates?:     Record<string, string>;
}) {
  const visible = tracks.filter((t) => t.isBot ? showBots : showHumans);

  // In multi mode hover is match-level; in single mode it's player-level
  const anyHovered = isMultiMatch ? hoveredMatchId !== null : hoveredUserId !== null;
  const getIsHovered = (track: PlayerTrack) => {
    if (isMultiMatch) {
      const matchId = track.userId.split(":")[0];
      return matchId === hoveredMatchId;
    }
    return track.userId === hoveredUserId;
  };

  return (
    <g>
      {visible.map((track) => {
        const isHovered   = getIsHovered(track);
        const baseOpacity = isMultiMatch
          ? (track.isBot ? 0.35 : 0.55)
          : (track.isBot ? 0.45 : 0.85);
        const lineOpacity = anyHovered ? (isHovered ? 0.95 : 0.04) : baseOpacity;
        const lastPt      = track.points[track.points.length - 1];

        return (
          <g key={`track-${track.userId}`}>
            {/* Visible stroke */}
            <polyline
              points={toPolylinePoints(track.points)}
              fill="none"
              stroke={track.isBot ? "#f97316" : "#22d3ee"}
              strokeWidth={isHovered ? 4 : 2.5}
              strokeOpacity={lineOpacity}
              strokeLinejoin="round"
              strokeLinecap="round"
              style={{ pointerEvents: "none" }}
            />
            {/* Wide transparent hit target */}
            <polyline
              points={toPolylinePoints(track.points)}
              fill="none"
              stroke="transparent"
              strokeWidth={12}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => {
                if (isMultiMatch) {
                  const matchId = track.userId.split(":")[0];
                  onHoverMatch(matchId);
                  if (lastPt) {
                    const lines: string[] = [track.label ?? `${matchId.slice(0, 12)}…`];
                    const date = matchDates?.[matchId];
                    if (date) lines.push(date);
                    lines.push(track.isBot ? "Bot" : "Human");
                    setTooltip({ pt: lastPt, lines });
                  }
                } else {
                  onHoverPath(track.userId);
                  if (lastPt) {
                    setTooltip({
                      pt:    lastPt,
                      lines: [track.label ?? `${track.userId.slice(0, 12)}…`, track.isBot ? "Bot" : "Human"],
                    });
                  }
                }
              }}
              onMouseLeave={() => {
                if (isMultiMatch) { onHoverMatch(null); } else { onHoverPath(null); }
                setTooltip(null);
              }}
              onContextMenu={(e) => {
                if (!isMultiMatch || !onContextMenu) return;
                e.preventDefault();
                const matchId = track.userId.split(":")[0];
                onContextMenu(matchId, track.label ?? matchId.slice(0, 12), e.clientX, e.clientY);
              }}
            />
          </g>
        );
      })}

      {/* Position dots — single-match only, gated by showDots flag */}
      {!isMultiMatch && showDots && visible.map((track) =>
        track.points.map((pt, i) => (
          <circle
            key={`dot-${track.userId}-${i}`}
            cx={pt.x} cy={pt.y}
            r={track.isBot ? 1.5 : 3}
            fill={track.isBot ? "#f97316" : "#22d3ee"}
            fillOpacity={
              anyHovered
                ? (hoveredUserId === track.userId ? 0.8 : 0.05)
                : (track.isBot ? 0.35 : 0.75)
            }
            style={{ pointerEvents: "none" }}
          />
        ))
      )}
    </g>
  );
}

function EventsLayer({
  markers,
  showKills,
  showDeaths,
  showLoot,
  showStorm,
  setTooltip,
}: {
  markers:   RichEventMarker[];
  showKills:  boolean;
  showDeaths: boolean;
  showLoot:   boolean;
  showStorm:  boolean;
  setTooltip: (data: TooltipData | null) => void;
}) {
  // Filter markers by type visibility
  const visible = markers.filter((m) => {
    if ((m.event === "Kill"   || m.event === "BotKill")   && !showKills)  return false;
    if ((m.event === "Killed" || m.event === "BotKilled") && !showDeaths) return false;
    if (m.event === "Loot"          && !showLoot)  return false;
    if (m.event === "KilledByStorm" && !showStorm) return false;
    return true;
  });

  return (
    <g>
      {/* Event markers */}
      {visible.map((m, i) => {
        const style = MARKER_STYLE[m.event];
        if (!style) return null;
        return (
          <g
            key={`evt-${i}`}
            style={{ cursor: "pointer" }}
            onMouseEnter={() => setTooltip({ pt: m.pt, lines: [m.event, m.isBot ? "Bot" : "Human"] })}
            onMouseLeave={() => setTooltip(null)}
          >
            <circle cx={m.pt.x} cy={m.pt.y} r={10} fill="transparent" />
            {renderMarker(m.pt, style)}
          </g>
        );
      })}

    </g>
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function Tooltip({ data, vx, vy }: { data: TooltipData; vx: number; vy: number }) {
  return (
    <div style={{
      position: "absolute", left: vx, top: vy - 58,
      transform: "translateX(-50%)",
      background: "rgba(10, 12, 20, 0.92)", border: "1px solid #2d3148",
      borderRadius: 6, padding: "6px 10px",
      pointerEvents: "none", zIndex: 20, whiteSpace: "nowrap", lineHeight: 1.65,
    }}>
      {data.lines.map((line, i) => (
        <div key={i} style={{ fontSize: i === 0 ? 13 : 11, color: i === 0 ? "#e2e8f0" : "#64748b" }}>
          {line}
        </div>
      ))}
    </div>
  );
}

// ── Context menu ─────────────────────────────────────────────────────────────

interface ContextMenuState {
  clientX: number;
  clientY: number;
  matchId: string;
  label:   string;
}

function ContextMenu({
  menu, onAnalyze, onClose,
}: {
  menu:      ContextMenuState;
  onAnalyze: () => void;
  onClose:   () => void;
}) {
  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <>
      {/* Invisible backdrop — click anywhere to close */}
      <div
        style={{ position: "fixed", inset: 0, zIndex: 98 }}
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div style={{
        position:     "fixed",
        left:         menu.clientX,
        top:          menu.clientY,
        background:   "#1e2132",
        border:       "1px solid #2d3148",
        borderRadius: 6,
        padding:      "4px 0",
        zIndex:       99,
        minWidth:     210,
        boxShadow:    "0 6px 24px rgba(0,0,0,0.55)",
        userSelect:   "none",
      }}>
        {/* Match label header */}
        <div style={{
          padding:      "6px 12px 6px",
          fontSize:     11,
          color:        "#64748b",
          borderBottom: "1px solid #2d3148",
          whiteSpace:   "nowrap",
          overflow:     "hidden",
          textOverflow: "ellipsis",
        }}>
          {menu.label}
        </div>
        <button
          style={{
            display:    "block",
            width:      "100%",
            textAlign:  "left",
            padding:    "9px 12px",
            background: "transparent",
            border:     "none",
            color:      "#e2e8f0",
            fontSize:   13,
            cursor:     "pointer",
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#2d3148"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          onClick={() => { onAnalyze(); onClose(); }}
        >
          Analyze in Single Match
        </button>
      </div>
    </>
  );
}

// ── Custom scrub bar ──────────────────────────────────────────────────────────

function ScrubBar({
  elapsed, duration, onChange,
  style,
}: {
  elapsed:  number;
  duration: number;
  onChange: (v: number) => void;
  style?:   React.CSSProperties;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const pct = duration > 0 ? (elapsed / duration) * 100 : 0;

  const seek = useCallback((e: React.MouseEvent | MouseEvent) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onChange(ratio * duration);
  }, [duration, onChange]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    seek(e);
    const move = (ev: MouseEvent) => seek(ev);
    const up   = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }, [seek]);

  return (
    <div
      ref={trackRef}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position:    "relative",
        height:      hovered ? 6 : 4,
        borderRadius: 99,
        background:  "rgba(255,255,255,0.1)",
        cursor:      "pointer",
        transition:  "height 0.15s",
        flexShrink:  0,
        ...style,
      }}
    >
      {/* Filled track */}
      <div style={{
        position:     "absolute", left: 0, top: 0, bottom: 0,
        width:        `${pct}%`,
        borderRadius: 99,
        background:   "linear-gradient(90deg, #4f52b8, #6366f1)",
        pointerEvents: "none",
      }} />
      {/* Thumb */}
      <div style={{
        position:     "absolute",
        top:          "50%",
        left:         `${pct}%`,
        transform:    "translate(-50%, -50%)",
        width:        hovered ? 14 : 10,
        height:       hovered ? 14 : 10,
        borderRadius: "50%",
        background:   "#6366f1",
        border:       "2px solid #c7d2fe",
        boxShadow:    "0 0 6px rgba(99,102,241,0.6)",
        transition:   "width 0.15s, height 0.15s",
        pointerEvents: "none",
      }} />
    </div>
  );
}

// ── Timeline panel ────────────────────────────────────────────────────────────

const TL_BTN: React.CSSProperties = {
  background: "#2d3148", border: "1px solid #3d4168",
  color: "#e2e8f0", padding: "5px 16px",
  borderRadius: 4, fontSize: 13, cursor: "pointer", flexShrink: 0,
};

function TimelinePanel({
  elapsed, duration, isPlaying, onScrub, onPlay, onPause, onReset,
}: {
  elapsed:   number;
  duration:  number;
  isPlaying: boolean;
  onScrub:   (v: number) => void;
  onPlay:    () => void;
  onPause:   () => void;
  onReset:   () => void;
}) {
  return (
    <div style={{
      width: "100%", background: "#1a1d27", border: "1px solid #2d3148",
      borderRadius: 8, padding: "12px 16px",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ fontFamily: "monospace", fontSize: 12, color: "#94a3b8" }}>
        Match Time:&nbsp;
        <strong style={{ color: "#e2e8f0" }}>{formatTime(elapsed)}</strong>
        &nbsp;/&nbsp;{formatTime(duration)}
      </div>
      <ScrubBar elapsed={elapsed} duration={duration} onChange={onScrub} style={{ width: "100%" }} />
      <div style={{ display: "flex", gap: 8 }}>
        <button style={TL_BTN} onClick={isPlaying ? onPause : onPlay}>
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button style={TL_BTN} onClick={onReset}>Reset</button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MatchMap({
  rows, multiData, mapId, isMultiMatch, showTimeline, layers, multiViewMode, heatmapType, matchLabels, matchDates, onAnalyzeSingleMatch,
}: Props) {
  const config = MAP_CONFIGS[mapId];
  if (!config) return <p style={{ color: "#f87171" }}>Unknown map: {mapId}</p>;

  // ── Single-match: timestamps & timeline ─────────────────────────────────────
  // (rowsWithMs is empty when isMultiMatch — rows is [] in that case)

  const rowsWithMs = useMemo<MatchRowMs[]>(
    () => rows.map((r) => ({ ...r, tsMs: tsToMs(r.ts) })),
    [rows]
  );

  const minTs    = useMemo(() => rowsWithMs.reduce((m, r) => Math.min(m, r.tsMs), Infinity),  [rowsWithMs]);
  const maxTs    = useMemo(() => rowsWithMs.reduce((m, r) => Math.max(m, r.tsMs), -Infinity), [rowsWithMs]);
  const duration = Math.max(maxTs - minTs, 1);

  // ── Timeline state ──────────────────────────────────────────────────────────

  const [elapsed,   setElapsed]   = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => { setElapsed(0); setIsPlaying(false); }, [rows]);

  // ── Zoom / pan state ────────────────────────────────────────────────────────

  const [zoom,      setZoom]      = useState(1);
  const [pan,       setPan]       = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging,  setDragging]  = useState(false);
  const [viewportW, setViewportW] = useState(0);
  const dragRef        = useRef<{ mx: number; my: number; px: number; py: number } | null>(null);
  const viewportRef    = useRef<HTMLDivElement>(null);
  const panInitialized = useRef(false);

  // Track viewport width so the map can be centered correctly
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setViewportW(entry.contentRect.width));
    ro.observe(el);
    setViewportW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const initPan = useCallback(
    () => ({ x: (viewportW - MAP_PX) / 2, y: 0 }),
    [viewportW]
  );

  // Reset zoom/pan when match, map, or tab changes (re-center based on current width)
  useEffect(() => { setZoom(1); setPan(initPan()); }, [rows, mapId, isMultiMatch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-center once when viewport width is first measured
  useEffect(() => {
    if (viewportW > 0 && !panInitialized.current) {
      panInitialized.current = true;
      setPan(initPan());
    }
  }, [viewportW]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll-wheel zoom (non-passive so we can preventDefault)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const factor   = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const rect     = el.getBoundingClientRect();
      const cx       = e.clientX - rect.left;
      const cy       = e.clientY - rect.top;
      setZoom((z) => {
        const newZ   = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * factor));
        const ratio  = newZ / z;
        setPan((p)  => ({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio }));
        return newZ;
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y };
    setDragging(true);
  }, [pan]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.px + e.clientX - dragRef.current.mx,
      y: dragRef.current.py + e.clientY - dragRef.current.my,
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  // SVG coord (0–1024) → viewport pixel (for tooltip positioning)
  const svgToViewport = useCallback((pt: PixelPoint) => ({
    x: pan.x + pt.x * MAP_SCALE * zoom,
    y: pan.y + pt.y * MAP_SCALE * zoom,
  }), [pan, zoom]);

  const stepPerTick = duration / TOTAL_TICKS;

  useEffect(() => {
    if (!showTimeline || !isPlaying) return;
    const id = setInterval(() => {
      setElapsed((prev) => {
        const next = prev + stepPerTick;
        if (next >= duration) { setIsPlaying(false); return duration; }
        return next;
      });
    }, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [showTimeline, isPlaying, stepPerTick, duration]);

  // ── Hover state ─────────────────────────────────────────────────────────────

  const [hoveredPath,    setHoveredPath]    = useState<string | null>(null);
  const [hoveredMatchId, setHoveredMatchId] = useState<string | null>(null);
  const [tooltip,        setTooltip]        = useState<TooltipData | null>(null);
  const [contextMenu,    setContextMenu]    = useState<ContextMenuState | null>(null);

  useEffect(() => {
    setHoveredPath(null);
    setHoveredMatchId(null);
    setTooltip(null);
  }, [layers.humanPaths, layers.botPaths]);

  // ── Single-match row visibility (playback filter) ───────────────────────────

  const currentTs = minTs + elapsed;

  const visibleRows = useMemo(
    () => (showTimeline && !isMultiMatch)
      ? rowsWithMs.filter((r) => r.tsMs <= currentTs)
      : rowsWithMs,
    [rowsWithMs, currentTs, showTimeline, isMultiMatch]
  );

  // ── Layer needs ─────────────────────────────────────────────────────────────

  const needPaths = isMultiMatch
    ? multiViewMode === "movement" || multiViewMode === "both"
    : layers.humanPaths || layers.botPaths;

  const needEvents = isMultiMatch
    ? multiViewMode === "movement" || multiViewMode === "both"
    : layers.kills || layers.deaths || layers.loot || layers.storm;

  const needHeatmap = isMultiMatch
    ? multiViewMode === "heatmap" || multiViewMode === "both"
    : false;

  // ── Single-match layer data ─────────────────────────────────────────────────

  const singleTracks = useMemo(
    () => (!isMultiMatch && needPaths) ? buildTracks(visibleRows, config) : [],
    [visibleRows, config, isMultiMatch, needPaths]
  );

  const eventMarkers = useMemo(
    () => (!isMultiMatch && needEvents) ? buildEventMarkers(visibleRows, config) : [],
    [visibleRows, config, isMultiMatch, needEvents]
  );

  // ── Multi-match layer data (from server — no client aggregation) ─────────────

  // Movement paths: convert server MatchPath[] → PlayerTrack[]
  // Points are already in pixel space; isBot defaults to false (server doesn't
  // track per-path bot status — all paths render as the same color in multi mode)
  const multiTracks = useMemo<PlayerTrack[]>(() => {
    if (!isMultiMatch || !multiData || (multiViewMode !== "movement" && multiViewMode !== "both")) return [];
    return multiData.paths.map((p) => ({
      userId: `${p.match_id}:${p.user_id}`,
      label:  matchLabels?.[p.match_id],
      isBot:  p.isBot,
      points: p.points,
    }));
  }, [isMultiMatch, multiData, multiViewMode, matchLabels]);

  const tracks = isMultiMatch ? multiTracks : singleTracks;

  // Heatmap: use server bins directly
  const heatBins = useMemo(() => {
    if (!isMultiMatch || !multiData) return [];
    if (heatmapType === "kills")   return multiData.heatmapKills;
    if (heatmapType === "deaths")  return multiData.heatmapDeaths;
    return multiData.heatmapTraffic;
  }, [isMultiMatch, multiData, heatmapType]);
  const heatMax = useMemo(
    () => heatBins.reduce((m, b) => Math.max(m, b.count), 0),
    [heatBins]
  );

  // Event clusters: server-aggregated for multi mode
  const eventPoints = (isMultiMatch && multiData && (multiViewMode === "movement" || multiViewMode === "both"))
    ? multiData.events
    : [];

  // ── Debug logging ────────────────────────────────────────────────────────────

  useEffect(() => {
    console.log("[MatchMap] mapId:", mapId, "| isMultiMatch:", isMultiMatch);
    if (isMultiMatch) {
      console.log("[MatchMap] multi | multiViewMode:", multiViewMode, "| multiData:",
        multiData
          ? `traffic=${multiData.heatmapTraffic.length} kills=${multiData.heatmapKills.length} deaths=${multiData.heatmapDeaths.length} events=${multiData.events.length} paths=${multiData.paths.length}`
          : "null");
      if (multiData) {
        console.log("[MatchMap] multi | matchCount:", multiData.matchCount, "/ totalCount:", multiData.totalCount);
      }
    } else {
      console.log("[MatchMap] single | rows:", rows.length);
    }
  }, [mapId, isMultiMatch, multiViewMode, rows.length, multiData]);

  // ── Guards — all hooks have already been called above ───────────────────────
  // These handle stale renders before MatchViewer's own fallbacks can engage.

  if (isMultiMatch && !multiData) {
    return (
      <div style={{
        background: "#161923", border: "1px solid #2d3148",
        borderRadius: 6, padding: "24px 32px", textAlign: "center",
      }}>
        <p style={{ fontSize: 13, color: "#64748b" }}>Multi-match data unavailable.</p>
      </div>
    );
  }

  if (!isMultiMatch && rows.length === 0) {
    return (
      <div style={{
        background: "#161923", border: "1px solid #2d3148",
        borderRadius: 6, padding: "24px 32px", textAlign: "center",
      }}>
        <p style={{ fontSize: 13, color: "#64748b" }}>No match data loaded.</p>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: "100%" }}>

      {/* ── Landscape viewport ── */}
      <div
        ref={viewportRef}
        style={{
          position:   "relative",
          width:      "100%",
          height:     MAP_H,
          overflow:   "hidden",
          borderRadius: 8,
          border:     "1px solid #2d3148",
          cursor:     dragging ? "grabbing" : "grab",
          userSelect: "none",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >

        {/* ── Zoomable / pannable layer ── */}
        <div style={{
          position:        "absolute",
          width:           MAP_PX,
          height:          MAP_PX,
          left:            0,
          top:             0,
          transform:       `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "0 0",
          willChange:      "transform",
        }}>
          <Image src={`/minimaps/${config.minimap}`} alt={mapId}
            fill style={{ objectFit: "cover" }} priority />

          <svg viewBox="0 0 1024 1024"
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}>

          {/* Heatmap — multi-match only, server-aggregated bins */}
          {needHeatmap && (
            <HeatmapLayer bins={heatBins} max={heatMax} type={heatmapType} />
          )}

          {/* Movement paths */}
          {needPaths && (
            <PathsLayer
              tracks={tracks}
              isMultiMatch={isMultiMatch}
              showHumans={layers.humanPaths}
              showBots={layers.botPaths}
              showDots={isMultiMatch ? false : layers.showDots}
              hoveredUserId={hoveredPath}
              hoveredMatchId={hoveredMatchId}
              onHoverPath={setHoveredPath}
              onHoverMatch={setHoveredMatchId}
              setTooltip={setTooltip}
              onContextMenu={(matchId, label, x, y) =>
                setContextMenu({ clientX: x, clientY: y, matchId, label })
              }
              matchDates={matchDates}
            />
          )}

          {/* Events — multi mode uses server points, single mode uses full markers */}
          {needEvents && isMultiMatch && (
            <MultiEventsLayer
              points={eventPoints}
              showKills={layers.kills}
              showDeaths={layers.deaths}
              showLoot={layers.loot}
              showStorm={layers.storm}
              hoveredMatchId={hoveredMatchId}
              onHoverMatch={setHoveredMatchId}
              setTooltip={setTooltip}
              matchLabels={matchLabels}
            />
          )}
          {needEvents && !isMultiMatch && (
            <EventsLayer
              markers={eventMarkers}
              showKills={layers.kills}
              showDeaths={layers.deaths}
              showLoot={layers.loot}
              showStorm={layers.storm}
              setTooltip={setTooltip}
            />
          )}
        </svg>
        </div>{/* end zoomable layer */}

        {/* ── Tooltip — viewport-space absolute positioning ── */}
        {tooltip && (() => {
          const vp = svgToViewport(tooltip.pt);
          return <Tooltip data={tooltip} vx={vp.x} vy={vp.y} />;
        })()}

        {/* ── Playback overlay (viewport-space, not zoomed) ── */}
        {showTimeline && (<>

          {/* Centered play / pause button */}
          <div style={{
            position: "absolute", top: "50%", left: "50%",
            transform: "translate(-50%, -50%)", zIndex: 11,
            pointerEvents: "none",
          }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isPlaying) { setIsPlaying(false); }
                else { if (elapsed >= duration) setElapsed(0); setIsPlaying(true); }
              }}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                pointerEvents: "all",
                width: 64, height: 64, borderRadius: "50%",
                background: "rgba(10,12,24,0.72)", border: "2px solid rgba(99,102,241,0.55)",
                backdropFilter: "blur(6px)", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: isPlaying ? 0.15 : 0.9,
                transition: "opacity 0.25s, border-color 0.2s",
                boxShadow: "0 2px 20px rgba(0,0,0,0.6)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.borderColor = "rgba(99,102,241,0.9)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = isPlaying ? "0.15" : "0.9"; e.currentTarget.style.borderColor = "rgba(99,102,241,0.55)"; }}
            >
              {isPlaying
                ? <svg width={22} height={22} viewBox="0 0 22 22"><rect x={3} y={2} width={6} height={18} rx={1.5} fill="#e2e8f0"/><rect x={13} y={2} width={6} height={18} rx={1.5} fill="#e2e8f0"/></svg>
                : <svg width={22} height={22} viewBox="0 0 22 22"><polygon points="5,2 20,11 5,20" fill="#e2e8f0"/></svg>
              }
            </button>
          </div>

          {/* Bottom control bar */}
          <div
            style={{
              position:       "absolute", bottom: 0, left: 0, right: 0, zIndex: 12,
              background:     "rgba(10,12,24,0.78)",
              backdropFilter: "blur(8px)",
              borderTop:      "1px solid rgba(45,49,72,0.8)",
              padding:        "8px 14px 10px",
              display:        "flex", alignItems: "center", gap: 10,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Play / Pause (small, in bar) */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isPlaying) { setIsPlaying(false); }
                else { if (elapsed >= duration) setElapsed(0); setIsPlaying(true); }
              }}
              style={{
                width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                background: "transparent", border: "1px solid #3d4168",
                color: "#e2e8f0", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#2d3148"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              {isPlaying
                ? <svg width={12} height={12} viewBox="0 0 12 12"><rect x={1} y={0} width={4} height={12} rx={1} fill="#e2e8f0"/><rect x={7} y={0} width={4} height={12} rx={1} fill="#e2e8f0"/></svg>
                : <svg width={12} height={12} viewBox="0 0 12 12"><polygon points="2,0 12,6 2,12" fill="#e2e8f0"/></svg>
              }
            </button>

            {/* Reset */}
            <button
              onClick={(e) => { e.stopPropagation(); setIsPlaying(false); setElapsed(0); }}
              title="Reset"
              style={{
                width: 30, height: 30, borderRadius: 6, flexShrink: 0,
                background: "transparent", border: "1px solid #3d4168",
                color: "#94a3b8", cursor: "pointer", fontSize: 14,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#2d3148"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >↺</button>

            {/* Elapsed time */}
            <span style={{
              fontFamily: "monospace", fontSize: 12, color: "#94a3b8",
              flexShrink: 0, minWidth: 90,
            }}>
              {formatTime(elapsed)} / {formatTime(duration)}
            </span>

            {/* Scrub bar */}
            <ScrubBar
              elapsed={elapsed}
              duration={duration}
              onChange={(v) => { setIsPlaying(false); setElapsed(v); }}
              style={{ flex: 1 }}
            />
          </div>

        </>)}

        {/* ── Zoom controls — top-right corner ── */}
        <div style={{
          position: "absolute", top: 40, right: 10, zIndex: 12,
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          {[
            { label: "+", title: "Zoom in",  onClick: () => setZoom((z) => Math.min(MAX_ZOOM, z * 1.3)) },
            { label: "−", title: "Zoom out", onClick: () => setZoom((z) => { const nz = Math.max(MIN_ZOOM, z / 1.3); setPan((p) => ({ x: p.x * nz/z, y: p.y * nz/z })); return nz; }) },
            { label: "⤢", title: "Reset zoom", onClick: () => { setZoom(1); setPan(initPan()); } },
          ].map(({ label, title, onClick }) => (
            <button
              key={label}
              title={title}
              onClick={(e) => { e.stopPropagation(); onClick(); }}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                width: 30, height: 30, borderRadius: 6,
                background: "rgba(10,12,24,0.72)", border: "1px solid #2d3148",
                color: "#e2e8f0", fontSize: label === "⤢" ? 14 : 18,
                cursor: "pointer", display: "flex", alignItems: "center",
                justifyContent: "center", backdropFilter: "blur(4px)",
                lineHeight: 1,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#2d3148"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(10,12,24,0.72)"; }}
            >
              {label}
            </button>
          ))}
          {zoom !== 1 && (
            <div style={{
              fontSize: 10, color: "#64748b", textAlign: "center",
              fontFamily: "monospace", marginTop: 2,
            }}>
              {zoom.toFixed(1)}×
            </div>
          )}
        </div>

      </div>{/* end viewport */}

      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          onAnalyze={() => onAnalyzeSingleMatch?.(contextMenu.matchId)}
          onClose={() => setContextMenu(null)}
        />
      )}

    </div>
  );
}
