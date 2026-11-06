import type { Polygon, Ring } from "polygon-clipping";
import { feature } from "topojson-client";
import countries50m from "world-atlas/countries-50m.json";

import type { Point } from "../types.ts";
import type { CountryPart } from "./countryBuilder.ts";
import { projectEquirectangular, ringToPoints } from "./geometry.ts";

/**
 * Natural Earth country borders (1:50m) as projected parts: one entry per
 * mainland or island of every country. Antarctica is dropped; Greenland, the
 * Canadian Arctic islands and the high Arctic become scenery, since no
 * territory sits on them and owning them would bloat the territories nearby.
 */

const MIN_LATITUDE = -56;
const HIGH_ARCTIC_LATITUDE = 70;
/** Baffin, Victoria and the other Arctic islands start north of this. */
const CANADIAN_ARCTIC_LATITUDE = 61;

/** Remove ±180° seams by keeping each ring's longitudes continuous. */
function unwrapLongitudes(coords: readonly (readonly number[])[], shift?: number): { ring: number[][]; shift: number } {
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
  let s = shift;
  if (s === undefined) {
    let sum = 0;
    for (const p of out) sum += p[0]!;
    s = -Math.round(sum / out.length / 360) * 360;
  }
  if (s !== 0) for (const p of out) p[0]! += s;
  return { ring: out, shift: s };
}

function project(coords: readonly (readonly number[])[]): Ring {
  return coords.map((c) => {
    const p = projectEquirectangular(c[0]!, c[1]!);
    return [p.x, p.y] as [number, number];
  });
}

export interface CountryData {
  readonly parts: CountryPart[];
  readonly decor: Point[][];
}

export function loadCountries(): CountryData {
  const geo = feature(countries50m, countries50m.objects.countries!);
  const features = geo.type === "FeatureCollection" ? geo.features : [geo];
  const parts: CountryPart[] = [];
  const decor: Point[][] = [];
  for (const f of features) {
    const name = String((f.properties as { name?: string } | null)?.name ?? "?");
    const g = f.geometry;
    const polys: number[][][][] =
      g?.type === "MultiPolygon"
        ? (g.coordinates as number[][][][])
        : g?.type === "Polygon"
          ? [g.coordinates as number[][][]]
          : [];
    for (const raw of polys) {
      const outerRaw = raw[0];
      if (!outerRaw) continue;
      let latMin = Infinity;
      let latMax = -Infinity;
      for (const c of outerRaw) {
        latMin = Math.min(latMin, c[1]!);
        latMax = Math.max(latMax, c[1]!);
      }
      if (latMax < MIN_LATITUDE) continue;
      const first = unwrapLongitudes(outerRaw);
      const poly: Polygon = [project(first.ring), ...raw.slice(1).map((h) => project(unwrapLongitudes(h, first.shift).ring))];
      const scenery =
        latMin > HIGH_ARCTIC_LATITUDE ||
        (name === "Canada" && latMin > CANADIAN_ARCTIC_LATITUDE) ||
        name === "Greenland";
      if (scenery) {
        decor.push(ringToPoints(poly[0]!));
        continue;
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const [x, y] of poly[0]!) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      parts.push({ country: name, poly, minX, minY, maxX, maxY });
    }
  }
  return { parts, decor };
}
