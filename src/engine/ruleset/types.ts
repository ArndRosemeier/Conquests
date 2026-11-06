import type { PowerId } from "../types.ts";

/**
 * Definition of one major power. All per-power balance numbers live here so a
 * new power (or an entirely different roster) is pure data, not code.
 *
 * Offense/Defense factors follow the manual's convention: LOWER is BETTER.
 */
export interface PowerDef {
  readonly id: PowerId;
  readonly name: string;
  /** CSS color used to render this power's control on the map. */
  readonly color: string;
  readonly armyOffense: number;
  readonly armyDefense: number;
  /** Cost in dollars to build 10,000 troops. */
  readonly armyCostPer10k: number;
  readonly navyOffense: number;
  readonly navyDefense: number;
  /** Cost in dollars to build 5 fleets. */
  readonly navyCostPer5: number;
}

/** Costs that are not tied to a specific power. */
export interface CostRules {
  readonly fortification: number;
  readonly spyMinor: number;
  readonly spyFortified: number;
  /** Increment in which armies are purchased. */
  readonly troopBuildIncrement: number;
  /** Increment in which fleets are purchased. */
  readonly fleetBuildIncrement: number;
}

/** Per-phase movement / action limits. */
export interface LimitRules {
  readonly armyMoves: number;
  readonly fleetMoves: number;
  readonly troopsPerFleet: number;
  /** Minimum garrison that must remain in a controlled area. */
  readonly minGarrison: number;
}

export interface CombatRules {
  readonly rounds: number;
  /**
   * Effectiveness multiplier applied per point of "factor headroom".
   * Effectiveness = base + (maxFactor - factor) * perPoint. Lower factor wins.
   */
  readonly factorBase: number;
  readonly factorMaxForScale: number;
  readonly factorPerPoint: number;
  /** Defense multiplier granted by a fortification. */
  readonly fortificationDefenseMultiplier: number;
  /** Extra defense multiplier per point of terrain value. */
  readonly terrainDefensePerPoint: number;
  /** Home advantage: the defender's battle strength (land and sea) is multiplied by this. */
  readonly homeAdvantageMultiplier: number;
}

export interface EconomyRules {
  /** Troops a neutral minor raises per dollar of economic aid it receives. */
  readonly minorTroopsPerDollar: number;
}

export interface VictoryRules {
  /** Winning-score choices offered at setup; 0 means play without a score limit. */
  readonly options: readonly number[];
  readonly pointsPerBattleWon: number;
  readonly pointsPerBattleLost: number;
  /** In the standard scenario, area victory point values are random in this range. */
  readonly standardAreaValueMin: number;
  readonly standardAreaValueMax: number;
}

export interface SubversionRules {
  /**
   * Cost of a single bribe. Subversion is a repeated fixed payment: each bribe
   * whittles down the minor's garrison, and money already spent is not refunded
   * if you stop before it flips.
   */
  readonly bribeCost: number;
  /**
   * Troops removed from a minor per dollar spent (scaled by net worth).
   * troopsRemoved = bribeCost * baseTroopsPerDollar / (1 + netWorth * worthResistance).
   */
  readonly baseTroopsPerDollar: number;
  readonly worthResistance: number;
  /**
   * Random swing on each bribe's effectiveness, as a fraction (0..1). At 0.5 an
   * individual bribe removes anywhere from 50% to 150% of the base figure, so the
   * exact bribe that finally flips a country is never certain.
   */
  readonly bribeVariance: number;
  /** A coup succeeds when remaining defenders reach zero. */
  readonly coupGarrison: number;
}

/** War, peace and reputation. Reputation runs from 0 (pariah) to `reputationMax`. */
export interface DiplomacyRules {
  /** Seasons of truce after every peace treaty, during which war cannot be declared. */
  readonly truceSeasons: number;
  /** Reputation every power starts with; yearly recovery stops here. */
  readonly reputationStart: number;
  readonly reputationMax: number;
  /** Reputation lost for declaring war. */
  readonly declareWarCost: number;
  /** Reduced cost when the victim's own reputation is below `pariahBelow`. */
  readonly declareWarOnPariahCost: number;
  readonly pariahBelow: number;
  /** Reputation regained each spring, up to `reputationStart`. */
  readonly recoveryPerYear: number;
  /** War balance points for each battle won against the enemy (plus the VP of land taken). */
  readonly warPointsPerBattle: number;
  /** Lengths, in years, a non-aggression pact can be signed for. */
  readonly pactYears: readonly number[];
  /** Extra reputation lost for declaring war on a pact partner (on top of the declaration). */
  readonly pactBreakCost: number;
  /** Extra reputation lost for declaring war on an ally. */
  readonly allyBetrayalCost: number;
  /** Reputation lost for leaving an alliance. */
  readonly leaveAllianceCost: number;
  /** Reputation lost for refusing an ally's call to arms (the alliance also ends). */
  readonly refuseCallCost: number;
  /** Reputation gained for answering an ally's call to arms. */
  readonly answerCallGain: number;
  /** Reputation gained by both sides when a pact runs its full term. */
  readonly pactKeptGain: number;
  /** Seasons a call to arms or treaty offer stays open. */
  readonly offerSeasons: number;
}

/**
 * The complete, changeable rule configuration. Swap this object to retune the
 * game, add powers, or model an entirely different world's economy.
 */
export interface RuleSet {
  readonly id: string;
  readonly powers: readonly PowerDef[];
  /** Order in which powers act and combat is resolved. */
  readonly playOrder: readonly PowerId[];
  readonly costs: CostRules;
  readonly limits: LimitRules;
  readonly combat: CombatRules;
  readonly economy: EconomyRules;
  readonly victory: VictoryRules;
  readonly subversion: SubversionRules;
  readonly diplomacy: DiplomacyRules;
}
