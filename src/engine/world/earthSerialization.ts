import { areaId, regionId } from "../types.ts";
import type { AreaId } from "../types.ts";
import type { Area, Point, Rating, Region, WorldDefinition } from "./types.ts";

/**
 * Plain-JSON form of a WorldDefinition. Coordinates are flattened to [x, y]
 * pairs and the adjacency Map becomes an entries array so the whole world can be
 * precomputed offline and shipped as a static asset (see `scripts/generateEarth.ts`).
 */
export interface SerializedWorld {
  readonly id: string;
  readonly regions: readonly SerializedRegion[];
  readonly areas: readonly SerializedArea[];
  readonly adjacency: readonly (readonly [number, readonly number[]])[];
  readonly bounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  };
  readonly decor?: readonly (readonly (readonly [number, number])[])[];
}

interface SerializedRegion {
  readonly id: number;
  readonly name: string;
  readonly color: string;
}

interface SerializedArea {
  readonly id: number;
  readonly name: string;
  readonly region: number;
  readonly terrain: number;
  readonly value: Rating;
  readonly defense: Rating;
  readonly isPort: boolean;
  readonly shape: readonly (readonly (readonly [number, number])[])[];
  readonly labelAnchor: readonly [number, number];
}

/** ~1 m precision is far finer than a degree-based world needs. */
function round(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

export function serializeWorld(world: WorldDefinition): SerializedWorld {
  return {
    id: world.id,
    regions: world.regions.map((r) => ({ id: r.id, name: r.name, color: r.color })),
    areas: world.areas.map((a) => ({
      id: a.id,
      name: a.name,
      region: a.region,
      terrain: a.terrain,
      value: a.value,
      defense: a.defense,
      isPort: a.isPort,
      shape: a.shape.map((ring) => ring.map((p) => [round(p.x), round(p.y)] as [number, number])),
      labelAnchor: [round(a.labelAnchor.x), round(a.labelAnchor.y)],
    })),
    adjacency: [...world.adjacency].map(([id, ns]) => [id, [...ns]] as [number, number[]]),
    bounds: world.bounds,
    ...(world.decor
      ? { decor: world.decor.map((ring) => ring.map((p) => [round(p.x), round(p.y)] as [number, number])) }
      : {}),
  };
}

export function deserializeWorld(data: SerializedWorld): WorldDefinition {
  const toPoint = (pair: readonly [number, number]): Point => ({ x: pair[0], y: pair[1] });
  const regions: Region[] = data.regions.map((r) => ({
    id: regionId(r.id),
    name: r.name,
    color: r.color,
  }));
  const areas: Area[] = data.areas.map((a) => ({
    id: areaId(a.id),
    name: a.name,
    region: regionId(a.region),
    terrain: a.terrain,
    value: a.value,
    defense: a.defense,
    isPort: a.isPort,
    shape: a.shape.map((ring) => ring.map(toPoint)),
    labelAnchor: toPoint(a.labelAnchor),
  }));
  const adjacency = new Map<AreaId, readonly AreaId[]>(
    data.adjacency.map(([id, ns]) => [areaId(id), ns.map((n) => areaId(n))]),
  );
  const decor = data.decor?.map((ring) => ring.map(toPoint));
  return { id: data.id, regions, areas, adjacency, bounds: data.bounds, ...(decor ? { decor } : {}) };
}
