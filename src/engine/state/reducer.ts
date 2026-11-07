import { getPowerDef } from "../ruleset/classic.ts";
import type { RuleSet } from "../ruleset/types.ts";
import { IllegalActionError } from "../types.ts";
import type { AreaId, PowerId } from "../types.ts";
import { getArea, neighborsOf } from "../world/classic.ts";
import type { WorldDefinition } from "../world/types.ts";
import type { Action } from "./actions.ts";
import type { GameEvent } from "./events.ts";
import type { AreaState, GameState, PendingMove, PowerState } from "./gameState.ts";
import {
  answerCallAction,
  answerPeaceAction,
  joinCoalitionAction,
  answerProposalAction,
  callsTo,
  canAttackOwner,
  declareWarAction,
  leaveAllianceAction,
  offerPeaceAction,
  proposeAction,
  recordGift,
} from "./diplomacy.ts";
import { floorTroops, getAreaState, getPowerState, roundTroops, withArea, withPower } from "./helpers.ts";
import { canBuild, canDiplomacy, canEspionage, canSubvert } from "./legalActions.ts";
import { recordIntel } from "./knowledge.ts";
import { endTurnFor } from "./phases.ts";
import { Rng } from "./rng.ts";
import { changeControl } from "./scoring.ts";

export interface ReduceResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

function requireActivePower(state: GameState): PowerId {
  if (state.activePower === null) {
    throw new IllegalActionError("No active power (combat in progress)");
  }
  return state.activePower;
}

/** Guard an action against the current season's gate (throws loudly if not). */
function requireCan(allowed: boolean, what: string): void {
  if (!allowed) {
    throw new IllegalActionError(`Cannot ${what} this turn (not allowed this season)`);
  }
}

function requirePositive(amount: number, what: string): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new IllegalActionError(`${what} must be a positive amount (got ${amount})`);
  }
}

function spend(power: PowerState, amount: number): PowerState {
  if (amount < 0) {
    throw new IllegalActionError(`Cannot spend a negative amount (${amount})`);
  }
  if (amount > power.treasury) {
    throw new IllegalActionError(
      `Insufficient treasury: need ${amount}, have ${power.treasury}`,
    );
  }
  return { ...power, treasury: power.treasury - amount };
}

function requireOwnedBy(state: GameState, area: AreaId, power: PowerId): AreaState {
  const a = getAreaState(state, area);
  if (a.owner !== power) {
    throw new IllegalActionError(`Area ${area} is not controlled by '${power}'`);
  }
  return a;
}

function buildArmy(
  state: GameState,
  ruleSet: RuleSet,
  power: PowerId,
  area: AreaId,
  troops: number,
): GameState {
  requireCan(canBuild(state), "build armies");
  const a = requireOwnedBy(state, area, power);
  if (a.supplyCenterOf !== power) {
    throw new IllegalActionError(`Area ${area} is not a supply center of '${power}'`);
  }
  if (troops <= 0 || troops % ruleSet.costs.troopBuildIncrement !== 0) {
    throw new IllegalActionError(
      `Troops must be a positive multiple of ${ruleSet.costs.troopBuildIncrement}`,
    );
  }
  const def = getPowerDef(ruleSet, power);
  const cost = (troops / 10_000) * def.armyCostPer10k;
  const p = spend(getPowerState(state, power), cost);
  const next = withPower(state, p);
  return withArea(next, { ...getAreaState(next, area), troops: a.troops + troops });
}

function buildFleet(
  state: GameState,
  ruleSet: RuleSet,
  world: WorldDefinition,
  power: PowerId,
  area: AreaId,
  fleets: number,
): GameState {
  requireCan(canBuild(state), "build fleets");
  const a = requireOwnedBy(state, area, power);
  if (a.supplyCenterOf !== power) {
    throw new IllegalActionError(`Area ${area} is not a supply center of '${power}'`);
  }
  if (!getArea(world, area).isPort) {
    throw new IllegalActionError(`Area ${area} is not a port; cannot build fleets`);
  }
  if (fleets <= 0 || fleets % ruleSet.costs.fleetBuildIncrement !== 0) {
    throw new IllegalActionError(
      `Fleets must be a positive multiple of ${ruleSet.costs.fleetBuildIncrement}`,
    );
  }
  const def = getPowerDef(ruleSet, power);
  const cost = (fleets / 5) * def.navyCostPer5;
  const p = spend(getPowerState(state, power), cost);
  const next = withPower(state, p);
  return withArea(next, { ...getAreaState(next, area), fleets: a.fleets + fleets });
}

function fortify(
  state: GameState,
  ruleSet: RuleSet,
  power: PowerId,
  area: AreaId,
): GameState {
  requireCan(canBuild(state), "fortify");
  const a = requireOwnedBy(state, area, power);
  if (a.fortified) {
    throw new IllegalActionError(`Area ${area} is already fortified`);
  }
  const p = spend(getPowerState(state, power), ruleSet.costs.fortification);
  const next = withPower(state, p);
  return withArea(next, { ...getAreaState(next, area), fortified: true });
}

function loanPower(
  state: GameState,
  from: PowerId,
  target: PowerId,
  amount: number,
): ReduceResult {
  requireCan(canDiplomacy(state), "send aid");
  if (target === from) {
    throw new IllegalActionError("Cannot loan to yourself");
  }
  requirePositive(amount, "Loan");
  if (getPowerState(state, target).eliminated) {
    throw new IllegalActionError(`'${target}' is out of the game`);
  }
  const fromState = spend(getPowerState(state, from), amount);
  const targetState = getPowerState(state, target);
  let next = withPower(state, fromState);
  next = withPower(next, { ...targetState, treasury: targetState.treasury + amount });
  next = recordGift(next, from, target, amount);
  return { state: next, events: [] };
}

function loanMinor(
  state: GameState,
  ruleSet: RuleSet,
  power: PowerId,
  area: AreaId,
  amount: number,
): GameState {
  requireCan(canDiplomacy(state), "fund a minor");
  requirePositive(amount, "Aid");
  const a = getAreaState(state, area);
  if (a.owner !== null) {
    throw new IllegalActionError(`Area ${area} is not a neutral minor`);
  }
  const p = spend(getPowerState(state, power), amount);
  let next = withPower(state, p);
  const newTroops = a.troops + floorTroops(amount * ruleSet.economy.minorTroopsPerDollar, ruleSet.limits.troopUnit);
  next = withArea(next, { ...getAreaState(next, area), troops: newTroops });
  return next;
}

function spy(
  state: GameState,
  ruleSet: RuleSet,
  power: PowerId,
  area: AreaId,
): ReduceResult {
  requireCan(canEspionage(state), "spy");
  const a = getAreaState(state, area);
  if (a.owner === power) {
    throw new IllegalActionError(`Area ${area} is your own; there is nothing to spy on`);
  }
  const cost =
    a.fortified || a.supplyCenterOf !== null
      ? ruleSet.costs.spyFortified
      : ruleSet.costs.spyMinor;
  const p = spend(getPowerState(state, power), cost);
  const next = recordIntel(withPower(state, p), power, area);
  return {
    state: next,
    events: [
      { type: "SPY_RESULT", by: power, area, troops: a.troops, income: a.income },
    ],
  };
}

function subvert(
  state: GameState,
  ruleSet: RuleSet,
  power: PowerId,
  area: AreaId,
): ReduceResult {
  requireCan(canSubvert(state), "subvert");
  const a = getAreaState(state, area);
  if (a.owner !== null) {
    throw new IllegalActionError(`Area ${area} is not a neutral minor`);
  }
  // One bribe is a fixed payment. It chips away at the garrison; the money is
  // gone whether or not this bribe is the one that finally flips the country.
  const bribe = ruleSet.subversion.bribeCost;
  const p = spend(getPowerState(state, power), bribe);
  let next = withPower(state, p);

  const resistance = 1 + a.income * ruleSet.subversion.worthResistance;
  const base = (bribe * ruleSet.subversion.baseTroopsPerDollar) / resistance;
  // Each bribe lands with a random swing, so the flip point is never certain.
  const rng = new Rng(next.rngState);
  const swing = 1 + (rng.next() * 2 - 1) * ruleSet.subversion.bribeVariance;
  next = { ...next, rngState: rng.snapshot() };
  const unit = ruleSet.limits.troopUnit;
  const removed = Math.max(unit, roundTroops(base * swing, unit));
  const remaining = a.troops - removed;
  const events: GameEvent[] = [];

  if (remaining <= 0) {
    next = withArea(next, {
      ...getAreaState(next, area),
      troops: ruleSet.subversion.coupGarrison,
    });
    const changed = changeControl(next, area, power, false); // coups award no VP
    next = changed.state;
    events.push(...changed.events);
    events.push({ type: "SUBVERSION", by: power, area, troopsRemoved: a.troops, coup: true });
  } else {
    next = withArea(next, { ...getAreaState(next, area), troops: remaining });
    events.push({ type: "SUBVERSION", by: power, area, troopsRemoved: removed, coup: false });
  }
  return { state: next, events };
}

/** Marching into a great power's land needs a declared war. */
function requireMayAttack(state: GameState, power: PowerId, to: AreaId): void {
  const owner = getAreaState(state, to).owner;
  if (!canAttackOwner(state, power, owner)) {
    throw new IllegalActionError(`You are not at war with ${String(owner)}; declare war first`);
  }
}

/** Troops always move in whole troop units (thousands). */
function requireWholeUnits(ruleSet: RuleSet, troops: number): void {
  const unit = ruleSet.limits.troopUnit;
  if (troops % unit !== 0) {
    throw new IllegalActionError(`Troops move in steps of ${unit}, got ${troops}`);
  }
}

function moveArmy(
  state: GameState,
  ruleSet: RuleSet,
  world: WorldDefinition,
  power: PowerId,
  from: AreaId,
  to: AreaId,
  troops: number,
): GameState {
  if (state.armyMovesRemaining <= 0) {
    throw new IllegalActionError("No army moves remaining this turn");
  }
  const src = requireOwnedBy(state, from, power);
  if (!neighborsOf(world, from).includes(to)) {
    throw new IllegalActionError(`Area ${to} is not adjacent to ${from}`);
  }
  requireMayAttack(state, power, to);
  const maxMovable = src.troops - ruleSet.limits.minGarrison;
  if (troops <= 0 || troops > maxMovable) {
    throw new IllegalActionError(
      `Can move 1..${Math.max(0, maxMovable)} troops from ${from}, got ${troops}`,
    );
  }
  requireWholeUnits(ruleSet, troops);
  const move: PendingMove = { power, from, to, troops, fleets: 0, bySea: false };
  const next = withArea(state, { ...src, troops: src.troops - troops });
  return {
    ...next,
    pending: [...next.pending, move],
    armyMovesRemaining: next.armyMovesRemaining - 1,
    tick: next.tick + 1,
  };
}

function moveFleet(
  state: GameState,
  ruleSet: RuleSet,
  world: WorldDefinition,
  power: PowerId,
  from: AreaId,
  to: AreaId,
  fleets: number,
  troops: number,
): GameState {
  if (state.fleetMovesRemaining <= 0) {
    throw new IllegalActionError("No fleet moves remaining this turn");
  }
  const src = requireOwnedBy(state, from, power);
  if (!getArea(world, from).isPort) {
    throw new IllegalActionError(`Origin ${from} is not a port`);
  }
  if (!getArea(world, to).isPort) {
    throw new IllegalActionError(`Destination ${to} is not a port`);
  }
  if (to === from) {
    throw new IllegalActionError("A fleet must sail to a different port");
  }
  requireMayAttack(state, power, to);
  if (fleets <= 0 || fleets > src.fleets) {
    throw new IllegalActionError(`Can move 1..${src.fleets} fleets from ${from}, got ${fleets}`);
  }
  if (troops < 0 || troops > fleets * ruleSet.limits.troopsPerFleet) {
    throw new IllegalActionError(
      `Fleets can carry at most ${fleets * ruleSet.limits.troopsPerFleet} troops`,
    );
  }
  requireWholeUnits(ruleSet, troops);
  if (troops > src.troops - ruleSet.limits.minGarrison) {
    throw new IllegalActionError(`Must leave a garrison of ${ruleSet.limits.minGarrison} in ${from}`);
  }
  const move: PendingMove = { power, from, to, troops, fleets, bySea: true };
  const next = withArea(state, {
    ...src,
    fleets: src.fleets - fleets,
    troops: src.troops - troops,
  });
  return {
    ...next,
    pending: [...next.pending, move],
    fleetMovesRemaining: next.fleetMovesRemaining - 1,
    tick: next.tick + 1,
  };
}

/**
 * The pure reducer: validate and apply one Action. Illegal actions throw
 * (loud errors), never silently no-op.
 */
export function reduce(
  state: GameState,
  action: Action,
  ruleSet: RuleSet,
  world: WorldDefinition,
): ReduceResult {
  if (state.winner !== null) {
    throw new IllegalActionError("Game is over; no further actions allowed");
  }
  const power = requireActivePower(state);

  switch (action.type) {
    case "BUILD_ARMY":
      return { state: buildArmy(state, ruleSet, power, action.area, action.troops), events: [] };
    case "BUILD_FLEET":
      return {
        state: buildFleet(state, ruleSet, world, power, action.area, action.fleets),
        events: [],
      };
    case "FORTIFY":
      return { state: fortify(state, ruleSet, power, action.area), events: [] };
    case "LOAN_POWER":
      return loanPower(state, power, action.target, action.amount);
    case "LOAN_MINOR":
      return { state: loanMinor(state, ruleSet, power, action.area, action.amount), events: [] };
    case "SPY":
      return spy(state, ruleSet, power, action.area);
    case "SUBVERT":
      return subvert(state, ruleSet, power, action.area);
    case "MOVE_ARMY":
      return {
        state: moveArmy(state, ruleSet, world, power, action.from, action.to, action.troops),
        events: [],
      };
    case "MOVE_FLEET":
      return {
        state: moveFleet(
          state,
          ruleSet,
          world,
          power,
          action.from,
          action.to,
          action.fleets,
          action.troops,
        ),
        events: [],
      };
    case "DECLARE_WAR":
      return declareWarAction(state, ruleSet, power, action.target);
    case "OFFER_PEACE":
      return offerPeaceAction(state, ruleSet, power, action.target, action.payment, action.cede ?? [], action.demand ?? []);
    case "ANSWER_PEACE":
      return answerPeaceAction(state, ruleSet, world, power, action.from, action.accept);
    case "JOIN_COALITION":
      return joinCoalitionAction(state, ruleSet, power, action.target);
    case "PROPOSE":
      return proposeAction(state, ruleSet, power, action);
    case "ANSWER_PROPOSAL":
      return answerProposalAction(state, ruleSet, power, action.from, action.kind, action.accept);
    case "ANSWER_CALL":
      return answerCallAction(state, ruleSet, power, action.partner, action.join);
    case "LEAVE_ALLIANCE":
      return leaveAllianceAction(state, ruleSet, power, action.ally);
    case "END_TURN":
      if (callsTo(state, power).length > 0) {
        throw new IllegalActionError("Answer your ally's call to arms before ending the turn");
      }
      return { state: endTurnFor(state, ruleSet), events: [] };
    default: {
      const exhaustive: never = action;
      throw new IllegalActionError(`Unknown action ${JSON.stringify(exhaustive)}`);
    }
  }
}
