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
 *
 * This is the active, evolving controller ("v3"). {@link "./aiControllerV2.ts"}
 * holds the frozen previous generation as an A/B control group. v3 adds
 * reinforcement flow: after acting, it marches idle troops one hop toward the
 * front each turn - but *targeted*, up a value-weighted potential field so force
 * converges on (and accumulates at) the launch point for the single most valuable
 * conquest, rather than dribbling toward the nearest edge. This lets it mass a
 * stack big enough to crack targets it could never afford in one turn's build -
 * something the myopic greedy loop (and combat's per-move battle resolution)
 * otherwise never achieves.
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

// --- tuning (kept local so the shared persona.ts mappings stay identical for
// the frozen v2 baseline) ----------------------------------------------------

/** Soft cap on *new* scouts committed in a single turn. Espionage is already
 * instrumental (only scout what you'd attack), so this is a loose backstop
 * against pathological blanketing rather than the primary throttle. */
const MAX_SCOUTS_PER_TURN = 12;
/** Uncertainty haircut applied to the value a scout is expected to unlock. */
const INTEL_DISCOUNT = 0.6;
/** Extra weight on grabbing neutral territory, so the economy actually snowballs. */
const EXPANSION_DRIVE = 2.2;
/** Scales the reserves knob down: v2 keeps fewer troops idle on defense. */
const RESERVE_SCALE = 0.6;
/** Force sent above the bare win-probability bar. Kept low: the VP race rewards
 * breadth (many cheap grabs) over thick stacks. */
const ASSAULT_MARGIN = 0.05;
/** Neutral land grabs have low downside (a lost assault just retreats with
 * casualties), so v2 accepts a lower win bar against them to grab more, faster. */
const NEUTRAL_BAR_SCALE = 0.7;
/** Assumed garrison of an unscouted neutral (common band ~12k-100k), used only to
 * decide whether scouting it is worthwhile; the real attack uses real intel. */
const PRIOR_NEUTRAL_TROOPS = 60_000;
/** Assumed garrison of a never-scouted enemy power area (they defend harder). */
const PRIOR_ENEMY_TROOPS = 80_000;
/** How many frontier supply centers leftover cash is spread across. */
const SPENDDOWN_SPREAD = 3;
/** Emphasis on an area's victory value. The game is won on the VP race and VP is
 * only earned by *conquering* areas (never by bribing), so v2 weights VP well
 * above banked income - it chases the win condition directly. */
const VP_WEIGHT = 3;
/** How strongly to favor targets inside a region the power already partly holds.
 * A consolidated, contiguous empire is more defensible and concentrates force, so
 * v3 rounds out continents rather than scattering conquests. This is a purely
 * strategic preference - it is not tied to any income bonus. */
const CONSOLIDATION = 1.6;
/** Per-hop attenuation of a front's pull as it propagates back through owned
 * territory. Near 1 a distant huge prize outshines every nearer target (troops
 * trek far); near 0 only the immediately-adjacent front matters (dumb nearest-edge
 * flow). ~0.85 balances distance against value across a typical empire. */
const REINFORCE_DECAY = 0.85;

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
      // Enforce the exploration cap across the whole turn, not per iteration.
      const spiesLeft = MAX_SCOUTS_PER_TURN - out.filter((a) => a.type === "SPY").length;
      const plans = this.candidates(sim, power, knobs, spiesLeft)
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
    const afterSpend = this.applyAll(sim, spendDown);
    if (spendDown.length > 0 && afterSpend !== null) {
      sim = afterSpend;
      out.push(...spendDown);
    }

    // Reinforcement flow: march idle interior troops one hop toward the front,
    // so force concentrates at launch points over successive turns.
    const reinforce = this.reinforceActions(sim, power, knobs);
    if (reinforce.length > 0 && this.applyAll(sim, reinforce) !== null) {
      out.push(...reinforce);
    }

    return out;
  }

  /**
   * The pull a foreign target exerts on reinforcements: its holding value, folded
   * with this power's appetite for taking it, its expansion drive, and how much it
   * rounds out a region the power already holds. Difficulty is deliberately left
   * out - the greedy loop already grabs whatever it can win cheaply each turn, so
   * what remains worth massing for are the high-value targets too big for a single
   * turn's build. This is the field reinforcement climbs.
   */
  private targetPull(state: GameState, power: PowerId, knobs: PersonaKnobs, target: AreaState): number {
    return (
      this.worth(target) *
      this.takeAppetite(state, power, target, knobs) *
      this.conquestDrive(target) *
      this.consolidation(state, power, target)
    );
  }

  /**
   * March idle troops one hop toward the front - but *targeted*. Because combat
   * resolves each move as its own battle (splitting an attack only weakens it) and
   * reinforcements arrive at end of turn, massing a war-winning stack can only be
   * done over several turns, which the greedy loop never does on its own.
   *
   * Each owned area gets a potential equal to the best conquest reachable from it,
   * propagated back through owned territory with a per-hop {@link REINFORCE_DECAY}
   * so nearer prizes outrank equally-valuable distant ones. Every area then ships
   * its surplus (troops above the defensive reserve) to whichever owned neighbor
   * stands higher on the field. Force therefore streams toward - and piles up at -
   * the launch point for the single most valuable target, cracking fortresses the
   * per-turn budget could never buy through.
   */
  private reinforceActions(state: GameState, power: PowerId, knobs: PersonaKnobs): Action[] {
    let budget = state.armyMovesRemaining;
    if (budget <= 0) return [];
    const owned = this.ownedIds(state, power);
    const navalW = navalWeight(knobs.naval);

    // Seed each owned area with the pull of its best adjacent land conquest.
    const potential = new Map<AreaId, number>();
    for (const id of owned) {
      let best = 0;
      for (const nb of neighborsOf(this.world, id)) {
        const t = state.areas[String(nb)];
        if (t === undefined || t.owner === power) continue;
        const v = this.targetPull(state, power, knobs, t);
        if (v > best) best = v;
      }
      potential.set(id, best);
    }

    // Naval staging: draw a landing force to the owned port nearest the single
    // best overseas target, so amphibious assaults launch from a fat stack.
    const ownedPorts = [...owned].filter((id) => getArea(this.world, id).isPort);
    if (navalW > 0 && ownedPorts.length > 0) {
      let bestTarget: AreaState | null = null;
      let bestVal = 0;
      for (const t of Object.values(state.areas)) {
        if (t.owner === power || !getArea(this.world, t.id).isPort) continue;
        const v = this.targetPull(state, power, knobs, t) * navalW;
        if (v > bestVal) {
          bestVal = v;
          bestTarget = t;
        }
      }
      if (bestTarget !== null) {
        let launch: AreaId | null = null;
        let bestD = Infinity;
        for (const pid of ownedPorts) {
          const d = this.nearestDistance(bestTarget.id, [pid]);
          if (d < bestD) {
            bestD = d;
            launch = pid;
          }
        }
        if (launch !== null) {
          potential.set(launch, Math.max(potential.get(launch) ?? 0, bestVal));
        }
      }
    }

    // Diffuse the potential inward: P[a] = max(own goal, best neighbor * decay).
    // A bounded number of sweeps (>= the owned graph's diameter) reaches a fixpoint.
    for (let sweep = 0; sweep < owned.size; sweep += 1) {
      let changed = false;
      for (const id of owned) {
        let p = potential.get(id)!;
        for (const nb of neighborsOf(this.world, id)) {
          if (!owned.has(nb)) continue;
          const cand = potential.get(nb)! * REINFORCE_DECAY;
          if (cand > p + 1e-9) {
            p = cand;
            changed = true;
          }
        }
        potential.set(id, p);
      }
      if (!changed) break;
    }

    // Send each area's surplus to the uphill neighbor (higher potential), biggest,
    // most valuable flows first so a tight move budget funds the decisive ones.
    interface Flow {
      readonly from: AreaId;
      readonly to: AreaId;
      readonly troops: number;
      readonly priority: number;
    }
    const flows: Flow[] = [];
    for (const id of owned) {
      const area = state.areas[String(id)];
      if (area === undefined) continue;
      const surplus = this.surplus(state, power, knobs, area);
      if (surplus <= 0) continue;
      const here = potential.get(id)!;

      let dest: AreaId | null = null;
      let destP = here;
      let destTroops = -1;
      for (const nb of neighborsOf(this.world, id)) {
        if (!owned.has(nb)) continue;
        const pn = potential.get(nb)!;
        if (pn <= here + 1e-9) continue; // must be strictly uphill
        const cand = state.areas[String(nb)];
        if (cand === undefined) continue;
        if (pn > destP + 1e-9 || (Math.abs(pn - destP) <= 1e-9 && cand.troops > destTroops)) {
          dest = nb;
          destP = pn;
          destTroops = cand.troops;
        }
      }
      if (dest !== null) flows.push({ from: id, to: dest, troops: surplus, priority: surplus * destP });
    }

    flows.sort((a, b) => b.priority - a.priority || (a.from < b.from ? -1 : 1));
    const actions: Action[] = [];
    for (const f of flows) {
      if (budget <= 0) break;
      actions.push({ type: "MOVE_ARMY", from: f.from, to: f.to, troops: f.troops });
      budget -= 1;
    }
    return actions;
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

  /**
   * A prior belief about a foreign area used only when deciding whether to *scout*
   * it (the AI has no real intel yet, so it must not peek at live troops). Neutrals
   * get a fixed common-case garrison; enemy powers reuse stale intel if any, else a
   * harder default. The actual assault is always sized from real, post-scout intel.
   */
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

  /** Points value of holding an area: its victory points (weighted, since VP wins
   * the game) plus banked income. */
  private worth(area: AreaState): number {
    return area.victoryValue * VP_WEIGHT + area.income * POINTS_PER_DOLLAR * INCOME_HORIZON;
  }

  private incomeWorth(area: AreaState): number {
    return area.income * POINTS_PER_DOLLAR * INCOME_HORIZON;
  }

  private points(dollars: number): number {
    return dollars * POINTS_PER_DOLLAR;
  }

  /** Extra appetite for grabbing neutral land, so the economy actually snowballs. */
  private conquestDrive(target: AreaState): number {
    return target.owner === null ? EXPANSION_DRIVE : 1;
  }

  private regionMembersCache: Map<number, readonly AreaId[]> | null = null;

  /** Area ids grouped by region (cached; the world is immutable). */
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

  /**
   * Multiplier favoring targets in a region the power already partly controls, so
   * the AI consolidates a contiguous bloc (defensible, force-concentrated) instead
   * of scattering conquests. Grows with the share of the region already held. A
   * strategic preference only - unrelated to income.
   */
  private consolidation(state: GameState, power: PowerId, area: AreaState): number {
    const region = getArea(this.world, area.id).region;
    const ids = this.regionMembers().get(region) ?? [];
    if (ids.length <= 1) return 1;
    let owned = 0;
    for (const id of ids) if (state.areas[String(id)]?.owner === power) owned += 1;
    return 1 + CONSOLIDATION * (owned / ids.length);
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

  /** Troops that must stay to defend an area, per the reserves knob (scaled down in v2). */
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
      this.ruleSet.combat.homeAdvantageMultiplier *
      (1 + terrain * this.ruleSet.combat.terrainDefensePerPoint) *
      (est.fortified ? this.ruleSet.combat.fortificationDefenseMultiplier : 1)
    );
  }

  /**
   * Troops needed to clear this persona's win-probability bar against a target
   * (plus a margin for a thicker, compounding stack), and the predicted win
   * probability at that force. Sizing is analytic (no Monte-Carlo) so many
   * candidates can be scored cheaply.
   */
  private assault(target: AreaState, est: Estimate, knobs: PersonaKnobs, power: PowerId): {
    troops: number;
    winProb: number;
  } {
    const defPower = est.troops * this.defEff(target, est);
    const attEff = this.attEff(power);
    const thr = riskThreshold(knobs.risk);
    // predictedWinProb(ratio) = clamp01((ratio - 0.7) / 0.9); solve for ratio at thr,
    // add a small margin, and (for low-downside neutral grabs) accept a lower bar
    // so the AI spreads across more cheap targets rather than over-committing.
    const neutralScale = target.owner === null ? NEUTRAL_BAR_SCALE : 1;
    const neededRatio = (0.7 + 0.9 * thr) * (1 + ASSAULT_MARGIN) * neutralScale;
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
   * The value a scout is expected to unlock: the payoff of the best attack it
   * would enable against this area, evaluated under a prior garrison (since the
   * true count is still unknown). This is what makes v2's espionage *instrumental*
   * - it only scouts things it plausibly intends to take.
   */
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

  /**
   * Scout only where intel pays for itself: land-adjacent foreign areas and - for
   * port powers - the nearest overseas ports, each scored by the conquest it would
   * unlock (times a discount) minus the spy's cost. At most {@link MAX_SCOUTS_PER_TURN}
   * scouts are taken per turn, so the AI probes purposefully instead of blanketing
   * the map with speculative espionage.
   */
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

    // Keep only the best few; the running turn cap does the rest.
    return plans.sort((a, b) => b.score - a.score).slice(0, spiesLeft);
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
      let est = this.estimate(state, power, tid);
      if (!est.known) {
        // Never attack an unscouted *power* blind, but a static neutral can be
        // grabbed on a prior (a failed overland assault just retreats): this lets
        // v2 expand at conquest speed instead of scouting speed.
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
      let est = this.estimate(state, power, target.id);
      if (!est.known) {
        // As on land, grab unscouted neutral ports on a prior; the cross-region
        // annihilation downside is still priced via expectedLoss below.
        if (target.owner !== null) continue;
        est = this.priorEstimate(state, power, target);
      }
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
   * Spend every remaining dollar. A port power short on hulls buys transport so it
   * can project force; otherwise cash is spread across the busiest frontier supply
   * centers (not one pile), so next turn several fronts can push at once.
   */
  private spendDown(state: GameState, power: PowerId): readonly Action[] {
    if (!canBuild(state)) return [];
    const owned = this.ownedIds(state, power);
    const def = getPowerDef(this.ruleSet, power);
    const treasury = getPowerState(state, power).treasury;

    // Rank supply centers by how much frontier they touch; track a port SC too.
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
          return [
            { type: "BUILD_FLEET", area: portSc, fleets: groups * this.ruleSet.costs.fleetBuildIncrement },
          ];
        }
      }
    }

    let chunks = Math.floor(treasury / def.armyCostPer10k);
    if (chunks <= 0 || scs.length === 0) return [];

    // Spread the troop budget across the top frontier supply centers.
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
