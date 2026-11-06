import { Delaunay } from "d3-delaunay";
import type { MultiPolygon, Polygon } from "polygon-clipping";
import polygonClipping from "polygon-clipping";

import type { AreaId } from "../../types.ts";
import type { Area, Point, Region, WorldDefinition } from "../types.ts";
import { distance, islandGlyph, pointInRingPoints, ringArea, ringToPoints } from "./geometry.ts";
import type { ExtraSeed, WorldSite } from "./worldBuilder.ts";
import { MinHeap } from "./worldBuilder.ts";

/**
 * Builds a world from real country borders.
 *
 * Every territory names the modern countries it may cover. A country used by
 * one territory goes to it whole, with its true borders and coast. A country
 * shared by several territories (France, the USA, India, Russia...) is split
 * between them by straight lines between their seeds, like state or province
 * lines, so the outer borders stay real and the inner ones stay clean.
 *
 * Which territory reaches which country piece is decided on a fine mesh of
 * "atoms" by a land-only flood fill from each territory's seeds, so a
 * territory never jumps a strait to claim land, and it never enters a country
 * reserved for others. Small islands with no atom go to the nearest territory
 * allowed to own them. Land nobody may own (Greenland, New Zealand...) is kept
 * as neutral scenery.
 *
 * Land adjacency and ports are read off the finished shapes: two territories
 * touch when they share a stretch of border, and a territory is a port when a
 * stretch of its outline is coast.
 */

/** One polygon of a country (a mainland or an island), already projected. */
export interface CountryPart {
  readonly country: string;
  /** Outer ring first, then holes, in polygon-clipping form. */
  readonly poly: Polygon;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface CountrySite extends WorldSite {
  /** Countries this territory may cover. Omitted: only countries nobody reserved. */
  readonly countries?: readonly string[];
  /** Force the port flag when geography alone gets it wrong. */
  readonly port?: boolean;
}

export interface BuildFromCountriesOptions {
  readonly id: string;
  readonly sites: readonly CountrySite[];
  readonly regions: readonly Region[];
  readonly parts: readonly CountryPart[];
  /** Land that is always scenery, never a territory (ice caps, far islands). */
  readonly decor: readonly (readonly Point[])[];
  readonly atomSpacing: number;
  readonly atomJitter: number;
  readonly seed: number;
  readonly extraSeeds?: readonly ExtraSeed[];
  /** A territory with less land than this is drawn as a small island glyph. */
  readonly minLandArea: number;
  readonly islandGlyphRadius: number;
  /** How far (world units) an atom-less island may be from the territory that takes it. */
  readonly islandReach: number;
  /** Island rings smaller than this are dropped from shapes. */
  readonly minRingArea: number;
  /** A territory needs at least this much coastline (world units) to be a port. */
  readonly minCoast: number;
  /** Two territories need this much shared border (world units) to be neighbours. */
  readonly minBorder: number;
  /** Douglas-Peucker tolerance applied to borders, keeping neighbours watertight. */
  readonly simplify: number;
  readonly forcedLinks?: readonly (readonly [AreaId, AreaId])[];
  readonly blockedLinks?: readonly (readonly [AreaId, AreaId])[];
  readonly boundsPadding: number;
}

export interface CountryWorld extends WorldDefinition {
  readonly decor: readonly (readonly Point[])[];
}

/** Small deterministic PRNG for the mesh jitter. */
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

function inPolygon(x: number, y: number, poly: Polygon): boolean {
  let inside = false;
  for (const ring of poly) {
    const n = ring.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[i]![0];
      const yi = ring[i]![1];
      const xj = ring[j]![0];
      const yj = ring[j]![1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Grid index over part bounding boxes, for fast "which country is this point in". */
class PartIndex {
  private readonly cells = new Map<string, number[]>();
  constructor(
    private readonly parts: readonly CountryPart[],
    private readonly size = 2,
  ) {
    parts.forEach((p, i) => {
      for (let gx = Math.floor(p.minX / size); gx <= Math.floor(p.maxX / size); gx++) {
        for (let gy = Math.floor(p.minY / size); gy <= Math.floor(p.maxY / size); gy++) {
          const k = `${gx},${gy}`;
          (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(i);
        }
      }
    });
  }

  find(x: number, y: number): number {
    const list = this.cells.get(`${Math.floor(x / this.size)},${Math.floor(y / this.size)}`);
    if (!list) return -1;
    for (const i of list) {
      const p = this.parts[i]!;
      if (x < p.minX || x > p.maxX || y < p.minY || y > p.maxY) continue;
      if (inPolygon(x, y, p.poly)) return i;
    }
    return -1;
  }
}

function linkKey(a: AreaId, b: AreaId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function segDist(px: number, py: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

export function buildWorldFromCountries(opts: BuildFromCountriesOptions): CountryWorld {
  const { sites, parts, atomSpacing } = opts;
  const index = new PartIndex(parts);

  // Countries named by any territory are reserved for the territories naming them.
  const reserved = new Set<string>();
  const allowedBy = new Map<AreaId, Set<string>>();
  for (const s of sites) {
    const set = new Set(s.countries ?? []);
    allowedBy.set(s.id, set);
    for (const c of set) reserved.add(c);
  }
  const allowed = (area: AreaId, country: string): boolean =>
    !reserved.has(country) || allowedBy.get(area)!.has(country);

  // 1. Seeds.
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

  // 2. Jittered atom mesh over the land.
  let bbMinX = Infinity;
  let bbMinY = Infinity;
  let bbMaxX = -Infinity;
  let bbMaxY = -Infinity;
  for (const p of parts) {
    bbMinX = Math.min(bbMinX, p.minX);
    bbMinY = Math.min(bbMinY, p.minY);
    bbMaxX = Math.max(bbMaxX, p.maxX);
    bbMaxY = Math.max(bbMaxY, p.maxY);
  }
  const rand = mulberry32(opts.seed);
  const atoms: Point[] = [];
  for (let y = bbMinY - atomSpacing; y <= bbMaxY + atomSpacing; y += atomSpacing) {
    for (let x = bbMinX - atomSpacing; x <= bbMaxX + atomSpacing; x += atomSpacing) {
      const jx = (rand() - 0.5) * 2 * opts.atomJitter * atomSpacing;
      const jy = (rand() - 0.5) * 2 * opts.atomJitter * atomSpacing;
      atoms.push({ x: x + jx, y: y + jy });
    }
  }
  const partOf = atoms.map((a) => index.find(a.x, a.y));
  const delaunay = Delaunay.from(atoms.map((p) => [p.x, p.y] as [number, number]));

  // Land edges: both ends on land and the midpoint too, so no edge hops water.
  const landAdj: number[][] = atoms.map(() => []);
  for (let i = 0; i < atoms.length; i++) {
    if (partOf[i]! < 0) continue;
    for (const j of delaunay.neighbors(i)) {
      if (j <= i || partOf[j]! < 0) continue;
      const mx = (atoms[i]!.x + atoms[j]!.x) / 2;
      const my = (atoms[i]!.y + atoms[j]!.y) / 2;
      if (index.find(mx, my) < 0) continue;
      landAdj[i]!.push(j);
      landAdj[j]!.push(i);
    }
  }

  // 3. Flood fill from the seeds over land, never into a country the
  //    territory may not own. Later passes pick up land the first could not reach.
  const label = new Array<AreaId | null>(atoms.length).fill(null);
  const dist = new Array<number>(atoms.length).fill(Infinity);
  const flood = (constrained: boolean, graph: readonly (readonly number[])[]): void => {
    const heap = new MinHeap();
    if (constrained && graph === landAdj) {
      for (let s = 0; s < seedPoints.length; s++) {
        const p = seedPoints[s]!;
        let best = -1;
        let bestD = atomSpacing * 2;
        for (let i = 0; i < atoms.length; i++) {
          if (partOf[i]! < 0 || !allowed(seedArea[s]!, parts[partOf[i]!]!.country)) continue;
          const d = distance(p, atoms[i]!);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
        if (best < 0 || bestD >= dist[best]!) continue;
        dist[best] = bestD;
        label[best] = seedArea[s]!;
        heap.push(bestD, best);
      }
    } else {
      for (let i = 0; i < atoms.length; i++) if (label[i] !== null) heap.push(dist[i]!, i);
    }
    while (heap.size > 0) {
      const { key: d, value: i } = heap.pop()!;
      if (d > dist[i]!) continue;
      const l = label[i]!;
      for (const j of graph[i]!) {
        if (constrained && !allowed(l, parts[partOf[j]!]!.country)) continue;
        if (graph !== landAdj && label[j] !== null) continue;
        if (!constrained && label[j] !== null) continue;
        const nd = d + distance(atoms[i]!, atoms[j]!);
        if (nd < dist[j]!) {
          dist[j] = nd;
          label[j] = l;
          heap.push(nd, j);
        }
      }
    }
  };
  // Land cut off by a lagoon or a too-narrow neck: first try any nearby atom
  // allowed to own it, only then anyone.
  const nearAdj: number[][] = atoms.map((_, i) =>
    partOf[i]! < 0 ? [] : [...delaunay.neighbors(i)].filter((j) => partOf[j]! >= 0),
  );
  flood(true, landAdj);
  flood(true, nearAdj);
  // Still cut off (a fjord-cut panhandle): nearest atom allowed to own it.
  const lab0: number[] = [];
  for (let i = 0; i < atoms.length; i++) if (label[i] !== null) lab0.push(i);
  for (let i = 0; i < atoms.length; i++) {
    if (partOf[i]! < 0 || label[i] !== null) continue;
    const country = parts[partOf[i]!]!.country;
    if (!reserved.has(country)) continue;
    let best = -1;
    let bestD = 4;
    for (const j of lab0) {
      if (!allowed(label[j]!, country)) continue;
      const d = distance(atoms[i]!, atoms[j]!);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best >= 0) {
      label[i] = label[best]!;
      dist[i] = dist[best]! + bestD;
    }
  }
  flood(false, landAdj);

  // 4. Who owns each country part.
  // A territory with only a stray atom or two in a part (cut off behind a
  // lagoon or a border wiggle) does not get a share of it.
  const counts = parts.map(() => new Map<AreaId, number>());
  for (let i = 0; i < atoms.length; i++) {
    const l = label[i];
    if (l != null && partOf[i]! >= 0) {
      const c = counts[partOf[i]!]!;
      c.set(l, (c.get(l) ?? 0) + 1);
    }
  }
  const owners = counts.map((c) => {
    let total = 0;
    for (const n of c.values()) total += n;
    const own = new Set<AreaId>();
    for (const [a, n] of c) if (n >= Math.min(5, total) && n >= total * 0.05) own.add(a);
    if (own.size === 0 && total > 0) own.add([...c].sort((x, y) => y[1] - x[1])[0]![0]);
    return own;
  });
  const labelled: number[] = [];
  for (let i = 0; i < atoms.length; i++) if (label[i] !== null) labelled.push(i);

  const pieces = new Map<AreaId, Polygon[]>();
  const addPiece = (area: AreaId, poly: Polygon): void => {
    (pieces.get(area) ?? pieces.set(area, []).get(area)!).push(poly);
  };
  const decor: Point[][] = opts.decor.map((r) => [...r]);

  parts.forEach((part, pi) => {
    const own = owners[pi]!;
    if (own.size === 0) {
      // An island too small for an atom: a seed on it, else the nearest
      // territory allowed to own it, else scenery.
      const outer = part.poly[0]!;
      const cx = (part.minX + part.maxX) / 2;
      const cy = (part.minY + part.maxY) / 2;
      let pick: AreaId | null = null;
      let bestD = Infinity;
      for (let s = 0; s < seedPoints.length; s++) {
        const p = seedPoints[s]!;
        if (!allowed(seedArea[s]!, part.country)) continue;
        // Distance from the seed to the island's bounding box.
        const dx = Math.max(part.minX - p.x, 0, p.x - part.maxX);
        const dy = Math.max(part.minY - p.y, 0, p.y - part.maxY);
        const d = Math.hypot(dx, dy);
        if (d < 1.5 && d < bestD) {
          bestD = d;
          pick = seedArea[s]!;
        }
      }
      if (pick === null) {
        bestD = opts.islandReach;
        for (const i of labelled) {
          const l = label[i]!;
          if (!allowed(l, part.country)) continue;
          const d = Math.hypot(atoms[i]!.x - cx, atoms[i]!.y - cy);
          if (d < bestD) {
            bestD = d;
            pick = l;
          }
        }
      }
      if (pick !== null) addPiece(pick, part.poly);
      else decor.push(ringToPoints(outer));
      return;
    }
    if (own.size === 1) {
      addPiece([...own][0]!, part.poly);
      return;
    }
    // Shared: straight lines between the owners' seeds.
    const pts: Point[] = [];
    const who: AreaId[] = [];
    for (let s = 0; s < seedPoints.length; s++) {
      if (!own.has(seedArea[s]!)) continue;
      pts.push(seedPoints[s]!);
      who.push(seedArea[s]!);
    }
    const vor = Delaunay.from(pts.map((p) => [p.x, p.y] as [number, number])).voronoi([
      Math.min(part.minX, ...pts.map((p) => p.x)) - 5,
      Math.min(part.minY, ...pts.map((p) => p.y)) - 5,
      Math.max(part.maxX, ...pts.map((p) => p.x)) + 5,
      Math.max(part.maxY, ...pts.map((p) => p.y)) + 5,
    ]);
    const cells = new Map<AreaId, Polygon[]>();
    who.forEach((a, k) => {
      const cell = vor.cellPolygon(k);
      if (!cell) return;
      (cells.get(a) ?? cells.set(a, []).get(a)!).push([cell.map(([x, y]) => [x, y] as [number, number])]);
    });
    for (const [a, cs] of cells) {
      const blob = polygonClipping.union(cs[0]!, ...cs.slice(1));
      for (const poly of polygonClipping.intersection(blob, part.poly)) addPiece(a, poly);
    }
  });

  // 5. Assemble each territory: union its pieces, keep outer rings.
  const rings = new Map<AreaId, Point[][]>();
  for (const s of sites) {
    const ps = pieces.get(s.id) ?? [];
    let out: Point[][] = [];
    if (ps.length > 0) {
      const merged: MultiPolygon = polygonClipping.union(ps[0]!, ...ps.slice(1));
      for (const poly of merged) {
        const outer = ringToPoints(poly[0]!);
        if (outer.length >= 3 && ringArea(outer) >= opts.minRingArea) out.push(outer);
        for (const hole of poly.slice(1)) {
          const h = ringToPoints(hole);
          if (ringArea(h) > 0.05) console.warn(`${s.name}: hole of ${ringArea(h).toFixed(2)} dropped`);
        }
      }
    }
    rings.set(s.id, out);
  }

  // 6. Borders and coasts, read from the shared outlines.
  const segs: { area: AreaId; a: Point; b: Point }[] = [];
  for (const [area, rs] of rings) {
    for (const r of rs) {
      for (let i = 0; i < r.length; i++) segs.push({ area, a: r[i]!, b: r[(i + 1) % r.length]! });
    }
  }
  const cell = 1;
  const grid = new Map<string, number[]>();
  segs.forEach((s, k) => {
    const x0 = Math.floor(Math.min(s.a.x, s.b.x) / cell);
    const x1 = Math.floor(Math.max(s.a.x, s.b.x) / cell);
    const y0 = Math.floor(Math.min(s.a.y, s.b.y) / cell);
    const y1 = Math.floor(Math.max(s.a.y, s.b.y) / cell);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const key = `${gx},${gy}`;
        (grid.get(key) ?? grid.set(key, []).get(key)!).push(k);
      }
    }
  });
  const shared = new Map<string, number>();
  const coast = new Map<AreaId, number>();
  const EPS = 1e-6;
  segs.forEach((s, sk) => {
    const len = distance(s.a, s.b);
    if (len === 0) return;
    const ux = (s.b.x - s.a.x) / len;
    const uy = (s.b.y - s.a.y) / len;
    // Every other territory's segment lying on this one, and how much of it.
    const seen = new Set<number>([sk]);
    const covered: [number, number][] = [];
    const x0 = Math.floor(Math.min(s.a.x, s.b.x) / cell);
    const x1 = Math.floor(Math.max(s.a.x, s.b.x) / cell);
    const y0 = Math.floor(Math.min(s.a.y, s.b.y) / cell);
    const y1 = Math.floor(Math.max(s.a.y, s.b.y) / cell);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        for (const k of grid.get(`${gx},${gy}`) ?? []) {
          if (seen.has(k)) continue;
          seen.add(k);
          const t = segs[k]!;
          if (t.area === s.area) continue;
          if (segDist(t.a.x, t.a.y, s.a, s.b) > EPS && segDist(s.a.x, s.a.y, t.a, t.b) > EPS) continue;
          // Collinear within tolerance?
          const off = (p: Point): number => Math.abs((p.x - s.a.x) * uy - (p.y - s.a.y) * ux);
          if (off(t.a) > EPS || off(t.b) > EPS) continue;
          const ta = (t.a.x - s.a.x) * ux + (t.a.y - s.a.y) * uy;
          const tb = (t.b.x - s.a.x) * ux + (t.b.y - s.a.y) * uy;
          const lo = Math.max(0, Math.min(ta, tb));
          const hi = Math.min(len, Math.max(ta, tb));
          if (hi - lo <= EPS) continue;
          covered.push([lo, hi]);
          const key = linkKey(s.area, t.area);
          shared.set(key, (shared.get(key) ?? 0) + (hi - lo) / 2);
        }
      }
    }
    covered.sort((p, q) => p[0] - q[0]);
    let used = 0;
    let end = 0;
    for (const [lo, hi] of covered) {
      if (hi <= end) continue;
      used += hi - Math.max(lo, end);
      end = hi;
    }
    if (len - used > EPS) coast.set(s.area, (coast.get(s.area) ?? 0) + (len - used));
  });

  // 7. Simplify outlines chain by chain, so a border shared by two
  //    territories is simplified identically on both sides.
  const sharedVertex = vertexOwners(rings);
  for (const [area, rs] of rings) {
    rings.set(
      area,
      rs.map((r) => simplifyRing(r, opts.simplify, sharedVertex)).filter((r) => r.length >= 3),
    );
  }

  // 8. Areas.
  const areas: Area[] = [];
  let sMinX = Infinity;
  let sMinY = Infinity;
  let sMaxX = -Infinity;
  let sMaxY = -Infinity;
  const track = (p: Point): void => {
    sMinX = Math.min(sMinX, p.x);
    sMinY = Math.min(sMinY, p.y);
    sMaxX = Math.max(sMaxX, p.x);
    sMaxY = Math.max(sMaxY, p.y);
  };
  const glyph = new Set<AreaId>();
  for (const s of sites) {
    let shape = rings.get(s.id)!;
    let isPort = (coast.get(s.id) ?? 0) >= opts.minCoast;
    const total = shape.reduce((sum, r) => sum + ringArea(r), 0);
    if (total < opts.minLandArea) {
      shape = [islandGlyph(s.point, opts.islandGlyphRadius)];
      isPort = true;
      glyph.add(s.id);
    }
    if (s.port !== undefined) isPort = s.port;
    for (const r of shape) for (const p of r) track(p);
    areas.push({
      id: s.id,
      name: s.name,
      region: s.region,
      terrain: s.terrain,
      value: s.value,
      defense: s.defense,
      isPort,
      shape,
      labelAnchor: labelPoint(shape, s.point),
    });
  }

  // 9. Adjacency.
  const blocked = new Set((opts.blockedLinks ?? []).map(([a, b]) => linkKey(a, b)));
  const neighbors = new Map<AreaId, Set<AreaId>>(sites.map((s) => [s.id, new Set<AreaId>()]));
  const connect = (a: AreaId, b: AreaId): void => {
    if (a === b || blocked.has(linkKey(a, b))) return;
    if (!neighbors.has(a) || !neighbors.has(b)) return;
    neighbors.get(a)!.add(b);
    neighbors.get(b)!.add(a);
  };
  for (const [key, len] of shared) {
    if (len < opts.minBorder) continue;
    const [a, b] = key.split("|").map((x) => Number(x) as AreaId) as [AreaId, AreaId];
    if (glyph.has(a) || glyph.has(b)) continue;
    connect(a, b);
  }
  for (const [a, b] of opts.forcedLinks ?? []) connect(a, b);
  const adjacency = new Map<AreaId, readonly AreaId[]>();
  for (const [id, set] of neighbors) adjacency.set(id, [...set].sort((x, y) => x - y));

  const pad = opts.boundsPadding;
  return {
    id: opts.id,
    regions: opts.regions,
    areas,
    adjacency,
    bounds: { minX: sMinX - pad, minY: sMinY - pad, maxX: sMaxX + pad, maxY: sMaxY + pad },
    decor: decor
      .map((r) => simplifyRing(r, opts.simplify, new Map()))
      .filter((r) => r.length >= 3 && ringArea(r) >= opts.minRingArea),
  };
}

function vkey(p: Point): string {
  return `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
}

/** For every vertex, which territories' outlines pass through it. */
function vertexOwners(rings: ReadonlyMap<AreaId, Point[][]>): Map<string, Set<AreaId>> {
  const m = new Map<string, Set<AreaId>>();
  for (const [area, rs] of rings) {
    for (const r of rs) {
      for (const p of r) {
        const k = vkey(p);
        (m.get(k) ?? m.set(k, new Set()).get(k)!).add(area);
      }
    }
  }
  return m;
}

function sameSet(a: Set<AreaId> | undefined, b: Set<AreaId> | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * Douglas-Peucker on a closed ring, cut into chains at every vertex where the
 * set of territories sharing the outline changes. Chain ends never move, so
 * both sides of a shared border end up with the same simplified line.
 */
function simplifyRing(ring: readonly Point[], tol: number, owners: Map<string, Set<AreaId>>): Point[] {
  const n = ring.length;
  if (n < 4 || tol <= 0) return [...ring];
  const own = ring.map((p) => owners.get(vkey(p)));
  const keep = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    const prev = own[(i - 1 + n) % n];
    const next = own[(i + 1) % n];
    if (!sameSet(prev, own[i]) || !sameSet(next, own[i]) || (own[i]?.size ?? 0) > 2) keep[i] = true;
  }
  if (!keep.some(Boolean)) {
    // A lone island: anchor on two far-apart points.
    keep[0] = true;
    keep[Math.floor(n / 2)] = true;
  }
  const anchors: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) anchors.push(i);
  const out = new Array<boolean>(n).fill(false);
  for (const i of anchors) out[i] = true;
  for (let k = 0; k < anchors.length; k++) {
    const a = anchors[k]!;
    const b = anchors[(k + 1) % anchors.length]!;
    const idx: number[] = [];
    for (let i = a; ; i = (i + 1) % n) {
      idx.push(i);
      if (i === b && idx.length > 1) break;
      if (idx.length > n + 1) break;
    }
    dp(ring, idx, 0, idx.length - 1, tol, out);
  }
  return ring.filter((_, i) => out[i]);
}

function dp(ring: readonly Point[], idx: readonly number[], lo: number, hi: number, tol: number, out: boolean[]): void {
  if (hi <= lo + 1) return;
  const a = ring[idx[lo]!]!;
  const b = ring[idx[hi]!]!;
  let best = -1;
  let bestD = tol;
  for (let k = lo + 1; k < hi; k++) {
    const p = ring[idx[k]!]!;
    const d = segDist(p.x, p.y, a, b);
    if (d > bestD) {
      bestD = d;
      best = k;
    }
  }
  if (best < 0) return;
  out[idx[best]!] = true;
  dp(ring, idx, lo, best, tol, out);
  dp(ring, idx, best, hi, tol, out);
}

/**
 * Where the name and markers go: the seed when it sits well inside the
 * territory, otherwise the most open point of its largest ring.
 */
function labelPoint(shape: readonly (readonly Point[])[], seed: Point): Point {
  let largest: readonly Point[] | null = null;
  for (const r of shape) if (!largest || ringArea(r) > ringArea(largest)) largest = r;
  if (!largest) return seed;
  const edgeDist = (x: number, y: number): number => {
    let d = Infinity;
    for (let i = 0; i < largest!.length; i++) {
      d = Math.min(d, segDist(x, y, largest![i]!, largest![(i + 1) % largest!.length]!));
    }
    return d;
  };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of largest) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const span = Math.max(maxX - minX, maxY - minY);
  const seedInside = shape.some((r) => pointInRingPoints(seed, r));
  if (seedInside && edgeDist(seed.x, seed.y) > Math.min(1.2, span * 0.12)) return seed;
  // Grid search for the point farthest from the edge, nudged toward the seed.
  let best = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  let bestScore = -Infinity;
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const x = minX + ((maxX - minX) * i) / steps;
      const y = minY + ((maxY - minY) * j) / steps;
      if (!pointInRingPoints({ x, y }, largest)) continue;
      const score = edgeDist(x, y) - 0.05 * Math.hypot(x - seed.x, y - seed.y);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}
