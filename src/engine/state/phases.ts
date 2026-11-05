import type { RuleSet } from "../ruleset/types.ts";
import { EngineError } from "../types.ts";
import type { PowerId, Season } from "../types.ts";
import type { GameState } from "./gameState.ts";
import { getPowerState } from "./helpers.ts";

/**
 * Turn structure. A year is four seasons; building and diplomacy happen only in
 * spring, movement every season. Within a power's turn there are no sub-phases:
 * it may take any allowed action in any order and then end its turn.
 */

/** The founding turn (year 1 spring) forbids building and diplomacy. */
export function isFoundingTurn(state: GameState): boolean {
  return state.year === 1 && state.season === "SPRING";
}

/** Whether a power actually takes a turn (humans and AIs do; neutrals do not). */
export function isActingPower(state: GameState, id: PowerId): boolean {
  const p = getPowerState(state, id);
  return !p.eliminated && (p.control === "human" || p.control === "ai");
}

/** The first acting power in play order, or null if none. */
export function firstActingPower(state: GameState, ruleSet: RuleSet): PowerId | null {
  for (const id of ruleSet.playOrder) {
    if (isActingPower(state, id)) return id;
  }
  return null;
}

/** The next acting power after `current` in play order, or null if none remain. */
export function nextActingPower(
  state: GameState,
  ruleSet: RuleSet,
  current: PowerId,
): PowerId | null {
  const idx = ruleSet.playOrder.indexOf(current);
  if (idx < 0) {
    throw new EngineError(`Power '${current}' not in play order`);
  }
  for (let i = idx + 1; i < ruleSet.playOrder.length; i += 1) {
    const id = ruleSet.playOrder[i]!;
    if (isActingPower(state, id)) return id;
  }
  return null;
}

const SEASON_ORDER: readonly Season[] = ["SPRING", "SUMMER", "FALL", "WINTER"];

export function nextSeason(season: Season): { season: Season; yearAdvance: boolean } {
  const idx = SEASON_ORDER.indexOf(season);
  const next = SEASON_ORDER[(idx + 1) % SEASON_ORDER.length]!;
  return { season: next, yearAdvance: next === "SPRING" };
}

/** Hand the turn to `power`: make it active and refill its movement budget. */
export function beginTurnFor(
  state: GameState,
  ruleSet: RuleSet,
  power: PowerId,
): GameState {
  return {
    ...state,
    stage: "PLAYER",
    activePower: power,
    armyMovesRemaining: ruleSet.limits.armyMoves,
    fleetMovesRemaining: ruleSet.limits.fleetMoves,
    tick: state.tick + 1,
  };
}

/**
 * End the active power's turn: hand off to the next acting power, or enter COMBAT
 * once everyone has acted.
 */
export function endTurnFor(state: GameState, ruleSet: RuleSet): GameState {
  if (state.activePower === null) {
    throw new EngineError("Cannot end a turn during COMBAT");
  }
  const next = nextActingPower(state, ruleSet, state.activePower);
  if (next !== null) {
    return beginTurnFor(state, ruleSet, next);
  }
  return {
    ...state,
    stage: "COMBAT",
    activePower: null,
    armyMovesRemaining: 0,
    fleetMovesRemaining: 0,
    tick: state.tick + 1,
  };
}

/**
 * Begin the next turn after combat: advance the season (and year), clear pending
 * movement, and hand the turn to the first acting power.
 */
export function beginNextTurn(state: GameState, ruleSet: RuleSet): GameState {
  const { season, yearAdvance } = nextSeason(state.season);
  const year = yearAdvance ? state.year + 1 : state.year;

  const staged: GameState = { ...state, season, year, pending: [] };
  const first = firstActingPower(staged, ruleSet);
  if (first === null) {
    throw new EngineError("No acting powers remain to begin a turn");
  }
  return beginTurnFor(staged, ruleSet, first);
}
