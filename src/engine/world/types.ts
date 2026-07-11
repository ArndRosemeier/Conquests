import type { AreaId, PowerId, RegionId } from "../types.ts";

export type Rating = "A" | "B" | "C" | "D";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Region {
  readonly id: RegionId;
  readonly name: string;
  /** Tint used to visually group the region on the map. */
  readonly color: string;
}

/**
 * Static definition of a map area. All dynamic state (who controls it, how many
 * troops, etc.) lives in GameState, not here.
 */
export interface Area {
  readonly id: AreaId;
  readonly name: string;
  readonly region: RegionId;
  /** Terrain factor, 0..4. Higher favors the defender. */
  readonly terrain: number;
  /** Strategic worth rating (A best). Seeds income / victory value. */
  readonly value: Rating;
  /** Defensive rating (A best). Seeds a minor's starting garrison & defense. */
  readonly defense: Rating;
  /** True when adjacent to an ocean; only ports can be reached by fleets. */
  readonly isPort: boolean;
  /**
   * Render geometry in world units. A territory may consist of several disjoint
   * rings (mainland plus offshore pieces), so the shape is a list of rings, each
   * ring an ordered list of points. Holes are not represented.
   */
  readonly shape: readonly (readonly Point[])[];
  /** Anchor for the area's label / markers (projected site centroid). */
  readonly labelAnchor: Point;
}

/**
 * A complete world. Swap this whole object for a different map (hand-authored or
 * procedurally generated) without touching engine or UI logic.
 */
export interface WorldDefinition {
  readonly id: string;
  readonly regions: readonly Region[];
  readonly areas: readonly Area[];
  /** Undirected land adjacency, expressed as a per-area neighbor list. */
  readonly adjacency: ReadonlyMap<AreaId, readonly AreaId[]>;
  readonly bounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  };
  /**
   * Horizontal period (in world units) for a map that wraps east-west like a
   * globe. When set, panning off one side scrolls seamlessly onto the other.
   * Omit for flat maps that do not wrap.
   */
  readonly wrapX?: number;
}

/** Home areas and supply centers per major power, used by scenarios. */
export interface HomeLayout {
  readonly homeAreas: ReadonlyMap<PowerId, readonly AreaId[]>;
  readonly supplyCenters: ReadonlyMap<PowerId, readonly AreaId[]>;
}
