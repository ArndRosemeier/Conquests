import { effectiveness } from "../../engine/state/combat.ts";
import {
  armyMoveSources,
  buildableAreas,
  fleetBuildableAreas,
  fleetMoveSources,
  neutralMinors,
} from "../../engine/state/legalActions.ts";
import { reduce } from "../../engine/state/reducer.ts";
import { getPowerState, isAtWar } from "../../engine/state/helpers.ts";
import { isFoundingTurn } from "../../engine/state/phases.ts";
import type { AreaState, GameState } from "../../engine/state/gameState.ts";
import type { Action } from "../../engine/state/actions.ts";
import { getPowerDef } from "../../engine/ruleset/classic.ts";
import type { RuleSet } from "../../engine/ruleset/types.ts";
import { getArea, neighborsOf } from "../../engine/world/classic.ts";
import type { WorldDefinition } from "../../engine/world/types.ts";
import type { AreaId, PowerId } from "../../engine/types.ts";
import type { DecisionContext, PlayerController } from "../types.ts";

/** A simple but coherent heuristic AI. Interchangeable with a human controller. */
export class AIController implements PlayerController {
  public readonly kind = "ai" as const;

  public constructor(
    private readonly ruleSet: RuleSet,
    private readonly world: WorldDefinition,
  ) {}

  public async requestActions(ctx: DecisionContext): Promise<readonly Action[]> {
    const state = ctx.view.state;
    const power = ctx.view.power;

    // Compose the whole turn's proposers, honoring the season gates. Spring
    // (non-founding) allows building; subversion runs any spring; movement runs
    // every season. Fortify / economic aid / espionage: the AI passes for now.
    const proposers: ((s: GameState) => readonly Action[])[] = [];
    if (state.season === "SPRING" && !isFoundingTurn(state)) {
      proposers.push((s) => this.armyBuild(s, power));
      proposers.push((s) => this.fleetBuild(s, power));
    }
    if (state.season === "SPRING") {
      proposers.push((s) => this.subvert(s, power));
    }
    proposers.push((s) => this.armyMoves(s, power));
    proposers.push((s) => this.fleetMoves(s, power));

    return this.planTurn(state, proposers);
  }

  /** AI aggression / spending grows with difficulty level (0-9). */
  private budgetFraction(state: GameState, power: PowerId): number {
    const level = getPowerState(state, power).aiLevel;
    return 0.3 + level * 0.045;
  }

  /**
   * Build a whole-turn plan by running each proposer against a local simulation
   * that accumulates prior actions, so the returned batch always applies cleanly
   * to the real state (and later proposers see the effects of earlier ones).
   */
  private planTurn(
    state: GameState,
    proposers: readonly ((sim: GameState) => readonly Action[])[],
  ): readonly Action[] {
    const actions: Action[] = [];
    let sim = state;
    for (const propose of proposers) {
      for (const action of propose(sim)) {
        try {
          sim = reduce(sim, action, this.ruleSet, this.world).state;
          actions.push(action);
        } catch {
          // Skip any action that turned out illegal against the running simulation.
        }
      }
    }
    return actions;
  }

  private armyBuild(state: GameState, power: PowerId): readonly Action[] {
    const centers = buildableAreas(state, power);
    const primary = centers[0];
    if (primary === undefined) return [];
    const def = getPowerDef(this.ruleSet, power);
    const budget = getPowerState(state, power).treasury * this.budgetFraction(state, power);
    const chunks = Math.floor(budget / def.armyCostPer10k);
    if (chunks <= 0) return [];
    return [{ type: "BUILD_ARMY", area: primary.id, troops: chunks * 10_000 }];
  }

  private fleetBuild(state: GameState, power: PowerId): readonly Action[] {
    if (getPowerState(state, power).aiLevel < 3) return [];
    const ports = fleetBuildableAreas(state, this.world, power);
    const port = ports[0];
    if (port === undefined) return [];
    const def = getPowerDef(this.ruleSet, power);
    const budget = getPowerState(state, power).treasury * 0.15;
    const groups = Math.floor(budget / def.navyCostPer5);
    if (groups <= 0) return [];
    return [{ type: "BUILD_FLEET", area: port.id, fleets: groups * 5 }];
  }

  private subvert(state: GameState, power: PowerId): readonly Action[] {
    const owned = new Set(
      this.world.areas.filter((a) => state.areas[String(a.id)]?.owner === power).map((a) => a.id),
    );
    const adjacentNeutrals = neutralMinors(state).filter((m) =>
      neighborsOf(this.world, m.id).some((n) => owned.has(n)),
    );
    adjacentNeutrals.sort((a, b) => a.troops - b.troops);

    const actions: Action[] = [];
    let budget = getPowerState(state, power).treasury * 0.35;
    for (const minor of adjacentNeutrals.slice(0, 3)) {
      const resistance = 1 + minor.income * this.ruleSet.subversion.worthResistance;
      const cost = Math.ceil((minor.troops * resistance) / this.ruleSet.subversion.baseTroopsPerDollar);
      if (cost <= budget) {
        actions.push({ type: "SUBVERT", area: minor.id, amount: cost });
        budget -= cost;
      }
    }
    return actions;
  }

  private canWin(
    attackerTroops: number,
    power: PowerId,
    target: AreaState,
    terrain: number,
  ): boolean {
    const def = getPowerDef(this.ruleSet, power);
    const attEff = effectiveness(this.ruleSet, def.armyOffense);
    const defFactor =
      target.owner === null
        ? target.minorDefense
        : getPowerDef(this.ruleSet, target.owner).armyDefense;
    const defEff =
      effectiveness(this.ruleSet, defFactor) *
      (1 + terrain * this.ruleSet.combat.terrainDefensePerPoint) *
      (target.fortified ? this.ruleSet.combat.fortificationDefenseMultiplier : 1);
    return attackerTroops * attEff >= target.troops * defEff * 1.4;
  }

  private hostile(state: GameState, power: PowerId, target: AreaState, year: number): boolean {
    if (target.owner === null) return true; // neutral minors are fair game
    if (target.owner === power) return false;
    if (isAtWar(state, power, target.owner)) return true;
    // Keep an uneasy peace with other powers in the early game (manual 7.8).
    return year >= 5 && getPowerState(state, power).aiLevel >= 6;
  }

  private armyMoves(state: GameState, power: PowerId): readonly Action[] {
    const actions: Action[] = [];
    let movesLeft = this.ruleSet.limits.armyMoves;
    const min = this.ruleSet.limits.minGarrison;

    for (const src of armyMoveSources(state, this.ruleSet, power)) {
      if (movesLeft <= 0) break;
      const surplus = src.troops - min;
      if (surplus <= 0) continue;

      const targets = neighborsOf(this.world, src.id)
        .map((id) => state.areas[String(id)])
        .filter((a): a is AreaState => a !== undefined)
        .filter((a) => this.hostile(state, power, a, state.year))
        .filter((a) => this.canWin(surplus, power, a, getArea(this.world, a.id).terrain))
        .sort((a, b) => b.victoryValue - a.victoryValue);

      const best = targets[0];
      if (best !== undefined) {
        actions.push({ type: "MOVE_ARMY", from: src.id, to: best.id, troops: surplus });
        movesLeft -= 1;
      }
    }
    return actions;
  }

  private fleetMoves(state: GameState, power: PowerId): readonly Action[] {
    if (getPowerState(state, power).aiLevel < 2) return [];
    const actions: Action[] = [];
    let movesLeft = Math.min(3, this.ruleSet.limits.fleetMoves);
    const min = this.ruleSet.limits.minGarrison;

    for (const src of fleetMoveSources(state, this.world, power)) {
      if (movesLeft <= 0) break;
      const troopsAvail = src.troops - min;
      if (troopsAvail <= 0 || src.fleets <= 0) continue;

      const carry = Math.min(troopsAvail, src.fleets * this.ruleSet.limits.troopsPerFleet);
      const target = this.bestNavalTarget(state, power, carry);
      if (target !== undefined) {
        actions.push({
          type: "MOVE_FLEET",
          from: src.id,
          to: target,
          fleets: src.fleets,
          troops: carry,
        });
        movesLeft -= 1;
      }
    }
    return actions;
  }

  private bestNavalTarget(
    state: GameState,
    power: PowerId,
    carry: number,
  ): AreaId | undefined {
    const candidates = neutralMinors(state)
      .filter((m) => getArea(this.world, m.id).isPort)
      .filter((m) => this.canWin(carry, power, m, getArea(this.world, m.id).terrain))
      .sort((a, b) => b.victoryValue - a.victoryValue);
    return candidates[0]?.id;
  }
}
