/**
 * app/api/match/route.ts
 *
 * GET /api/match?matchId=<uuid>
 *
 * Reads a single match JSON file from data/processed/matches/ and returns
 * sanitized rows.  Used by Single Match mode when the user picks a match.
 *
 * Response: { rows: MatchRow[] }
 */

export const runtime = "nodejs";

import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";

const MATCHES_DIR = path.join(process.cwd(), "data", "processed", "matches");

function sanitize(r: Record<string, unknown>) {
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

export async function GET(req: NextRequest) {
  const matchId = req.nextUrl.searchParams.get("matchId") ?? "";

  if (!matchId) {
    return Response.json({ error: "matchId query param is required" }, { status: 400 });
  }

  // Basic validation — prevent path traversal
  if (!/^[0-9a-f-]+$/i.test(matchId)) {
    return Response.json({ error: "Invalid matchId format" }, { status: 400 });
  }

  const fp = path.join(MATCHES_DIR, `${matchId}.json`);

  if (!fs.existsSync(fp)) {
    return Response.json({ error: `Match not found: ${matchId}` }, { status: 404 });
  }

  const raw = JSON.parse(fs.readFileSync(fp, "utf-8")) as Array<Record<string, unknown>>;
  const rows = JSON.parse(JSON.stringify(raw.map(sanitize)));

  return Response.json({ rows });
}
