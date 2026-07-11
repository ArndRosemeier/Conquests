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
}

export interface EconomyRules {
  /** Maximum bonus (dollars) for controlling an entire region. */
  readonly regionBonusMax: number;
  /** Loan amount that guarantees ending a war with a computer power. */
  readonly guaranteedPeaceLoan: number;
  /** Minimum loan that has any chance of ending a war. */
  readonly minPeaceLoan: number;
}

export interface VictoryRules {
  readonly options: readonly number[];
  readonly pointsPerBattleWon: number;
  readonly pointsPerBattleLost: number;
  /** In the standard scenario, area victory point values are random in this range. */
  readonly standardAreaValueMin: number;
  readonly standardAreaValueMax: number;
}

export interface SubversionRules {
  /**
   * Troops removed from a minor per dollar spent (scaled by net worth).
   * troopsRemoved = spend * baseTroopsPerDollar / (1 + netWorth * worthResistance).
   */
  readonly baseTroopsPerDollar: number;
  readonly worthResistance: number;
  /** A coup succeeds when remaining defenders reach zero. */
  readonly coupGarrison: number;
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
}
