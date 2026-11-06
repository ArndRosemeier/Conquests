import type { RuleSet } from "../ruleset/types.ts";
import type { WorldDefinition } from "../world/types.ts";
import { resolveCombat } from "./combat.ts";
import type { GameEvent } from "./events.ts";
import type { GameState } from "./gameState.ts";
import { allAreas, withPower } from "./helpers.ts";
import { recoverReputation, tickDiplomacy } from "./diplomacy.ts";
import { beginNextTurn } from "./phases.ts";
import { annualIncomeFor, applyAnnualEconomy, checkWinner } from "./scoring.ts";

/**
 * Everything that happens between the last power ending its turn and the next
 * turn starting, in one place: combat, eliminations, the new season, the yearly
 * payout and the victory check. The live game, the headless simulator, the
 * tests and the multiplayer host all use this, so they cannot drift apart.
 */
export function advanceAfterCombat(
  state: GameState,
  ruleSet: RuleSet,
  world: WorldDefinition,
): { state: GameState; events: readonly GameEvent[] } {
  const combat = resolveCombat(state, ruleSet, world);
  const events: GameEvent[] = [...combat.events];
  let next = eliminateLandless(combat.state, events);

  const standing = Object.values(next.powers).filter((p) => !p.eliminated && p.control !== "neutral");
  if (standing.length <= 1) {
    const last = standing[0];
    if (last !== undefined) {
      events.push({ type: "GAME_WON", power: last.id });
      return { state: { ...next, winner: last.id, activePower: null }, events };
    }
  }

  next = beginNextTurn(next, ruleSet);
  const upkeep = tickDiplomacy(next, ruleSet);
  events.push(...upkeep.events);
  next = upkeep.state;
  if (next.season === "SPRING") {
    for (const power of ruleSet.playOrder) {
      const p = next.powers[String(power)];
      if (p === undefined || p.eliminated) continue;
      const amount = annualIncomeFor(next, ruleSet, world, power);
      if (amount > 0) events.push({ type: "INCOME", power, amount });
    }
    next = applyAnnualEconomy(next, ruleSet, world).state;
    next = recoverReputation(next, ruleSet);
  }

  const winner = checkWinner(next);
  if (winner !== null) {
    events.push({ type: "GAME_WON", power: winner });
    next = { ...next, winner };
  }
  return { state: next, events };
}

/** Mark every power that holds no area as eliminated. */
function eliminateLandless(state: GameState, events: GameEvent[]): GameState {
  const holders = new Set<string>();
  for (const a of allAreas(state)) if (a.owner !== null) holders.add(String(a.owner));
  let next = state;
  for (const p of Object.values(state.powers)) {
    if (p.eliminated || holders.has(String(p.id))) continue;
    next = withPower(next, { ...p, eliminated: true, treasury: 0 });
    events.push({ type: "POWER_ELIMINATED", power: p.id });
  }
  return next;
}
