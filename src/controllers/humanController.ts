import type { Action } from "../engine/state/actions.ts";
import type { DecisionContext, PlayerController } from "./types.ts";

/**
 * The human player. Actions are applied live through the store as the user
 * interacts with the UI, so requestActions simply resolves (with an empty batch)
 * once the user ends their turn. This keeps humans and AIs on the same runner
 * loop while giving the UI immediate map feedback.
 */
export class HumanController implements PlayerController {
  public readonly kind = "human" as const;
  private resolver: ((actions: readonly Action[]) => void) | null = null;

  public requestActions(_ctx: DecisionContext): Promise<readonly Action[]> {
    void _ctx;
    return new Promise((resolve) => {
      this.resolver = resolve;
    });
  }

  /** Called by the UI when the user finishes their turn. */
  public finishTurn(): void {
    const resolve = this.resolver;
    this.resolver = null;
    resolve?.([]);
  }

  /** True while the runner is awaiting this human's input. */
  public get isWaiting(): boolean {
    return this.resolver !== null;
  }
}
