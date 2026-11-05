import type { PlayerController } from "../controllers/types.ts";
import type { Action } from "../engine/state/actions.ts";
import type { GameEvent } from "../engine/state/events.ts";
import type { GameState } from "../engine/state/gameState.ts";
import { reduce } from "../engine/state/reducer.ts";
import { advanceAfterCombat } from "../engine/state/turn.ts";
import type { RuleSet } from "../engine/ruleset/types.ts";
import { EngineError } from "../engine/types.ts";
import type { PowerId } from "../engine/types.ts";
import type { WorldDefinition } from "../engine/world/types.ts";

export interface GameRunnerHooks {
  /** Called after every state change with the events that produced it. */
  readonly onUpdate: (state: GameState, events: readonly GameEvent[]) => void;
  readonly aiActionDelayMs?: number;
  readonly combatDelayMs?: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drives the game: walks phases and play order, asks each power's controller for
 * actions, applies them through the pure reducer, and resolves combat between
 * turns. Human and AI powers use the identical loop.
 */
export class GameRunner {
  private current: GameState;
  private running = false;
  private pacing: { aiActionDelayMs: number; combatDelayMs: number };
  private stopped = false;

  public constructor(
    private readonly ruleSet: RuleSet,
    private readonly world: WorldDefinition,
    initialState: GameState,
    private readonly controllers: ReadonlyMap<PowerId, PlayerController>,
    private readonly hooks: GameRunnerHooks,
  ) {
    this.current = initialState;
    this.pacing = { aiActionDelayMs: hooks.aiActionDelayMs ?? 0, combatDelayMs: hooks.combatDelayMs ?? 0 };
  }

  public get state(): GameState {
    return this.current;
  }

  private set(state: GameState, events: readonly GameEvent[] = []): void {
    if (this.stopped) return;
    this.current = state;
    this.hooks.onUpdate(state, events);
  }

  /**
   * Permanently stop this runner. Any in-flight loop (AI turns, combat) becomes
   * a no-op so an abandoned game can never write over a freshly started one.
   */
  public stop(): void {
    this.stopped = true;
  }

  /**
   * Swap in an earlier state of the current human turn (undo). Only valid while
   * the runner is waiting for that human, which the caller guarantees.
   */
  public replace(state: GameState): void {
    this.set(state, []);
  }

  /** Change pacing while running (e.g. the player picks a faster AI speed). */
  public setPacing(aiActionDelayMs: number, combatDelayMs: number): void {
    this.pacing = { aiActionDelayMs, combatDelayMs };
  }

  /** Apply a single action (used for live human input and internally). */
  public apply(action: Action): void {
    const result = reduce(this.current, action, this.ruleSet, this.world);
    this.set(result.state, result.events);
  }

  /** Run the loop until a human's input is required or the game ends. */
  public async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.loop();
    } finally {
      this.running = false;
    }
  }

  private async loop(): Promise<void> {
    for (;;) {
      if (this.stopped) return;
      const s = this.current;
      if (s.winner !== null) return;

      if (s.stage === "COMBAT") {
        await this.resolveCombat();
        continue;
      }

      const power = s.activePower;
      if (power === null) {
        throw new EngineError("No active power outside of combat");
      }
      const controller = this.controllers.get(power);
      if (controller === undefined) {
        throw new EngineError(`No controller for power '${power}'`);
      }

      const actions = await controller.requestActions({
        view: { power, state: this.current, ruleSet: this.ruleSet, world: this.world },
      });
      if (this.stopped) return;

      for (const action of actions) {
        this.apply(action);
        if (this.stopped) return;
        if (controller.kind === "ai" && this.pacing.aiActionDelayMs) {
          await sleep(this.pacing.aiActionDelayMs);
        }
      }

      // Human actions were already applied live; end the turn either way.
      this.apply({ type: "END_TURN" });
    }
  }

  private async resolveCombat(): Promise<void> {
    const result = advanceAfterCombat(this.current, this.ruleSet, this.world);
    this.set(result.state, result.events);
    if (this.pacing.combatDelayMs) {
      await sleep(this.pacing.combatDelayMs);
    }
  }
}
