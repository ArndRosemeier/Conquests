import type { AreaId } from "../../engine/types.ts";
import type { Point, WorldDefinition } from "../../engine/world/types.ts";

/** Render-ready geometry for one territory, in world units (x = longitude, y = -latitude). */
export interface AreaGeometry {
  readonly id: AreaId;
  readonly path: Path2D;
  /** Visual centre: centroid of the largest ring. */
  readonly center: Point;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** Rough size of the territory (largest ring's area), for label and marker sizing. */
  readonly size: number;
}

function ringCentroid(ring: readonly Point[]): { x: number; y: number; area: number } {
  const n = ring.length;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const p of ring) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / Math.max(1, n), y: sy / Math.max(1, n), area: 0 };
  }
  return { x: cx / (6 * a), y: cy / (6 * a), area: Math.abs(a) };
}

const cache = new WeakMap<WorldDefinition, Map<AreaId, AreaGeometry>>();

/** Path2D and centre for every area of a world (built once per world). */
export function worldGeometry(world: WorldDefinition): Map<AreaId, AreaGeometry> {
  const hit = cache.get(world);
  if (hit) return hit;
  const out = new Map<AreaId, AreaGeometry>();
  for (const area of world.areas) {
    const path = new Path2D();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let best: { x: number; y: number; area: number } | null = null;
    for (const ring of area.shape) {
      if (ring.length < 3) continue;
      ring.forEach((p, i) => {
        if (i === 0) path.moveTo(p.x, p.y);
        else path.lineTo(p.x, p.y);
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      });
      path.closePath();
      const c = ringCentroid(ring);
      if (best === null || c.area > best.area) best = c;
    }
    out.set(area.id, {
      id: area.id,
      path,
      // The world builder places the anchor inside the territory; a ring
      // centroid can fall outside a curved one (Chile, Norway).
      center: area.labelAnchor ?? (best ? { x: best.x, y: best.y } : { x: 0, y: 0 }),
      minX,
      minY,
      maxX,
      maxY,
      size: best?.area ?? 0,
    });
  }
  cache.set(world, out);
  return out;
}

const decorCache = new WeakMap<WorldDefinition, Path2D | null>();

/** Neutral scenery land (Greenland, New Zealand...) as one path, or null if the world has none. */
export function decorPath(world: WorldDefinition): Path2D | null {
  if (decorCache.has(world)) return decorCache.get(world)!;
  let path: Path2D | null = null;
  if (world.decor && world.decor.length > 0) {
    path = new Path2D();
    for (const ring of world.decor) {
      if (ring.length < 3) continue;
      ring.forEach((p, i) => (i === 0 ? path!.moveTo(p.x, p.y) : path!.lineTo(p.x, p.y)));
      path.closePath();
    }
  }
  decorCache.set(world, path);
  return path;
}

/** A quadratic arc between two points, bowed to the left of travel. */
export function arcControl(a: Point, b: Point, bend: number): Point {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { x: mx - dy * bend, y: my + dx * bend };
}

export function quadPoint(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

/**
 * The copy of `to` (shifted by a multiple of the wrap period) closest to
 * `from`, so an arc from Alaska to Siberia crosses the date line instead of
 * spanning the whole map.
 */
export function nearestCopy(from: Point, to: Point, wrapX: number | undefined): Point {
  if (wrapX === undefined) return to;
  let best = to;
  for (const k of [-1, 1]) {
    const cand = { x: to.x + k * wrapX, y: to.y };
    if (Math.abs(cand.x - from.x) < Math.abs(best.x - from.x)) best = cand;
  }
  return best;
}
