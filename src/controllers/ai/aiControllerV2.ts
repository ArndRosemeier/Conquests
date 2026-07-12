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
 * FROZEN BASELINE. A verbatim copy of the instrumental-intel utility AI, kept
 * unchanged as the "v2" control group for A/B testing against the evolving
 * {@link AIController} ("v3"). Do not tune this file; changes belong in v3.
 *
 * Value model. Everything the AI weighs is expressed in abstract "points" so
 * that seizing victory value, banking income, and spending cash are directly
 * comparable. A dollar is worth {@link POINTS_PER_DOLLAR}; recurring area income
 * is valued over a {@link INCOME_HORIZON}-year horizon. It prices a scout only by
 * the conquest/bribe it would unlock, grabs static neutrals on a prior, weights
 * victory value (the win condition), and consolidates contiguous territory.
 */
const POINTS_PER_DOLLAR = 1e-5;
const INCOME_HORIZON = 4;

/** How much a stale enemy garrison estimate is inflated per season of age. */
const STALE_GROWTH_PER_SEASON = 0.08;
/** Re-scout a border area once its snapshot is at least this many seasons old. */
const RESPY_AGE_SEASONS = 3;
/** A tiny assault floor so undefended grabs still send a credible force. */
const MIN_ASSAULT = 1_000;
/** Safety cap on the greedy loop and on any single bribe run. */
const MAX_ITERS = 200;
const MAX_BRIBES_PER_TARGET = 40;
/** How many of the nearest overseas ports a naval power will consider scouting. */
const MAX_SEA_SCOUTS = 6;
const MAX_SCOUTS_PER_TURN = 12;
const INTEL_DISCOUNT = 0.6;
const EXPANSION_DRIVE = 2.2;
const RESERVE_SCALE = 0.6;
const ASSAULT_MARGIN = 0.05;
const NEUTRAL_BAR_SCALE = 0.7;
const PRIOR_NEUTRAL_TROOPS = 60_000;
const PRIOR_ENEMY_TROOPS = 80_000;
const SPENDDOWN_SPREAD = 3;
const VP_WEIGHT = 3;
const CONSOLIDATION = 1.6;

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
 * The frozen v2 utility AI (see file header). Identical in shape to v3 but
 * without v3's behavioral additions, so A/B games isolate those changes.
 */
export class AIControllerV2 implements PlayerController {
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
      const spiesLeft = MAX_SCOUTS_PER_TURN - out.filter((a) => a.type === "SPY").length;
      const plans = this.candidates(sim, power, knobs, spiesLeft)
        .filter((p) => p.score > 0)
        .sort((a, b) => b.score - a.score);
      if (plans.length === 0) break;

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

    const spendDown = this.spendDown(sim, power);
    if (spendDown.length > 0 && this.applyAll(sim, spendDown) !== null) {
      out.push(...spendDown);
    }

    return out;
  }

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

  private candidates(
    state: GameState,
    power: PowerId,
    knobs: PersonaKnobs,
    spiesLeft: number,
  ): Plan[] {
    const plans: Plan[] = [];
    plans.push(...this.spyPlans(state, power, knobs, spiesLeft));
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

  private priorEstimate(state: GameState, power: PowerId, area: AreaState): Estimate {
    if (area.owner === null) {
      return { troops: PRIOR_NEUTRAL_TROOPS, fleets: 0, fortified: false, known: true };
    }
    const view = perceive(state, power, area.id);
    if (view.kind === "report") {
      return {
        troops: Math.ceil(view.troops * (1 + STALE_GROWTH_PER_SEASON * view.ageSeasons)),
        fleets: view.fleets,
        fortified: view.fortified,
        known: true,
      };
    }
    return { troops: PRIOR_ENEMY_TROOPS, fleets: 0, fortified: false, known: true };
  }

  private worth(area: AreaState): number {
    return area.victoryValue * VP_WEIGHT + area.income * POINTS_PER_DOLLAR * INCOME_HORIZON;
  }

  private incomeWorth(area: AreaState): number {
    return area.income * POINTS_PER_DOLLAR * INCOME_HORIZON;
  }

  private points(dollars: number): number {
    return dollars * POINTS_PER_DOLLAR;
  }

  private conquestDrive(target: AreaState): number {
    return target.owner === null ? EXPANSION_DRIVE : 1;
  }

  private regionMembersCache: Map<number, readonly AreaId[]> | null = null;

  private regionMembers(): Map<number, readonly AreaId[]> {
    if (this.regionMembersCache === null) {
      const m = new Map<number, AreaId[]>();
      for (const a of this.world.areas) {
        const list = m.get(a.region) ?? [];
        list.push(a.id);
        m.set(a.region, list);
      }
      this.regionMembersCache = m;
    }
    return this.regionMembersCache;
  }

  private consolidation(state: GameState, power: PowerId, area: AreaState): number {
    const region = getArea(this.world, area.id).region;
    const ids = this.regionMembers().get(region) ?? [];
    if (ids.length <= 1) return 1;
    let owned = 0;
    for (const id of ids) if (state.areas[String(id)]?.owner === power) owned += 1;
    return 1 + CONSOLIDATION * (owned / ids.length);
  }

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

  private reserveNeeded(state: GameState, power: PowerId, knobs: PersonaKnobs, id: AreaId): number {
    const threat = this.localThreat(state, power, id);
    return Math.max(
      this.ruleSet.limits.minGarrison,
      Math.ceil(RESERVE_SCALE * defenseSafety(knobs.reserves) * threat),
    );
  }

  private surplus(state: GameState, power: PowerId, knobs: PersonaKnobs, area: AreaState): number {
    return Math.max(0, area.troops - this.reserveNeeded(state, power, knobs, area.id));
  }

  private attEff(power: PowerId): number {
    return effectiveness(this.ruleSet, getPowerDef(this.ruleSet, power).armyOffense);
  }

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

  private assault(target: AreaState, est: Estimate, knobs: PersonaKnobs, power: PowerId): {
    troops: number;
    winProb: number;
  } {
    const defPower = est.troops * this.defEff(target, est);
    const attEff = this.attEff(power);
    const thr = riskThreshold(knobs.risk);
    const neutralScale = target.owner === null ? NEUTRAL_BAR_SCALE : 1;
    const neededRatio = (0.7 + 0.9 * thr) * (1 + ASSAULT_MARGIN) * neutralScale;
    const troops = Math.max(MIN_ASSAULT, Math.ceil((neededRatio * defPower) / attEff));
    const ratio = (attEff * troops) / Math.max(defPower, 1);
    const winProb = Math.max(0, Math.min(1, (ratio - 0.7) / 0.9));
    return { troops, winProb };
  }

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

  private takeAppetite(state: GameState, power: PowerId, target: AreaState, knobs: PersonaKnobs): number {
    if (target.owner === null) return appetite(knobs.expansion);
    const denyBonus = target.owner === this.leader(state) && target.owner !== power ? 1.4 : 1;
    return appetite(knobs.aggression) * denyBonus;
  }

  // --- Candidate generators -------------------------------------------------

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

  private expectedUnlock(
    state: GameState,
    power: PowerId,
    knobs: PersonaKnobs,
    area: AreaState,
    seaScale: number,
  ): number {
    const est = this.priorEstimate(state, power, area);
    const { winProb } = this.assault(area, est, knobs, power);
    return (
      this.worth(area) *
      winProb *
      this.takeAppetite(state, power, area, knobs) *
      this.conquestDrive(area) *
      this.consolidation(state, power, area) *
      seaScale
    );
  }

  private spyPlans(
    state: GameState,
    power: PowerId,
    knobs: PersonaKnobs,
    spiesLeft: number,
  ): Plan[] {
    if (spiesLeft <= 0 || !canEspionage(state)) return [];
    const owned = this.ownedIds(state, power);
    const treasury = getPowerState(state, power).treasury;
    const plans: Plan[] = [];
    const seen = new Set<AreaId>();

    const addTarget = (id: AreaId, seaScale: number): void => {
      if (owned.has(id) || seen.has(id)) return;
      seen.add(id);
      const a = state.areas[String(id)];
      if (a === undefined || a.owner === power) return;
      if (!this.needsIntel(state, power, id)) return;
      const cost = this.spyCost(a);
      if (cost > treasury) return;
      const unlocked = this.expectedUnlock(state, power, knobs, a, seaScale);
      const score = unlocked * INTEL_DISCOUNT - this.points(cost);
      if (score > 0) plans.push({ score, actions: [{ type: "SPY", area: id }] });
    };

    for (const id of owned) {
      for (const nb of neighborsOf(this.world, id)) addTarget(nb, 1);
    }

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

    return plans.sort((a, b) => b.score - a.score).slice(0, spiesLeft);
  }

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
      let est = this.estimate(state, power, tid);
      if (!est.known) {
        if (target.owner !== null) continue;
        est = this.priorEstimate(state, power, target);
      }
      const { troops: need, winProb } = this.assault(target, est, knobs, power);

      const plan = this.bestLandLaunch(state, power, knobs, target, need, owned);
      if (plan === null) continue;

      const value =
        this.worth(target) *
        winProb *
        this.takeAppetite(state, power, target, knobs) *
        this.conquestDrive(target) *
        this.consolidation(state, power, target);
      plans.push({ score: value - this.points(plan.buildCost), actions: plan.actions });
    }
    return plans;
  }

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
      let est = this.estimate(state, power, target.id);
      if (!est.known) {
        if (target.owner !== null) continue;
        est = this.priorEstimate(state, power, target);
      }
      const { troops: need, winProb } = this.assault(target, est, knobs, power);

      const plan = this.bestSeaLaunch(state, power, knobs, target, need, est, ports);
      if (plan === null) continue;

      const def = getPowerDef(this.ruleSet, power);
      const troopValue = need * (def.armyCostPer10k / 10_000);
      const expectedLoss = plan.crossRegion
        ? (1 - winProb) * troopValue * invasionCaution(knobs.risk)
        : 0;

      const value =
        this.worth(target) *
        winProb *
        this.takeAppetite(state, power, target, knobs) *
        this.conquestDrive(target) *
        this.consolidation(state, power, target) *
        navalW;
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

  private spendDown(state: GameState, power: PowerId): readonly Action[] {
    if (!canBuild(state)) return [];
    const owned = this.ownedIds(state, power);
    const def = getPowerDef(this.ruleSet, power);
    const treasury = getPowerState(state, power).treasury;

    const scs: { id: AreaId; frontier: number }[] = [];
    let portSc: AreaId | null = null;
    for (const id of owned) {
      const area = state.areas[String(id)];
      if (area === undefined || area.supplyCenterOf !== power) continue;
      const frontier = neighborsOf(this.world, id).filter((nb) => !owned.has(nb)).length;
      scs.push({ id, frontier });
      if (portSc === null && getArea(this.world, id).isPort) portSc = id;
    }
    scs.sort((a, b) => b.frontier - a.frontier);

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
          return [
            { type: "BUILD_FLEET", area: portSc, fleets: groups * this.ruleSet.costs.fleetBuildIncrement },
          ];
        }
      }
    }

    const chunks = Math.floor(treasury / def.armyCostPer10k);
    if (chunks <= 0 || scs.length === 0) return [];

    const spread = Math.min(SPENDDOWN_SPREAD, scs.length);
    const inc = this.ruleSet.costs.troopBuildIncrement;
    const actions: Action[] = [];
    for (let i = 0; i < spread && chunks > 0; i += 1) {
      const share = i === 0 ? chunks - Math.floor(chunks / spread) * (spread - 1) : Math.floor(chunks / spread);
      if (share <= 0) continue;
      actions.push({ type: "BUILD_ARMY", area: scs[i]!.id, troops: share * inc });
    }
    return actions;
  }
}
