import type { RuleSet } from "../ruleset/types.ts";
import type { AreaId, PowerId } from "../types.ts";
import { getArea, neighborsOf, portAreas } from "../world/classic.ts";
import type { WorldDefinition } from "../world/types.ts";
import type { AreaState, GameState } from "./gameState.ts";
import { getAreaState, allAreas } from "./helpers.ts";
import { isFoundingTurn } from "./phases.ts";

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

// --- Season gates -----------------------------------------------------------
//
// These replace the old per-phase gating. Building and diplomacy are spring-only
// and not allowed on the founding turn; espionage and subversion are spring-only
// (allowed on the founding turn); movement is allowed every season. They power
// both the reducer's legality checks and the UI's action affordances.

/** Building armies/fleets and fortifying (spring, but not the founding turn). */
export function canBuild(state: GameState): boolean {
  return state.season === "SPRING" && !isFoundingTurn(state);
}

/** Economic aid to powers or minors (spring, but not the founding turn). */
export function canDiplomacy(state: GameState): boolean {
  return state.season === "SPRING" && !isFoundingTurn(state);
}

/** Espionage (spring, including the founding turn). */
export function canEspionage(state: GameState): boolean {
  return state.season === "SPRING";
}

/** Subversion of neutral minors (spring, including the founding turn). */
export function canSubvert(state: GameState): boolean {
  return state.season === "SPRING";
}

/** An area-scoped action the UI can offer for a clicked area. */
export type AreaActionKind =
  | "BUILD_ARMY"
  | "BUILD_FLEET"
  | "FORTIFY"
  | "MOVE_ARMY"
  | "MOVE_FLEET"
  | "SPY"
  | "SUBVERT"
  | "LOAN_MINOR"
  | "LOAN_POWER";

/**
 * The actions the acting `power` may take against a specific `area` right now,
 * used to build the map's click popup. Movement targets are chosen separately
 * (source area first, then destination), so only the source-side move actions
 * appear here.
 */
export function availableAreaActions(
  state: GameState,
  ruleSet: RuleSet,
  world: WorldDefinition,
  area: AreaId,
  power: PowerId,
): readonly AreaActionKind[] {
  const a = getAreaState(state, area);
  const def = getArea(world, area);
  const kinds: AreaActionKind[] = [];

  if (a.owner === power) {
    if (canBuild(state) && a.supplyCenterOf === power) {
      kinds.push("BUILD_ARMY");
      if (def.isPort) kinds.push("BUILD_FLEET");
    }
    if (canBuild(state) && !a.fortified) kinds.push("FORTIFY");
    if (a.troops > ruleSet.limits.minGarrison && state.armyMovesRemaining > 0) {
      kinds.push("MOVE_ARMY");
    }
    if (def.isPort && a.fleets > 0 && state.fleetMovesRemaining > 0) {
      kinds.push("MOVE_FLEET");
    }
    return kinds;
  }

  if (a.owner === null) {
    if (canEspionage(state)) kinds.push("SPY");
    if (canSubvert(state)) kinds.push("SUBVERT");
    if (canDiplomacy(state)) kinds.push("LOAN_MINOR");
    return kinds;
  }

  // Foreign power-owned area.
  if (canEspionage(state)) kinds.push("SPY");
  if (canDiplomacy(state)) kinds.push("LOAN_POWER");
  return kinds;
}
