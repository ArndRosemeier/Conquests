import type { RuleSet } from "../../engine/ruleset/types.ts";
import type { WorldDefinition } from "../../engine/world/types.ts";
import type { PlayerController } from "../types.ts";
import { AIController } from "./aiController.ts";
import { AIControllerV2 } from "./aiControllerV2.ts";
import { DiplomatAI } from "./diplomat.ts";

/**
 * Which AI implementation drives a seat. "v2" is the frozen baseline kept as a
 * control group; "v3" is the current, evolving controller. Both are pure
 * (stateless) so a single instance per version can drive any number of seats.
 */
export type AiVersion = "v2" | "v3";

/**
 * The version used by the live game and the crash tester. This single constant is
 * the one place to switch which AI ships: flip it to "v3" (or a future version)
 * once that version proves stronger than the current default in an A/B run
 * (`npm run ab`). v2 is the default because v3's reinforcement-flow experiment did
 * not beat it head-to-head.
 */
export const DEFAULT_AI_VERSION: AiVersion = "v2";

/** Construct the AI controller for a given version. */
export function createAI(
  version: AiVersion,
  ruleSet: RuleSet,
  world: WorldDefinition,
): PlayerController {
  const planner = version === "v2"
    ? new AIControllerV2(ruleSet, world)
    : new AIController(ruleSet, world);
  // Both planners share one diplomatic layer: war declarations and peace.
  return new DiplomatAI(planner, ruleSet, world);
}
