/**
 * Core branded identifiers and shared unions for the engine.
 *
 * Branding prevents accidentally mixing raw numbers/strings (e.g. passing a
 * region number where an area number is expected). IDs stay serializable
 * because at runtime they are just numbers/strings.
 */

export type AreaId = number & { readonly __brand: "AreaId" };
export type RegionId = number & { readonly __brand: "RegionId" };
export type PowerId = string & { readonly __brand: "PowerId" };

export const areaId = (n: number): AreaId => n as AreaId;
export const regionId = (n: number): RegionId => n as RegionId;
export const powerId = (s: string): PowerId => s as PowerId;

/** Build sub-phases. Occur once per year, in spring. */
export type BuildPhaseId =
  | "ARMY_BUILD"
  | "FLEET_BUILD"
  | "FORTIFY"
  | "ECONOMIC_AID"
  | "ESPIONAGE"
  | "SUBVERSION";

/** Movement sub-phases. Occur every turn. */
export type MovePhaseId = "ARMY_MOVE" | "FLEET_MOVE";

/** Every phase a single power can act in. */
export type PlayerPhaseId = BuildPhaseId | MovePhaseId;

/** All phases, including the global combat resolution. */
export type PhaseId = PlayerPhaseId | "COMBAT";

export const BUILD_PHASES: readonly BuildPhaseId[] = [
  "ARMY_BUILD",
  "FLEET_BUILD",
  "FORTIFY",
  "ECONOMIC_AID",
  "ESPIONAGE",
  "SUBVERSION",
];

export const MOVE_PHASES: readonly MovePhaseId[] = ["ARMY_MOVE", "FLEET_MOVE"];

/** The four seasons; build phases only happen in SPRING. */
export type Season = "SPRING" | "SUMMER" | "FALL" | "WINTER";

export const SEASONS: readonly Season[] = ["SPRING", "SUMMER", "FALL", "WINTER"];

/** How a major power is controlled. Human/AI are interchangeable to the engine. */
export type ControlKind = "human" | "ai" | "neutral";

/**
 * Base class for all engine errors. Per project policy, illegal actions and
 * inconsistent state throw loudly rather than being silently swallowed.
 */
export class EngineError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "EngineError";
  }
}

/** Thrown when an action is not legal in the current state. */
export class IllegalActionError extends EngineError {
  public constructor(message: string) {
    super(message);
    this.name = "IllegalActionError";
  }
}

/** Thrown when the engine is asked for an entity that does not exist. */
export class NotFoundError extends EngineError {
  public constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

/** Narrowing helper that throws instead of returning undefined. */
export function assertDefined<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) {
    throw new NotFoundError(message);
  }
  return value;
}
