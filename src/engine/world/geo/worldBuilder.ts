import { Delaunay } from "d3-delaunay";
import type { MultiPolygon, Polygon, Ring } from "polygon-clipping";
import polygonClipping from "polygon-clipping";

import type { AreaId, RegionId } from "../../types.ts";
import type { Area, Point, Rating, Region, WorldDefinition } from "../types.ts";
import {
  distance,
  islandGlyph,
  pointInMultiPolygon,
  pointInRingPoints,
  ringArea,
  ringToPoints,
} from "./geometry.ts";

/** A single seed for a territory, already in projected 2D space. */
export interface WorldSite {
  readonly id: AreaId;
  readonly name: string;
  readonly region: RegionId;
  readonly point: Point;
  readonly terrain: number;
  readonly value: Rating;
  readonly defense: Rating;
}

/** An extra seed attached to an existing area, to shape elongated territories. */
export interface ExtraSeed {
  readonly area: AreaId;
  readonly point: Point;
}

export interface BuildWorldOptions {
  readonly id: string;
  readonly sites: readonly WorldSite[];
  readonly regions: readonly Region[];
  /** Projected land polygons; the country mesh is clipped to this for coasts. */
  readonly landMask: MultiPolygon;
  /**
   * Grid spacing of the atom mesh, in world units (degrees). Every country is a
   * union of many small mesh cells, so smaller spacing yields finer, more
   * organic borders (at the cost of a larger precomputed world).
   */
  readonly atomSpacing: number;
  /** Jitter as a fraction of spacing (0..0.5); breaks up the grid look. */
  readonly atomJitter: number;
  /** Deterministic RNG seed for the jitter. */
  readonly seed: number;
  /** Extra seeds bound to existing areas, to spread long/large countries. */
  readonly extraSeeds?: readonly ExtraSeed[];
  /** A territory whose clipped land is below this area is drawn as a glyph. */
  readonly minLandArea: number;
  readonly islandGlyphRadius: number;
  /**
   * Max distance a seed may snap to a land atom. A seed farther than this from
   * any land (a tiny, remote ocean island like Ascension) is not seeded at all
   * and is drawn as a glyph, instead of annexing a chunk of a distant mainland.
   * Defaults to `atomSpacing * 2`.
   */
  readonly maxSeedSnap?: number;
  /** Land connections forced on regardless of geometry (isthmuses, straits). */
  readonly forcedLinks?: readonly (readonly [AreaId, AreaId])[];
  /** Land connections suppressed even if geometry suggests them. */
  readonly blockedLinks?: readonly (readonly [AreaId, AreaId])[];
  readonly boundsPadding: number;
}

function linkKey(a: AreaId, b: AreaId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Small, fast, deterministic PRNG for reproducible mesh jitter. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boundsOf(mask: MultiPolygon): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of mask) {
    for (const ring of poly) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY };
}

/** A country is the union of its atoms' Voronoi cells, clipped to the coast. */
export function buildWorldFromSites(opts: BuildWorldOptions): WorldDefinition {
  const { sites, landMask, atomSpacing, atomJitter, minLandArea } = opts;
  const maxSeedSnap = opts.maxSeedSnap ?? atomSpacing * 2;

  // 1. Labeled seeds: one per site plus any hand-placed extras. Their index in
  //    `seedArea` is the country each nearby atom will be assigned to.
  const seedPoints: Point[] = [];
  const seedArea: AreaId[] = [];
  for (const s of sites) {
    seedPoints.push(s.point);
    seedArea.push(s.id);
  }
  for (const e of opts.extraSeeds ?? []) {
    seedPoints.push(e.point);
    seedArea.push(e.area);
  }

  // 2. A jittered-grid atom mesh across the land bounding box. Ocean atoms are
  //    kept so coastal cells stay local (they can't balloon across straits).
  const bb = boundsOf(landMask);
  const rand = mulberry32(opts.seed);
  const atoms: Point[] = [];
  for (let y = bb.minY - atomSpacing; y <= bb.maxY + atomSpacing; y += atomSpacing) {
    for (let x = bb.minX - atomSpacing; x <= bb.maxX + atomSpacing; x += atomSpacing) {
      const jx = (rand() - 0.5) * 2 * atomJitter * atomSpacing;
      const jy = (rand() - 0.5) * 2 * atomJitter * atomSpacing;
      atoms.push({ x: x + jx, y: y + jy });
    }
  }

  const delaunay = Delaunay.from(atoms.map((p) => [p.x, p.y] as [number, number]));
  const voronoi = delaunay.voronoi([
    bb.minX - atomSpacing * 2,
    bb.minY - atomSpacing * 2,
    bb.maxX + atomSpacing * 2,
    bb.maxY + atomSpacing * 2,
  ]);

  // 3. Classify atoms as land/ocean.
  const isLand = new Array<boolean>(atoms.length);
  for (let i = 0; i < atoms.length; i++) {
    isLand[i] = pointInMultiPolygon(atoms[i]!, landMask);
  }

  // 3a. Land-only adjacency: two land atoms are connected only when the edge
  //     between them stays on land (its midpoint is land). This forbids "hops"
  //     across straits, so assignment and adjacency can never cross water.
  const landAdj: number[][] = atoms.map(() => []);
  for (let i = 0; i < atoms.length; i++) {
    if (!isLand[i]) continue;
    for (const j of delaunay.neighbors(i)) {
      if (j <= i || !isLand[j]) continue;
      const mx = (atoms[i]!.x + atoms[j]!.x) / 2;
      const my = (atoms[i]!.y + atoms[j]!.y) / 2;
      if (!pointInMultiPolygon({ x: mx, y: my }, landMask)) continue;
      landAdj[i]!.push(j);
      landAdj[j]!.push(i);
    }
  }

  // 3b. Assign atoms to the nearest seed REACHABLE OVER LAND (multi-source
  //     Dijkstra on the land graph). Euclidean nearest would leak across water
  //     (Florida->Cuba, Greece->N.Africa); land distance cannot.
  const atomLabel = new Array<AreaId | null>(atoms.length).fill(null);
  const dist = new Array<number>(atoms.length).fill(Infinity);
  const heap = new MinHeap();
  for (let s = 0; s < seedPoints.length; s++) {
    const start = nearestLandAtom(seedPoints[s]!, atoms, isLand);
    if (start < 0) continue;
    const seedToAtom = distance(seedPoints[s]!, atoms[start]!);
    // A seed with no land within reach is a tiny remote island: leave it
    // unseeded so it falls back to a glyph instead of annexing distant land.
    if (seedToAtom > maxSeedSnap) continue;
    if (seedToAtom < dist[start]!) {
      dist[start] = seedToAtom;
      atomLabel[start] = seedArea[s]!;
      heap.push(seedToAtom, start);
    }
  }
  while (heap.size > 0) {
    const { key: d, value: i } = heap.pop()!;
    if (d > dist[i]!) continue;
    const label = atomLabel[i]!;
    for (const j of landAdj[i]!) {
      const nd = d + distance(atoms[i]!, atoms[j]!);
      if (nd < dist[j]!) {
        dist[j] = nd;
        atomLabel[j] = label;
        heap.push(nd, j);
      }
    }
  }

  // 4. Gather each country's raw Voronoi cells and atom centers.
  const cellsByArea = new Map<AreaId, Polygon[]>();
  const atomsByArea = new Map<AreaId, Point[]>();
  const coastalArea = new Set<AreaId>();
  for (let i = 0; i < atoms.length; i++) {
    if (!isLand[i]) continue;
    const area = atomLabel[i];
    if (area == null) continue; // land with no seed reachable over land
    const cell = voronoi.cellPolygon(i);
    if (!cell) continue;
    const ring = cell.map(([x, y]) => [x, y] as [number, number]) as Ring;
    (cellsByArea.get(area) ?? cellsByArea.set(area, []).get(area)!).push([ring]);
    (atomsByArea.get(area) ?? atomsByArea.set(area, []).get(area)!).push(atoms[i]!);
    // Coastal when a neighbouring atom is open ocean.
    for (const j of delaunay.neighbors(i)) {
      if (!isLand[j]) {
        coastalArea.add(area);
        break;
      }
    }
  }

  // 5. Per country: union its cells into one blob, clip to the coastline, and
  //    keep only the land pieces that actually contain one of its atoms (so a
  //    cell reaching across water never annexes the far shore).
  const areas: Area[] = [];
  let sMinX = Infinity;
  let sMinY = Infinity;
  let sMaxX = -Infinity;
  let sMaxY = -Infinity;
  const track = (p: Point): void => {
    if (p.x < sMinX) sMinX = p.x;
    if (p.y < sMinY) sMinY = p.y;
    if (p.x > sMaxX) sMaxX = p.x;
    if (p.y > sMaxY) sMaxY = p.y;
  };

  for (const site of sites) {
    const cells = cellsByArea.get(site.id) ?? [];
    const areaAtoms = atomsByArea.get(site.id) ?? [];
    let shape: Point[][];
    let isPort: boolean;

    if (cells.length === 0) {
      shape = [islandGlyph(site.point, opts.islandGlyphRadius)];
      isPort = true;
    } else {
      const blob =
        cells.length === 1
          ? polygonClipping.union(cells[0]!)
          : polygonClipping.union(cells[0]!, ...cells.slice(1));
      const clipped = polygonClipping.intersection(blob, landMask);

      const rings: Point[][] = [];
      for (const poly of clipped) {
        const outer = ringToPoints(poly[0]!);
        if (outer.length < 3) continue;
        if (ringArea(outer) < minLandArea * 0.05) continue; // drop slivers
        const holdsAtom = areaAtoms.some((p) => pointInRingPoints(p, outer));
        if (holdsAtom) rings.push(outer);
      }

      const total = rings.reduce((sum, r) => sum + ringArea(r), 0);
      if (rings.length === 0 || total < minLandArea) {
        shape = [islandGlyph(site.point, opts.islandGlyphRadius)];
        isPort = true;
      } else {
        shape = rings;
        isPort = coastalArea.has(site.id);
      }
    }

    for (const ring of shape) for (const p of ring) track(p);
    track(site.point);

    areas.push({
      id: site.id,
      name: site.name,
      region: site.region,
      terrain: site.terrain,
      value: site.value,
      defense: site.defense,
      isPort,
      shape,
      labelAnchor: site.point,
    });
  }

  const adjacency = buildAdjacency(landAdj, atomLabel, opts);

  const pad = opts.boundsPadding;
  return {
    id: opts.id,
    regions: opts.regions,
    areas,
    adjacency,
    bounds: {
      minX: sMinX - pad,
      minY: sMinY - pad,
      maxX: sMaxX + pad,
      maxY: sMaxY + pad,
    },
  };
}

/**
 * Two countries are neighbours when land atoms of each are joined by a land edge
 * (from `landAdj`, which already excludes water crossings), plus any forced
 * links for isthmuses and the manual's special sea crossings.
 */
function buildAdjacency(
  landAdj: readonly number[][],
  atomLabel: readonly (AreaId | null)[],
  opts: BuildWorldOptions,
): ReadonlyMap<AreaId, readonly AreaId[]> {
  const blocked = new Set((opts.blockedLinks ?? []).map(([a, b]) => linkKey(a, b)));
  const links = new Set<string>();
  const neighbors = new Map<AreaId, Set<AreaId>>();
  for (const s of opts.sites) neighbors.set(s.id, new Set());

  const connect = (a: AreaId, b: AreaId): void => {
    if (a === b) return;
    const key = linkKey(a, b);
    if (blocked.has(key) || links.has(key)) return;
    if (!neighbors.has(a) || !neighbors.has(b)) return;
    links.add(key);
    neighbors.get(a)!.add(b);
    neighbors.get(b)!.add(a);
  };

  for (let i = 0; i < landAdj.length; i++) {
    const la = atomLabel[i];
    if (la == null) continue;
    for (const j of landAdj[i]!) {
      if (j <= i) continue;
      const lb = atomLabel[j];
      if (lb == null || lb === la) continue;
      connect(la, lb);
    }
  }

  for (const [a, b] of opts.forcedLinks ?? []) connect(a, b);

  const result = new Map<AreaId, readonly AreaId[]>();
  for (const [id, set] of neighbors) {
    result.set(
      id,
      [...set].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)),
    );
  }
  return result;
}

/** Index of the nearest land atom to a point (Euclidean), or -1 if none. */
function nearestLandAtom(
  p: Point,
  atoms: readonly Point[],
  isLand: readonly boolean[],
): number {
  let best = Infinity;
  let bestIdx = -1;
  for (let i = 0; i < atoms.length; i++) {
    if (!isLand[i]) continue;
    const dx = p.x - atoms[i]!.x;
    const dy = p.y - atoms[i]!.y;
    const d = dx * dx + dy * dy;
    if (d < best) {
      best = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Minimal binary min-heap keyed by number, for Dijkstra. */
class MinHeap {
  private readonly keys: number[] = [];
  private readonly vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, value: number): void {
    this.keys.push(key);
    this.vals.push(value);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= this.keys[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { key: number; value: number } | null {
    if (this.keys.length === 0) return null;
    const key = this.keys[0]!;
    const value = this.vals[0]!;
    const lastKey = this.keys.pop()!;
    const lastVal = this.vals.pop()!;
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.vals[0] = lastVal;
      this.siftDown(0);
    }
    return { key, value };
  }

  private siftDown(start: number): void {
    const n = this.keys.length;
    let i = start;
    for (;;) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let smallest = i;
      if (l < n && this.keys[l]! < this.keys[smallest]!) smallest = l;
      if (r < n && this.keys[r]! < this.keys[smallest]!) smallest = r;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }

  private swap(a: number, b: number): void {
    const k = this.keys[a]!;
    this.keys[a] = this.keys[b]!;
    this.keys[b] = k;
    const v = this.vals[a]!;
    this.vals[a] = this.vals[b]!;
    this.vals[b] = v;
  }
}
