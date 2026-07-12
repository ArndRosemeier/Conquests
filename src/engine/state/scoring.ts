import type { RuleSet } from "../ruleset/types.ts";
import type { AreaId, PowerId } from "../types.ts";
import type { WorldDefinition } from "../world/types.ts";
import type { GameEvent } from "./events.ts";
import type { AreaState, GameState } from "./gameState.ts";
import { allAreas, getAreaState, getPowerState, withArea, withPower } from "./helpers.ts";

/**
 * Change control of an area, adjusting victory points per the manual: the new
 * owner gains the area's value; the previous power owner loses it. Subversion
 * passes awardPoints=false (coups grant no victory points).
 */
export function changeControl(
  state: GameState,
  area: AreaId,
  newOwner: PowerId | null,
  awardPoints: boolean,
): { state: GameState; events: readonly GameEvent[] } {
  const areaState = getAreaState(state, area);
  const previous = areaState.owner;
  if (previous === newOwner) {
    return { state, events: [] };
  }

  let next = withArea(state, { ...areaState, owner: newOwner });
  const events: GameEvent[] = [
    { type: "CONTROL_CHANGE", area, from: previous, to: newOwner },
  ];

  if (awardPoints) {
    if (previous !== null) {
      const loser = getPowerState(next, previous);
      next = withPower(next, { ...loser, score: loser.score - areaState.victoryValue });
    }
    if (newOwner !== null) {
      const gainer = getPowerState(next, newOwner);
      next = withPower(next, { ...gainer, score: gainer.score + areaState.victoryValue });
    }
  }

  return { state: next, events };
}

/** Add battle victory points to a power (can be negative). */
export function addBattlePoints(
  state: GameState,
  power: PowerId,
  points: number,
): GameState {
  const p = getPowerState(state, power);
  return withPower(state, { ...p, score: p.score + points });
}

function areasByOwner(state: GameState): Map<string, AreaState[]> {
  const map = new Map<string, AreaState[]>();
  for (const a of allAreas(state)) {
    if (a.owner === null) continue;
    const key = String(a.owner);
    const list = map.get(key) ?? [];
    list.push(a);
    map.set(key, list);
  }
  return map;
}

/**
 * Annual economy applied at the start of each year: every controlled area pays
 * its income into the owner's treasury.
 */
export function applyAnnualEconomy(
  state: GameState,
  ruleSet: RuleSet,
  _world: WorldDefinition,
): { state: GameState; events: readonly GameEvent[] } {
  const owned = areasByOwner(state);
  let next = state;

  for (const power of ruleSet.playOrder) {
    const p = getPowerState(next, power);
    if (p.eliminated) continue;

    const areas = owned.get(String(power)) ?? [];
    const gain = areas.reduce((sum, a) => sum + a.income, 0);

    next = withPower(next, { ...p, treasury: p.treasury + gain });
  }

  return { state: next, events: [] };
}

/**
 * The income a power would collect at the next annual payout given the current
 * board: every controlled area's income. Mirrors applyAnnualEconomy without
 * mutating state.
 */
export function annualIncomeFor(
  state: GameState,
  _ruleSet: RuleSet,
  _world: WorldDefinition,
  power: PowerId,
): number {
  const areas = areasByOwner(state).get(String(power)) ?? [];
  return areas.reduce((sum, a) => sum + a.income, 0);
}

/** Highest-scoring power that meets the winning score, or null. */
export function checkWinner(state: GameState): PowerId | null {
  if (!Number.isFinite(state.winningScore)) return null;
  let best: PowerId | null = null;
  let bestScore = state.winningScore - 1;
  for (const p of Object.values(state.powers)) {
    if (p.score > bestScore) {
      bestScore = p.score;
      best = p.id;
    }
  }
  return best;
}
