import { powerId } from "../types.ts";
import type { PowerDef, RuleSet } from "./types.ts";

/**
 * Faithful reproduction of SSI Colonial Conquest (1985) balance data, taken
 * from the Major Country Comparison Chart and the rulebook. Everything is a
 * plain object so alternate rulesets can be authored without touching code.
 */

export const ENGLAND = powerId("england");
export const GERMANY = powerId("germany");
export const FRANCE = powerId("france");
export const USA = powerId("usa");
export const JAPAN = powerId("japan");
export const RUSSIA = powerId("russia");

const POWERS: readonly PowerDef[] = [
  {
    id: ENGLAND,
    name: "England",
    color: "#8e44ad",
    armyOffense: 1,
    armyDefense: 1,
    armyCostPer10k: 600_000,
    navyOffense: 1,
    navyDefense: 1,
    navyCostPer5: 300_000,
  },
  {
    id: GERMANY,
    name: "Germany",
    color: "#7f8c8d",
    armyOffense: 3,
    armyDefense: 2,
    armyCostPer10k: 400_000,
    navyOffense: 3,
    navyDefense: 2,
    navyCostPer5: 400_000,
  },
  {
    id: FRANCE,
    name: "France",
    color: "#27ae60",
    armyOffense: 2,
    armyDefense: 2,
    armyCostPer10k: 300_000,
    navyOffense: 2,
    navyDefense: 3,
    navyCostPer5: 500_000,
  },
  {
    id: USA,
    name: "USA",
    color: "#5dade2",
    armyOffense: 2,
    armyDefense: 2,
    armyCostPer10k: 300_000,
    navyOffense: 3,
    navyDefense: 1,
    navyCostPer5: 400_000,
  },
  {
    id: JAPAN,
    name: "Japan",
    color: "#f1c40f",
    armyOffense: 4,
    armyDefense: 3,
    armyCostPer10k: 300_000,
    navyOffense: 3,
    navyDefense: 2,
    navyCostPer5: 500_000,
  },
  {
    id: RUSSIA,
    name: "Russia",
    color: "#c0392b",
    armyOffense: 4,
    armyDefense: 3,
    armyCostPer10k: 200_000,
    navyOffense: 4,
    navyDefense: 4,
    navyCostPer5: 700_000,
  },
];

export const CLASSIC_RULESET: RuleSet = {
  id: "classic-1985",
  powers: POWERS,
  playOrder: [ENGLAND, GERMANY, FRANCE, USA, JAPAN, RUSSIA],
  costs: {
    fortification: 1_000_000,
    spyMinor: 200_000,
    spyFortified: 1_000_000,
    troopBuildIncrement: 10_000,
    fleetBuildIncrement: 5,
  },
  limits: {
    armyMoves: 20,
    fleetMoves: 10,
    troopsPerFleet: 1_000,
    minGarrison: 1_000,
  },
  combat: {
    rounds: 9,
    factorBase: 1,
    factorMaxForScale: 5,
    factorPerPoint: 0.5,
    fortificationDefenseMultiplier: 2,
    terrainDefensePerPoint: 0.25,
  },
  economy: {
    regionBonusMax: 20_000_000,
    guaranteedPeaceLoan: 8_000_000,
    minPeaceLoan: 300_000,
  },
  victory: {
    options: [500, 1000, 1500, Number.POSITIVE_INFINITY],
    pointsPerBattleWon: 1,
    pointsPerBattleLost: 1,
    standardAreaValueMin: 13,
    standardAreaValueMax: 50,
  },
  subversion: {
    baseTroopsPerDollar: 0.05,
    worthResistance: 0.0000002,
    coupGarrison: 1_000,
  },
  springPhases: [
    "ARMY_BUILD",
    "FLEET_BUILD",
    "FORTIFY",
    "ECONOMIC_AID",
    "ESPIONAGE",
    "SUBVERSION",
    "ARMY_MOVE",
    "FLEET_MOVE",
  ],
  regularPhases: ["ARMY_MOVE", "FLEET_MOVE"],
};

/** Convenience lookup for a power definition. */
export function getPowerDef(ruleSet: RuleSet, id: string): PowerDef {
  const def = ruleSet.powers.find((p) => p.id === id);
  if (def === undefined) {
    throw new Error(`Unknown power '${id}' in ruleset '${ruleSet.id}'`);
  }
  return def;
}
