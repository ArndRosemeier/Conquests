import { describe, expect, it } from "vitest";
import { createAI } from "./factory.ts";
import { BUILTIN_PERSONAS } from "./persona.ts";
import { CLASSIC_RULESET as R } from "../../engine/ruleset/classic.ts";
import { reduce } from "../../engine/state/reducer.ts";
import { createGame } from "../../engine/state/setup.ts";
import type { PowerControlConfig } from "../../engine/state/setup.ts";
import { advanceAfterCombat } from "../../engine/state/turn.ts";
import type { PowerId } from "../../engine/types.ts";
import { CLASSIC_WORLD as W } from "../../engine/world/classic.ts";
import { CLASSIC_HOME, SCENARIO_STANDARD } from "../../engine/world/scenarios.ts";

describe("AI navy budget", () => {
  it("spends most of its military budget on troops, not ships", async () => {
    const ai = createAI("v2", R, W);
    const controls = new Map<PowerId, PowerControlConfig>();
    R.playOrder.forEach((p, i) => controls.set(p, { control: "ai", persona: BUILTIN_PERSONAS[i % BUILTIN_PERSONAS.length]!.knobs }));
    let s = createGame({ ruleSet: R, world: W, home: CLASSIC_HOME, scenario: SCENARIO_STANDARD, controls, winningScore: 1000, seed: 3 });
    let army = 0;
    let navy = 0;
    let sorties = 0;
    while (s.winner === null && s.year <= 8) {
      if (s.stage === "COMBAT") {
        s = advanceAfterCombat(s, R, W).state;
        continue;
      }
      const power = s.activePower!;
      for (const a of await ai.requestActions({ view: { power, state: s, ruleSet: R, world: W } })) {
        const before = s.powers[String(power)]!.treasury;
        s = reduce(s, a, R, W).state;
        const cost = before - s.powers[String(power)]!.treasury;
        if (a.type === "BUILD_ARMY") army += cost;
        if (a.type === "BUILD_FLEET") navy += cost;
        if (a.type === "MOVE_FLEET" && a.troops > 0) sorties += 1;
      }
      s = reduce(s, { type: "END_TURN" }, R, W).state;
    }
    expect(sorties).toBeGreaterThan(0); // the AI still invades by sea
    expect(navy / (army + navy)).toBeLessThan(0.2);
  });
});
