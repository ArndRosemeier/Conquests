import { getPowerDef } from "../ruleset/classic.ts";
import type { RuleSet } from "../ruleset/types.ts";
import type { AreaId, PowerId } from "../types.ts";
import { getArea } from "../world/classic.ts";
import type { WorldDefinition } from "../world/types.ts";
import type { GameEvent } from "./events.ts";
import type { AreaState, GameState, PendingMove } from "./gameState.ts";
import {
  declareWar,
  getAreaState,
  getPowerState,
  withArea,
} from "./helpers.ts";
import { Rng } from "./rng.ts";
import { addBattlePoints, changeControl } from "./scoring.ts";

/**
 * Combat effectiveness of a unit given its factor. Per the manual, LOWER
 * factors are better, so effectiveness increases as the factor decreases.
 */
export function effectiveness(ruleSet: RuleSet, factor: number): number {
  return (
    ruleSet.combat.factorBase +
    (ruleSet.combat.factorMaxForScale - factor) * ruleSet.combat.factorPerPoint
  );
}

function terrainMultiplier(ruleSet: RuleSet, terrain: number): number {
  return 1 + terrain * ruleSet.combat.terrainDefensePerPoint;
}

interface BattleResult {
  readonly attackerWon: boolean;
  readonly attackerSurvivors: number;
  readonly defenderSurvivors: number;
}

/** Attrition battle over up to N rounds; decisive by comparing effective power. */
function fight(
  attackers: number,
  attEff: number,
  defenders: number,
  defEff: number,
  rounds: number,
  rng: Rng,
): BattleResult {
  let a = attackers;
  let d = defenders;
  for (let r = 0; r < rounds; r += 1) {
    if (a <= 0 || d <= 0) break;
    const aStrength = a * attEff * (0.8 + 0.4 * rng.next());
    const dStrength = d * defEff * (0.8 + 0.4 * rng.next());
    const total = aStrength + dStrength || 1;
    const aLoss = Math.round(a * (dStrength / total) * 0.5);
    const dLoss = Math.round(d * (aStrength / total) * 0.5);
    a = Math.max(0, a - aLoss);
    d = Math.max(0, d - dLoss);
  }
  let attackerWon: boolean;
  if (d <= 0 && a > 0) attackerWon = true;
  else if (a <= 0 && d > 0) attackerWon = false;
  else attackerWon = a * attEff >= d * defEff;
  return { attackerWon, attackerSurvivors: a, defenderSurvivors: d };
}

interface Ctx {
  ruleSet: RuleSet;
  world: WorldDefinition;
  rng: Rng;
  events: GameEvent[];
}

function armyEff(ctx: Ctx, power: PowerId, offense: boolean): number {
  const def = getPowerDef(ctx.ruleSet, power);
  return effectiveness(ctx.ruleSet, offense ? def.armyOffense : def.armyDefense);
}

function navyEff(ctx: Ctx, power: PowerId, offense: boolean): number {
  const def = getPowerDef(ctx.ruleSet, power);
  return effectiveness(ctx.ruleSet, offense ? def.navyOffense : def.navyDefense);
}

/** Defender's army effectiveness (power factor or a minor's own rating). */
function defenderArmyEff(ctx: Ctx, area: AreaState): number {
  if (area.owner === null) {
    return effectiveness(ctx.ruleSet, area.minorDefense);
  }
  return armyEff(ctx, area.owner, false);
}

function returnTroopsHome(
  state: GameState,
  attacker: PowerId,
  from: AreaId,
  troops: number,
): GameState {
  const home = getAreaState(state, from);
  if (home.owner === attacker) {
    return withArea(state, { ...home, troops: home.troops + troops });
  }
  return state; // home lost: troops destroyed
}

function returnFleetsHome(
  state: GameState,
  attacker: PowerId,
  from: AreaId,
  fleets: number,
): GameState {
  const home = getAreaState(state, from);
  if (home.owner === attacker) {
    return withArea(state, { ...home, fleets: home.fleets + fleets });
  }
  return state;
}

function ensureWar(state: GameState, attacker: PowerId, defender: PowerId | null, ctx: Ctx): GameState {
  if (defender === null || defender === attacker) return state;
  const defState = getPowerState(state, defender);
  // Only powers actually go to war; neutral-controlled majors act like minors.
  if (defState.control === "neutral") return state;
  if ((state.war[String(defender)] ?? []).includes(attacker)) return state;
  ctx.events.push({ type: "WAR_DECLARED", by: defender, against: attacker });
  return { ...state, war: declareWar(state.war, attacker, defender) };
}

/** Resolve a single attack (naval or land) against its destination. */
function resolveAttack(state: GameState, move: PendingMove, ctx: Ctx): GameState {
  let next = state;
  const dest = getAreaState(next, move.to);
  const defenderOwner = dest.owner;
  const fromArea = getArea(ctx.world, move.from);
  const toArea = getArea(ctx.world, move.to);
  const crossRegion = fromArea.region !== toArea.region;

  let landingTroops = move.troops;
  let survivingFleets = move.fleets;

  // Naval leg: fleet-vs-fleet before any troops can land.
  if (move.bySea && (move.fleets > 0 || dest.fleets > 0)) {
    const navalDefEff =
      defenderOwner === null ? effectiveness(ctx.ruleSet, 5) : navyEff(ctx, defenderOwner, false);
    const naval = fight(
      move.fleets,
      navyEff(ctx, move.power, true),
      dest.fleets,
      navalDefEff,
      ctx.ruleSet.combat.rounds,
      ctx.rng,
    );
    survivingFleets = naval.attackerSurvivors;

    if (!naval.attackerWon) {
      // Assault repelled at sea: fleets retreat home, troops lost unless same region.
      next = withArea(next, { ...dest, fleets: naval.defenderSurvivors });
      next = returnFleetsHome(next, move.power, move.from, survivingFleets);
      if (!crossRegion) {
        next = returnTroopsHome(next, move.power, move.from, landingTroops);
      }
      next = ensureWar(next, move.power, defenderOwner, ctx);
      ctx.events.push({
        type: "BATTLE",
        area: move.to,
        attacker: move.power,
        defender: defenderOwner,
        attackerWon: false,
        attackerLosses: move.troops + (move.fleets - survivingFleets),
        defenderLosses: dest.fleets - naval.defenderSurvivors,
      });
      return next;
    }

    // Seas won: defender fleets destroyed/retreated, troops proceed to land.
    next = withArea(next, { ...getAreaState(next, move.to), fleets: 0 });
    if (landingTroops === 0) {
      // Pure sortie: fleets return home after clearing the seas.
      next = returnFleetsHome(next, move.power, move.from, survivingFleets);
      next = ensureWar(next, move.power, defenderOwner, ctx);
      ctx.events.push({
        type: "BATTLE",
        area: move.to,
        attacker: move.power,
        defender: defenderOwner,
        attackerWon: true,
        attackerLosses: move.fleets - survivingFleets,
        defenderLosses: dest.fleets,
      });
      return next;
    }
  }

  // Land battle for the area's garrison.
  const target = getAreaState(next, move.to);
  const battle = fight(
    landingTroops,
    armyEff(ctx, move.power, true),
    target.troops,
    defenderArmyEff(ctx, target) *
      terrainMultiplier(ctx.ruleSet, toArea.terrain) *
      (target.fortified ? ctx.ruleSet.combat.fortificationDefenseMultiplier : 1),
    ctx.ruleSet.combat.rounds,
    ctx.rng,
  );

  next = ensureWar(next, move.power, defenderOwner, ctx);

  if (battle.attackerWon) {
    // Occupy: attacker becomes the new controller and defender.
    const occupied: AreaState = {
      ...getAreaState(next, move.to),
      troops: Math.max(battle.attackerSurvivors, 1),
      fleets: survivingFleets,
      fortified: false,
    };
    next = withArea(next, occupied);
    const changed = changeControl(next, move.to, move.power, true);
    next = changed.state;
    ctx.events.push(...changed.events);
    next = addBattlePoints(next, move.power, ctx.ruleSet.victory.pointsPerBattleWon);
    if (defenderOwner !== null) {
      next = addBattlePoints(next, defenderOwner, -ctx.ruleSet.victory.pointsPerBattleLost);
    }
  } else {
    // Repelled: defender holds with survivors; attackers retreat or die.
    next = withArea(next, { ...getAreaState(next, move.to), troops: Math.max(battle.defenderSurvivors, 1) });
    if (!crossRegion || !move.bySea) {
      next = returnTroopsHome(next, move.power, move.from, battle.attackerSurvivors);
    }
    if (move.bySea) {
      next = returnFleetsHome(next, move.power, move.from, survivingFleets);
    }
    next = addBattlePoints(next, move.power, -ctx.ruleSet.victory.pointsPerBattleLost);
    if (defenderOwner !== null) {
      next = addBattlePoints(next, defenderOwner, ctx.ruleSet.victory.pointsPerBattleWon);
    }
  }

  ctx.events.push({
    type: "BATTLE",
    area: move.to,
    attacker: move.power,
    defender: defenderOwner,
    attackerWon: battle.attackerWon,
    attackerLosses: landingTroops - battle.attackerSurvivors,
    defenderLosses: target.troops - battle.defenderSurvivors,
  });

  return next;
}

/** Apply a friendly reinforcement move (destination already controlled). */
function applyReinforcement(state: GameState, move: PendingMove): GameState {
  const dest = getAreaState(state, move.to);
  return withArea(state, {
    ...dest,
    troops: dest.troops + move.troops,
    fleets: dest.fleets + move.fleets,
  });
}

/**
 * Resolve all pending movement into combat: reinforcements first, then attacks
 * (ordered by the attacking power's play order, matching the manual).
 */
export function resolveCombat(
  state: GameState,
  ruleSet: RuleSet,
  world: WorldDefinition,
): { state: GameState; events: readonly GameEvent[] } {
  const rng = new Rng(state.rngState);
  const ctx: Ctx = { ruleSet, world, rng, events: [] };

  let next = state;

  const reinforcements: PendingMove[] = [];
  const attacks: PendingMove[] = [];
  for (const move of state.pending) {
    const dest = getAreaState(next, move.to);
    if (dest.owner === move.power) reinforcements.push(move);
    else attacks.push(move);
  }

  for (const move of reinforcements) {
    next = applyReinforcement(next, move);
  }

  const orderIndex = (p: PowerId): number => ruleSet.playOrder.indexOf(p);
  attacks.sort((m1, m2) => orderIndex(m1.power) - orderIndex(m2.power));

  for (const move of attacks) {
    next = resolveAttack(next, move, ctx);
  }

  next = { ...next, pending: [], rngState: rng.snapshot(), tick: next.tick + 1 };
  return { state: next, events: ctx.events };
}
