import { create } from "zustand";
import { AIController } from "../controllers/ai/aiController.ts";
import { HumanController } from "../controllers/humanController.ts";
import type { PlayerController } from "../controllers/types.ts";
import { GameRunner } from "../game/gameRunner.ts";
import { CLASSIC_RULESET } from "../engine/ruleset/classic.ts";
import type { RuleSet } from "../engine/ruleset/types.ts";
import type { Action } from "../engine/state/actions.ts";
import type { GameEvent } from "../engine/state/events.ts";
import type { GameState } from "../engine/state/gameState.ts";
import { getAreaState } from "../engine/state/helpers.ts";
import { createGame } from "../engine/state/setup.ts";
import type { PowerControlConfig } from "../engine/state/setup.ts";
import type { AreaId, PowerId } from "../engine/types.ts";
import { CLASSIC_WORLD, getArea, neighborsOf } from "../engine/world/classic.ts";
import type { WorldDefinition } from "../engine/world/types.ts";
import { CLASSIC_HOME, getScenario } from "../engine/world/scenarios.ts";

export interface NewGameConfig {
  readonly scenarioId: string;
  readonly humanPower: PowerId;
  readonly aiLevel: number;
  readonly winningScore: number;
  readonly seed: number;
}

interface StoreState {
  readonly screen: "setup" | "playing";
  readonly ruleSet: RuleSet;
  readonly world: WorldDefinition;
  readonly gameState: GameState | null;
  readonly humanPower: PowerId | null;
  readonly log: readonly GameEvent[];
  readonly selectedArea: AreaId | null;
  readonly moveFrom: AreaId | null;
  readonly moveTo: AreaId | null;

  startGame: (config: NewGameConfig) => void;
  playAction: (action: Action) => void;
  endPhase: () => void;
  handleMapClick: (id: AreaId) => void;
  clearMoveSelection: () => void;
  setSelectedArea: (id: AreaId | null) => void;
}

// Non-reactive engine handles kept outside React state.
let runner: GameRunner | null = null;
let humanController: HumanController | null = null;

const MAX_LOG = 40;

export const useGame = create<StoreState>((set, get) => ({
  screen: "setup",
  ruleSet: CLASSIC_RULESET,
  world: CLASSIC_WORLD,
  gameState: null,
  humanPower: null,
  log: [],
  selectedArea: null,
  moveFrom: null,
  moveTo: null,

  startGame: (config) => {
    const ruleSet = CLASSIC_RULESET;
    const world = CLASSIC_WORLD;
    const scenario = getScenario(config.scenarioId);

    const controls = new Map<PowerId, PowerControlConfig>();
    const controllers = new Map<PowerId, PlayerController>();
    const human = new HumanController();
    humanController = human;

    for (const power of ruleSet.playOrder) {
      if (power === config.humanPower) {
        controls.set(power, { control: "human", aiLevel: 0 });
        controllers.set(power, human);
      } else {
        controls.set(power, { control: "ai", aiLevel: config.aiLevel });
        controllers.set(power, new AIController(ruleSet, world));
      }
    }

    const initial = createGame({
      ruleSet,
      world,
      home: CLASSIC_HOME,
      scenario,
      controls,
      winningScore: config.winningScore,
      seed: config.seed,
    });

    set({
      screen: "playing",
      gameState: initial,
      humanPower: config.humanPower,
      log: [],
      selectedArea: null,
      moveFrom: null,
      moveTo: null,
    });

    runner = new GameRunner(ruleSet, world, initial, controllers, {
      aiActionDelayMs: 220,
      combatDelayMs: 650,
      onUpdate: (state, events) => {
        set((prev) => ({
          gameState: state,
          log: [...events, ...prev.log].slice(0, MAX_LOG),
        }));
      },
    });

    void runner.run();
  },

  playAction: (action) => {
    if (runner === null) return;
    runner.apply(action);
    set({ selectedArea: null, moveFrom: null, moveTo: null });
  },

  endPhase: () => {
    humanController?.finishPhase();
    set({ selectedArea: null, moveFrom: null, moveTo: null });
  },

  setSelectedArea: (id) => set({ selectedArea: id }),

  clearMoveSelection: () => set({ moveFrom: null, moveTo: null }),

  handleMapClick: (id) => {
    const { gameState, humanPower, world, ruleSet } = get();
    if (gameState === null || humanPower === null) return;
    if (gameState.activePower !== humanPower) return;
    const min = ruleSet.limits.minGarrison;
    const area = getAreaState(gameState, id);

    if (gameState.phase === "ARMY_MOVE") {
      const { moveFrom } = get();
      if (moveFrom === null) {
        if (area.owner === humanPower && area.troops > min) set({ moveFrom: id, moveTo: null });
        return;
      }
      if (id === moveFrom) {
        set({ moveFrom: null, moveTo: null });
        return;
      }
      if (neighborsOf(world, moveFrom).includes(id)) {
        set({ moveTo: id });
      } else if (area.owner === humanPower && area.troops > min) {
        set({ moveFrom: id, moveTo: null });
      }
      return;
    }

    if (gameState.phase === "FLEET_MOVE") {
      const { moveFrom } = get();
      if (moveFrom === null) {
        if (area.owner === humanPower && area.fleets > 0 && getArea(world, id).isPort) {
          set({ moveFrom: id, moveTo: null });
        }
        return;
      }
      if (id === moveFrom) {
        set({ moveFrom: null, moveTo: null });
        return;
      }
      if (getArea(world, id).isPort) {
        set({ moveTo: id });
      }
      return;
    }

    set({ selectedArea: id });
  },
}));
