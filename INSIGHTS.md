# Gameplay Insights

Three things I learned about Lila Black by building and using this tool.

---

## Insight 1 — The Storm Funnel Creates a Single Choke Point on AmbroseValley

### What caught my eye
When I loaded multi-match heatmaps for AmbroseValley and switched to the **Deaths** layer, `KilledByStorm` events didn't scatter evenly across the map — they clustered in a narrow band on the east side, concentrated across almost every date in the dataset.

### The data
- Filtering to `KilledByStorm` events in multi-match mode shows a dense corridor that accounts for a disproportionate share of late-game deaths
- The traffic heatmap shows that late-match movement (when players have fewer safe zones) converges into this same corridor, meaning players are both passing through and dying there
- The effect is consistent across February 10–14, suggesting it's structural (storm spawn logic) rather than a one-day anomaly

### What's actionable
**Metrics affected:** Storm death rate, late-game survival rate, time-to-extract for players crossing that zone

**Actionable items:**
1. Add a second navigable route through the east — a ravine, building cluster, or terrain feature — so players have a cover option other than the open corridor
2. Adjust storm origin distribution to rotate the final zone more evenly around the map's center, reducing the predictability of the death band
3. Monitor: if storm death rate in the east corridor drops after a map change, the terrain fix is working

### Why a level designer should care
A predictable death corridor is a skill trap — experienced players know to avoid it, but new players funnel in. This compresses late-game into a single line of play, reduces rotational variety, and makes the map feel smaller than it is in the final circle.

---

## Insight 2 — Loot Events Are Almost Absent Near the Map Center, Suggesting Spawn Asymmetry

### What caught my eye
When I switched to the **Loot** event layer in multi-match mode, I noticed loot pickups concentrate heavily around the map periphery and named POIs near edges. The center of AmbroseValley — which has the highest movement traffic — shows very few loot events relative to its foot traffic density.

### The data
- The traffic heatmap (movement density) shows the center as a high-traffic zone across most matches
- The loot overlay shows sparse pickup events in that same central area despite the heavy player presence
- This gap between "where players walk" and "where players loot" holds across multiple dates, indicating players are transiting through the center without stopping — either because loot isn't there, or it's already been taken by the time most players arrive

### What's actionable
**Metrics affected:** Early-game engagement rate, loot satisfaction, time-to-first-engagement

**Actionable items:**
1. Audit loot table density at center-map spawn points — if density is low, increase it or add a high-value anchor (e.g., a weapon crate) to give players a reason to contest the center
2. If loot exists but is being depleted in the first 60 seconds by early-drop players, introduce a loot respawn mechanic or shift some high-value loot to secondary spawns slightly off-center
3. A/B test: add one mid-tier loot cache in the center and measure whether loot events there increase and whether early-fight rate goes up

### Why a level designer should care
Player pathing follows loot. If the center is a dead zone for items, players treat it as a corridor rather than a destination, reducing organic encounters. Distributing loot more intentionally can turn the center into a contested space and create mid-game fights that currently aren't happening.

---

## Insight 3 — Bots and Humans Occupy Different Spatial Zones, But Only on Larger Maps

### What caught my eye
When I toggled the **Human Paths** and **Bot Paths** layers in single-match playback mode, I noticed that human players on AmbroseValley clearly cluster around loot-dense areas and extraction points, while bot movement traces show broader, more evenly distributed coverage. On the smaller Lockdown map, this separation nearly disappears — bots and humans occupy the same zones.

### The data
- On AmbroseValley, filtering to bot paths alone shows even coverage across the outer quadrants; human paths are concentrated in 3–4 POI clusters
- On Lockdown, the map is small enough that the bot distribution pattern overlaps significantly with human player paths
- BotKill and BotKilled events on Lockdown are more frequent per-match than on AmbroseValley (relative to player count), consistent with forced spatial overlap

### What's actionable
**Metrics affected:** Bot-player engagement rate, perceived difficulty, time-to-first-combat, player retention for new players

**Actionable items:**
1. For larger maps, consider adding bot waypoints that bias toward known human POI clusters — this increases early engagement without making bots feel scripted
2. Investigate whether the spatial separation on AmbroseValley is causing new players to go several minutes without any engagement (bots not finding them), which could hurt early-session retention
3. Use the spatial overlap metric (proportion of bot path that falls within human hotspot zones) as an ongoing tuning signal when adjusting bot AI navigation budgets

### Why a level designer should care
Bot placement is a difficulty dial, not just a population filler. If bots occupy empty space while humans cluster at POIs, the first few minutes of a match feel quiet for most players. On a large map, deliberate bot concentration in loot zones can control pacing without adding more bots — a pure design lever.
