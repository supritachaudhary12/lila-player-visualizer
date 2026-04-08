/**
 * page.tsx  (server component)
 *
 * Reads summary.json + the default single match at build/request time and
 * passes them to MatchViewer.  All further data loading happens client-side.
 */

import fs from "fs";
import path from "path";
import styles from "./page.module.css";
import MatchViewer from "@/components/MatchViewer";
import { MatchRow } from "@/components/MatchMap";
import { SummaryEntry } from "@/lib/types";

const MATCHES_DIR  = path.join(process.cwd(), "data", "processed", "matches");
const SUMMARY_PATH = path.join(process.cwd(), "data", "processed", "summary.json");

// Default match shown on first load
const DEFAULT_MATCH_ID = "0f169d20-5205-4a6c-8334-21965ae5caef";

function sanitizeRow(r: Record<string, unknown>): MatchRow {
  return {
    user_id:  String(r.user_id  ?? ""),
    match_id: String(r.match_id ?? ""),
    map_id:   String(r.map_id   ?? ""),
    x:        Number(r.x   ?? 0),
    y:        Number(r.y   ?? 0),
    z:        Number(r.z   ?? 0),
    ts:       String(r.ts    ?? ""),
    event:    String(r.event ?? ""),
    is_bot:   Boolean(r.is_bot),
  };
}

export default function Home() {
  // Read summary — plain JSON round-trip guarantees no non-serializable values
  const summary: SummaryEntry[] = JSON.parse(JSON.stringify(
    JSON.parse(fs.readFileSync(SUMMARY_PATH, "utf-8"))
  ));

  console.log("[page] summary loaded:", summary.length, "entries");

  // Read the default match rows
  const matchPath = path.join(MATCHES_DIR, `${DEFAULT_MATCH_ID}.json`);
  const initialRows: MatchRow[] = JSON.parse(JSON.stringify(
    (JSON.parse(fs.readFileSync(matchPath, "utf-8")) as Array<Record<string, unknown>>)
      .map(sanitizeRow)
  ));

  console.log("[page] defaultMatch:", DEFAULT_MATCH_ID, "→", initialRows.length, "rows");

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <span style={{ fontSize: 13, color: "#94a3b8", letterSpacing: "0.04em" }}>
          Player Journey Visualizer
        </span>
      </header>

      <MatchViewer
        initialRows={initialRows}
        initialMatchId={DEFAULT_MATCH_ID}
        summary={summary}
      />
    </div>
  );
}
