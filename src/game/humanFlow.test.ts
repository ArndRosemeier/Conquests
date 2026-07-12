import { describe, expect, it } from "vitest";
import { createAI, DEFAULT_AI_VERSION } from "../controllers/ai/factory.ts";
import { knobs } from "../controllers/ai/persona.ts";
import { HumanController } from "../controllers/humanController.ts";
import type { PlayerController } from "../controllers/types.ts";
import { CLASSIC_RULESET, ENGLAND } from "../engine/ruleset/classic.ts";
import { createGame } from "../engine/state/setup.ts";
import type { PowerControlConfig } from "../engine/state/setup.ts";
import type { PowerId } from "../engine/types.ts";
import { CLASSIC_WORLD } from "../engine/world/classic.ts";
import { CLASSIC_HOME, SCENARIO_STANDARD } from "../engine/world/scenarios.ts";
import { GameRunner } from "./gameRunner.ts";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("human handoff", () => {
  it("advances turns as the human ends each turn, without deadlock", async () => {
    const human = new HumanController();
    const controls = new Map<PowerId, PowerControlConfig>();
    const controllers = new Map<PowerId, PlayerController>();
    for (const p of CLASSIC_RULESET.playOrder) {
      if (p === ENGLAND) {
        controls.set(p, { control: "human", persona: null });
        controllers.set(p, human);
      } else {
        controls.set(p, { control: "ai", persona: knobs({}) });
        controllers.set(p, createAI(DEFAULT_AI_VERSION, CLASSIC_RULESET, CLASSIC_WORLD));
      }
    }

    const initial = createGame({
      ruleSet: CLASSIC_RULESET,
      world: CLASSIC_WORLD,
      home: CLASSIC_HOME,
      scenario: SCENARIO_STANDARD,
      controls,
      winningScore: 100_000,
      seed: 5,
    });

    const runner = new GameRunner(CLASSIC_RULESET, CLASSIC_WORLD, initial, controllers, {
      onUpdate: () => undefined,
    });
    void runner.run();

    // The human simply ends every turn; the runner should keep advancing.
    for (let i = 0; i < 200; i += 1) {
      await tick();
      if (human.isWaiting) human.finishTurn();
      if (runner.state.year >= 3) break;
    }

    expect(runner.state.year).toBeGreaterThanOrEqual(3);
  });
});
