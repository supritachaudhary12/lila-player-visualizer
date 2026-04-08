/**
 * mapConfig.ts
 *
 * Static configuration for each supported map:
 *   - world-space origin and scale used for coordinate conversion
 *   - minimap image filename (served from public/minimaps/)
 */

export type MapId = "AmbroseValley" | "GrandRift" | "Lockdown";

export interface MapConfig {
  /** World units that map to the full [0, 1] UV range */
  scale: number;
  /** World-space X coordinate that maps to u = 0 */
  originX: number;
  /** World-space Z coordinate that maps to v = 0 */
  originZ: number;
  /** Filename inside public/minimaps/ */
  minimap: string;
}

export const MAP_CONFIGS: Record<MapId, MapConfig> = {
  AmbroseValley: {
    scale: 900,
    originX: -370,
    originZ: -473,
    minimap: "AmbroseValley_Minimap.png",
  },
  GrandRift: {
    scale: 581,
    originX: -290,
    originZ: -290,
    minimap: "GrandRift_Minimap.png",
  },
  Lockdown: {
    scale: 1000,
    originX: -500,
    originZ: -500,
    minimap: "Lockdown_Minimap.jpg",
  },
};
