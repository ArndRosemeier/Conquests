import type { MultiPolygon, Ring } from "polygon-clipping";
import { feature } from "topojson-client";
import land110m from "world-atlas/land-110m.json";

import { projectEquirectangular } from "./geometry.ts";

/**
 * Real-world coastline as a projected 2D land mask, ready to clip Voronoi cells
 * against. The pipeline that consumes this is source-agnostic: a procedural
 * generator can hand it a synthetic mask of the very same shape.
 *
 * Two real-Earth-specific clean-ups happen here (a procgen mask needs neither):
 *  - Longitudes are UNWRAPPED so landmasses that cross the ±180° antimeridian
 *    (Eurasia's Chukotka tip, Fiji, some Arctic islands) don't draw a spurious
 *    full-width band across the map.
 *  - Antarctica, the high Arctic, and Greenland are dropped: no game area sits
 *    on them and, being unclaimed, they distort the nearest territories' shapes.
 */

const MIN_LATITUDE = -56;
const HIGH_ARCTIC_LATITUDE = 70;
const LARGE_ARCTIC_MIN_LATITUDE = 58;
const LARGE_ARCTIC_SPAN = 12;

/** Remove ±180° seams by keeping each ring's longitudes continuous. */
function unwrapLongitudes(coords: readonly (readonly number[])[]): number[][] {
  const out: number[][] = [];
  let offset = 0;
  for (let i = 0; i < coords.length; i++) {
    const lon = coords[i]![0]!;
    if (i > 0) {
      const delta = lon - coords[i - 1]![0]!;
      if (delta > 180) offset -= 360;
      else if (delta < -180) offset += 360;
    }
    out.push([lon + offset, coords[i]![1]!]);
  }
  // Recenter so the ring's bulk stays inside the normal [-180, 180] range.
  let sum = 0;
  for (const p of out) sum += p[0]!;
  const shift = -Math.round(sum / out.length / 360) * 360;
  if (shift !== 0) for (const p of out) p[0]! += shift;
  return out;
}

function projectRing(coords: readonly (readonly number[])[]): Ring {
  return coords.map((c) => {
    const p = projectEquirectangular(c[0]!, c[1]!);
    return [p.x, p.y] as [number, number];
  });
}

function latitudeBounds(coords: readonly (readonly number[])[]): {
  min: number;
  max: number;
} {
  let min = Infinity;
  let max = -Infinity;
  for (const c of coords) {
    if (c[1]! < min) min = c[1]!;
    if (c[1]! > max) max = c[1]!;
  }
  return { min, max };
}

function buildLandMask(): MultiPolygon {
  const geo = feature(land110m, land110m.objects.land!);
  const features = geo.type === "FeatureCollection" ? geo.features : [geo];
  const polygons: number[][][][] = [];
  for (const f of features) {
    const geometry = f.geometry;
    if (geometry?.type === "MultiPolygon") {
      polygons.push(...(geometry.coordinates as number[][][][]));
    } else if (geometry?.type === "Polygon") {
      polygons.push(geometry.coordinates as number[][][]);
    } else {
      throw new Error(`Unexpected land geometry: ${geometry?.type ?? "null"}`);
    }
  }

  const mask: MultiPolygon = [];
  for (const poly of polygons) {
    const outer = poly[0];
    if (!outer) continue;
    const lat = latitudeBounds(outer);
    if (lat.max < MIN_LATITUDE) continue; // Antarctica
    if (lat.min > HIGH_ARCTIC_LATITUDE) continue; // Svalbard, Franz Josef Land, etc.
    if (lat.min > LARGE_ARCTIC_MIN_LATITUDE && lat.max - lat.min > LARGE_ARCTIC_SPAN) {
      continue; // Greenland and the large Canadian Arctic islands
    }
    mask.push(poly.map((ring) => projectRing(unwrapLongitudes(ring))));
  }
  return mask;
}

export const LAND_MASK: MultiPolygon = buildLandMask();
