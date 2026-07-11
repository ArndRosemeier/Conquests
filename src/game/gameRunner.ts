import type { PlayerController } from "../controllers/types.ts";
import type { Action } from "../engine/state/actions.ts";
import { resolveCombat as resolveCombatFn } from "../engine/state/combat.ts";
import type { GameEvent } from "../engine/state/events.ts";
import type { GameState } from "../engine/state/gameState.ts";
import { beginNextTurn } from "../engine/state/phases.ts";
import { reduce } from "../engine/state/reducer.ts";
import { applyAnnualEconomy, checkWinner } from "../engine/state/scoring.ts";
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
  private stopped = false;

  public constructor(
    private readonly ruleSet: RuleSet,
    private readonly world: WorldDefinition,
    initialState: GameState,
    private readonly controllers: ReadonlyMap<PowerId, PlayerController>,
    private readonly hooks: GameRunnerHooks,
  ) {
    this.current = initialState;
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

      for (const action of actions) {
        this.apply(action);
        if (controller.kind === "ai" && this.hooks.aiActionDelayMs) {
          await sleep(this.hooks.aiActionDelayMs);
        }
      }

      // Human actions were already applied live; end the turn either way.
      this.apply({ type: "END_TURN" });
    }
  }

  private async resolveCombat(): Promise<void> {
    const combat = resolveCombatFn(this.current, this.ruleSet, this.world);
    this.set(combat.state, combat.events);
    if (this.hooks.combatDelayMs) {
      await sleep(this.hooks.combatDelayMs);
    }

    let next = beginNextTurn(this.current, this.ruleSet);
    if (next.season === "SPRING") {
      const eco = applyAnnualEconomy(next, this.ruleSet, this.world);
      next = eco.state;
      this.set(next, eco.events);
    } else {
      this.set(next);
    }

    const winner = checkWinner(this.current);
    if (winner !== null) {
      this.set({ ...this.current, winner });
    }
  }
}
