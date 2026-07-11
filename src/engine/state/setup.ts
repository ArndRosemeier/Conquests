import { getPowerDef } from "../ruleset/classic.ts";
import type { RuleSet } from "../ruleset/types.ts";
import { EngineError } from "../types.ts";
import type { AreaId, ControlKind, PowerId } from "../types.ts";
import { getArea } from "../world/classic.ts";
import { ringArea } from "../world/geo/geometry.ts";
import type { Area, Rating, WorldDefinition } from "../world/types.ts";
import type { HomeLayout } from "../world/types.ts";
import type { Scenario } from "../world/scenarios.ts";
import type { AreaState, GameState, PowerState } from "./gameState.ts";
import { declareWar } from "./helpers.ts";
import { Rng } from "./rng.ts";

/** Per-power control configuration chosen at game setup. */
export interface PowerControlConfig {
  readonly control: ControlKind;
  /** AI difficulty 0-9 (only used when control === "ai"). */
  readonly aiLevel: number;
}

export interface NewGameOptions {
  readonly ruleSet: RuleSet;
  readonly world: WorldDefinition;
  readonly home: HomeLayout;
  readonly scenario: Scenario;
  readonly controls: ReadonlyMap<PowerId, PowerControlConfig>;
  readonly winningScore: number;
  readonly seed: number;
}

const INCOME_BY_VALUE: Readonly<Record<Rating, number>> = {
  A: 8_000_000,
  B: 5_000_000,
  C: 3_000_000,
  D: 1_000_000,
};

const HIST_VP_BY_VALUE: Readonly<Record<Rating, number>> = {
  A: 45,
  B: 35,
  C: 25,
  D: 15,
};

const MINOR_DEFENSE_FACTOR_BY_RATING: Readonly<Record<Rating, number>> = {
  A: 2,
  B: 3,
  C: 4,
  D: 5,
};

/** Garrison multiplier by defensive rating; strong minors field bigger armies. */
const MINOR_TROOP_MULT_BY_DEFENSE: Readonly<Record<Rating, number>> = {
  A: 1.35,
  B: 1.12,
  C: 0.95,
  D: 0.78,
};

/** Total projected land area of a territory (in world units). */
function territorySize(area: Area): number {
  let total = 0;
  for (const ring of area.shape) total += ringArea(ring);
  return total;
}

/**
 * Neutral garrison strength with a deliberately non-linear spread: most minors
 * are middling, but a few are almost undefended (down to ~1k) and a few are
 * fortress-states (>100k). Bigger/stronger territories skew larger, tiny
 * islands smaller. Numbers are intentionally not round multiples of 10k.
 */
function seedNeutralTroops(rng: Rng, area: Area): number {
  const roll = rng.next();
  let base: number;
  if (roll < 0.1) {
    // Barely defended; squared roll clusters near the bottom (~1k).
    base = 1_000 + rng.next() ** 2 * 9_000; // 1k .. 10k
  } else if (roll < 0.82) {
    base = 12_000 + rng.next() * 48_000; // 12k .. 60k (the common case)
  } else if (roll < 0.95) {
    base = 62_000 + rng.next() * 58_000; // 62k .. 120k
  } else {
    base = 120_000 + rng.next() ** 1.5 * 140_000; // 120k .. 260k (rare fortress)
  }

  // Territory size nudges the garrison: ~0.6x for a small island, ~1.2x for a
  // continental heavyweight.
  const sizeFactor = 0.6 + 0.6 * Math.min(1, territorySize(area) / 300);
  const raw = base * MINOR_TROOP_MULT_BY_DEFENSE[area.defense] * sizeFactor;

  // A little jitter, then round to the nearest 100 so values look organic.
  const jittered = raw * (0.9 + rng.next() * 0.2);
  return Math.max(500, Math.round(jittered / 100) * 100);
}

function requiredControl(
  controls: ReadonlyMap<PowerId, PowerControlConfig>,
  power: PowerId,
): PowerControlConfig {
  const cfg = controls.get(power);
  if (cfg === undefined) {
    throw new EngineError(`No control config provided for power '${power}'`);
  }
  return cfg;
}

/** Builds a fresh, deterministic GameState from the chosen options. */
export function createGame(options: NewGameOptions): GameState {
  const { ruleSet, world, home, scenario, controls, winningScore, seed } = options;
  const rng = new Rng(seed);

  // Static home / supply-center ownership, derived from the home layout.
  const homeOfMap = new Map<string, PowerId>();
  const supplyOfMap = new Map<string, PowerId>();
  for (const [power, areas] of home.homeAreas) {
    for (const id of areas) homeOfMap.set(String(id), power);
  }
  for (const [power, areas] of home.supplyCenters) {
    for (const id of areas) supplyOfMap.set(String(id), power);
  }

  const areaStates: Record<string, AreaState> = {};

  // Every area starts as a neutral minor; powers overwrite their holdings below.
  for (const area of world.areas) {
    const income = scenario.presetMinors
      ? INCOME_BY_VALUE[area.value]
      : rng.range(1, 8) * 1_000_000;
    const victoryValue = scenario.presetMinors
      ? HIST_VP_BY_VALUE[area.value]
      : rng.range(
          ruleSet.victory.standardAreaValueMin,
          ruleSet.victory.standardAreaValueMax,
        );
    const troops = seedNeutralTroops(rng, area);
    const minorDefense = MINOR_DEFENSE_FACTOR_BY_RATING[area.defense];

    areaStates[String(area.id)] = {
      id: area.id,
      owner: null,
      troops,
      fleets: 0,
      fortified: false,
      homeOf: homeOfMap.get(String(area.id)) ?? null,
      supplyCenterOf: supplyOfMap.get(String(area.id)) ?? null,
      income,
      minorDefense,
      victoryValue,
    };
  }

  const powerStates: Record<string, PowerState> = {};

  for (const setup of scenario.powers) {
    const def = getPowerDef(ruleSet, setup.power);
    const cfg = requiredControl(controls, setup.power);

    const homeAreas = home.homeAreas.get(def.id) ?? [];
    const supplyCenters = home.supplyCenters.get(def.id) ?? [];
    const controlled: readonly AreaId[] = [...homeAreas, ...setup.extraAreas];

    if (controlled.length === 0) {
      throw new EngineError(`Power '${def.id}' has no starting areas`);
    }

    // Spread the starting army across every holding so each home area is
    // garrisoned, not just the capital. Supply centers are weighted heavily (the
    // capital most of all), home provinces moderately, outlying colonies least.
    // Fleets go to the first port supply center.
    const minGarrison = ruleSet.limits.minGarrison;
    const primarySupply = supplyCenters[0] ?? controlled[0]!;
    const weightOf = (id: AreaId): number => {
      if (id === primarySupply) return 10;
      if (supplyCenters.includes(id)) return 3;
      if (homeAreas.includes(id)) return 2;
      return 1;
    };
    const totalWeight = controlled.reduce((sum, id) => sum + weightOf(id), 0);
    const perAreaTroops = new Map<string, number>();
    let assigned = 0;
    for (const id of controlled) {
      const share = Math.max(
        minGarrison,
        Math.round((setup.troops * weightOf(id)) / totalWeight / 1000) * 1000,
      );
      perAreaTroops.set(String(id), share);
      assigned += share;
    }
    // Reconcile rounding/min-garrison drift into the capital.
    const capital = perAreaTroops.get(String(primarySupply)) ?? minGarrison;
    perAreaTroops.set(
      String(primarySupply),
      Math.max(minGarrison, capital + (setup.troops - assigned)),
    );

    // Base the fleet at home/supply ports (its naval bases), split by the same
    // weighting so a power with several home ports isn't all-eggs-in-one-basket,
    // while colonies get no starting navy. Fall back to any port, then the
    // capital, so fleets are never lost when there is no home port.
    const isPort = (id: AreaId): boolean => getArea(world, id).isPort;
    const homePorts = controlled.filter(
      (id) => isPort(id) && (supplyCenters.includes(id) || homeAreas.includes(id)),
    );
    const portTargets =
      homePorts.length > 0 ? homePorts : controlled.filter(isPort);
    const mainPort =
      supplyCenters.find(isPort) ?? portTargets[0] ?? primarySupply;

    const perAreaFleets = new Map<string, number>();
    if (setup.fleets > 0) {
      if (portTargets.length === 0) {
        perAreaFleets.set(String(mainPort), setup.fleets);
      } else {
        const totalPortWeight = portTargets.reduce((sum, id) => sum + weightOf(id), 0);
        let assignedFleets = 0;
        for (const id of portTargets) {
          const share = Math.round((setup.fleets * weightOf(id)) / totalPortWeight);
          perAreaFleets.set(String(id), share);
          assignedFleets += share;
        }
        const base = perAreaFleets.get(String(mainPort)) ?? 0;
        perAreaFleets.set(String(mainPort), Math.max(0, base + (setup.fleets - assignedFleets)));
      }
    }

    for (const id of controlled) {
      const area = getArea(world, id);
      const existing = areaStates[String(id)];
      if (existing === undefined) {
        throw new EngineError(`Area ${id} for power '${def.id}' missing`);
      }
      const isSupply = supplyCenters.includes(id);
      areaStates[String(id)] = {
        ...existing,
        owner: def.id,
        troops: perAreaTroops.get(String(id)) ?? minGarrison,
        fleets: perAreaFleets.get(String(id)) ?? 0,
        fortified: isSupply,
        income: INCOME_BY_VALUE[area.value],
        // Historical starting areas contribute no victory points (manual 6.5).
        victoryValue: HIST_VP_BY_VALUE[area.value],
      };
    }

    powerStates[String(def.id)] = {
      id: def.id,
      control: cfg.control,
      aiLevel: cfg.aiLevel,
      treasury: setup.treasury,
      score: 0,
      startingAreas: controlled,
      eliminated: false,
    };
  }

  let war: GameState["war"] = {};
  for (const [a, b] of scenario.initialWars) {
    war = declareWar(war, a, b);
  }

  const firstPower = ruleSet.playOrder[0];
  if (firstPower === undefined) {
    throw new EngineError("Ruleset has an empty play order");
  }

  // The founding turn (year 1 spring) allows only espionage, subversion, and
  // movement (manual 6.1.3); the season gates in legalActions enforce this.
  return {
    rulesetId: ruleSet.id,
    worldId: world.id,
    scenarioId: scenario.id,
    year: 1,
    season: "SPRING",
    stage: "PLAYER",
    activePower: firstPower,
    armyMovesRemaining: ruleSet.limits.armyMoves,
    fleetMovesRemaining: ruleSet.limits.fleetMoves,
    powers: powerStates,
    areas: areaStates,
    pending: [],
    war,
    intel: {},
    rngState: rng.snapshot(),
    winningScore: winningScore,
    winner: null,
    tick: 0,
  };
}
