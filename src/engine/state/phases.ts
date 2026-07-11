import type { RuleSet } from "../ruleset/types.ts";
import { EngineError } from "../types.ts";
import type { PhaseId, PowerId, Season } from "../types.ts";
import type { GameState } from "./gameState.ts";
import { getPowerState } from "./helpers.ts";

/** Phases the currently-acting power runs this turn. */
export function playerPhases(state: GameState, ruleSet: RuleSet): readonly PhaseId[] {
  if (state.season === "SPRING") {
    // First turn of the whole game: only Espionage + Subversion (manual 6.1.3).
    if (state.year === 1) {
      return ["ESPIONAGE", "SUBVERSION", "ARMY_MOVE", "FLEET_MOVE"];
    }
    return ruleSet.springPhases;
  }
  return ruleSet.regularPhases;
}

export function initialMovesFor(ruleSet: RuleSet, phase: PhaseId): number {
  if (phase === "ARMY_MOVE") return ruleSet.limits.armyMoves;
  if (phase === "FLEET_MOVE") return ruleSet.limits.fleetMoves;
  return 0;
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

/**
 * Advance to the next player phase. If the acting power has finished all phases,
 * hand off to the next acting power. If every power is done, enter COMBAT.
 */
export function endPhaseFor(state: GameState, ruleSet: RuleSet): GameState {
  if (state.activePower === null) {
    throw new EngineError("Cannot end a player phase during COMBAT");
  }
  const phases = playerPhases(state, ruleSet);
  const nextIndex = state.phaseIndex + 1;

  if (nextIndex < phases.length) {
    const phase = phases[nextIndex]!;
    return {
      ...state,
      phaseIndex: nextIndex,
      phase,
      movesRemaining: initialMovesFor(ruleSet, phase),
      tick: state.tick + 1,
    };
  }

  const next = nextActingPower(state, ruleSet, state.activePower);
  if (next !== null) {
    const phase = phases[0]!;
    return {
      ...state,
      activePower: next,
      phaseIndex: 0,
      phase,
      movesRemaining: initialMovesFor(ruleSet, phase),
      tick: state.tick + 1,
    };
  }

  // Everyone has acted; time to resolve combat.
  return {
    ...state,
    activePower: null,
    phase: "COMBAT",
    phaseIndex: 0,
    movesRemaining: 0,
    tick: state.tick + 1,
  };
}

/**
 * Begin the next turn after combat: advance the season (and year), set the first
 * acting power, and reset to that power's first phase.
 */
export function beginNextTurn(state: GameState, ruleSet: RuleSet): GameState {
  const { season, yearAdvance } = nextSeason(state.season);
  const year = yearAdvance ? state.year + 1 : state.year;

  const staged: GameState = { ...state, season, year, pending: [] };
  const first = firstActingPower(staged, ruleSet);
  if (first === null) {
    throw new EngineError("No acting powers remain to begin a turn");
  }
  const phases = playerPhases(staged, ruleSet);
  const phase = phases[0]!;

  return {
    ...staged,
    activePower: first,
    phaseIndex: 0,
    phase,
    movesRemaining: initialMovesFor(ruleSet, phase),
    tick: staged.tick + 1,
  };
}
