import { describe, expect, it } from "vitest";
import { CLASSIC_RULESET } from "../../engine/ruleset/classic.ts";
import { resolveCombat } from "../../engine/state/combat.ts";
import type { GameState } from "../../engine/state/gameState.ts";
import { declareWar, getAreaState, withArea } from "../../engine/state/helpers.ts";
import { getIntel } from "../../engine/state/knowledge.ts";
import { reduce } from "../../engine/state/reducer.ts";
import { createGame } from "../../engine/state/setup.ts";
import type { PowerControlConfig } from "../../engine/state/setup.ts";
import type { AreaId, PowerId } from "../../engine/types.ts";
import { CLASSIC_WORLD, neighborsOf } from "../../engine/world/classic.ts";
import { CLASSIC_HOME, SCENARIO_STANDARD } from "../../engine/world/scenarios.ts";
import { createAI, DEFAULT_AI_VERSION } from "./factory.ts";
import type { AiVersion } from "./factory.ts";
import { knobs } from "./persona.ts";

const R = CLASSIC_RULESET;
const W = CLASSIC_WORLD;

/**
 * The active power gets a home area next to an enemy-held area that is heavily
 * garrisoned, while its intel says the area is nearly empty.
 */
function setup(intelAgeSeasons: number): { state: GameState; me: PowerId; target: AreaId; from: AreaId } {
  const controls = new Map<PowerId, PowerControlConfig>();
  for (const p of R.playOrder) controls.set(p, { control: "ai", persona: knobs({ aggression: 90 }) });
  let state = createGame({ ruleSet: R, world: W, home: CLASSIC_HOME, scenario: SCENARIO_STANDARD, controls, winningScore: 9999, seed: 7 });
  let me: PowerId | null = null;
  let from: AreaId | null = null;
  let target: AreaId | null = null;
  for (const p of R.playOrder) {
    for (const a of Object.values(state.areas)) {
      if (a.owner !== p || a.supplyCenterOf !== p) continue;
      const t = neighborsOf(W, a.id).find((id) => state.areas[String(id)]?.owner !== p);
      if (t !== undefined) {
        [me, from, target] = [p, a.id, t];
        break;
      }
    }
    if (me !== null) break;
  }
  if (me === null || from === null || target === null) throw new Error("no land border");
  const enemy = R.playOrder.find((p) => p !== me)!;
  state = { ...state, activePower: me };
  state = withArea(state, { ...getAreaState(state, target), owner: enemy, troops: 900_000, fortified: false });
  state = withArea(state, { ...getAreaState(state, from), troops: 200_000 });
  state = { ...state, war: declareWar(state.war, me, enemy) };
  const observedYear = state.year - Math.floor(intelAgeSeasons / 4);
  state = {
    ...state,
    intel: {
      ...state.intel,
      [String(me)]: {
        [String(target)]: { troops: 5_000, fleets: 0, owner: enemy, fortified: false, observedYear, observedSeason: "SPRING" },
      },
    },
  };
  return { state, me, target, from };
}

describe("AI and stale intel", () => {
  it("a repulsed attacker learns the garrison it fought", () => {
    const { state, me, target, from } = setup(4);
    let s = reduce(state, { type: "MOVE_ARMY", from, to: target, troops: 20_000 }, R, W).state;
    s = { ...s, stage: "COMBAT", activePower: null };
    const after = resolveCombat(s, R, W).state;
    expect(getAreaState(after, target).owner).not.toBe(me);
    const report = getIntel(after, me, target);
    expect(report).not.toBeNull();
    expect(report!.troops).toBe(getAreaState(after, target).troops);
    expect(report!.troops).toBeGreaterThan(100_000);
  });

  it("does not attack again after being thrown back (no spying outside spring)", async () => {
    const { state, me, target, from } = setup(4);
    let s = reduce(state, { type: "MOVE_ARMY", from, to: target, troops: 20_000 }, R, W).state;
    s = resolveCombat({ ...s, stage: "COMBAT", activePower: null }, R, W).state;
    s = { ...s, stage: "PLAYER", activePower: me, season: "SUMMER", armyMovesRemaining: state.armyMovesRemaining };
    const ai = createAI(DEFAULT_AI_VERSION, R, W);
    const actions = await ai.requestActions({ view: { power: me, state: s, ruleSet: R, world: W } });
    expect(actions.some((a) => a.type === "MOVE_ARMY" && a.to === target)).toBe(false);
  });

  for (const version of new Set<AiVersion>([DEFAULT_AI_VERSION, "v2", "v3"])) {
    it(`${version}: re-scouts an old report in spring instead of attacking blind`, async () => {
      const { state, me, target } = setup(4);
      expect(state.season).toBe("SPRING");
      const ai = createAI(version, R, W);
      const actions = await ai.requestActions({ view: { power: me, state, ruleSet: R, world: W } });
      expect(actions.some((a) => a.type === "SPY" && a.area === target)).toBe(true);
      const attack = actions.some((a) => a.type === "MOVE_ARMY" && a.to === target);
      expect(attack).toBe(false);
    });
  }
});
