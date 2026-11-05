import { EngineError } from "../types.ts";
import type { AreaId } from "../types.ts";
import type { Area, WorldDefinition } from "./types.ts";
import { REAL_WORLD } from "./realWorld.ts";

/**
 * The default Conquests world. It is produced by the generic
 * site-based Voronoi builder from real Earth geography (see `realWorld.ts`).
 * Swapping in a different map — including a procedurally generated one — just
 * means handing another `WorldDefinition` to the engine and UI.
 */
export const CLASSIC_WORLD: WorldDefinition = REAL_WORLD;

/** Lookup helper that throws (loudly) when an area is missing. */
export function getArea(world: WorldDefinition, id: AreaId): Area {
  const area = world.areas.find((a) => a.id === id);
  if (area === undefined) {
    throw new EngineError(`Area ${id} not found in world '${world.id}'`);
  }
  return area;
}

/** Neighbors of an area (throws if the area is unknown). */
export function neighborsOf(world: WorldDefinition, id: AreaId): readonly AreaId[] {
  const list = world.adjacency.get(id);
  if (list === undefined) {
    throw new EngineError(`Area ${id} has no adjacency entry in '${world.id}'`);
  }
  return list;
}

/** All port areas in the world. */
export function portAreas(world: WorldDefinition): readonly Area[] {
  return world.areas.filter((a) => a.isPort);
}
