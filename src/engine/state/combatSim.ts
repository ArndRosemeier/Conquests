import { getPowerDef } from "../ruleset/classic.ts";
import type { RuleSet } from "../ruleset/types.ts";
import type { PowerId } from "../types.ts";
import { NEUTRAL_NAVY_FACTOR, effectiveness, fight } from "./combat.ts";
import { Rng } from "./rng.ts";

/**
 * A "what if" battle set up entirely from UI inputs. This mirrors the live
 * combat path in `resolveAttack` (naval leg, then the land battle with terrain
 * and fortification multipliers) but is pure and side-effect free so the info
 * panel can run it thousands of times to estimate probabilities.
 */
export interface BattleScenario {
  readonly attacker: PowerId;
  readonly attackerTroops: number;
  /** Attacking fleets, only relevant when `bySea`. */
  readonly attackerFleets: number;
  readonly bySea: boolean;
  /** Defender power, or null for a neutral minor (uses `minorDefenseFactor`). */
  readonly defender: PowerId | null;
  /** Neutral minor defense factor (2=A best .. 5=D worst). Ignored for powers. */
  readonly minorDefenseFactor: number;
  readonly defenderTroops: number;
  readonly defenderFleets: number;
  /** Terrain factor of the target area, 0..4. */
  readonly terrain: number;
  readonly fortified: boolean;
}

export interface BattleOdds {
  /** Probability the attacker takes the area (0..1). */
  readonly winProb: number;
  /** Probability of winning the naval leg, or null when it is not a sea assault. */
  readonly navalWinProb: number | null;
  readonly avgAttackerSurvivors: number;
  readonly avgDefenderSurvivors: number;
  readonly trials: number;
}

/** Effective per-unit army strengths for a scenario (attacker, defender). */
export function scenarioArmyEff(
  ruleSet: RuleSet,
  scenario: BattleScenario,
): { attack: number; defense: number } {
  const attack = effectiveness(ruleSet, getPowerDef(ruleSet, scenario.attacker).armyOffense);
  const baseDef =
    scenario.defender === null
      ? effectiveness(ruleSet, scenario.minorDefenseFactor)
      : effectiveness(ruleSet, getPowerDef(ruleSet, scenario.defender).armyDefense);
  const terrainMult = 1 + scenario.terrain * ruleSet.combat.terrainDefensePerPoint;
  const fortMult = scenario.fortified ? ruleSet.combat.fortificationDefenseMultiplier : 1;
  return { attack, defense: baseDef * ruleSet.combat.homeAdvantageMultiplier * terrainMult * fortMult };
}

/** Monte-Carlo estimate of a battle's outcome using the real combat resolver. */
export function estimateBattle(
  ruleSet: RuleSet,
  scenario: BattleScenario,
  trials = 3000,
): BattleOdds {
  const { attack: attArmyEff, defense: defArmyEff } = scenarioArmyEff(ruleSet, scenario);
  const attNavyEff = effectiveness(ruleSet, getPowerDef(ruleSet, scenario.attacker).navyOffense);
  const navalDefEff =
    (scenario.defender === null
      ? effectiveness(ruleSet, NEUTRAL_NAVY_FACTOR)
      : effectiveness(ruleSet, getPowerDef(ruleSet, scenario.defender).navyDefense)) *
    ruleSet.combat.homeAdvantageMultiplier;
  const rounds = ruleSet.combat.rounds;
  const navalContested =
    scenario.bySea && (scenario.attackerFleets > 0 || scenario.defenderFleets > 0);

  let wins = 0;
  let navalWins = 0;
  let attSurvSum = 0;
  let defSurvSum = 0;

  for (let i = 0; i < trials; i += 1) {
    // Distinct seed per trial for independent samples of the ±20% combat luck.
    const rng = new Rng((Math.imul(i + 1, 2654435761) ^ 0x9e3779b9) >>> 0);

    let landingTroops = scenario.attackerTroops;
    if (navalContested) {
      const naval = fight(
        scenario.attackerFleets,
        attNavyEff,
        scenario.defenderFleets,
        navalDefEff,
        rounds,
        rng,
      );
      if (naval.attackerWon) navalWins += 1;
      else {
        // Assault repelled at sea: no landing, defender holds.
        defSurvSum += scenario.defenderTroops;
        continue;
      }
    }

    const battle = fight(landingTroops, attArmyEff, scenario.defenderTroops, defArmyEff, rounds, rng);
    if (battle.attackerWon) {
      wins += 1;
      attSurvSum += Math.max(battle.attackerSurvivors, 1);
    } else {
      defSurvSum += Math.max(battle.defenderSurvivors, 1);
    }
  }

  return {
    winProb: wins / trials,
    navalWinProb: navalContested ? navalWins / trials : null,
    avgAttackerSurvivors: wins > 0 ? attSurvSum / wins : 0,
    avgDefenderSurvivors: trials - wins > 0 ? defSurvSum / (trials - wins) : 0,
    trials,
  };
}
