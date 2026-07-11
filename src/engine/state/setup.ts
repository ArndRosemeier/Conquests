import { getPowerDef } from "../ruleset/classic.ts";
import type { RuleSet } from "../ruleset/types.ts";
import { EngineError } from "../types.ts";
import type { AreaId, ControlKind, PowerId } from "../types.ts";
import { getArea } from "../world/classic.ts";
import type { Rating, WorldDefinition } from "../world/types.ts";
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

const MINOR_TROOPS_BY_DEFENSE: Readonly<Record<Rating, number>> = {
  A: 60_000,
  B: 40_000,
  C: 25_000,
  D: 10_000,
};

const MINOR_DEFENSE_FACTOR_BY_RATING: Readonly<Record<Rating, number>> = {
  A: 2,
  B: 3,
  C: 4,
  D: 5,
};

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
    const troops = scenario.presetMinors
      ? MINOR_TROOPS_BY_DEFENSE[area.defense]
      : rng.range(1, 8) * 10_000;
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

    // Reserve a minimum garrison in each controlled area; pile the rest into the
    // primary supply center. Fleets go to the first port supply center.
    const minGarrison = ruleSet.limits.minGarrison;
    let troopPool = setup.troops;
    const perAreaTroops = new Map<string, number>();
    for (const id of controlled) {
      perAreaTroops.set(String(id), minGarrison);
      troopPool -= minGarrison;
    }
    if (troopPool < 0) troopPool = 0;

    const primarySupply = supplyCenters[0] ?? controlled[0]!;
    perAreaTroops.set(
      String(primarySupply),
      (perAreaTroops.get(String(primarySupply)) ?? 0) + troopPool,
    );

    const portSupply =
      supplyCenters.find((id) => getArea(world, id).isPort) ??
      controlled.find((id) => getArea(world, id).isPort) ??
      primarySupply;

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
        fleets: id === portSupply ? setup.fleets : 0,
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

  // The very first turn only runs Espionage + Subversion, then movement (manual
  // 6.1.3). We model the first turn's build as those two phases only.
  const firstPhases: GameState["phase"][] = [
    "ESPIONAGE",
    "SUBVERSION",
    "ARMY_MOVE",
    "FLEET_MOVE",
  ];
  const firstPhase = firstPhases[0]!;

  return {
    rulesetId: ruleSet.id,
    worldId: world.id,
    scenarioId: scenario.id,
    year: 1,
    season: "SPRING",
    phaseIndex: 0,
    phase: firstPhase,
    activePower: firstPower,
    movesRemaining: 0,
    powers: powerStates,
    areas: areaStates,
    pending: [],
    war,
    rngState: rng.snapshot(),
    winningScore: winningScore,
    winner: null,
    tick: 0,
  };
}
