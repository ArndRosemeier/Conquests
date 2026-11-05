import { describe, expect, it } from "vitest";
import { knobs } from "../controllers/ai/persona.ts";
import { CLASSIC_RULESET, ENGLAND, FRANCE, GERMANY } from "./ruleset/classic.ts";
import { resolveCombat } from "./state/combat.ts";
import { reputationOf, truceUntil, warBalance } from "./state/diplomacy.ts";
import type { AreaState, GameState } from "./state/gameState.ts";
import { getAreaState, getPowerState, isAtWar, withArea } from "./state/helpers.ts";
import { reduce } from "./state/reducer.ts";
import { deserializeGame, serializeGame } from "./state/serialization.ts";
import { createGame } from "./state/setup.ts";
import type { PowerControlConfig } from "./state/setup.ts";
import { IllegalActionError } from "./types.ts";
import type { AreaId, PowerId } from "./types.ts";
import { CLASSIC_WORLD, neighborsOf } from "./world/classic.ts";
import { CLASSIC_HOME, SCENARIO_1914, SCENARIO_STANDARD } from "./world/scenarios.ts";

const R = CLASSIC_RULESET;
const W = CLASSIC_WORLD;
const D = R.diplomacy;

function game(scenario = SCENARIO_STANDARD): GameState {
  const controls = new Map<PowerId, PowerControlConfig>();
  for (const p of R.playOrder) controls.set(p, { control: "ai", persona: knobs({}) });
  return createGame({ ruleSet: R, world: W, home: CLASSIC_HOME, scenario, controls, winningScore: 1000, seed: 7 });
}

function set(state: GameState, id: AreaId, patch: Partial<AreaState>): GameState {
  return withArea(state, { ...getAreaState(state, id), ...patch });
}

const act = (s: GameState, power: PowerId, a: Parameters<typeof reduce>[1]) =>
  reduce({ ...s, activePower: power, stage: "PLAYER" }, a, R, W);

/** A French area next to a German-held one with a big army. */
function border(s: GameState): { s: GameState; from: AreaId; target: AreaId } {
  const target = W.areas.find((x) => getAreaState(s, x.id).owner === FRANCE)!.id;
  const from = neighborsOf(W, target)[0]!;
  const t = set(s, target, { troops: 1_000, fortified: false });
  return { s: set(t, from, { owner: GERMANY, troops: 200_000 }), from, target };
}

describe("diplomacy", () => {
  it("forbids marching on a power you are at peace with", () => {
    const { s, from, target } = border(game());
    expect(() => act(s, GERMANY, { type: "MOVE_ARMY", from, to: target, troops: 10_000 })).toThrow(IllegalActionError);
  });

  it("declaring war costs reputation and allows the attack", () => {
    const { s, from, target } = border(game());
    const declared = act(s, GERMANY, { type: "DECLARE_WAR", target: FRANCE });
    expect(declared.events).toContainEqual({ type: "WAR_DECLARED", by: GERMANY, against: FRANCE, reputationLoss: D.declareWarCost });
    expect(isAtWar(declared.state, GERMANY, FRANCE)).toBe(true);
    expect(reputationOf(declared.state, R, GERMANY)).toBe(D.reputationStart - D.declareWarCost);
    const moved = act(declared.state, GERMANY, { type: "MOVE_ARMY", from, to: target, troops: 150_000 });
    const { state } = resolveCombat(moved.state, R, W);
    expect(getAreaState(state, target).owner).toBe(GERMANY);
    expect(warBalance(state, GERMANY, FRANCE)).toBeGreaterThan(0);
  });

  it("peace with payment moves the money, ends the war and starts a truce", () => {
    let s = act(game(), GERMANY, { type: "DECLARE_WAR", target: FRANCE }).state;
    const before = getPowerState(s, GERMANY).treasury + getPowerState(s, FRANCE).treasury;
    s = act(s, GERMANY, { type: "OFFER_PEACE", target: FRANCE, payment: 500_000 }).state;
    const { state, events } = act(s, FRANCE, { type: "ANSWER_PEACE", from: GERMANY, accept: true });
    expect(events).toContainEqual({ type: "WAR_ENDED", by: GERMANY, against: FRANCE, payment: 500_000 });
    expect(isAtWar(state, GERMANY, FRANCE)).toBe(false);
    expect(getPowerState(state, FRANCE).treasury + getPowerState(state, GERMANY).treasury).toBe(before);
    expect(truceUntil(state, GERMANY, FRANCE)).not.toBeNull();
    expect(() => act(state, FRANCE, { type: "DECLARE_WAR", target: GERMANY })).toThrow(/truce/);
  });

  it("a refused offer keeps the war; offers lapse at the offerer's next turn", () => {
    let s = act(game(), ENGLAND, { type: "DECLARE_WAR", target: FRANCE }).state;
    s = act(s, ENGLAND, { type: "OFFER_PEACE", target: FRANCE, payment: 0 }).state;
    const refused = act(s, FRANCE, { type: "ANSWER_PEACE", from: ENGLAND, accept: false });
    expect(refused.events).toContainEqual({ type: "PEACE_DECLINED", by: FRANCE, offerer: ENGLAND });
    expect(isAtWar(refused.state, ENGLAND, FRANCE)).toBe(true);
    // England offers again, then ends its turn: the offer survives the others' turns...
    s = act(refused.state, ENGLAND, { type: "OFFER_PEACE", target: FRANCE, payment: 0 }).state;
    s = reduce(s, { type: "END_TURN" }, R, W).state;
    expect(s.peaceOffers).toHaveLength(1);
  });

  it("scenario wars start without costing reputation and survive a save", () => {
    const s = game(SCENARIO_1914);
    expect(isAtWar(s, GERMANY, FRANCE)).toBe(true);
    expect(reputationOf(s, R, GERMANY)).toBe(D.reputationStart);
    const back = deserializeGame(serializeGame(s));
    expect(back.warSince).toEqual(s.warSince);
  });
});
