import type { Action } from "../engine/state/actions.ts";
import type { GameState } from "../engine/state/gameState.ts";
import type { DecisionContext, PlayerController } from "../controllers/types.ts";

/**
 * A nation played by someone in another browser. Their actions arrive as intents and are applied
 * by the host as they come; `requestActions` resolves when they end their turn. While they are
 * away, the computer stands in.
 */
export class SeatController implements PlayerController {
  public readonly kind = "human" as const;
  private resolver: ((actions: readonly Action[]) => void) | null = null;
  private ctx: DecisionContext | null = null;

  public constructor(
    private readonly online: () => boolean,
    private readonly standIn: PlayerController,
    private readonly current: () => GameState,
  ) {}

  public requestActions(ctx: DecisionContext): Promise<readonly Action[]> {
    if (!this.online()) return this.standIn.requestActions(ctx);
    this.ctx = ctx;
    return new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  public get isWaiting(): boolean {
    return this.resolver !== null;
  }

  public finishTurn(): void {
    const resolve = this.resolver;
    this.resolver = null;
    this.ctx = null;
    resolve?.([]);
  }

  /** The player left mid-turn: the computer finishes the turn from where they stopped. */
  public async takeOver(): Promise<void> {
    const resolve = this.resolver;
    const ctx = this.ctx;
    if (resolve === null || ctx === null || this.online()) return;
    this.resolver = null;
    this.ctx = null;
    const actions = await this.standIn.requestActions({ view: { ...ctx.view, state: this.current() } });
    resolve(actions);
  }
}
