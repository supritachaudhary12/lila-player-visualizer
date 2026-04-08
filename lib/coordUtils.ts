/**
 * coordUtils.ts
 *
 * Converts world-space (x, z) coordinates to minimap pixel coordinates.
 *
 * The minimap is treated as a 1024×1024 image.
 *
 * Conversion steps:
 *   u = (x - origin_x) / scale          → normalised [0, 1] along X
 *   v = (z - origin_z) / scale          → normalised [0, 1] along Z
 *   pixel_x = u * 1024
 *   pixel_y = (1 - v) * 1024            → flip Y so +Z is "up" on the image
 */

import type { MapConfig } from "./mapConfig";

export interface PixelPoint {
  x: number; // pixel column in [0, 1024]
  y: number; // pixel row   in [0, 1024]
}

export function worldToMinimap(
  worldX: number,
  worldZ: number,
  config: MapConfig
): PixelPoint {
  const u = (worldX - config.originX) / config.scale;
  const v = (worldZ - config.originZ) / config.scale;
  return {
    x: u * 1024,
    y: (1 - v) * 1024,
  };
}
