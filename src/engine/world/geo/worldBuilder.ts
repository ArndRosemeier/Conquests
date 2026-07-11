import { Delaunay } from "d3-delaunay";
import type { MultiPolygon, Polygon } from "polygon-clipping";
import polygonClipping from "polygon-clipping";

import type { AreaId, RegionId } from "../../types.ts";
import type { Area, Point, Rating, Region, WorldDefinition } from "../types.ts";
import {
  diskPolygon,
  islandGlyph,
  midpoint,
  multiPolygonArea,
  pointInMultiPolygon,
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

export interface BuildWorldOptions {
  readonly id: string;
  readonly sites: readonly WorldSite[];
  readonly regions: readonly Region[];
  /** Projected land polygons; cells are clipped to this to form coastlines. */
  readonly landMask: MultiPolygon;
  /** Maximum reach of a territory from its site, in world units. */
  readonly cellRadius: number;
  /** Clipped land area below which an area is drawn as a small island glyph. */
  readonly minLandArea: number;
  readonly islandGlyphRadius: number;
  /** Radius of the local disk sampled around a site to decide if it is coastal. */
  readonly portProbeRadius: number;
  /** An inland area keeps at least this fraction of its local probe disk as land. */
  readonly portLandFraction: number;
  /** Land connections forced on regardless of geometry (isthmuses, straits). */
  readonly forcedLinks?: readonly (readonly [AreaId, AreaId])[];
  /** Land connections suppressed even if geometry suggests them. */
  readonly blockedLinks?: readonly (readonly [AreaId, AreaId])[];
  readonly boundsPadding: number;
}

function linkKey(a: AreaId, b: AreaId): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** A site is a port when open ocean intrudes into a small local disk around it. */
function isCoastal(
  site: Point,
  landMask: MultiPolygon,
  opts: BuildWorldOptions,
): boolean {
  const disk = diskPolygon(site, opts.portProbeRadius);
  const diskArea = ringArea(disk[0]!.map(([x, y]) => ({ x, y })));
  const landInDisk = multiPolygonArea(polygonClipping.intersection(disk, landMask));
  return landInDisk < diskArea * opts.portLandFraction;
}

export function buildWorldFromSites(opts: BuildWorldOptions): WorldDefinition {
  const { sites, landMask, cellRadius } = opts;
  const coords: [number, number][] = sites.map((s) => [s.point.x, s.point.y]);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const delaunay = Delaunay.from(coords);
  const voronoi = delaunay.voronoi([
    minX - cellRadius,
    minY - cellRadius,
    maxX + cellRadius,
    maxY + cellRadius,
  ]);

  const areas: Area[] = [];
  let shapeMinX = Infinity;
  let shapeMinY = Infinity;
  let shapeMaxX = -Infinity;
  let shapeMaxY = -Infinity;

  const trackBounds = (p: Point): void => {
    if (p.x < shapeMinX) shapeMinX = p.x;
    if (p.y < shapeMinY) shapeMinY = p.y;
    if (p.x > shapeMaxX) shapeMaxX = p.x;
    if (p.y > shapeMaxY) shapeMaxY = p.y;
  };

  for (let i = 0; i < sites.length; i++) {
    const site = sites[i]!;
    const cell = voronoi.cellPolygon(i);
    let shape: Point[][];
    let isPort: boolean;

    if (!cell) {
      shape = [islandGlyph(site.point, opts.islandGlyphRadius)];
      isPort = true;
    } else {
      const cellPoly: Polygon = [cell.map(([x, y]) => [x, y] as [number, number])];
      const landClip = polygonClipping.intersection(cellPoly, landMask);
      const landArea = multiPolygonArea(landClip);

      if (landArea < opts.minLandArea) {
        shape = [islandGlyph(site.point, opts.islandGlyphRadius)];
        isPort = true;
      } else {
        const bounded: MultiPolygon = polygonClipping.intersection(
          landClip,
          diskPolygon(site.point, cellRadius),
        );
        shape = bounded
          .map((poly) => ringToPoints(poly[0]!))
          .filter((ring) => ring.length >= 3);
        if (shape.length === 0) {
          // The site's own cell has no land within reach: it sits in open water.
          shape = [islandGlyph(site.point, opts.islandGlyphRadius)];
          isPort = true;
        } else {
          isPort = isCoastal(site.point, landMask, opts);
        }
      }
    }

    for (const ring of shape) for (const p of ring) trackBounds(p);
    trackBounds(site.point);

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

  const adjacency = buildAdjacency(sites, delaunay, opts);

  const pad = opts.boundsPadding;
  return {
    id: opts.id,
    regions: opts.regions,
    areas,
    adjacency,
    bounds: {
      minX: shapeMinX - pad,
      minY: shapeMinY - pad,
      maxX: shapeMaxX + pad,
      maxY: shapeMaxY + pad,
    },
  };
}

function buildAdjacency(
  sites: readonly WorldSite[],
  delaunay: Delaunay<[number, number]>,
  opts: BuildWorldOptions,
): ReadonlyMap<AreaId, readonly AreaId[]> {
  const blocked = new Set((opts.blockedLinks ?? []).map(([a, b]) => linkKey(a, b)));
  const links = new Set<string>();
  const neighbors = new Map<AreaId, Set<AreaId>>();
  for (const s of sites) neighbors.set(s.id, new Set());

  const connect = (a: AreaId, b: AreaId): void => {
    if (a === b) return;
    const key = linkKey(a, b);
    if (blocked.has(key) || links.has(key)) return;
    links.add(key);
    neighbors.get(a)!.add(b);
    neighbors.get(b)!.add(a);
  };

  for (let i = 0; i < sites.length; i++) {
    const a = sites[i]!;
    for (const j of delaunay.neighbors(i)) {
      if (j <= i) continue;
      const b = sites[j]!;
      const mid = midpoint(a.point, b.point);
      if (pointInMultiPolygon(mid, opts.landMask)) connect(a.id, b.id);
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
