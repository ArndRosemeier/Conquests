import { describe, expect, it } from "vitest";
import { AIController } from "../controllers/ai/aiController.ts";
import { knobs } from "../controllers/ai/persona.ts";
import type { PlayerController } from "../controllers/types.ts";
import { CLASSIC_RULESET } from "../engine/ruleset/classic.ts";
import { createGame } from "../engine/state/setup.ts";
import type { PowerControlConfig } from "../engine/state/setup.ts";
import type { PowerId } from "../engine/types.ts";
import { CLASSIC_WORLD } from "../engine/world/classic.ts";
import { CLASSIC_HOME, SCENARIO_STANDARD } from "../engine/world/scenarios.ts";
import { GameRunner } from "./gameRunner.ts";

describe("GameRunner (all AI)", () => {
  it("drives phases, combat, and years to a conclusion", async () => {
    const controls = new Map<PowerId, PowerControlConfig>();
    const controllers = new Map<PowerId, PlayerController>();
    for (const p of CLASSIC_RULESET.playOrder) {
      controls.set(p, { control: "ai", persona: knobs({}) });
      controllers.set(p, new AIController(CLASSIC_RULESET, CLASSIC_WORLD));
    }

    const initial = createGame({
      ruleSet: CLASSIC_RULESET,
      world: CLASSIC_WORLD,
      home: CLASSIC_HOME,
      scenario: SCENARIO_STANDARD,
      controls,
      winningScore: 40,
      seed: 99,
    });

    let updates = 0;
    const runner = new GameRunner(
      CLASSIC_RULESET,
      CLASSIC_WORLD,
      initial,
      controllers,
      { onUpdate: () => (updates += 1) },
    );

    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 4000));
    await Promise.race([runner.run(), timeout]);

    expect(updates).toBeGreaterThan(10);
    // Either a winner emerged or the game advanced well beyond the first year.
    expect(runner.state.winner !== null || runner.state.year > 2).toBe(true);
  });
});
