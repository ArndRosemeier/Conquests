import { effectiveness } from "../../engine/state/combat.ts";
import {
  canBuild,
  canEspionage,
  canSubvert,
} from "../../engine/state/legalActions.ts";
import { reduce } from "../../engine/state/reducer.ts";
import { getPowerState } from "../../engine/state/helpers.ts";
import { perceive } from "../../engine/state/knowledge.ts";
import type { AreaState, GameState, PersonaKnobs } from "../../engine/state/gameState.ts";
import type { Action } from "../../engine/state/actions.ts";
import { getPowerDef } from "../../engine/ruleset/classic.ts";
import type { RuleSet } from "../../engine/ruleset/types.ts";
import { getArea, neighborsOf } from "../../engine/world/classic.ts";
import type { WorldDefinition } from "../../engine/world/types.ts";
import type { AreaId, PowerId } from "../../engine/types.ts";
import {
  appetite,
  defenseSafety,
  invasionCaution,
  knobs as neutralKnobs,
  navalWeight,
  riskThreshold,
} from "./persona.ts";
import type { DecisionContext, PlayerController } from "../types.ts";

/**
 * Value model. Everything the AI weighs is expressed in abstract "points" so
 * that seizing victory value, banking income, and spending cash are directly
 * comparable. A dollar is worth {@link POINTS_PER_DOLLAR}; recurring area income
 * is valued over a {@link INCOME_HORIZON}-year horizon (income is an asset, a
 * bribe or a build is a one-off cost). Victory points are counted at face value.
 */
const POINTS_PER_DOLLAR = 1e-5;
const INCOME_HORIZON = 4;

/** How much a stale enemy garrison estimate is inflated per season of age. */
const STALE_GROWTH_PER_SEASON = 0.15;
/** Re-scout a border area once its snapshot is at least this many seasons old. */
const RESPY_AGE_SEASONS = 2;
/** A tiny assault floor so undefended grabs still send a credible force. */
const MIN_ASSAULT = 1_000;
/** Safety cap on the greedy loop and on any single bribe run. */
const MAX_ITERS = 200;
const MAX_BRIBES_PER_TARGET = 40;
/** How many of the nearest overseas ports a naval power will consider scouting. */
const MAX_SEA_SCOUTS = 10;

/** The AI's fair belief about a foreign area, derived only from its own intel. */
interface Estimate {
  readonly troops: number;
  readonly fleets: number;
  readonly fortified: boolean;
  /** False when the area has never been scouted (the AI must not peek). */
  readonly known: boolean;
}

/** A candidate play: a score in points plus the concrete actions to emit. */
interface Plan {
  readonly score: number;
  readonly actions: readonly Action[];
}

/**
 * A utility-driven AI. Each turn it repeatedly enumerates every legal play,
 * scores each by a persona-weighted expected value, greedily commits the best
 * against a running simulation, and stops when nothing scores positively. All
 * behavioral character comes from the power's persona (a vector of weights);
 * there is no difficulty dial. Fully interchangeable with a human controller.
 */
export class AIController implements PlayerController {
  public readonly kind = "ai" as const;

  public constructor(
    private readonly ruleSet: RuleSet,
    private readonly world: WorldDefinition,
  ) {}

  public async requestActions(ctx: DecisionContext): Promise<readonly Action[]> {
    return this.planTurn(ctx.view.state, ctx.view.power);
  }

  private persona(state: GameState, power: PowerId): PersonaKnobs {
    return getPowerState(state, power).persona ?? neutralKnobs({});
  }

  // --- Turn planning --------------------------------------------------------

  private planTurn(state: GameState, power: PowerId): readonly Action[] {
    const knobs = this.persona(state, power);
    const out: Action[] = [];
    let sim = state;

    for (let iter = 0; iter < MAX_ITERS; iter += 1) {
      const plans = this.candidates(sim, power, knobs)
        .filter((p) => p.score > 0)
        .sort((a, b) => b.score - a.score);
      if (plans.length === 0) break;

      // Commit the best plan that still applies cleanly to the running sim.
      let committed = false;
      for (const plan of plans) {
        const next = this.applyAll(sim, plan.actions);
        if (next !== null) {
          sim = next;
          out.push(...plan.actions);
          committed = true;
          break;
        }
      }
      if (!committed) break;
    }

    // Cash is always spent: dump any remaining treasury into troops.
    const spendDown = this.spendDown(sim, power);
    if (spendDown !== null && this.applyAll(sim, [spendDown]) !== null) {
      out.push(spendDown);
    }

    return out;
  }

  /** Apply a whole action list; returns the resulting state, or null if any failed. */
  private applyAll(sim: GameState, actions: readonly Action[]): GameState | null {
    let next = sim;
    for (const action of actions) {
      try {
        next = reduce(next, action, this.ruleSet, this.world).state;
      } catch {
        return null;
      }
    }
    return next;
  }

  private candidates(state: GameState, power: PowerId, knobs: PersonaKnobs): Plan[] {
    const plans: Plan[] = [];
    plans.push(...this.spyPlans(state, power, knobs));
    plans.push(...this.conquerLandPlans(state, power, knobs));
    plans.push(...this.conquerSeaPlans(state, power, knobs));
    plans.push(...this.bribePlans(state, power, knobs));
    plans.push(...this.fortifyPlans(state, power, knobs));
    return plans;
  }

  // --- Shared helpers -------------------------------------------------------

  private ownedIds(state: GameState, power: PowerId): Set<AreaId> {
    const set = new Set<AreaId>();
    for (const a of Object.values(state.areas)) {
      if (a.owner === power) set.add(a.id);
    }
    return set;
  }

  /** Fair estimate of a foreign area's garrison, from this power's intel only. */
  private estimate(state: GameState, power: PowerId, id: AreaId): Estimate {
    const view = perceive(state, power, id);
    if (view.kind === "own") {
      return { troops: view.troops, fleets: view.fleets, fortified: view.fortified, known: true };
    }
    if (view.kind === "unknown") return { troops: 0, fleets: 0, fortified: false, known: false };
    const inflate = view.owner === null ? 1 : 1 + STALE_GROWTH_PER_SEASON * view.ageSeasons;
    return {
      troops: Math.ceil(view.troops * inflate),
      fleets: view.fleets,
      fortified: view.fortified,
      known: true,
    };
  }

  /** Points value of holding an area: its victory points plus banked income. */
  private worth(area: AreaState): number {
    return area.victoryValue + area.income * POINTS_PER_DOLLAR * INCOME_HORIZON;
  }

  private incomeWorth(area: AreaState): number {
    return area.income * POINTS_PER_DOLLAR * INCOME_HORIZON;
  }

  private points(dollars: number): number {
    return dollars * POINTS_PER_DOLLAR;
  }

  /** Enemy pressure on an owned area: the strongest scouted hostile neighbor. */
  private localThreat(state: GameState, power: PowerId, id: AreaId): number {
    let worst = 0;
    for (const nb of neighborsOf(this.world, id)) {
      const a = state.areas[String(nb)];
      if (a === undefined || a.owner === power) continue;
      const est = this.estimate(state, power, nb);
      if (est.known && est.troops > worst) worst = est.troops;
    }
    return worst;
  }

  /** Troops that must stay to defend an area, per the reserves knob. */
  private reserveNeeded(state: GameState, power: PowerId, knobs: PersonaKnobs, id: AreaId): number {
    const threat = this.localThreat(state, power, id);
    return Math.max(
      this.ruleSet.limits.minGarrison,
      Math.ceil(defenseSafety(knobs.reserves) * threat),
    );
  }

  private surplus(state: GameState, power: PowerId, knobs: PersonaKnobs, area: AreaState): number {
    return Math.max(0, area.troops - this.reserveNeeded(state, power, knobs, area.id));
  }

  /** Effective attack strength per attacking troop for this power. */
  private attEff(power: PowerId): number {
    return effectiveness(this.ruleSet, getPowerDef(this.ruleSet, power).armyOffense);
  }

  /** Effective defense strength per defending troop of an area (with terrain/fort). */
  private defEff(target: AreaState, est: Estimate): number {
    const base =
      target.owner === null
        ? target.minorDefense
        : getPowerDef(this.ruleSet, target.owner).armyDefense;
    const terrain = getArea(this.world, target.id).terrain;
    return (
      effectiveness(this.ruleSet, base) *
      (1 + terrain * this.ruleSet.combat.terrainDefensePerPoint) *
      (est.fortified ? this.ruleSet.combat.fortificationDefenseMultiplier : 1)
    );
  }

  /**
   * Troops needed to reach this persona's win-probability bar against a target,
   * and the predicted win probability at that force. Sizing is analytic (no
   * Monte-Carlo) so many candidates can be scored cheaply.
   */
  private assault(target: AreaState, est: Estimate, knobs: PersonaKnobs, power: PowerId): {
    troops: number;
    winProb: number;
  } {
    const defPower = est.troops * this.defEff(target, est);
    const attEff = this.attEff(power);
    const thr = riskThreshold(knobs.risk);
    // predictedWinProb(ratio) = clamp01((ratio - 0.7) / 0.9); solve for ratio at thr.
    const neededRatio = 0.7 + 0.9 * thr;
    const troops = Math.max(MIN_ASSAULT, Math.ceil((neededRatio * defPower) / attEff));
    const ratio = (attEff * troops) / Math.max(defPower, 1);
    const winProb = Math.max(0, Math.min(1, (ratio - 0.7) / 0.9));
    return { troops, winProb };
  }

  /** The current overall score leader (for the deny-the-leader aggression bonus). */
  private leader(state: GameState): PowerId | null {
    let best: PowerId | null = null;
    let bestScore = -Infinity;
    for (const p of Object.values(state.powers)) {
      if (p.score > bestScore) {
        bestScore = p.score;
        best = p.id;
      }
    }
    return best;
  }

  /** Appetite for taking a target, folding in the deny-the-leader bonus. */
  private takeAppetite(state: GameState, power: PowerId, target: AreaState, knobs: PersonaKnobs): number {
    if (target.owner === null) return appetite(knobs.expansion);
    const denyBonus = target.owner === this.leader(state) && target.owner !== power ? 1.4 : 1;
    return appetite(knobs.aggression) * denyBonus;
  }

  // --- Candidate generators -------------------------------------------------

  /** True when a power lacks fresh intel on an area and would benefit from scouting. */
  private needsIntel(state: GameState, power: PowerId, id: AreaId): boolean {
    const view = perceive(state, power, id);
    return (
      view.kind === "unknown" ||
      (view.kind === "report" && view.ageSeasons >= RESPY_AGE_SEASONS)
    );
  }

  private spyCost(area: AreaState): number {
    return area.fortified || area.supplyCenterOf !== null
      ? this.ruleSet.costs.spyFortified
      : this.ruleSet.costs.spyMinor;
  }

  /**
   * Scout targets whose intel unlocks future attacks: every land-adjacent
   * foreign area, plus - crucially for island/naval powers - the nearest
   * unscouted overseas ports. Without the latter, sea powers stay blind and
   * never invade, so the whole naval identity would be inert.
   */
  private spyPlans(state: GameState, power: PowerId, knobs: PersonaKnobs): Plan[] {
    if (!canEspionage(state)) return [];
    const owned = this.ownedIds(state, power);
    const plans: Plan[] = [];
    const seen = new Set<AreaId>();

    const addTarget = (id: AreaId, seaScale: number): void => {
      if (owned.has(id) || seen.has(id)) return;
      seen.add(id);
      const a = state.areas[String(id)];
      if (a === undefined || a.owner === power) return;
      if (!this.needsIntel(state, power, id)) return;
      const value = this.worth(a) * 0.3 * appetite(knobs.intelligence) * seaScale;
      plans.push({ score: value - this.points(this.spyCost(a)), actions: [{ type: "SPY", area: id }] });
    };

    // Land-adjacent foreign areas.
    for (const id of owned) {
      for (const nb of neighborsOf(this.world, id)) addTarget(nb, 1);
    }

    // Nearest overseas ports, weighted by naval appetite (continental personas
    // barely value them, so they rarely waste espionage reaching abroad).
    const ownedPorts = [...owned].filter((id) => getArea(this.world, id).isPort);
    if (ownedPorts.length > 0) {
      const navalW = navalWeight(knobs.naval);
      const nearest = Object.values(state.areas)
        .filter((a) => a.owner !== power && !seen.has(a.id) && getArea(this.world, a.id).isPort)
        .map((a) => ({ id: a.id, d: this.nearestDistance(a.id, ownedPorts) }))
        .sort((x, y) => x.d - y.d)
        .slice(0, MAX_SEA_SCOUTS);
      for (const t of nearest) addTarget(t.id, navalW);
    }

    return plans;
  }

  /** Shortest wrap-aware distance from an area to any of the given areas. */
  private nearestDistance(id: AreaId, from: readonly AreaId[]): number {
    const p = getArea(this.world, id).labelAnchor;
    const wrap = this.world.wrapX;
    let best = Infinity;
    for (const oid of from) {
      const q = getArea(this.world, oid).labelAnchor;
      let dx = Math.abs(p.x - q.x);
      if (wrap !== undefined) dx = Math.min(dx, wrap - dx);
      const d = Math.hypot(dx, p.y - q.y);
      if (d < best) best = d;
    }
    return best;
  }

  /** Overland assaults on adjacent hostile areas, building the shortfall if needed. */
  private conquerLandPlans(state: GameState, power: PowerId, knobs: PersonaKnobs): Plan[] {
    if (state.armyMovesRemaining <= 0) return [];
    const owned = this.ownedIds(state, power);
    const plans: Plan[] = [];
    const targets = new Set<AreaId>();
    for (const id of owned) {
      for (const nb of neighborsOf(this.world, id)) {
        if (!owned.has(nb)) targets.add(nb);
      }
    }

    for (const tid of targets) {
      const target = state.areas[String(tid)];
      if (target === undefined) continue;
      const est = this.estimate(state, power, tid);
      if (!est.known) continue; // never attack blind
      const { troops: need, winProb } = this.assault(target, est, knobs, power);

      const plan = this.bestLandLaunch(state, power, knobs, target, need, owned);
      if (plan === null) continue;

      const value = this.worth(target) * winProb * this.takeAppetite(state, power, target, knobs);
      plans.push({ score: value - this.points(plan.buildCost), actions: plan.actions });
    }
    return plans;
  }

  /** Cheapest owned land-neighbor from which `need` troops can strike `target`. */
  private bestLandLaunch(
    state: GameState,
    power: PowerId,
    knobs: PersonaKnobs,
    target: AreaState,
    need: number,
    owned: Set<AreaId>,
  ): { buildCost: number; actions: readonly Action[] } | null {
    let best: { buildCost: number; actions: readonly Action[] } | null = null;
    const def = getPowerDef(this.ruleSet, power);
    const inc = this.ruleSet.costs.troopBuildIncrement;

    for (const lid of neighborsOf(this.world, target.id)) {
      if (!owned.has(lid)) continue;
      const launch = state.areas[String(lid)];
      if (launch === undefined) continue;
      const avail = this.surplus(state, power, knobs, launch);

      let buildCost = 0;
      const actions: Action[] = [];
      if (avail < need) {
        const deficit = need - avail;
        const canBuildHere = canBuild(state) && launch.supplyCenterOf === power;
        if (!canBuildHere) continue;
        const buildTroops = Math.ceil(deficit / inc) * inc;
        buildCost = (buildTroops / 10_000) * def.armyCostPer10k;
        if (buildCost > getPowerState(state, power).treasury) continue;
        actions.push({ type: "BUILD_ARMY", area: lid, troops: buildTroops });
      }
      actions.push({ type: "MOVE_ARMY", from: lid, to: target.id, troops: need });

      if (best === null || buildCost < best.buildCost) best = { buildCost, actions };
    }
    return best;
  }

  /** Sea-borne invasions of ports, scaled down hard for continental personas. */
  private conquerSeaPlans(state: GameState, power: PowerId, knobs: PersonaKnobs): Plan[] {
    if (state.fleetMovesRemaining <= 0) return [];
    const owned = this.ownedIds(state, power);
    const ports = [...owned]
      .map((id) => state.areas[String(id)])
      .filter((a): a is AreaState => a !== undefined && getArea(this.world, a.id).isPort);
    if (ports.length === 0) return [];

    const navalW = navalWeight(knobs.naval);
    const plans: Plan[] = [];
    for (const target of Object.values(state.areas)) {
      if (target.owner === power) continue;
      if (!getArea(this.world, target.id).isPort) continue;
      const est = this.estimate(state, power, target.id);
      if (!est.known) continue;
      const { troops: need, winProb } = this.assault(target, est, knobs, power);

      const plan = this.bestSeaLaunch(state, power, knobs, target, need, est, ports);
      if (plan === null) continue;

      // A cross-region amphibious loss destroys the whole landing force (the
      // engine returns no survivors home), unlike an overland or same-region
      // assault. Price that downside in: the expected value of the troops that
      // would be annihilated on a defeat, scaled by the persona's risk appetite
      // (bold personas discount it and gamble on invasions; cautious ones inflate
      // it and prefer bridgeheads + overland expansion). This makes a high-naval,
      // high-risk persona play as an "invader" while still letting any persona
      // grab weak, juicy ports.
      const def = getPowerDef(this.ruleSet, power);
      const troopValue = need * (def.armyCostPer10k / 10_000);
      const expectedLoss = plan.crossRegion
        ? (1 - winProb) * troopValue * invasionCaution(knobs.risk)
        : 0;

      const value =
        this.worth(target) * winProb * this.takeAppetite(state, power, target, knobs) * navalW;
      plans.push({
        score: value - this.points(plan.buildCost) - this.points(expectedLoss),
        actions: plan.actions,
      });
    }
    return plans;
  }

  private bestSeaLaunch(
    state: GameState,
    power: PowerId,
    knobs: PersonaKnobs,
    target: AreaState,
    need: number,
    est: Estimate,
    ports: readonly AreaState[],
  ): { buildCost: number; crossRegion: boolean; actions: readonly Action[] } | null {
    let best: { buildCost: number; crossRegion: boolean; actions: readonly Action[] } | null = null;
    const def = getPowerDef(this.ruleSet, power);
    const tinc = this.ruleSet.costs.troopBuildIncrement;
    const finc = this.ruleSet.costs.fleetBuildIncrement;
    const tpf = this.ruleSet.limits.troopsPerFleet;
    const targetRegion = getArea(this.world, target.id).region;
    // Enough hulls to both ferry the troops and outweigh the defender's fleets.
    const needFleets = Math.ceil(need / tpf) + est.fleets;

    for (const launch of ports) {
      if (launch.id === target.id) continue;
      const availTroops = this.surplus(state, power, knobs, launch);
      const actions: Action[] = [];
      let buildCost = 0;
      const treasury = getPowerState(state, power).treasury;

      if (availTroops < need) {
        const deficit = need - availTroops;
        if (!(canBuild(state) && launch.supplyCenterOf === power)) continue;
        const buildTroops = Math.ceil(deficit / tinc) * tinc;
        buildCost += (buildTroops / 10_000) * def.armyCostPer10k;
        actions.push({ type: "BUILD_ARMY", area: launch.id, troops: buildTroops });
      }
      if (launch.fleets < needFleets) {
        const deficit = needFleets - launch.fleets;
        if (!(canBuild(state) && launch.supplyCenterOf === power)) continue;
        const buildFleets = Math.ceil(deficit / finc) * finc;
        buildCost += (buildFleets / 5) * def.navyCostPer5;
        actions.push({ type: "BUILD_FLEET", area: launch.id, fleets: buildFleets });
      }
      if (buildCost > treasury) continue;
      actions.push({
        type: "MOVE_FLEET",
        from: launch.id,
        to: target.id,
        fleets: needFleets,
        troops: need,
      });

      // A same-region launch is a bridgehead: on a loss the troops draw back
      // instead of being annihilated, so it is strongly preferred over a
      // transoceanic (cross-region) assault, then cheapest build wins.
      const crossRegion = getArea(this.world, launch.id).region !== targetRegion;
      const better =
        best === null ||
        (Number(crossRegion) !== Number(best.crossRegion)
          ? Number(crossRegion) < Number(best.crossRegion)
          : buildCost < best.buildCost);
      if (better) best = { buildCost, crossRegion, actions };
    }
    return best;
  }

  /** Bribe scouted, adjacent neutral minors into a coup (income, no victory points). */
  private bribePlans(state: GameState, power: PowerId, knobs: PersonaKnobs): Plan[] {
    if (!canSubvert(state)) return [];
    const owned = this.ownedIds(state, power);
    const { bribeCost, baseTroopsPerDollar, worthResistance, bribeVariance } =
      this.ruleSet.subversion;
    const treasury = getPowerState(state, power).treasury;
    const plans: Plan[] = [];
    const seen = new Set<AreaId>();

    for (const id of owned) {
      for (const nb of neighborsOf(this.world, id)) {
        if (owned.has(nb) || seen.has(nb)) continue;
        seen.add(nb);
        const minor = state.areas[String(nb)];
        if (minor === undefined || minor.owner !== null) continue;
        const est = this.estimate(state, power, nb);
        if (!est.known) continue;

        const resistance = 1 + minor.income * worthResistance;
        const perBribe = (bribeCost * baseTroopsPerDollar) / resistance;
        // Budget for the worst-case swing so a run reliably flips the minor.
        const worst = Math.max(1, Math.floor(perBribe * (1 - bribeVariance)));
        const bribes = Math.ceil(est.troops / worst);
        if (bribes <= 0 || bribes > MAX_BRIBES_PER_TARGET) continue;
        const total = bribes * bribeCost;
        if (total > treasury) continue;

        const value = this.incomeWorth(minor) * appetite(knobs.corrupt);
        const score = value - this.points(total);
        const actions: Action[] = [];
        for (let i = 0; i < bribes; i += 1) actions.push({ type: "SUBVERT", area: nb });
        plans.push({ score, actions });
      }
    }
    return plans;
  }

  /** Fortify threatened frontier holdings, weighted by the fortification knob. */
  private fortifyPlans(state: GameState, power: PowerId, knobs: PersonaKnobs): Plan[] {
    if (!canBuild(state)) return [];
    const owned = this.ownedIds(state, power);
    const cost = this.ruleSet.costs.fortification;
    const treasury = getPowerState(state, power).treasury;
    if (cost > treasury) return [];
    const plans: Plan[] = [];

    for (const id of owned) {
      const area = state.areas[String(id)];
      if (area === undefined || area.fortified) continue;
      const threat = this.localThreat(state, power, id);
      if (threat <= 0) continue;
      const pressure = Math.min(1, threat / (area.troops + 1));
      const value = this.worth(area) * pressure * appetite(knobs.fortification);
      plans.push({ score: value - this.points(cost), actions: [{ type: "FORTIFY", area: id }] });
    }
    return plans;
  }

  /**
   * Spend every remaining dollar. Normally on troops at the best frontier supply
   * center; but a port power whose idle troops already exceed its fleet lift
   * capacity buys transport instead, so island/naval powers can actually project
   * force rather than stockpiling armies they can never ship.
   */
  private spendDown(state: GameState, power: PowerId): Action | null {
    if (!canBuild(state)) return null;
    const owned = this.ownedIds(state, power);
    const def = getPowerDef(this.ruleSet, power);
    const treasury = getPowerState(state, power).treasury;

    // Choose the "front" supply center; for a port power, also track a port SC.
    let bestId: AreaId | null = null;
    let bestFrontier = -1;
    let portSc: AreaId | null = null;
    for (const id of owned) {
      const area = state.areas[String(id)];
      if (area === undefined || area.supplyCenterOf !== power) continue;
      const frontier = neighborsOf(this.world, id).filter((nb) => !owned.has(nb)).length;
      if (frontier > bestFrontier) {
        bestFrontier = frontier;
        bestId = id;
      }
      if (portSc === null && getArea(this.world, id).isPort) portSc = id;
    }

    // A port power short on hulls buys fleets to lift its stranded troops.
    if (portSc !== null) {
      const min = this.ruleSet.limits.minGarrison;
      let idleTroops = 0;
      let capacity = 0;
      for (const id of owned) {
        const a = state.areas[String(id)];
        if (a === undefined) continue;
        idleTroops += Math.max(0, a.troops - min);
        capacity += a.fleets * this.ruleSet.limits.troopsPerFleet;
      }
      if (capacity < idleTroops) {
        const groups = Math.floor(treasury / def.navyCostPer5);
        if (groups > 0) {
          return { type: "BUILD_FLEET", area: portSc, fleets: groups * this.ruleSet.costs.fleetBuildIncrement };
        }
      }
    }

    const chunks = Math.floor(treasury / def.armyCostPer10k);
    if (chunks <= 0 || bestId === null) return null;
    return { type: "BUILD_ARMY", area: bestId, troops: chunks * this.ruleSet.costs.troopBuildIncrement };
  }
}
