import { getPowerDef } from "../ruleset/classic.ts";
import type { RuleSet } from "../ruleset/types.ts";
import type { AreaId, PowerId } from "../types.ts";
import { getArea } from "../world/classic.ts";
import type { WorldDefinition } from "../world/types.ts";
import type { GameEvent } from "./events.ts";
import type { AreaState, GameState, PendingMove } from "./gameState.ts";
import {
  floorTroops,
  getAreaState,
  roundTroops,
  withArea,
} from "./helpers.ts";
import { addWarGains, canAttackOwner } from "./diplomacy.ts";
import { forgetIntel } from "./knowledge.ts";
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

export interface BattleResult {
  readonly attackerWon: boolean;
  readonly attackerSurvivors: number;
  readonly defenderSurvivors: number;
}

/**
 * Per-round battle constants. Each side's round strength is rolled between
 * LUCK_MIN and LUCK_MIN + LUCK_SPREAD of its nominal value, and each side loses
 * up to LOSS_RATE of its units per round (scaled by the enemy's share of the
 * total strength). Exported so the in-game rules reference shows real numbers.
 */
export const BATTLE_LUCK_MIN = 0.8;
export const BATTLE_LUCK_SPREAD = 0.4;
export const BATTLE_LOSS_RATE = 0.5;
/** Naval defense factor of a neutral harbour (worst on the scale). */
export const NEUTRAL_NAVY_FACTOR = 5;

/**
 * Attrition battle over up to N rounds; decisive by comparing effective power.
 * Counts are in men (or ships). The fight itself runs on exact numbers; with a
 * `unit` above 1 the survivors are then rounded to the nearest whole unit
 * (troops in thousands), and the winner always keeps at least one unit.
 */
export function fight(
  attackers: number,
  attEff: number,
  defenders: number,
  defEff: number,
  rounds: number,
  rng: Rng,
  unit = 1,
): BattleResult {
  let a = attackers;
  let d = defenders;
  for (let r = 0; r < rounds; r += 1) {
    if (a <= 0 || d <= 0) break;
    const aStrength = a * attEff * (BATTLE_LUCK_MIN + BATTLE_LUCK_SPREAD * rng.next());
    const dStrength = d * defEff * (BATTLE_LUCK_MIN + BATTLE_LUCK_SPREAD * rng.next());
    const total = aStrength + dStrength || 1;
    const aLoss = Math.round(a * (dStrength / total) * BATTLE_LOSS_RATE);
    const dLoss = Math.round(d * (aStrength / total) * BATTLE_LOSS_RATE);
    a = Math.max(0, a - aLoss);
    d = Math.max(0, d - dLoss);
  }
  let attackerWon: boolean;
  if (d <= 0 && a > 0) attackerWon = true;
  else if (a <= 0 && d > 0) attackerWon = false;
  else attackerWon = a * attEff >= d * defEff;
  if (unit > 1) {
    a = Math.min(attackers, roundTroops(a, unit));
    d = Math.min(defenders, roundTroops(d, unit));
    if (attackerWon) a = Math.max(a, Math.min(unit, attackers));
    else d = Math.max(d, Math.min(unit, defenders));
  }
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

/** Return each wave's share of the survivors to the area it came from (if still held). */
function returnSurvivorsHome(
  state: GameState,
  power: PowerId,
  legs: readonly PendingMove[],
  survivors: number,
  unit: number,
): GameState {
  const sent = legs.reduce((sum, m) => sum + m.troops, 0);
  if (sent <= 0 || survivors <= 0) return state;
  let next = state;
  let left = survivors;
  legs.forEach((leg, i) => {
    const share = i === legs.length - 1 ? left : floorTroops((survivors * leg.troops) / sent, unit);
    left -= share;
    next = returnTroopsHome(next, power, leg.from, share);
  });
  return next;
}

function landDefense(ctx: Ctx, target: AreaState, terrain: number): number {
  return (
    defenderArmyEff(ctx, target) *
    ctx.ruleSet.combat.homeAdvantageMultiplier *
    terrainMultiplier(ctx.ruleSet, terrain) *
    (target.fortified ? ctx.ruleSet.combat.fortificationDefenseMultiplier : 1)
  );
}

/** Winner takes the area: control changes and battle points are booked. */
function occupy(
  state: GameState,
  ctx: Ctx,
  power: PowerId,
  area: AreaId,
  defenderOwner: PowerId | null,
  troops: number,
  fleets: number,
): GameState {
  let next = withArea(state, {
    ...getAreaState(state, area),
    troops: Math.max(troops, ctx.ruleSet.limits.troopUnit),
    fleets,
    fortified: false,
  });
  const taken = getAreaState(state, area).victoryValue;
  const changed = changeControl(next, area, power, true);
  next = changed.state;
  ctx.events.push(...changed.events);
  next = addBattlePoints(next, power, ctx.ruleSet.victory.pointsPerBattleWon);
  if (defenderOwner !== null) {
    next = addBattlePoints(next, defenderOwner, -ctx.ruleSet.victory.pointsPerBattleLost);
    next = addWarGains(next, power, defenderOwner, ctx.ruleSet.diplomacy.warPointsPerBattle + taken);
  }
  return next;
}

function repelled(state: GameState, ctx: Ctx, power: PowerId, defenderOwner: PowerId | null): GameState {
  let next = addBattlePoints(state, power, -ctx.ruleSet.victory.pointsPerBattleLost);
  if (defenderOwner !== null) {
    next = addBattlePoints(next, defenderOwner, ctx.ruleSet.victory.pointsPerBattleWon);
    next = addWarGains(next, defenderOwner, power, ctx.ruleSet.diplomacy.warPointsPerBattle);
  }
  return next;
}

/**
 * Resolve one land assault. Every army a power marched into the same area this
 * turn fights as a single combined force, so attacking from two sides adds up
 * instead of being fed in piecemeal.
 */
function resolveLandAssault(state: GameState, legs: readonly PendingMove[], ctx: Ctx): GameState {
  const first = legs[0]!;
  const power = first.power;
  const to = first.to;
  const target = getAreaState(state, to);
  const defenderOwner = target.owner;
  const troops = legs.reduce((sum, m) => sum + m.troops, 0);
  const terrain = getArea(ctx.world, to).terrain;

  const battle = fight(
    troops,
    armyEff(ctx, power, true),
    target.troops,
    landDefense(ctx, target, terrain),
    ctx.ruleSet.combat.rounds,
    ctx.rng,
    ctx.ruleSet.limits.troopUnit,
  );
  let next = state;
  if (battle.attackerWon) {
    next = occupy(next, ctx, power, to, defenderOwner, battle.attackerSurvivors, target.fleets);
  } else {
    next = withArea(next, { ...getAreaState(next, to), troops: Math.max(battle.defenderSurvivors, ctx.ruleSet.limits.troopUnit) });
    // The old report was clearly wrong: throw it away (spy again to learn more).
    next = forgetIntel(next, power, to);
    next = returnSurvivorsHome(next, power, legs, battle.attackerSurvivors, ctx.ruleSet.limits.troopUnit);
    next = repelled(next, ctx, power, defenderOwner);
  }
  ctx.events.push({
    type: "BATTLE",
    area: to,
    attacker: power,
    defender: defenderOwner,
    attackerWon: battle.attackerWon,
    captured: battle.attackerWon,
    attackerLosses: troops - battle.attackerSurvivors,
    defenderLosses: target.troops - battle.defenderSurvivors,
    from: legs.map((m) => m.from),
    bySea: false,
  });
  return next;
}

/** Resolve one seaborne assault: a fleet battle first, then any landing. */
function resolveSeaAssault(state: GameState, move: PendingMove, ctx: Ctx): GameState {
  let next = state;
  const dest = getAreaState(next, move.to);
  const defenderOwner = dest.owner;
  const fromArea = getArea(ctx.world, move.from);
  const toArea = getArea(ctx.world, move.to);
  const crossRegion = fromArea.region !== toArea.region;
  const battleBase = { type: "BATTLE" as const, area: move.to, attacker: move.power, defender: defenderOwner, from: [move.from], bySea: true };

  let survivingFleets = move.fleets;
  if (move.fleets > 0 || dest.fleets > 0) {
    const navalDefEff =
      (defenderOwner === null ? effectiveness(ctx.ruleSet, NEUTRAL_NAVY_FACTOR) : navyEff(ctx, defenderOwner, false)) *
      ctx.ruleSet.combat.homeAdvantageMultiplier;
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
      // Repelled at sea: fleets limp home; troops drown unless home is close by.
      next = withArea(next, { ...getAreaState(next, move.to), fleets: naval.defenderSurvivors });
      next = returnFleetsHome(next, move.power, move.from, survivingFleets);
      if (!crossRegion) next = returnTroopsHome(next, move.power, move.from, move.troops);
      next = repelled(next, ctx, move.power, defenderOwner);
      ctx.events.push({
        ...battleBase,
        attackerWon: false,
        captured: false,
        attackerLosses: (crossRegion ? move.troops : 0) + (move.fleets - survivingFleets),
        defenderLosses: dest.fleets - naval.defenderSurvivors,
      });
      return next;
    }
    next = withArea(next, { ...getAreaState(next, move.to), fleets: 0 });
    if (move.troops === 0) {
      // A pure sortie clears the harbour and sails home.
      next = returnFleetsHome(next, move.power, move.from, survivingFleets);
      ctx.events.push({
        ...battleBase,
        attackerWon: true,
        captured: false,
        attackerLosses: move.fleets - survivingFleets,
        defenderLosses: dest.fleets,
      });
      return next;
    }
  }

  const target = getAreaState(next, move.to);
  const battle = fight(
    move.troops,
    armyEff(ctx, move.power, true),
    target.troops,
    landDefense(ctx, target, toArea.terrain),
    ctx.ruleSet.combat.rounds,
    ctx.rng,
    ctx.ruleSet.limits.troopUnit,
  );
  if (battle.attackerWon) {
    next = occupy(next, ctx, move.power, move.to, defenderOwner, battle.attackerSurvivors, survivingFleets);
  } else {
    next = withArea(next, { ...getAreaState(next, move.to), troops: Math.max(battle.defenderSurvivors, ctx.ruleSet.limits.troopUnit) });
    next = forgetIntel(next, move.power, move.to);
    // The fleet re-embarks the survivors and sails home.
    next = returnTroopsHome(next, move.power, move.from, battle.attackerSurvivors);
    next = returnFleetsHome(next, move.power, move.from, survivingFleets);
    next = repelled(next, ctx, move.power, defenderOwner);
  }
  ctx.events.push({
    ...battleBase,
    attackerWon: battle.attackerWon,
    captured: battle.attackerWon,
    attackerLosses: move.troops - battle.attackerSurvivors + (move.fleets - survivingFleets),
    defenderLosses: target.troops - battle.defenderSurvivors + dest.fleets,
  });
  return next;
}

/** Apply a friendly move (the destination is held by the mover when it arrives). */
function applyReinforcement(state: GameState, move: PendingMove): GameState {
  const dest = getAreaState(state, move.to);
  return withArea(state, {
    ...dest,
    troops: dest.troops + move.troops,
    fleets: dest.fleets + move.fleets,
  });
}

/** One unit of combat: a power's combined land assault on an area, or a single landing by sea. */
interface Assault {
  readonly power: PowerId;
  readonly to: AreaId;
  readonly bySea: boolean;
  readonly legs: readonly PendingMove[];
}

/** Group a power's land moves on the same target; sea moves stay separate. */
function groupAssaults(moves: readonly PendingMove[], ruleSet: RuleSet): Assault[] {
  const order = (p: PowerId): number => ruleSet.playOrder.indexOf(p);
  const sorted = [...moves].sort((a, b) => order(a.power) - order(b.power));
  const out: Assault[] = [];
  const land = new Map<string, PendingMove[]>();
  for (const m of sorted) {
    if (m.bySea) {
      out.push({ power: m.power, to: m.to, bySea: true, legs: [m] });
      continue;
    }
    const key = `${String(m.power)}>${String(m.to)}`;
    const legs = land.get(key);
    if (legs) {
      legs.push(m);
    } else {
      const fresh = [m];
      land.set(key, fresh);
      out.push({ power: m.power, to: m.to, bySea: false, legs: fresh });
    }
  }
  return out;
}

/**
 * Resolve all pending movement. Moves into areas the mover already holds land
 * first; then assaults run in play order. Ownership is re-checked right before
 * each assault, so a wave that arrives after its own side took the area simply
 * reinforces it instead of fighting its own garrison.
 */
export function resolveCombat(
  state: GameState,
  ruleSet: RuleSet,
  world: WorldDefinition,
): { state: GameState; events: readonly GameEvent[] } {
  const rng = new Rng(state.rngState);
  const ctx: Ctx = { ruleSet, world, rng, events: [] };
  let next = state;

  const hostile: PendingMove[] = [];
  for (const move of state.pending) {
    if (getAreaState(next, move.to).owner === move.power) next = applyReinforcement(next, move);
    else hostile.push(move);
  }

  for (const assault of groupAssaults(hostile, ruleSet)) {
    const owner = getAreaState(next, assault.to).owner;
    if (owner === assault.power) {
      for (const leg of assault.legs) next = applyReinforcement(next, leg);
      continue;
    }
    if (owner !== null && !canAttackOwner(next, assault.power, owner)) {
      // The target changed hands, or peace was made, after the order: turn back.
      for (const leg of assault.legs) {
        next = returnTroopsHome(next, assault.power, leg.from, leg.troops);
        if (leg.fleets > 0) next = returnFleetsHome(next, assault.power, leg.from, leg.fleets);
      }
      ctx.events.push({ type: "ATTACK_CALLED_OFF", power: assault.power, area: assault.to, owner });
      continue;
    }
    next = assault.bySea
      ? resolveSeaAssault(next, assault.legs[0]!, ctx)
      : resolveLandAssault(next, assault.legs, ctx);
  }

  next = { ...next, pending: [], rngState: rng.snapshot(), tick: next.tick + 1 };
  return { state: next, events: ctx.events };
}
