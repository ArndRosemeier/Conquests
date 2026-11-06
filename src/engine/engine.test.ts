import { describe, expect, it } from "vitest";
import { createAI, DEFAULT_AI_VERSION } from "../controllers/ai/factory.ts";
import { knobs } from "../controllers/ai/persona.ts";
import type { PlayerController } from "../controllers/types.ts";
import { CLASSIC_RULESET } from "./ruleset/classic.ts";
import { resolveCombat } from "./state/combat.ts";
import type { GameState } from "./state/gameState.ts";
import { allAreas } from "./state/helpers.ts";
import { reduce } from "./state/reducer.ts";
import { advanceAfterCombat } from "./state/turn.ts";
import { deserializeGame, serializeGame } from "./state/serialization.ts";
import { createGame } from "./state/setup.ts";
import type { PowerControlConfig } from "./state/setup.ts";
import type { PowerId } from "./types.ts";
import { CLASSIC_WORLD, neighborsOf } from "./world/classic.ts";
import { CLASSIC_HOME } from "./world/scenarios.ts";
import { SCENARIO_STANDARD } from "./world/scenarios.ts";

function allAiGame(seed: number, winningScore: number): GameState {
  const controls = new Map<PowerId, PowerControlConfig>();
  for (const p of CLASSIC_RULESET.playOrder) {
    controls.set(p, { control: "ai", persona: knobs({}) });
  }
  return createGame({
    ruleSet: CLASSIC_RULESET,
    world: CLASSIC_WORLD,
    home: CLASSIC_HOME,
    scenario: SCENARIO_STANDARD,
    controls,
    winningScore,
    seed,
  });
}

/** Advance one turn (a single power acting, or combat) with AI controllers. */
async function stepTurn(state: GameState): Promise<GameState> {
  if (state.stage === "COMBAT") {
    return advanceAfterCombat(state, CLASSIC_RULESET, CLASSIC_WORLD).state;
  }
  const ai: PlayerController = createAI(DEFAULT_AI_VERSION, CLASSIC_RULESET, CLASSIC_WORLD);
  const power = state.activePower!;
  const actions = await ai.requestActions({
    view: { power, state, ruleSet: CLASSIC_RULESET, world: CLASSIC_WORLD },
  });
  let next = state;
  for (const a of actions) {
    next = reduce(next, a, CLASSIC_RULESET, CLASSIC_WORLD).state;
  }
  return reduce(next, { type: "END_TURN" }, CLASSIC_RULESET, CLASSIC_WORLD).state;
}

async function run(state: GameState, turns: number): Promise<GameState> {
  let next = state;
  for (let i = 0; i < turns && next.winner === null; i += 1) {
    next = await stepTurn(next);
  }
  return next;
}

describe("game setup", () => {
  it("gives every acting power its home areas at start (standard)", () => {
    const state = allAiGame(1, 1000);
    const owners = new Set(allAreas(state).map((a) => a.owner).filter((o) => o !== null));
    // All six powers should control at least their home areas.
    expect(owners.size).toBe(6);
    for (const p of CLASSIC_RULESET.playOrder) {
      const owned = allAreas(state).filter((a) => a.owner === p);
      expect(owned.length).toBeGreaterThan(0);
    }
  });

  it("starts neutral minors with no owner", () => {
    const state = allAiGame(1, 1000);
    const neutrals = allAreas(state).filter((a) => a.owner === null);
    expect(neutrals.length).toBeGreaterThan(90);
  });
});

describe("determinism", () => {
  it("produces identical results for identical seeds", async () => {
    const a = await run(allAiGame(42, 100000), 60);
    const b = await run(allAiGame(42, 100000), 60);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("combat resolution is a pure function of state", () => {
    const start = allAiGame(7, 100000);
    // Fast-forward to a state that has some pending moves by stepping to a move.
    const r1 = resolveCombat(start, CLASSIC_RULESET, CLASSIC_WORLD);
    const r2 = resolveCombat(start, CLASSIC_RULESET, CLASSIC_WORLD);
    expect(JSON.stringify(r1.state)).toBe(JSON.stringify(r2.state));
  });
});

describe("serialization", () => {
  it("round-trips game state losslessly", async () => {
    const state = await run(allAiGame(11, 100000), 30);
    const restored = deserializeGame(serializeGame(state));
    expect(JSON.stringify(restored)).toBe(JSON.stringify(state));
  });
});

describe("AI expansion", () => {
  it("conquers neutral territory over several years without errors", async () => {
    const before = allAiGame(3, 100000);
    const neutralsBefore = before.areas;
    const after = await run(before, 120);

    const ownedAfter = Object.values(after.areas).filter((a) => a.owner !== null).length;
    const ownedBefore = Object.values(neutralsBefore).filter((a) => a.owner !== null).length;
    expect(ownedAfter).toBeGreaterThan(ownedBefore);
    expect(after.year).toBeGreaterThan(1);
  });
});

describe("troops in whole thousands", () => {
  it("keeps every garrison, move and battle result a multiple of 1000", async () => {
    const unit = CLASSIC_RULESET.limits.troopUnit;
    let state = allAiGame(11, 100000);
    const odd: string[] = [];
    const check = (s: GameState, when: string): void => {
      for (const a of allAreas(s)) if (a.troops % unit !== 0) odd.push(`${when}: ${String(a.id)} ${a.troops}`);
      for (const m of s.pending) if (m.troops % unit !== 0) odd.push(`${when}: move ${m.troops}`);
    };
    check(state, "setup");
    for (let i = 0; i < 150 && state.winner === null; i += 1) {
      if (state.stage === "COMBAT") {
        const res = advanceAfterCombat(state, CLASSIC_RULESET, CLASSIC_WORLD);
        for (const e of res.events) {
          if (e.type === "BATTLE" && !e.bySea && (e.attackerLosses % unit !== 0 || e.defenderLosses % unit !== 0)) {
            odd.push(`battle ${e.attackerLosses}/${e.defenderLosses}`);
          }
        }
        state = res.state;
      } else {
        state = await stepTurn(state);
      }
      check(state, `step ${i}`);
    }
    expect(odd.slice(0, 5)).toEqual([]);
  });

  it("refuses moves that are not whole thousands", () => {
    const state = allAiGame(5, 100000);
    const power = state.activePower!;
    const area = allAreas(state).find((a) => a.owner === power && a.troops > 5_000)!;
    const to = neighborsOf(CLASSIC_WORLD, area.id)[0]!;
    expect(() =>
      reduce(state, { type: "MOVE_ARMY", from: area.id, to, troops: 1_500 }, CLASSIC_RULESET, CLASSIC_WORLD),
    ).toThrow(/steps of 1000/);
  });
});
