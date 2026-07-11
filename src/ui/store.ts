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
import { createGame } from "../engine/state/setup.ts";
import type { PowerControlConfig } from "../engine/state/setup.ts";
import type { AreaId, PowerId } from "../engine/types.ts";
import { CLASSIC_WORLD, getArea, neighborsOf } from "../engine/world/classic.ts";
import type { WorldDefinition } from "../engine/world/types.ts";
import { CLASSIC_HOME, getScenario } from "../engine/world/scenarios.ts";
import { pushAutosave, putManualSave } from "./persistence.ts";

export interface NewGameConfig {
  readonly scenarioId: string;
  readonly humanPower: PowerId;
  readonly aiLevel: number;
  readonly winningScore: number;
  readonly seed: number;
}

/** Which movement the player is currently aiming (source picked, awaiting target). */
export type MoveMode = "army" | "fleet";

/** An open area popup, anchored at the click position (screen coordinates). */
export interface Popup {
  readonly area: AreaId;
  readonly x: number;
  readonly y: number;
}

interface StoreState {
  readonly screen: "setup" | "playing";
  readonly ruleSet: RuleSet;
  readonly world: WorldDefinition;
  readonly gameState: GameState | null;
  readonly humanPower: PowerId | null;
  readonly log: readonly GameEvent[];
  readonly selectedArea: AreaId | null;
  readonly popup: Popup | null;
  readonly moveMode: MoveMode | null;
  readonly moveFrom: AreaId | null;
  readonly moveTo: AreaId | null;
  readonly infoOpen: boolean;
  readonly saveLoadOpen: boolean;

  startGame: (config: NewGameConfig) => void;
  setInfoOpen: (open: boolean) => void;
  setSaveLoadOpen: (open: boolean) => void;
  saveGame: (name: string) => Promise<void>;
  loadGame: (state: GameState) => void;
  newGame: () => void;
  playAction: (action: Action, keepPopup?: boolean) => void;
  endTurn: () => void;
  handleMapClick: (id: AreaId, x: number, y: number) => void;
  beginMove: (mode: MoveMode) => void;
  cancelMove: () => void;
  closePopup: () => void;
  dismiss: () => void;
}

// Non-reactive engine handles kept outside React state.
let runner: GameRunner | null = null;
let humanController: HumanController | null = null;

const MAX_LOG = 40;

const CLEARED = {
  selectedArea: null,
  popup: null,
  moveMode: null,
  moveFrom: null,
  moveTo: null,
} as const;

export const useGame = create<StoreState>((set, get) => {
  // Key of the last turn we autosaved, so a human turn is only snapshotted once
  // even though many state updates arrive during it.
  let autosaveKey: string | null = null;

  const maybeAutosave = (): void => {
    const { gameState, humanPower } = get();
    if (gameState === null || humanPower === null) return;
    // Snapshot at the start of each of the human's turns (one per season).
    if (gameState.stage === "PLAYER" && gameState.activePower === humanPower) {
      const key = `${gameState.year}-${gameState.season}`;
      if (key !== autosaveKey) {
        autosaveKey = key;
        void pushAutosave(gameState).catch((e) => console.error("Autosave failed", e));
      }
    }
  };

  /**
   * Boot a runner from a concrete GameState (fresh or loaded). Controllers are
   * reconstructed from each power's stored control kind, so a saved game resumes
   * with the same human/AI assignment.
   */
  const launch = (state: GameState, log: readonly GameEvent[]): void => {
    runner?.stop();
    const controllers = new Map<PowerId, PlayerController>();
    let human: HumanController | null = null;
    let humanPower: PowerId | null = null;
    for (const p of Object.values(state.powers)) {
      if (p.control === "human") {
        if (human === null) human = new HumanController();
        controllers.set(p.id, human);
        humanPower = p.id;
      } else if (p.control === "ai") {
        controllers.set(p.id, new AIController(CLASSIC_RULESET, CLASSIC_WORLD));
      }
    }
    humanController = human;

    set({
      screen: "playing",
      gameState: state,
      humanPower,
      log,
      infoOpen: false,
      saveLoadOpen: false,
      ...CLEARED,
    });

    runner = new GameRunner(CLASSIC_RULESET, CLASSIC_WORLD, state, controllers, {
      aiActionDelayMs: 220,
      combatDelayMs: 650,
      onUpdate: (s, events) => {
        set((prev) => ({
          gameState: s,
          log: [...events, ...prev.log].slice(0, MAX_LOG),
        }));
        maybeAutosave();
      },
    });

    maybeAutosave();
    void runner.run();
  };

  return {
  screen: "setup",
  ruleSet: CLASSIC_RULESET,
  world: CLASSIC_WORLD,
  gameState: null,
  humanPower: null,
  log: [],
  selectedArea: null,
  popup: null,
  moveMode: null,
  moveFrom: null,
  moveTo: null,
  infoOpen: false,
  saveLoadOpen: false,

  setInfoOpen: (open) => set({ infoOpen: open }),
  setSaveLoadOpen: (open) => set({ saveLoadOpen: open }),

  saveGame: async (name) => {
    const { gameState } = get();
    if (gameState === null) return;
    await putManualSave(name, gameState);
  },

  loadGame: (state) => {
    // Avoid an immediate duplicate autosave of the turn we just loaded.
    autosaveKey = `${state.year}-${state.season}`;
    launch(state, []);
  },

  startGame: (config) => {
    const ruleSet = CLASSIC_RULESET;
    const world = CLASSIC_WORLD;
    const scenario = getScenario(config.scenarioId);

    const controls = new Map<PowerId, PowerControlConfig>();
    for (const power of ruleSet.playOrder) {
      if (power === config.humanPower) {
        controls.set(power, { control: "human", aiLevel: 0 });
      } else {
        controls.set(power, { control: "ai", aiLevel: config.aiLevel });
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

    autosaveKey = null;
    launch(initial, []);
  },

  newGame: () => {
    runner?.stop();
    runner = null;
    humanController = null;
    autosaveKey = null;
    set({
      screen: "setup",
      gameState: null,
      humanPower: null,
      log: [],
      ...CLEARED,
    });
  },

  playAction: (action, keepPopup) => {
    if (runner === null) return;
    runner.apply(action);
    // Repeated bribes keep the popup open so the player can keep paying until
    // the country flips; everything else dismisses the popup on success.
    if (keepPopup !== true) set({ ...CLEARED });
  },

  endTurn: () => {
    humanController?.finishTurn();
    set({ ...CLEARED });
  },

  beginMove: (mode) => {
    const { popup } = get();
    if (popup === null) return;
    set({ moveMode: mode, moveFrom: popup.area, moveTo: null, popup: null, selectedArea: popup.area });
  },

  cancelMove: () => set({ ...CLEARED }),

  closePopup: () => set({ popup: null, selectedArea: null }),

  /** Clear any popup/selection/pending move (e.g. clicking empty ocean or Escape). */
  dismiss: () => set({ ...CLEARED }),

  handleMapClick: (id, x, y) => {
    const { gameState, humanPower, world, moveMode, moveFrom } = get();
    if (gameState === null || humanPower === null) return;
    if (gameState.stage !== "PLAYER" || gameState.activePower !== humanPower) return;

    // Choosing a movement destination (source already picked).
    if (moveMode !== null && moveFrom !== null) {
      if (id === moveFrom) {
        set({ ...CLEARED });
        return;
      }
      const validTarget =
        moveMode === "army"
          ? neighborsOf(world, moveFrom).includes(id)
          : getArea(world, id).isPort;
      if (validTarget) {
        set({ moveTo: id, popup: { area: id, x, y } });
      }
      return;
    }

    // Otherwise open the area action popup.
    set({ selectedArea: id, popup: { area: id, x, y }, moveMode: null, moveFrom: null, moveTo: null });
  },
  };
});
