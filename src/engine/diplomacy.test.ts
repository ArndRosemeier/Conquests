import { describe, expect, it } from "vitest";
import { knobs } from "../controllers/ai/persona.ts";
import { CLASSIC_RULESET, ENGLAND, FRANCE, GERMANY } from "./ruleset/classic.ts";
import { resolveCombat } from "./state/combat.ts";
import { alliesOf, callsTo, coalitionAgainst, reputationOf, tradeableAreas, treatyBetween, truceUntil, warBalance } from "./state/diplomacy.ts";
import { opinionOf } from "./state/opinion.ts";
import { advanceAfterCombat } from "./state/turn.ts";
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
    expect(declared.events).toContainEqual({ type: "WAR_DECLARED", by: GERMANY, against: FRANCE, reputationLoss: D.declareWarCost, reason: "declared" });
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
    expect(events).toContainEqual({ type: "WAR_ENDED", by: GERMANY, against: FRANCE, payment: 500_000, ceded: [], gained: [] });
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

  it("a pact is signed with payment, raises opinion, and breaking it costs extra reputation", () => {
    let s = act(game(), GERMANY, { type: "PROPOSE", to: FRANCE, kind: "pact", payment: 1_000_000, years: 3, enemy: null }).state;
    const before = opinionOf(s, R, W, FRANCE, GERMANY).value;
    s = act(s, FRANCE, { type: "ANSWER_PROPOSAL", from: GERMANY, kind: "pact", accept: true }).state;
    expect(treatyBetween(s, GERMANY, FRANCE)?.kind).toBe("pact");
    expect(opinionOf(s, R, W, FRANCE, GERMANY).value).toBeGreaterThan(before);
    const broken = act(s, GERMANY, { type: "DECLARE_WAR", target: FRANCE });
    expect(broken.events).toContainEqual({ type: "TREATY_ENDED", kind: "pact", a: GERMANY, b: FRANCE, reason: "broken" });
    expect(reputationOf(broken.state, R, GERMANY)).toBe(D.reputationStart - D.declareWarCost - D.pactBreakCost);
  });

  it("pacts expire after their term and both sides gain reputation", () => {
    let s = act(game(), GERMANY, { type: "PROPOSE", to: FRANCE, kind: "pact", payment: 0, years: 3, enemy: null }).state;
    s = act(s, FRANCE, { type: "ANSWER_PROPOSAL", from: GERMANY, kind: "pact", accept: true }).state;
    for (let i = 0; i < 12; i += 1) s = advanceAfterCombat({ ...s, stage: "COMBAT", activePower: null }, R, W).state;
    expect(treatyBetween(s, GERMANY, FRANCE)).toBeUndefined();
    expect(reputationOf(s, R, GERMANY)).toBe(D.reputationStart + D.pactKeptGain);
  });

  it("an attack on an ally raises a call to arms; joining gains reputation, refusing ends the alliance", () => {
    let s = act(game(), ENGLAND, { type: "PROPOSE", to: FRANCE, kind: "alliance", payment: 0, years: 0, enemy: null }).state;
    s = act(s, FRANCE, { type: "ANSWER_PROPOSAL", from: ENGLAND, kind: "alliance", accept: true }).state;
    expect(alliesOf(s, FRANCE)).toEqual([ENGLAND]);
    const attacked = act(s, GERMANY, { type: "DECLARE_WAR", target: FRANCE });
    expect(attacked.events).toContainEqual({ type: "CALL_TO_ARMS", ally: ENGLAND, partner: FRANCE, enemy: GERMANY });
    s = attacked.state;
    expect(callsTo(s, ENGLAND)).toHaveLength(1);
    expect(() => act(s, ENGLAND, { type: "END_TURN" })).toThrow(/call to arms/);

    const joined = act(s, ENGLAND, { type: "ANSWER_CALL", partner: FRANCE, join: true }).state;
    expect(isAtWar(joined, ENGLAND, GERMANY)).toBe(true);
    expect(reputationOf(joined, R, ENGLAND)).toBe(D.reputationStart + D.answerCallGain);

    const refused = act(s, ENGLAND, { type: "ANSWER_CALL", partner: FRANCE, join: false }).state;
    expect(isAtWar(refused, ENGLAND, GERMANY)).toBe(false);
    expect(treatyBetween(refused, ENGLAND, FRANCE)).toBeUndefined();
    expect(reputationOf(refused, R, ENGLAND)).toBe(D.reputationStart - D.refuseCallCost);
  });

  it("war aid: a paid helper joins the war", () => {
    let s = act(game(), GERMANY, { type: "DECLARE_WAR", target: FRANCE }).state;
    s = act(s, FRANCE, { type: "PROPOSE", to: ENGLAND, kind: "aid", payment: 2_000_000, years: 0, enemy: GERMANY }).state;
    const treasury = getPowerState(s, ENGLAND).treasury;
    s = act(s, ENGLAND, { type: "ANSWER_PROPOSAL", from: FRANCE, kind: "aid", accept: true }).state;
    expect(isAtWar(s, ENGLAND, GERMANY)).toBe(true);
    expect(getPowerState(s, ENGLAND).treasury).toBe(treasury + 2_000_000);
  });

  it("peace terms can hand over territory; home supply centers cannot be traded", () => {
    let s = act(game(), GERMANY, { type: "DECLARE_WAR", target: FRANCE }).state;
    const french = W.areas.filter((a) => getAreaState(s, a.id).owner === FRANCE);
    const capital = french.find((a) => getAreaState(s, a.id).supplyCenterOf === FRANCE)!.id;
    expect(() => act(s, GERMANY, { type: "OFFER_PEACE", target: FRANCE, payment: 0, demand: [capital] })).toThrow(/supply centers/);
    const area = tradeableAreas(s, FRANCE)[0]!;
    s = set(s, area, { troops: 40_000 });
    const frenchTroops = (st: GameState): number => W.areas.reduce((n, a) => n + (getAreaState(st, a.id).owner === FRANCE ? getAreaState(st, a.id).troops : 0), 0);
    const before = frenchTroops(s);
    const scoreBefore = getPowerState(s, GERMANY).score;
    s = act(s, GERMANY, { type: "OFFER_PEACE", target: FRANCE, payment: 0, demand: [area] }).state;
    const { state, events } = act(s, FRANCE, { type: "ANSWER_PEACE", from: GERMANY, accept: true });
    expect(events).toContainEqual({ type: "WAR_ENDED", by: GERMANY, against: FRANCE, payment: 0, ceded: [], gained: [area] });
    expect(getAreaState(state, area).owner).toBe(GERMANY);
    expect(getAreaState(state, area).troops).toBe(R.limits.minGarrison);
    expect(getPowerState(state, GERMANY).score).toBe(scoreBefore + getAreaState(s, area).victoryValue);
    // The French garrison withdrew next door instead of vanishing.
    expect(frenchTroops(state)).toBe(before - 40_000 + (neighborsOf(W, area).some((n) => getAreaState(s, n).owner === FRANCE) ? 40_000 : 0));
    expect(isAtWar(state, GERMANY, FRANCE)).toBe(false);
  });

  it("an offer fails if a promised area changed hands", () => {
    let s = act(game(), GERMANY, { type: "DECLARE_WAR", target: FRANCE }).state;
    const area = tradeableAreas(s, FRANCE)[0]!;
    s = act(s, GERMANY, { type: "OFFER_PEACE", target: FRANCE, payment: 0, demand: [area] }).state;
    s = set(s, area, { owner: ENGLAND });
    expect(() => act(s, FRANCE, { type: "ANSWER_PEACE", from: GERMANY, accept: true })).toThrow(IllegalActionError);
  });

  it("coalitions: only against a pariah; members gain reputation; a separate peace costs", () => {
    let s = game();
    expect(() => act(s, ENGLAND, { type: "JOIN_COALITION", target: GERMANY })).toThrow(/reputation below/);
    s = { ...s, reputation: { ...s.reputation, [String(GERMANY)]: 10 } };
    const joined = act(s, ENGLAND, { type: "JOIN_COALITION", target: GERMANY });
    expect(joined.events[0]).toEqual({ type: "COALITION_JOINED", power: ENGLAND, target: GERMANY, founded: true, members: 1 });
    expect(isAtWar(joined.state, ENGLAND, GERMANY)).toBe(true);
    expect(reputationOf(joined.state, R, ENGLAND)).toBe(D.reputationStart - D.declareWarOnPariahCost + D.coalitionJoinGain);
    s = act(joined.state, FRANCE, { type: "JOIN_COALITION", target: GERMANY }).state;
    expect(coalitionAgainst(s, GERMANY)?.members).toEqual([ENGLAND, FRANCE]);

    // France makes a separate peace while England fights on.
    s = act(s, GERMANY, { type: "OFFER_PEACE", target: FRANCE, payment: 0 }).state;
    const rep = reputationOf(s, R, FRANCE);
    const peace = act(s, FRANCE, { type: "ANSWER_PEACE", from: GERMANY, accept: true });
    expect(peace.events).toContainEqual({ type: "COALITION_LEFT", power: FRANCE, target: GERMANY, reputationLoss: D.coalitionDesertCost });
    expect(reputationOf(peace.state, R, FRANCE)).toBe(rep - D.coalitionDesertCost);
    expect(coalitionAgainst(peace.state, GERMANY)?.members).toEqual([ENGLAND]);

    // The last member's peace ends the coalition at no cost.
    s = act(peace.state, GERMANY, { type: "OFFER_PEACE", target: ENGLAND, payment: 0 }).state;
    const last = act(s, ENGLAND, { type: "ANSWER_PEACE", from: GERMANY, accept: true });
    expect(last.events).toContainEqual({ type: "COALITION_LEFT", power: ENGLAND, target: GERMANY, reputationLoss: 0 });
    expect(last.events).toContainEqual({ type: "COALITION_ENDED", target: GERMANY, reason: "peace" });
    expect(coalitionAgainst(last.state, GERMANY)).toBeUndefined();
  });
});
