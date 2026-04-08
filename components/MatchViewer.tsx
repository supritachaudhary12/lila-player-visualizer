"use client";

/**
 * MatchViewer.tsx
 *
 * Top-level layout component.  Owns:
 *   mode:       "single" | "multi"
 *   singleMode: "playback" | "movement" | "events"  (single mode only)
 *   layers:     LayerFlags                           (single mode only)
 *   multiViewMode: "movement" | "heatmap" | "events" (multi mode only)
 *
 * Single Match mode has three analysis workflows, each with their own
 * checkbox-based layer controls:
 *   Playback  — timeline, cumulative filtering, movement + events
 *   Movement  — static view, paths + optional dots
 *   Events    — static view, event markers by type
 *
 * Multi-match mode is unchanged: Movement / Heatmap / Events view buttons.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import MatchMap, { MatchRow, ViewMode } from "./MatchMap";
import { MapId, MAP_CONFIGS } from "@/lib/mapConfig";
import { SummaryEntry, SingleMode, LayerFlags, DEFAULT_LAYERS, MultiMatchData, HeatmapType } from "@/lib/types";

// ── Types ─────────────────────────────────────────────────────────────────────

type Mode = "single" | "multi";

interface Props {
  initialRows:    MatchRow[];
  initialMatchId: string;
  summary:        SummaryEntry[];
}

// ── Shared styles ─────────────────────────────────────────────────────────────

function btn(active: boolean): React.CSSProperties {
  return {
    background:   active ? "#3d4168" : "#1e2132",
    border:       `1px solid ${active ? "#6366f1" : "#2d3148"}`,
    color:        active ? "#e2e8f0" : "#94a3b8",
    padding:      "5px 12px",
    borderRadius: 4,
    fontSize:     12,
    cursor:       "pointer",
    width:        "100%",
    textAlign:    "left" as const,
  };
}

const SELECT: React.CSSProperties = {
  background: "#1e2132", border: "1px solid #2d3148",
  color: "#e2e8f0", padding: "5px 8px",
  borderRadius: 4, fontSize: 12,
  cursor: "pointer", width: "100%", outline: "none",
};

const DIVIDER: React.CSSProperties = {
  borderTop: "1px solid #2d3148",
  margin:    "12px 0",
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 11, color: "#64748b",
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em", marginBottom: 8,
};

// ── Layer checkbox component ──────────────────────────────────────────────────

function LayerRow({
  checked, onChange, label, children,
}: {
  checked:  boolean;
  onChange: (v: boolean) => void;
  label:    string;
  children: React.ReactNode;  // SVG icon
}) {
  return (
    <label style={{
      display: "flex", alignItems: "center", gap: 8,
      cursor: "pointer", userSelect: "none",
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ cursor: "pointer", accentColor: "#6366f1", flexShrink: 0 }}
      />
      {children}
      <span style={{ fontSize: 12, color: checked ? "#e2e8f0" : "#64748b" }}>
        {label}
      </span>
    </label>
  );
}

// ── Inline SVG icons (14×14) for layer checkboxes ────────────────────────────

function Ico({ children }: { children: React.ReactNode }) {
  return <svg width={14} height={14} viewBox="0 0 14 14" style={{ flexShrink: 0 }}>{children}</svg>;
}

const IcoHuman   = () => <Ico><line x1={1} y1={7} x2={13} y2={7} stroke="#22d3ee" strokeWidth={2.5} strokeLinecap="round"/></Ico>;
const IcoBot     = () => <Ico><line x1={1} y1={7} x2={13} y2={7} stroke="#f97316" strokeWidth={2.5} strokeLinecap="round"/></Ico>;
const IcoDots    = () => <Ico><circle cx={4} cy={7} r={2} fill="#22d3ee" opacity={0.8}/><circle cx={10} cy={7} r={2} fill="#22d3ee" opacity={0.8}/></Ico>;
const IcoKill    = () => <Ico><circle cx={7} cy={7} r={4} fill="#ef4444" fillOpacity={0.75} stroke="rgba(255,255,255,0.25)" strokeWidth={0.5}/></Ico>;
const IcoDeath   = () => <Ico><line x1={2} y1={2} x2={12} y2={12} stroke="#f8fafc" strokeWidth={2} strokeLinecap="round" strokeOpacity={0.75}/><line x1={12} y1={2} x2={2} y2={12} stroke="#f8fafc" strokeWidth={2} strokeLinecap="round" strokeOpacity={0.75}/></Ico>;
const IcoLoot    = () => <Ico><circle cx={7} cy={7} r={4} fill="#facc15" fillOpacity={0.75} stroke="rgba(255,255,255,0.2)" strokeWidth={0.5}/></Ico>;
const IcoStorm   = () => <Ico><path d="M 7 2 L 12 7 L 7 12 L 2 7 Z" fill="#a855f7" fillOpacity={0.75} stroke="rgba(255,255,255,0.2)" strokeWidth={0.5}/></Ico>;

// ── Multi-match legend components ─────────────────────────────────────────────

const LR: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10 };
const LL: React.CSSProperties = { fontSize: 13, color: "#e2e8f0" };

function LegendRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return <div style={LR}>{icon}<span style={LL}>{label}</span></div>;
}

const HEAT_GRADIENT: Record<string, [string, string, string]> = {
  traffic: ["hsl(200,100%,45%)", "hsl(60,100%,45%)",  "hsl(0,100%,45%)"],
  kills:   ["hsl(28,100%,55%)",  "hsl(14,100%,62%)",  "hsl(0,100%,70%)"],
  deaths:  ["hsl(280,90%,35%)",  "hsl(310,90%,55%)",  "hsl(340,90%,80%)"],
};

const HEAT_LABEL: Record<string, string> = {
  traffic: "Movement density",
  kills:   "Kill density",
  deaths:  "Death density",
};

function HeatGradient({ type }: { type: string }) {
  const [c0, c1, c2] = HEAT_GRADIENT[type] ?? HEAT_GRADIENT.traffic;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <svg width={80} height={10} style={{ borderRadius: 3, flexShrink: 0 }}>
        <defs>
          <linearGradient id="heat-legend" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor={c0} />
            <stop offset="50%"  stopColor={c1} />
            <stop offset="100%" stopColor={c2} />
          </linearGradient>
        </defs>
        <rect width={80} height={10} fill="url(#heat-legend)" rx={3} />
      </svg>
      <span style={{ fontSize: 11, color: "#64748b" }}>low → high</span>
    </div>
  );
}

function MultiLegend({ viewMode, heatmapType }: { viewMode: ViewMode; heatmapType: string }) {
  if (viewMode === "heatmap" || viewMode === "both") {
    return (
      <>
        <p style={SECTION_LABEL}>Density</p>
        <HeatGradient type={heatmapType} />
        <p style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
          {HEAT_LABEL[heatmapType] ?? "Density"} across all loaded matches.
        </p>
      </>
    );
  }
  return null;
}

// ── Insights section ─────────────────────────────────────────────────────────

function gridArea(bx: number, by: number): string {
  const h = bx < 22 ? "West" : bx < 43 ? "Center" : "East";
  const v = by < 22 ? "North" : by < 43 ? "Mid"    : "South";
  return h === "Center" && v === "Mid" ? "Center" : `${v}-${h}`;
}

function InsightsSection({
  data, mapId, matchCount, totalCount, multiDates,
}: {
  data:        MultiMatchData | null;
  mapId:       string;
  matchCount:  number;
  totalCount:  number;
  multiDates:  string[];
}) {
  const storageKey = `insights_notes_${mapId}`;
  const [notes, setNotes] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(storageKey) ?? "";
  });

  const saveNotes = (val: string) => {
    setNotes(val);
    localStorage.setItem(storageKey, val);
  };

  const insights = useMemo(() => {
    if (!data) return [];
    const out: { icon: string; text: string }[] = [];

    // Top kill zone
    if (data.heatmapKills.length) {
      const top = data.heatmapKills.reduce((a, b) => b.count > a.count ? b : a);
      out.push({ icon: "🔴", text: `Kill hotspot: ${gridArea(top.bx, top.by)} (${top.count} kills)` });
    }
    // Top death zone
    if (data.heatmapDeaths.length) {
      const top = data.heatmapDeaths.reduce((a, b) => b.count > a.count ? b : a);
      out.push({ icon: "✕", text: `Death hotspot: ${gridArea(top.bx, top.by)} (${top.count} deaths)` });
    }
    // Top traffic zone
    if (data.heatmapTraffic.length) {
      const top = data.heatmapTraffic.reduce((a, b) => b.count > a.count ? b : a);
      out.push({ icon: "◈", text: `High traffic: ${gridArea(top.bx, top.by)} (${top.count.toLocaleString()} positions)` });
    }
    // Bot ratio in paths
    if (data.paths.length) {
      const bots  = data.paths.filter(p => p.isBot).length;
      const pct   = Math.round((bots / data.paths.length) * 100);
      out.push({ icon: "⬡", text: `Bot paths: ${pct}% of sampled movement` });
    }
    // Match coverage
    out.push({ icon: "▦", text: `${matchCount} matches across ${multiDates.length} date${multiDates.length !== 1 ? "s" : ""}` });

    return out;
  }, [data, matchCount, multiDates]);

  return (
    <>
      <p style={SECTION_LABEL}>Auto Insights</p>
      {!data ? (
        <p style={{ fontSize: 11, color: "#64748b" }}>Load matches to see insights.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {insights.map(({ icon, text }, i) => (
            <div key={i} style={{
              display:      "flex", gap: 7, alignItems: "flex-start",
              background:   "rgba(99,102,241,0.06)",
              border:       "1px solid rgba(99,102,241,0.15)",
              borderRadius: 5, padding: "5px 8px",
            }}>
              <span style={{ fontSize: 11, flexShrink: 0, marginTop: 1, color: "#6366f1" }}>{icon}</span>
              <span style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>{text}</span>
            </div>
          ))}
        </div>
      )}

      <p style={{ ...SECTION_LABEL, marginTop: 12 }}>Designer Notes</p>
      <textarea
        value={notes}
        onChange={(e) => saveNotes(e.target.value)}
        placeholder="Write observations, ideas, or issues…"
        rows={5}
        style={{
          width:          "100%",
          background:     "#0f1117",
          border:         "1px solid #2d3148",
          borderRadius:   6,
          color:          "#e2e8f0",
          fontSize:       12,
          fontFamily:     "system-ui, sans-serif",
          padding:        "8px 10px",
          resize:         "vertical",
          outline:        "none",
          lineHeight:     1.55,
        }}
        onFocus={(e)  => { e.currentTarget.style.borderColor = "#6366f1"; }}
        onBlur={(e)   => { e.currentTarget.style.borderColor = "#2d3148"; }}
      />
    </>
  );
}

// ── Single-match insights ─────────────────────────────────────────────────────

function SingleInsightsSection({ matchId }: { matchId: string }) {
  const storageKey = `insights_notes_single_${matchId}`;
  const [notes, setNotes] = useState(() =>
    typeof window !== "undefined" ? (localStorage.getItem(storageKey) ?? "") : ""
  );

  // Re-load notes when match changes
  useEffect(() => {
    setNotes(typeof window !== "undefined" ? (localStorage.getItem(storageKey) ?? "") : "");
  }, [storageKey]);

  const saveNotes = (val: string) => {
    setNotes(val);
    localStorage.setItem(storageKey, val);
  };

  return (
    <>
      <p style={SECTION_LABEL}>Designer Notes</p>
      <textarea
        value={notes}
        onChange={(e) => saveNotes(e.target.value)}
        placeholder="Write observations, issues, or ideas for this match…"
        rows={5}
        style={{
          width: "100%", background: "#0f1117",
          border: "1px solid #2d3148", borderRadius: 6,
          color: "#e2e8f0", fontSize: 12,
          fontFamily: "system-ui, sans-serif",
          padding: "8px 10px", resize: "vertical",
          outline: "none", lineHeight: 1.55,
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = "#6366f1"; }}
        onBlur={(e)  => { e.currentTarget.style.borderColor = "#2d3148"; }}
      />
    </>
  );
}

// ── Error card ────────────────────────────────────────────────────────────────

function ErrorCard({ message }: { message: string }) {
  return (
    <div style={{
      background: "#1e1a2e", border: "1px solid #7f1d1d",
      borderRadius: 6, padding: "20px 24px", maxWidth: 480,
    }}>
      <p style={{ fontSize: 13, color: "#f87171", marginBottom: 8, fontWeight: 600 }}>
        Failed to load match data
      </p>
      <p style={{ fontSize: 12, color: "#94a3b8", fontFamily: "monospace", wordBreak: "break-all" }}>
        {message}
      </p>
    </div>
  );
}

// ── Fallback box (non-error empty state) ──────────────────────────────────────

function FallbackBox({ message }: { message: string }) {
  return (
    <div style={{
      background: "#161923", border: "1px solid #2d3148",
      borderRadius: 6, padding: "24px 32px", maxWidth: 480, textAlign: "center",
    }}>
      <p style={{ fontSize: 13, color: "#64748b" }}>{message}</p>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const KNOWN_MAPS = Object.keys(MAP_CONFIGS) as MapId[];

const fmtDate  = (d: string) => d.replace(/_/g, " ");
const fmtMatch = (e: SummaryEntry, i: number) =>
  `${i + 1}. ${e.match_id.slice(0, 8)} · ${e.human_players}H ${e.bot_players}B`;

// ── Component ─────────────────────────────────────────────────────────────────

export default function MatchViewer({ initialRows, initialMatchId, summary }: Props) {

  // ── Top-level mode ───────────────────────────────────────────────────────────

  const [mode, setMode] = useState<Mode>("single");

  // ── Single-match: analysis mode + layers ────────────────────────────────────

  const [singleMode, setSingleMode] = useState<SingleMode>("playback");
  const [layers,     setLayers]     = useState<LayerFlags>(DEFAULT_LAYERS.playback);

  // Reset layers to defaults when analysis mode changes
  useEffect(() => { setLayers(DEFAULT_LAYERS[singleMode]); }, [singleMode]);

  const toggleLayer = (key: keyof LayerFlags) =>
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));

  // ── Single-match: Map → Date → Match ────────────────────────────────────────

  const initEntry = useMemo(
    () => summary.find((e) => e.match_id === initialMatchId),
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [singleMapId,   setSingleMapId]   = useState<string>(initEntry?.map_id ?? KNOWN_MAPS[0] ?? "");
  const [singleDate,    setSingleDate]    = useState<string>(initEntry?.date ?? "");
  const [singleMatchId, setSingleMatchId] = useState<string>(initialMatchId);

  const singleDates = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of summary) {
      if (e.map_id === singleMapId && !seen.has(e.date)) { seen.add(e.date); out.push(e.date); }
    }
    return out.sort();
  }, [summary, singleMapId]);

  // All matches for selected map + date
  const singleMatchEntries = useMemo(
    () => summary.filter((e) => e.map_id === singleMapId && e.date === singleDate),
    [summary, singleMapId, singleDate]
  );

  const currentEntry = useMemo(
    () => summary.find((e) => e.match_id === singleMatchId),
    [summary, singleMatchId]
  );

  // Map change → reset date + match (or apply pending navigation target)
  useEffect(() => {
    if (pendingNavRef.current) {
      const { date, matchId } = pendingNavRef.current;
      pendingNavRef.current = null;
      setSingleDate(date);
      setSingleMatchId(matchId);
      return;
    }
    const firstDate  = singleDates[0] ?? "";
    const firstMatch = summary.find((e) => e.map_id === singleMapId && e.date === firstDate)?.match_id ?? "";
    setSingleDate(firstDate);
    setSingleMatchId(firstMatch);
  }, [singleMapId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Date change → reset to first match for that date
  useEffect(() => {
    if (!singleDate) return;
    const firstMatch = summary.find((e) => e.map_id === singleMapId && e.date === singleDate)?.match_id ?? "";
    setSingleMatchId(firstMatch);
  }, [singleDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Single-match: row loading ────────────────────────────────────────────────

  const [singleRows,    setSingleRows]    = useState<MatchRow[]>(initialRows);
  const [loadingSingle, setLoadingSingle] = useState(false);
  const [singleError,   setSingleError]   = useState<string | null>(null);

  const loadedSingleRef  = useRef<string>(initialMatchId);
  // Used to bypass the cascading map→date→match effects during programmatic navigation
  const pendingNavRef = useRef<{ date: string; matchId: string } | null>(null);

  useEffect(() => {
    if (!singleMatchId || singleMatchId === loadedSingleRef.current) return;

    setLoadingSingle(true);
    setSingleError(null);

    fetch(`/api/match?matchId=${singleMatchId}`)
      .then((res) => {
        if (!res.ok) return res.text().then((b) => { throw new Error(`HTTP ${res.status}: ${b}`); });
        return res.json();
      })
      .then(({ rows: fetched, error }: { rows: MatchRow[]; error?: string }) => {
        if (error) throw new Error(error);
        setSingleRows(fetched);
        loadedSingleRef.current = singleMatchId;
        setLoadingSingle(false);
      })
      .catch((err: Error) => {
        setSingleError(err.message);
        setLoadingSingle(false);
      });
  }, [singleMatchId]);

  // ── Multi-match state ────────────────────────────────────────────────────────
  // Server returns pre-aggregated data — no raw rows stored on the client.

  const [multiViewMode, setMultiViewMode] = useState<ViewMode>("heatmap");
  const [heatmapType,   setHeatmapType]   = useState<HeatmapType>("traffic");
  const [multiMapId,        setMultiMapId]        = useState<MapId>(KNOWN_MAPS[0]);
  const [multiSelectedDates, setMultiSelectedDates] = useState<Set<string>>(new Set());
  const [multiData,         setMultiData]         = useState<MultiMatchData | null>(null);
  const [loadingMulti,      setLoadingMulti]      = useState(false);
  const [multiError,        setMultiError]        = useState<string | null>(null);

  // All unique dates for the current multi map
  const multiDates = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of summary) {
      if (e.map_id === multiMapId && !seen.has(e.date)) { seen.add(e.date); out.push(e.date); }
    }
    return out.sort();
  }, [summary, multiMapId]);

  // Match count per date for the current multi map
  const multiDateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of summary) {
      if (e.map_id === multiMapId) counts[e.date] = (counts[e.date] ?? 0) + 1;
    }
    return counts;
  }, [summary, multiMapId]);

  // When map changes, reset to all dates selected
  useEffect(() => {
    setMultiSelectedDates(new Set(multiDates));
  }, [multiMapId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch when mode, map, or selected dates change
  useEffect(() => {
    if (mode !== "multi") return;
    if (multiSelectedDates.size === 0) { setMultiData(null); return; }
    setLoadingMulti(true);
    setMultiError(null);
    const datesParam = [...multiSelectedDates].map(encodeURIComponent).join(",");
    fetch(`/api/matches?mapId=${multiMapId}&dates=${datesParam}`)
      .then((res) => {
        if (!res.ok) return res.text().then((b) => { throw new Error(`HTTP ${res.status}: ${b}`); });
        return res.json();
      })
      .then((data: MultiMatchData & { error?: string }) => {
        if (data.error) throw new Error(data.error);
        setMultiData(data);
        setLoadingMulti(false);
      })
      .catch((err: Error) => { setMultiError(err.message); setLoadingMulti(false); });
  }, [mode, multiMapId, multiSelectedDates]);

  const toggleMultiDate = (date: string) => {
    setMultiSelectedDates((prev) => {
      const next = new Set(prev);
      next.has(date) ? next.delete(date) : next.add(date);
      return next;
    });
  };

  // Navigate from multi mode to single mode for a specific match
  const handleAnalyzeSingleMatch = (matchId: string) => {
    const entry = summary.find((e) => e.match_id === matchId);
    if (!entry) return;
    if (entry.map_id !== singleMapId) {
      // Map will change → use pending ref so the effect sets our date+match instead of defaults
      pendingNavRef.current = { date: entry.date, matchId: entry.match_id };
      setSingleMapId(entry.map_id as MapId);
    } else {
      // Same map — just set date+match directly
      setSingleDate(entry.date);
      setSingleMatchId(entry.match_id);
    }
    setMode("single");
  };

  // Derived from multiData so no separate state is needed
  const matchCount = multiData?.matchCount ?? 0;
  const totalCount = multiData?.totalCount ?? 0;

  // match_id → fmtMatch-style label, numbered by position within map+date group
  // (same numbering as the Single Match dropdown so labels stay consistent)
  const matchLabels = useMemo(() => {
    if (!multiData) return {};
    const labels: Record<string, string> = {};
    for (const p of multiData.paths) {
      if (p.match_id in labels) continue;
      const entry = summary.find((e) => e.match_id === p.match_id);
      if (entry) {
        const dateGroup = summary.filter((e) => e.map_id === entry.map_id && e.date === entry.date);
        const idx = dateGroup.findIndex((e) => e.match_id === p.match_id);
        labels[p.match_id] = fmtMatch(entry, idx >= 0 ? idx : 0);
      } else {
        labels[p.match_id] = p.match_id.slice(0, 8);
      }
    }
    return labels;
  }, [multiData, summary]);

  // match_id → formatted date string
  const matchDates = useMemo(() => {
    if (!multiData) return {};
    const dates: Record<string, string> = {};
    for (const p of multiData.paths) {
      if (!(p.match_id in dates)) {
        const entry = summary.find((e) => e.match_id === p.match_id);
        if (entry) dates[p.match_id] = fmtDate(entry.date);
      }
    }
    return dates;
  }, [multiData, summary]);

  // ── Debug logging ────────────────────────────────────────────────────────────

  useEffect(() => {
    console.log("[MatchViewer] mode:", mode);
    if (mode === "single") {
      console.log("[MatchViewer] single | map:", singleMapId, "| match:", singleMatchId);
      console.log("[MatchViewer] single | rows:", singleRows.length, "| hasRows:", singleRows.length > 0);
    } else {
      console.log("[MatchViewer] multi | map:", multiMapId, "| view:", multiViewMode);
      console.log("[MatchViewer] multi | multiData:", multiData
        ? `${multiData.matchCount}/${multiData.totalCount} matches, traffic=${multiData.heatmapTraffic.length} kills=${multiData.heatmapKills.length} deaths=${multiData.heatmapDeaths.length} events=${multiData.events.length}`
        : "null");
    }
  }, [mode, singleMapId, singleMatchId, singleRows.length, multiMapId, multiViewMode, multiData]);

  // ── Unified props for MatchMap ───────────────────────────────────────────────

  const activeMapId = mode === "single"
    ? (singleRows[0]?.map_id as MapId ?? KNOWN_MAPS[0])
    : multiMapId;
  const loading    = mode === "single" ? loadingSingle : loadingMulti;
  const fetchError = mode === "single" ? singleError   : multiError;
  const showTimeline = mode === "single" && singleMode === "playback";

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside style={{
        width: 270, background: "#161923",
        borderRight: "1px solid #2d3148",
        flexShrink: 0, overflowY: "auto",
        display: "flex", flexDirection: "column",
      }}>

        {/* ── Tab bar ──────────────────────────────────────────────────── */}
        <div style={{ display: "flex", borderBottom: "1px solid #2d3148", flexShrink: 0 }}>
          {(["single", "multi"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                padding: "10px 4px",
                fontSize: 11,
                fontWeight: mode === m ? 600 : 400,
                color: mode === m ? "#e2e8f0" : "#64748b",
                background: mode === m ? "#1e2132" : "transparent",
                border: "none",
                borderBottom: mode === m ? "2px solid #6366f1" : "2px solid transparent",
                cursor: "pointer",
                letterSpacing: "0.03em",
              }}
            >
              {m === "single" ? "Single Match" : "All Matches"}
            </button>
          ))}
        </div>

        {/* ── Tab content ──────────────────────────────────────────────── */}
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>

          {/* ── SINGLE MODE ────────────────────────────────────────────── */}
          {mode === "single" && (<>

            {/* Map selection — top */}
            <p style={SECTION_LABEL}>Map</p>
            {KNOWN_MAPS.map((m) => (
              <button key={m} style={btn(singleMapId === m)} onClick={() => setSingleMapId(m)}>
                {m}
              </button>
            ))}

            <div style={DIVIDER} />
            <p style={SECTION_LABEL}>Date</p>
            {singleDates.length === 0 ? (
              <p style={{ fontSize: 11, color: "#64748b" }}>No dates available</p>
            ) : (
              <select value={singleDate} onChange={(e) => setSingleDate(e.target.value)} style={SELECT}>
                {singleDates.map((d) => (
                  <option key={d} value={d}>{fmtDate(d)}</option>
                ))}
              </select>
            )}

            <div style={DIVIDER} />
            <p style={SECTION_LABEL}>Match</p>
            {singleMatchEntries.length === 0 ? (
              <p style={{ fontSize: 11, color: "#64748b" }}>No matches available</p>
            ) : (
              <div style={{
                maxHeight:    160,
                overflowY:    "auto",
                borderRadius: 6,
                border:       "1px solid #2d3148",
                background:   "#0f1117",
              }}>
                {singleMatchEntries.map((entry, i) => {
                  const active = entry.match_id === singleMatchId;
                  return (
                    <button
                      key={entry.match_id}
                      onClick={() => setSingleMatchId(entry.match_id)}
                      style={{
                        display:    "block",
                        width:      "100%",
                        textAlign:  "left",
                        padding:    "7px 10px",
                        fontSize:   12,
                        fontFamily: "monospace",
                        cursor:     "pointer",
                        border:     "none",
                        borderBottom: i < singleMatchEntries.length - 1 ? "1px solid #1e2132" : "none",
                        background: active ? "rgba(99,102,241,0.15)" : "transparent",
                        color:      active ? "#a5b4fc" : "#94a3b8",
                        borderLeft: active ? "2px solid #6366f1" : "2px solid transparent",
                        transition: "background 0.12s, color 0.12s",
                      }}
                      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "#e2e8f0"; } }}
                      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#94a3b8"; } }}
                    >
                      {fmtMatch(entry, i)}
                    </button>
                  );
                })}
              </div>
            )}
            {currentEntry && (
              <div style={{
                display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap",
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: "2px 7px",
                  borderRadius: 4, background: "rgba(34,211,238,0.12)",
                  border: "1px solid rgba(34,211,238,0.3)", color: "#22d3ee",
                }}>
                  {currentEntry.human_players} Human
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: "2px 7px",
                  borderRadius: 4, background: "rgba(249,115,22,0.12)",
                  border: "1px solid rgba(249,115,22,0.3)", color: "#f97316",
                }}>
                  {currentEntry.bot_players} Bot
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 600, padding: "2px 7px",
                  borderRadius: 4, background: "rgba(148,163,184,0.08)",
                  border: "1px solid #2d3148", color: "#94a3b8",
                }}>
                  {currentEntry.total_players} Total
                </span>
              </div>
            )}

            {/* Analysis mode */}
            <div style={DIVIDER} />
            <p style={SECTION_LABEL}>Analysis</p>
            <button style={btn(singleMode === "playback")} onClick={() => setSingleMode("playback")}>
              Playback
            </button>
            <button style={btn(singleMode === "movement")} onClick={() => setSingleMode("movement")}>
              Movement
            </button>

            {/* Layer checkboxes — content varies by analysis mode */}
            <div style={DIVIDER} />
            <p style={SECTION_LABEL}>Layers</p>

            {singleMode === "playback" && (<>
              <LayerRow checked={layers.humanPaths} onChange={() => toggleLayer("humanPaths")} label="Human movement"><IcoHuman /></LayerRow>
              <LayerRow checked={layers.botPaths}   onChange={() => toggleLayer("botPaths")}   label="Bot movement"><IcoBot /></LayerRow>
              <LayerRow checked={layers.kills}      onChange={() => toggleLayer("kills")}      label="Kill / BotKill"><IcoKill /></LayerRow>
              <LayerRow checked={layers.deaths}     onChange={() => toggleLayer("deaths")}     label="Death / BotKilled"><IcoDeath /></LayerRow>
              <LayerRow checked={layers.loot}       onChange={() => toggleLayer("loot")}       label="Loot"><IcoLoot /></LayerRow>
              <LayerRow checked={layers.storm}      onChange={() => toggleLayer("storm")}      label="Killed by Storm"><IcoStorm /></LayerRow>
            </>)}

            {singleMode === "movement" && (<>
              <LayerRow checked={layers.humanPaths} onChange={() => toggleLayer("humanPaths")} label="Human paths"><IcoHuman /></LayerRow>
              <LayerRow checked={layers.botPaths}   onChange={() => toggleLayer("botPaths")}   label="Bot paths"><IcoBot /></LayerRow>
              <LayerRow checked={layers.showDots}   onChange={() => toggleLayer("showDots")}   label="Show dots"><IcoDots /></LayerRow>
              <LayerRow checked={layers.kills}      onChange={() => toggleLayer("kills")}      label="Kill / BotKill"><IcoKill /></LayerRow>
              <LayerRow checked={layers.deaths}     onChange={() => toggleLayer("deaths")}     label="Death / BotKilled"><IcoDeath /></LayerRow>
              <LayerRow checked={layers.loot}       onChange={() => toggleLayer("loot")}       label="Loot"><IcoLoot /></LayerRow>
              <LayerRow checked={layers.storm}      onChange={() => toggleLayer("storm")}      label="Killed by Storm"><IcoStorm /></LayerRow>
            </>)}

            <div style={DIVIDER} />
            <SingleInsightsSection matchId={singleMatchId} />
          </>)}

          {/* ── MULTI MODE ─────────────────────────────────────────────── */}
          {mode === "multi" && (<>

            {/* Map selection — top */}
            <p style={SECTION_LABEL}>Map</p>
            {KNOWN_MAPS.map((m) => (
              <button key={m} style={btn(multiMapId === m)} onClick={() => setMultiMapId(m)}>
                {m}
              </button>
            ))}

            {/* Date selection */}
            <div style={DIVIDER} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <p style={{ ...SECTION_LABEL, margin: 0 }}>Matches</p>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={() => setMultiSelectedDates(new Set(multiDates))}
                  style={{
                    fontSize: 10, padding: "2px 6px", borderRadius: 3, cursor: "pointer",
                    background: "transparent", border: "1px solid #2d3148", color: "#64748b",
                  }}
                >All</button>
                <button
                  onClick={() => setMultiSelectedDates(new Set())}
                  style={{
                    fontSize: 10, padding: "2px 6px", borderRadius: 3, cursor: "pointer",
                    background: "transparent", border: "1px solid #2d3148", color: "#64748b",
                  }}
                >None</button>
              </div>
            </div>
            {multiDates.map((date) => {
              const checked = multiSelectedDates.has(date);
              const count   = multiDateCounts[date] ?? 0;
              return (
                <label key={date} style={{
                  display: "flex", alignItems: "center", gap: 7,
                  cursor: "pointer", userSelect: "none",
                  padding: "4px 0",
                }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleMultiDate(date)}
                    style={{ cursor: "pointer", accentColor: "#6366f1", flexShrink: 0 }}
                  />
                  <span style={{ fontSize: 12, color: checked ? "#e2e8f0" : "#64748b", flex: 1 }}>
                    {fmtDate(date)}
                  </span>
                  <span style={{ fontSize: 10, color: "#475569", flexShrink: 0 }}>
                    {count}
                  </span>
                </label>
              );
            })}
            {matchCount > 0 && (
              <p style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>
                {matchCount < totalCount ? (
                  <>Sampling{" "}<strong style={{ color: "#64748b" }}>{matchCount}</strong>{" "}of{" "}<strong style={{ color: "#64748b" }}>{totalCount}</strong></>
                ) : (
                  <><strong style={{ color: "#64748b" }}>{matchCount}</strong>{" "}matches loaded</>
                )}
              </p>
            )}
            {multiSelectedDates.size === 0 && (
              <p style={{ fontSize: 11, color: "#64748b" }}>No dates selected.</p>
            )}

            <div style={DIVIDER} />
            <p style={SECTION_LABEL}>View</p>
            <button style={btn(multiViewMode === "movement")} onClick={() => setMultiViewMode("movement")}>
              Movement
            </button>
            <button style={btn(multiViewMode === "heatmap")} onClick={() => setMultiViewMode("heatmap")}>
              Heatmap
            </button>
            <button style={btn(multiViewMode === "both")} onClick={() => setMultiViewMode("both")}>
              Both
            </button>

            {(multiViewMode === "heatmap" || multiViewMode === "both") && (<>
              <div style={DIVIDER} />
              <p style={SECTION_LABEL}>Heatmap</p>
              <button style={btn(heatmapType === "traffic")} onClick={() => setHeatmapType("traffic")}>
                High-Traffic Areas
              </button>
              <button style={btn(heatmapType === "kills")} onClick={() => setHeatmapType("kills")}>
                Kill Zones
              </button>
              <button style={btn(heatmapType === "deaths")} onClick={() => setHeatmapType("deaths")}>
                Death Zones
              </button>
            </>)}

            {(multiViewMode === "movement" || multiViewMode === "both") && (<>
              <div style={DIVIDER} />
              <p style={SECTION_LABEL}>Layers</p>
              <LayerRow checked={layers.humanPaths} onChange={() => toggleLayer("humanPaths")} label="Human paths"><IcoHuman /></LayerRow>
              <LayerRow checked={layers.botPaths}   onChange={() => toggleLayer("botPaths")}   label="Bot paths"><IcoBot /></LayerRow>
              <LayerRow checked={layers.kills}  onChange={() => toggleLayer("kills")}  label="Kill / BotKill"><IcoKill /></LayerRow>
              <LayerRow checked={layers.deaths} onChange={() => toggleLayer("deaths")} label="Death / BotKilled"><IcoDeath /></LayerRow>
              <LayerRow checked={layers.loot}   onChange={() => toggleLayer("loot")}   label="Loot"><IcoLoot /></LayerRow>
              <LayerRow checked={layers.storm}  onChange={() => toggleLayer("storm")}  label="Killed by Storm"><IcoStorm /></LayerRow>
            </>)}

            {(multiViewMode === "heatmap" || multiViewMode === "both") && (<>
              <div style={DIVIDER} />
              <MultiLegend viewMode={multiViewMode} heatmapType={heatmapType} />
            </>)}

            <div style={DIVIDER} />
            <InsightsSection
              data={multiData}
              mapId={multiMapId}
              matchCount={matchCount}
              totalCount={totalCount}
              multiDates={[...multiSelectedDates]}
            />
          </>)}

        </div>
      </aside>

      {/* ── Map area ─────────────────────────────────────────────────────── */}
      <main style={{
        flex: 1, background: "#0f1117",
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "auto", padding: 24,
      }}>
        {loading ? (
          <p style={{ fontSize: 14, color: "#64748b" }}>Loading…</p>
        ) : fetchError ? (
          <ErrorCard message={fetchError} />
        ) : mode === "multi" && !multiData ? (
          <FallbackBox message="Multi-match data unavailable — select a map to load." />
        ) : mode === "single" && singleRows.length === 0 ? (
          <FallbackBox message="No match data loaded. Select a match from the sidebar." />
        ) : (
          <MatchMap
            rows={mode === "single" ? singleRows : []}
            multiData={mode === "multi" ? (multiData ?? undefined) : undefined}
            mapId={activeMapId}
            isMultiMatch={mode === "multi"}
            matchCount={matchCount}
            showTimeline={showTimeline}
            layers={layers}
            multiViewMode={multiViewMode}
            heatmapType={heatmapType}
            matchLabels={matchLabels}
            matchDates={matchDates}
            onAnalyzeSingleMatch={mode === "multi" ? handleAnalyzeSingleMatch : undefined}
          />
        )}
      </main>

    </div>
  );
}
