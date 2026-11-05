import { createAI, DEFAULT_AI_VERSION } from "../../controllers/ai/factory.ts";
import { BUILTIN_PERSONAS } from "../../controllers/ai/persona.ts";
import { CLASSIC_RULESET } from "../../engine/ruleset/classic.ts";
import type { GameEvent } from "../../engine/state/events.ts";
import type { GameState } from "../../engine/state/gameState.ts";
import { reduce } from "../../engine/state/reducer.ts";
import { createGame } from "../../engine/state/setup.ts";
import type { PowerControlConfig } from "../../engine/state/setup.ts";
import { advanceAfterCombat } from "../../engine/state/turn.ts";
import type { PowerId } from "../../engine/types.ts";
import { CLASSIC_WORLD } from "../../engine/world/classic.ts";
import { CLASSIC_HOME, SCENARIO_STANDARD } from "../../engine/world/scenarios.ts";

/**
 * Attract mode: a real all-AI game that plays itself behind the title screen.
 * `step()` advances one power's turn (or one combat phase) and returns what happened.
 */
export class AttractGame {
  state: GameState;
  private readonly ai = createAI(DEFAULT_AI_VERSION, CLASSIC_RULESET, CLASSIC_WORLD);
  private busy = false;

  constructor(seed = Math.floor(Math.random() * 1e9)) {
    this.state = AttractGame.fresh(seed);
  }

  private static fresh(seed: number): GameState {
    const controls = new Map<PowerId, PowerControlConfig>();
    CLASSIC_RULESET.playOrder.forEach((p, i) => {
      const persona = BUILTIN_PERSONAS[(i + seed) % BUILTIN_PERSONAS.length]!;
      controls.set(p, { control: "ai", persona: persona.knobs });
    });
    return createGame({
      ruleSet: CLASSIC_RULESET,
      world: CLASSIC_WORLD,
      home: CLASSIC_HOME,
      scenario: SCENARIO_STANDARD,
      controls,
      winningScore: 600,
      seed,
    });
  }

  async step(): Promise<readonly GameEvent[]> {
    if (this.busy) return [];
    this.busy = true;
    try {
      let s = this.state;
      // Restart after a winner (or a very long game) so the show never ends.
      if (s.winner !== null || s.year > 40) {
        this.state = AttractGame.fresh(Math.floor(Math.random() * 1e9));
        return [];
      }
      if (s.stage === "COMBAT") {
        const r = advanceAfterCombat(s, CLASSIC_RULESET, CLASSIC_WORLD);
        this.state = r.state;
        return r.events;
      }
      const power = s.activePower!;
      const actions = await this.ai.requestActions({
        view: { power, state: s, ruleSet: CLASSIC_RULESET, world: CLASSIC_WORLD },
      });
      const events: GameEvent[] = [];
      for (const a of actions) {
        try {
          const r = reduce(s, a, CLASSIC_RULESET, CLASSIC_WORLD);
          s = r.state;
          events.push(...r.events);
        } catch {
          // An AI order that turns out illegal is just skipped in the show.
        }
      }
      s = reduce(s, { type: "END_TURN" }, CLASSIC_RULESET, CLASSIC_WORLD).state;
      this.state = s;
      return events;
    } finally {
      this.busy = false;
    }
  }
}
