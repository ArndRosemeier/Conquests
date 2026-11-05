import {
  ENGLAND,
  FRANCE,
  GERMANY,
  JAPAN,
  RUSSIA,
  USA,
} from "../ruleset/classic.ts";
import { areaId } from "../types.ts";
import type { AreaId, PowerId } from "../types.ts";
import type { HomeLayout } from "./types.ts";

const ids = (...ns: number[]): readonly AreaId[] => ns.map(areaId);

/** Home areas and supply centers per power (matches the Major Country chart). */
export const CLASSIC_HOME: HomeLayout = {
  homeAreas: new Map<PowerId, readonly AreaId[]>([
    [ENGLAND, ids(46, 47, 48)],
    [GERMANY, ids(52, 53, 54)],
    [FRANCE, ids(49, 50, 51)],
    [USA, ids(17, 18, 19, 20)],
    [JAPAN, ids(114, 115, 116)],
    [RUSSIA, ids(95, 94, 96, 97)],
  ]),
  supplyCenters: new Map<PowerId, readonly AreaId[]>([
    [ENGLAND, ids(46, 47)],
    [GERMANY, ids(52, 53)],
    [FRANCE, ids(49, 51)],
    [USA, ids(17, 18, 20)],
    [JAPAN, ids(114, 116)],
    [RUSSIA, ids(95)],
  ]),
};

export interface ScenarioPowerSetup {
  readonly power: PowerId;
  /** Areas controlled at start beyond the power's home areas. */
  readonly extraAreas: readonly AreaId[];
  readonly troops: number;
  readonly fleets: number;
  readonly treasury: number;
}

export interface Scenario {
  readonly id: string;
  readonly name: string;
  /** One line for the setup screen. */
  readonly blurb: string;
  /** Calendar year of the first turn (the engine counts years from 1). */
  readonly startYear: number;
  /** Preset minor stats from ratings (historical) vs randomized (standard). */
  readonly presetMinors: boolean;
  readonly powers: readonly ScenarioPowerSetup[];
  /**
   * Garrison multiplier for neutral minors by region id (default 1). Evens out
   * geography: a power whose home continent is full of weak neighbours would
   * otherwise snowball unopposed.
   */
  readonly minorStrength?: Readonly<Record<number, number>>;
  /** Unordered pairs; both directions of war are created. */
  readonly initialWars: readonly (readonly [PowerId, PowerId])[];
}

const STARTING_TREASURY = 3_000_000;

/**
 * The Americas hold more independent states within marching distance of a
 * single great power than any other continent. Tougher garrisons there keep
 * the USA from snowballing unopposed (measured with `npm run balance`).
 */
const AMERICAS_RESIST: Readonly<Record<number, number>> = { 1: 3, 2: 2 };

/** Standard scenario: powers hold only their home areas; minors randomized. */
export const SCENARIO_STANDARD: Scenario = {
  id: "standard",
  name: "Open World",
  blurb: "Every great power starts at home. The rest of the world is up for grabs, and every map rolls new values.",
  startYear: 1880,
  presetMinors: false,
  initialWars: [],
  minorStrength: AMERICAS_RESIST,
  powers: [
    { power: ENGLAND, extraAreas: [], troops: 155_000, fleets: 120, treasury: STARTING_TREASURY },
    { power: GERMANY, extraAreas: [], troops: 365_000, fleets: 90, treasury: STARTING_TREASURY },
    { power: FRANCE, extraAreas: [], troops: 430_000, fleets: 80, treasury: STARTING_TREASURY },
    { power: USA, extraAreas: [], troops: 175_000, fleets: 85, treasury: STARTING_TREASURY },
    { power: JAPAN, extraAreas: [], troops: 255_000, fleets: 85, treasury: STARTING_TREASURY },
    { power: RUSSIA, extraAreas: [], troops: 520_000, fleets: 50, treasury: STARTING_TREASURY },
  ],
};

/**
 * 1880 "The Scramble". Historical holdings are approximated; tune freely via
 * this data.
 */
export const SCENARIO_1880: Scenario = {
  id: "1880",
  name: "1880: The Scramble",
  blurb: "Historical holdings and fixed values. The race for the last unclaimed lands is on.",
  startYear: 1880,
  presetMinors: true,
  initialWars: [],
  minorStrength: AMERICAS_RESIST,
  powers: [
    {
      power: ENGLAND,
      extraAreas: ids(7, 5, 78, 86, 88, 92, 89, 128, 129),
      troops: 501_000,
      fleets: 207,
      treasury: STARTING_TREASURY,
    },
    {
      power: GERMANY,
      extraAreas: [],
      troops: 381_000,
      fleets: 100,
      treasury: STARTING_TREASURY,
    },
    {
      power: FRANCE,
      extraAreas: ids(58, 62, 106, 108),
      troops: 507_000,
      fleets: 105,
      treasury: STARTING_TREASURY,
    },
    {
      power: USA,
      extraAreas: ids(1),
      troops: 192_000,
      fleets: 100,
      treasury: STARTING_TREASURY,
    },
    {
      power: JAPAN,
      extraAreas: [],
      troops: 270_000,
      fleets: 95,
      treasury: STARTING_TREASURY,
    },
    {
      power: RUSSIA,
      extraAreas: ids(98, 100),
      troops: 560_000,
      fleets: 50,
      treasury: STARTING_TREASURY,
    },
  ],
};

/**
 * 1914 "The Brink". Germany begins at war with England, France, and Russia.
 * Historical holdings approximated.
 */
export const SCENARIO_1914: Scenario = {
  id: "1914",
  name: "1914: The Brink",
  blurb: "Huge armies and old grudges. Germany starts at war with England, France and Russia.",
  startYear: 1914,
  presetMinors: true,
  minorStrength: AMERICAS_RESIST,
  initialWars: [
    [GERMANY, ENGLAND],
    [GERMANY, FRANCE],
    [GERMANY, RUSSIA],
  ],
  powers: [
    {
      power: ENGLAND,
      extraAreas: ids(7, 5, 78, 86, 88, 92, 89, 128, 129, 61, 65, 68, 63, 117),
      troops: 1_782_000,
      fleets: 207,
      treasury: STARTING_TREASURY,
    },
    {
      power: GERMANY,
      extraAreas: ids(74, 125),
      troops: 3_465_000,
      fleets: 125,
      treasury: STARTING_TREASURY,
    },
    {
      power: FRANCE,
      extraAreas: ids(58, 62, 106, 108, 56, 59, 64, 77),
      troops: 1_495_000,
      fleets: 110,
      treasury: STARTING_TREASURY,
    },
    {
      power: USA,
      extraAreas: ids(1, 11, 109, 110),
      troops: 570_000,
      fleets: 150,
      treasury: STARTING_TREASURY,
    },
    {
      power: JAPAN,
      extraAreas: ids(105, 113),
      troops: 900_000,
      fleets: 125,
      treasury: STARTING_TREASURY,
    },
    {
      power: RUSSIA,
      extraAreas: ids(98, 100, 99),
      troops: 3_030_000,
      fleets: 50,
      treasury: STARTING_TREASURY,
    },
  ],
};

export const SCENARIOS: readonly Scenario[] = [
  SCENARIO_STANDARD,
  SCENARIO_1880,
  SCENARIO_1914,
];

export function getScenario(id: string): Scenario {
  const s = SCENARIOS.find((x) => x.id === id);
  if (s === undefined) {
    throw new Error(`Unknown scenario '${id}'`);
  }
  return s;
}
