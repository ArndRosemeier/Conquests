import type { Action } from "../engine/state/actions.ts";
import type { GameState } from "../engine/state/gameState.ts";
import type { RuleSet } from "../engine/ruleset/types.ts";
import type { PowerId } from "../engine/types.ts";
import type { WorldDefinition } from "../engine/world/types.ts";

/**
 * What a controller is allowed to see when deciding. Today this exposes the full
 * state (single-player); fog-of-war can be layered here later without touching
 * controllers, since they only read through this view.
 */
export interface PlayerView {
  readonly power: PowerId;
  readonly state: GameState;
  readonly ruleSet: RuleSet;
  readonly world: WorldDefinition;
}

export interface DecisionContext {
  readonly view: PlayerView;
}

/**
 * A player. Human and AI controllers are fully interchangeable: both return the
 * actions to apply for the whole turn (END_TURN is added by the runner).
 * Swapping a power's controller at runtime is therefore trivial.
 */
export interface PlayerController {
  readonly kind: "human" | "ai";
  requestActions(ctx: DecisionContext): Promise<readonly Action[]>;
}
