import type { MultiPolygon, Pair, Polygon, Ring } from "polygon-clipping";

import type { Point } from "../types.ts";

/**
 * Low-level 2D geometry helpers shared by every world generator (the real-world
 * builder today, procedural generators tomorrow). Everything here works in a
 * flat, projected coordinate space; nothing knows about longitude/latitude.
 */

/** Equirectangular projection: longitude east is +x, latitude north is -y. */
export function projectEquirectangular(lon: number, lat: number): Point {
  return { x: lon, y: -lat };
}

export function toPair(p: Point): Pair {
  return [p.x, p.y];
}

export function fromPair(pair: Pair): Point {
  return { x: pair[0], y: pair[1] };
}

/** Convert a polygon-clipping ring back into our point ring (dropping the closing duplicate). */
export function ringToPoints(ring: Ring): Point[] {
  const pts = ring.map(fromPair);
  if (pts.length > 1) {
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    if (first.x === last.x && first.y === last.y) pts.pop();
  }
  return pts;
}

/** Signed area * 2 via the shoelace formula; sign encodes winding order. */
export function signedRingArea(ring: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export function ringArea(ring: readonly Point[]): number {
  return Math.abs(signedRingArea(ring));
}

/** Total absolute area of a multipolygon expressed in polygon-clipping form. */
export function multiPolygonArea(multi: MultiPolygon): number {
  let total = 0;
  for (const poly of multi) {
    for (let r = 0; r < poly.length; r++) {
      const ring = poly[r]!.map(fromPair);
      const a = ringArea(ring);
      // First ring is the outer boundary; subsequent rings are holes.
      total += r === 0 ? a : -a;
    }
  }
  return total;
}

/** Even-odd ray cast against every ring (outer boundaries and holes alike). */
export function pointInMultiPolygon(pt: Point, multi: MultiPolygon): boolean {
  let inside = false;
  for (const poly of multi) {
    for (const ring of poly) {
      if (rayCastRing(pt, ring)) inside = !inside;
    }
  }
  return inside;
}

function rayCastRing(pt: Point, ring: Ring): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    const intersects =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** A regular polygon approximating a disk, used to bound how far a cell may reach. */
export function diskPolygon(center: Point, radius: number, segments = 48): Polygon {
  const ring: Ring = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    ring.push([center.x + Math.cos(t) * radius, center.y + Math.sin(t) * radius]);
  }
  return [ring];
}

/** A small regular polygon standing in for an island too tiny to appear in the land mask. */
export function islandGlyph(center: Point, radius: number, sides = 7): Point[] {
  const ring: Point[] = [];
  for (let i = 0; i < sides; i++) {
    const t = (i / sides) * Math.PI * 2 - Math.PI / 2;
    ring.push({ x: center.x + Math.cos(t) * radius, y: center.y + Math.sin(t) * radius });
  }
  return ring;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
