import type { RuleSet } from "../ruleset/types.ts";
import type { AreaId, PowerId } from "../types.ts";
import { getArea, neighborsOf, portAreas } from "../world/classic.ts";
import type { WorldDefinition } from "../world/types.ts";
import type { AreaState, GameState } from "./gameState.ts";
import { allAreas } from "./helpers.ts";

/** Areas the power owns. */
export function ownedAreas(state: GameState, power: PowerId): readonly AreaState[] {
  return allAreas(state).filter((a) => a.owner === power);
}

/** Supply centers the power currently controls (where it may build). */
export function buildableAreas(state: GameState, power: PowerId): readonly AreaState[] {
  return allAreas(state).filter((a) => a.owner === power && a.supplyCenterOf === power);
}

/** Supply-center ports the power controls (where it may build fleets). */
export function fleetBuildableAreas(
  state: GameState,
  world: WorldDefinition,
  power: PowerId,
): readonly AreaState[] {
  return buildableAreas(state, power).filter((a) => getArea(world, a.id).isPort);
}

/** Owned, not-yet-fortified areas. */
export function fortifiableAreas(state: GameState, power: PowerId): readonly AreaState[] {
  return ownedAreas(state, power).filter((a) => !a.fortified);
}

/** All neutral minors (uncontrolled areas). */
export function neutralMinors(state: GameState): readonly AreaState[] {
  return allAreas(state).filter((a) => a.owner === null);
}

/** Owned areas with more than the minimum garrison (can send armies). */
export function armyMoveSources(
  state: GameState,
  ruleSet: RuleSet,
  power: PowerId,
): readonly AreaState[] {
  return ownedAreas(state, power).filter(
    (a) => a.troops > ruleSet.limits.minGarrison,
  );
}

/** Land neighbors an army may move to from `from`. */
export function armyMoveDestinations(
  world: WorldDefinition,
  from: AreaId,
): readonly AreaId[] {
  return neighborsOf(world, from);
}

/** Owned ports with fleets (can send fleets). */
export function fleetMoveSources(
  state: GameState,
  world: WorldDefinition,
  power: PowerId,
): readonly AreaState[] {
  return ownedAreas(state, power).filter(
    (a) => a.fleets > 0 && getArea(world, a.id).isPort,
  );
}

/** Every port is a valid fleet destination (naval movement is port-to-port). */
export function fleetMoveDestinations(world: WorldDefinition): readonly AreaId[] {
  return portAreas(world).map((a) => a.id);
}

/** Which phases allow which top-level action types, for UI affordances. */
export function isBuildPhase(state: GameState): boolean {
  return (
    state.phase === "ARMY_BUILD" ||
    state.phase === "FLEET_BUILD" ||
    state.phase === "FORTIFY" ||
    state.phase === "ECONOMIC_AID" ||
    state.phase === "ESPIONAGE" ||
    state.phase === "SUBVERSION"
  );
}

export function isMovePhase(state: GameState): boolean {
  return state.phase === "ARMY_MOVE" || state.phase === "FLEET_MOVE";
}
