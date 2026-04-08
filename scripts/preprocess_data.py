"""
preprocess_data.py

Reads all .nakama-0 parquet files from data/raw/, combines player data
by match, and writes per-match JSON files plus a summary index.

Output layout:
    data/processed/matches/{match_id}.json   — one file per match
    data/processed/summary.json              — index of all matches
"""

import json
import os

import pandas as pd
import pyarrow.parquet as pq

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

DATA_DIR      = os.path.join(os.path.dirname(__file__), "..", "data", "raw")
OUT_MATCH_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "processed", "matches")
OUT_SUMMARY   = os.path.join(os.path.dirname(__file__), "..", "data", "processed", "summary.json")

# Fields to keep in each per-match JSON row
KEEP_FIELDS = ["user_id", "match_id", "map_id", "x", "y", "z", "ts", "event", "is_bot"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def parse_filename(filename: str) -> tuple[str, str]:
    """Extract user_id and match_id from '{user_id}_{match_id}.nakama-0'.

    Both user_id and match_id use '-' internally (UUID format, or a plain
    number for bots).  The only '_' in the filename is the single separator
    between them, so splitting on '_' once is sufficient and unambiguous.

    Examples:
      0019c582-574d-4a53-9f77-554519b75b4c_1298e3e2-2776-4038-ba9b-72808b041561.nakama-0
        → user_id  = '0019c582-574d-4a53-9f77-554519b75b4c'
        → match_id = '1298e3e2-2776-4038-ba9b-72808b041561'

      1388_7abc3541-fa03-45b8-975b-d754ff33acad.nakama-0
        → user_id  = '1388'
        → match_id = '7abc3541-fa03-45b8-975b-d754ff33acad'
    """
    stem = filename.replace(".nakama-0", "")
    user_id, match_id = stem.split("_", 1)
    return user_id, match_id


def decode_events(series: pd.Series) -> pd.Series:
    """Decode event column from bytes to utf-8 string if needed."""
    if series.dtype == object and series.dropna().apply(lambda x: isinstance(x, bytes)).any():
        return series.apply(lambda x: x.decode("utf-8") if isinstance(x, bytes) else x)
    return series


def folder_to_date(folder_name: str) -> str:
    """
    Convert a folder name like 'February_10' to 'February 10'.
    Returns the original string unchanged if it doesn't match that pattern.
    """
    return folder_name.replace("_", " ")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Create output directories if they don't already exist
    os.makedirs(OUT_MATCH_DIR, exist_ok=True)

    frames = []       # list of DataFrames, one per file
    file_count = 0

    print(f"Scanning: {os.path.abspath(DATA_DIR)}\n")

    # Walk every subfolder under data/raw/
    for root, _, files in os.walk(DATA_DIR):
        # The immediate subfolder name (e.g. "February_10") is used as the date
        folder_name = os.path.basename(root)

        for fname in files:
            if ".nakama-0" not in fname:
                continue  # skip README.md and other non-data files

            filepath = os.path.join(root, fname)
            user_id, match_id = parse_filename(fname)

            try:
                table = pq.read_table(filepath)
                df = table.to_pandas()
            except Exception as e:
                print(f"  [skip] {fname}: {e}")
                continue

            # Decode event bytes → string
            df["event"] = decode_events(df["event"])

            # Overwrite user_id / match_id from the filename (source of truth)
            df["user_id"]  = user_id
            df["match_id"] = match_id

            # A user_id is a bot when it is purely numeric
            df["is_bot"] = user_id.isdigit()

            # Carry the folder name so we can derive the date per match later
            df["_folder"] = folder_name

            frames.append(df)
            file_count += 1

    if not frames:
        print("No files loaded. Check that DATA_DIR is correct.")
        return

    # Combine everything into one DataFrame
    all_data = pd.concat(frames, ignore_index=True)

    # Diagnostic: confirm unique match_ids before grouping
    unique_match_ids = all_data["match_id"].nunique()
    print(f"Files read               : {file_count}")
    print(f"Unique match_ids parsed  : {unique_match_ids}")
    print()

    # Show 5 sample filename → parsed ids
    print("Sample filename parsing (5 files):")
    seen = set()
    for root, _, files in os.walk(DATA_DIR):
        for fname in files:
            if ".nakama-0" not in fname or fname in seen:
                continue
            seen.add(fname)
            uid, mid = parse_filename(fname)
            print(f"  file     : {fname}")
            print(f"  user_id  : {uid}")
            print(f"  match_id : {mid}")
            print()
            if len(seen) >= 5:
                break
        if len(seen) >= 5:
            break
    print()

    # Sort by match then timestamp so each match file comes out time-ordered
    all_data.sort_values(["match_id", "ts"], inplace=True)

    # -------------------------------------------------------------------------
    # Write one JSON file per match
    # -------------------------------------------------------------------------

    summary_rows = []
    match_groups = all_data.groupby("match_id", sort=False)

    for match_id, group in match_groups:
        # Derive date from the folder that the first file for this match came from
        date = folder_to_date(group["_folder"].iloc[0])

        # Map id (should be consistent within a match; take the first value)
        map_id = group["map_id"].iloc[0]

        # Build the list of row dicts, keeping only the required fields
        available = [f for f in KEEP_FIELDS if f in group.columns]
        rows = group[available].to_dict(orient="records")

        # Write match JSON
        match_path = os.path.join(OUT_MATCH_DIR, f"{match_id}.json")
        with open(match_path, "w", encoding="utf-8") as fh:
            json.dump(rows, fh, default=str)  # default=str handles Timestamps etc.

        # Accumulate summary data
        summary_rows.append({
            "match_id":      match_id,
            "map_id":        map_id,
            "date":          date,
            "min_ts":        str(group["ts"].min()),
            "max_ts":        str(group["ts"].max()),
            "total_players": int(group["user_id"].nunique()),
            "human_players": int(group.loc[~group["is_bot"], "user_id"].nunique()),
            "bot_players":   int(group.loc[ group["is_bot"], "user_id"].nunique()),
        })

    # -------------------------------------------------------------------------
    # Write summary.json
    # -------------------------------------------------------------------------

    with open(OUT_SUMMARY, "w", encoding="utf-8") as fh:
        json.dump(summary_rows, fh, indent=2)

    # -------------------------------------------------------------------------
    # Final report
    # -------------------------------------------------------------------------

    total_matches = len(summary_rows)
    print(f"Files read      : {file_count}")
    print(f"Matches saved   : {total_matches}")
    print(f"Output dir      : {os.path.abspath(OUT_MATCH_DIR)}")
    print(f"Summary file    : {os.path.abspath(OUT_SUMMARY)}")

    if summary_rows:
        print("\nSample match summary:")
        sample = summary_rows[0]
        for key, value in sample.items():
            print(f"  {key:<16}: {value}")


if __name__ == "__main__":
    main()
