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

/** Even-odd ray cast against a single ring expressed as points. */
export function pointInRingPoints(pt: Point, ring: readonly Point[]): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const intersects =
      a.y > pt.y !== b.y > pt.y &&
      pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function centroid(ring: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / ring.length, y: y / ring.length };
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

/** Distance from a point to the nearest vertex of a ring. */
export function minVertexDistance(p: Point, ring: readonly Point[]): number {
  let best = Infinity;
  for (const v of ring) {
    const d = distance(p, v);
    if (d < best) best = d;
  }
  return best;
}

// --- Organic border roughening -------------------------------------------
//
// Voronoi cell edges are perfectly straight, which makes inland borders look
// artificial. We fix this with a deterministic domain-warp: every vertex is
// displaced by a smooth value-noise field that depends ONLY on its position.
// Because two neighbouring territories share an edge with identical endpoints,
// subdividing that edge into the same number of steps and warping each point by
// a position-only field yields the exact same wobbly curve on both sides, so
// borders stay perfectly aligned with no gaps or overlaps.

/** 32-bit integer hash of a lattice corner mapped to [-1, 1]. */
function hashLattice(ix: number, iy: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  h ^= h >>> 16;
  return (h >>> 0) / 2147483647.5 - 1;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Smooth 2D value noise in [-1, 1]. */
function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);
  const n00 = hashLattice(x0, y0);
  const n10 = hashLattice(x0 + 1, y0);
  const n01 = hashLattice(x0, y0 + 1);
  const n11 = hashLattice(x0 + 1, y0 + 1);
  const nx0 = n00 + (n10 - n00) * fx;
  const nx1 = n01 + (n11 - n01) * fx;
  return nx0 + (nx1 - nx0) * fy;
}

/** Fractal (multi-octave) value noise for richer, non-repetitive detail. */
function fbm(x: number, y: number): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < 3; o++) {
    sum += amp * valueNoise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

export interface WarpOptions {
  /** Maximum displacement of a point, in world units. */
  readonly amplitude: number;
  /** Spatial frequency of the wobble (higher = tighter waves). */
  readonly frequency: number;
}

/** Displace a point by a smooth, position-only noise field. */
export function warpPoint(p: Point, opts: WarpOptions): Point {
  const dx = fbm(p.x * opts.frequency, p.y * opts.frequency);
  const dy = fbm(p.x * opts.frequency + 41.7, p.y * opts.frequency - 17.3);
  return { x: p.x + dx * opts.amplitude, y: p.y + dy * opts.amplitude };
}

/**
 * Roughen only the INLAND edges of a territory ring, leaving real coastline
 * edges crisp. An edge is inland when land lies on both of its sides; such an
 * edge is subdivided and its interior points warped by the position-only field.
 * Edge endpoints (the tripoints where borders meet) are never moved, so an
 * inland edge and an adjacent coastal edge keep sharing an exact vertex.
 *
 * Consistency: a shared inland edge has identical endpoints, length and
 * classification in both neighbours, and the warp is a pure function of world
 * position, so both sides produce the very same wobbly curve — no gaps.
 */
export function roughenRing(
  ring: readonly Point[],
  segLength: number,
  warp: WarpOptions,
  isLand: (p: Point) => boolean,
  sideProbe: number,
): Point[] {
  const n = ring.length;
  if (n < 3) return ring.slice();
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % n]!;
    out.push(a);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const nx = -dy / len;
    const ny = dx / len;
    const mx = a.x + dx * 0.5;
    const my = a.y + dy * 0.5;
    const landLeft = isLand({ x: mx + nx * sideProbe, y: my + ny * sideProbe });
    const landRight = isLand({ x: mx - nx * sideProbe, y: my - ny * sideProbe });
    if (!landLeft || !landRight) continue; // coastal edge: keep it crisp
    const segs = Math.max(2, Math.round(len / segLength));
    for (let k = 1; k < segs; k++) {
      const t = k / segs;
      out.push(warpPoint({ x: a.x + dx * t, y: a.y + dy * t }, warp));
    }
  }
  return out;
}
