import type { Action } from "../../engine/state/actions.ts";
import type { GameState } from "../../engine/state/gameState.ts";
import type { RuleSet } from "../../engine/ruleset/types.ts";
import { getArea } from "../../engine/world/classic.ts";
import type { WorldDefinition } from "../../engine/world/types.ts";
import type { AreaId, PowerId } from "../../engine/types.ts";

/**
 * Fleet housekeeping shared by the AI planners. Ships cannot conquer anything,
 * so the AI should own only the hulls it needs to carry its armies and to
 * guard against enemy fleets. A fleet carries an army over, sails home, and
 * carries the next one: new hulls are bought only when the whole navy is too
 * small for an invasion.
 */

/** What the AI knows about a port, as the planner sees it. */
export interface FleetIntel {
  /** Troops at an own area free to embark (above the reserve it wants kept). */
  readonly spareTroops: (id: AreaId) => number;
  /** Enemy fleets the AI has seen at a foreign port (0 if unknown). */
  readonly knownFleets: (id: AreaId) => number;
}

/** The busiest home port (most troops): where invasions are raised and launched. */
export function homePort(state: GameState, power: PowerId, world: WorldDefinition): AreaId | null {
  let home: AreaId | null = null;
  let homeTroops = -1;
  for (const a of Object.values(state.areas)) {
    if (a.owner !== power || a.supplyCenterOf !== power || !getArea(world, a.id).isPort) continue;
    if (a.troops > homeTroops) {
      home = a.id;
      homeTroops = a.troops;
    }
  }
  return home;
}

/** Fleets at each owned port beyond what that port needs to keep there. */
export function idleFleetsByPort(
  state: GameState,
  power: PowerId,
  ruleSet: RuleSet,
  world: WorldDefinition,
  intel: FleetIntel,
): Map<AreaId, number> {
  const enemyByRegion = new Map<number, number>();
  for (const a of Object.values(state.areas)) {
    if (a.owner === power || a.owner === null || !getArea(world, a.id).isPort) continue;
    const region = getArea(world, a.id).region;
    enemyByRegion.set(region, Math.max(enemyByRegion.get(region) ?? 0, intel.knownFleets(a.id)));
  }

  // Home ports (supply centers) keep enough hulls to lift their spare troops,
  // plus a guard matching the biggest enemy fleet seen in their region. Fleets
  // at outlying colonies (where an invasion landed) are all free to sail home.
  const idle = new Map<AreaId, number>();
  for (const a of Object.values(state.areas)) {
    if (a.owner !== power || a.fleets <= 0 || !getArea(world, a.id).isPort) continue;
    let keep = 0;
    if (a.supplyCenterOf === power) {
      const lift = Math.ceil(Math.max(0, intel.spareTroops(a.id)) / ruleSet.limits.troopsPerFleet);
      keep = Math.max(lift, enemyByRegion.get(getArea(world, a.id).region) ?? 0);
    }
    const spare = a.fleets - keep;
    if (spare > 0) idle.set(a.id, spare);
  }
  return idle;
}

/**
 * Sail idle fleets stranded at outlying ports (they stay wherever an invasion
 * landed) back to the home port where armies are raised, so the next invasion
 * reuses them instead of buying new hulls. Uses only fleet moves left over.
 */
export function regroupFleets(
  state: GameState,
  power: PowerId,
  ruleSet: RuleSet,
  world: WorldDefinition,
  intel: FleetIntel,
): readonly Action[] {
  let movesLeft = state.fleetMovesRemaining;
  if (movesLeft <= 0) return [];
  const home = homePort(state, power, world);
  if (home === null) return [];

  const idle = [...idleFleetsByPort(state, power, ruleSet, world, intel)]
    .filter(([id]) => id !== home)
    .sort((x, y) => y[1] - x[1]);
  const out: Action[] = [];
  for (const [from, fleets] of idle) {
    if (movesLeft <= 0) break;
    out.push({ type: "MOVE_FLEET", from, to: home, fleets, troops: 0 });
    movesLeft -= 1;
  }
  return out;
}

/** Every fleet the power owns, including those already under way this turn. */
export function navySize(state: GameState, power: PowerId): number {
  let n = 0;
  for (const a of Object.values(state.areas)) if (a.owner === power) n += a.fleets;
  for (const m of state.pending) if (m.power === power) n += m.fleets;
  return n;
}
