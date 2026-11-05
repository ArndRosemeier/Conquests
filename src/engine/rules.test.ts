import { describe, expect, it } from "vitest";
import { knobs } from "../controllers/ai/persona.ts";
import { CLASSIC_RULESET, ENGLAND, FRANCE, GERMANY } from "./ruleset/classic.ts";
import { resolveCombat } from "./state/combat.ts";
import { calendarYear } from "./state/gameState.ts";
import type { AreaState, GameState } from "./state/gameState.ts";
import { allAreas, getAreaState, withArea } from "./state/helpers.ts";
import { reduce } from "./state/reducer.ts";
import { deserializeGame } from "./state/serialization.ts";
import { createGame } from "./state/setup.ts";
import type { PowerControlConfig } from "./state/setup.ts";
import { advanceAfterCombat } from "./state/turn.ts";
import { IllegalActionError } from "./types.ts";
import type { AreaId, PowerId } from "./types.ts";
import { CLASSIC_WORLD, neighborsOf } from "./world/classic.ts";
import { CLASSIC_HOME, SCENARIO_1914, SCENARIO_STANDARD } from "./world/scenarios.ts";

const R = CLASSIC_RULESET;
const W = CLASSIC_WORLD;

function game(scenario = SCENARIO_STANDARD): GameState {
  const controls = new Map<PowerId, PowerControlConfig>();
  for (const p of R.playOrder) controls.set(p, { control: "ai", persona: knobs({}) });
  return createGame({ ruleSet: R, world: W, home: CLASSIC_HOME, scenario, controls, winningScore: 1000, seed: 7 });
}

function set(state: GameState, id: AreaId, patch: Partial<AreaState>): GameState {
  return withArea(state, { ...getAreaState(state, id), ...patch });
}

/** A neutral area with at least two neutral neighbours, so two armies can converge on it. */
function convergence(state: GameState): { target: AreaId; a: AreaId; b: AreaId } {
  for (const area of W.areas) {
    const ns = neighborsOf(W, area.id).filter((n) => getAreaState(state, n).owner === null);
    if (getAreaState(state, area.id).owner === null && ns.length >= 2) {
      return { target: area.id, a: ns[0]!, b: ns[1]! };
    }
  }
  throw new Error("no convergence point");
}

describe("combat", () => {
  it("combines armies a power marches into the same area", () => {
    let s = game();
    const { target, a, b } = convergence(s);
    s = set(s, a, { owner: ENGLAND, troops: 1_000 });
    s = set(s, b, { owner: ENGLAND, troops: 1_000 });
    s = set(s, target, { troops: 30_000, fortified: false });
    s = {
      ...s,
      pending: [
        { power: ENGLAND, from: a, to: target, troops: 25_000, fleets: 0, bySea: false },
        { power: ENGLAND, from: b, to: target, troops: 25_000, fleets: 0, bySea: false },
      ],
    };
    const { state, events } = resolveCombat(s, R, W);
    const battles = events.filter((e) => e.type === "BATTLE");
    expect(battles).toHaveLength(1);
    expect(battles[0]).toMatchObject({ area: target, from: [a, b] });
    // 50k elite troops against 30k: the combined force should carry it.
    expect(getAreaState(state, target).owner).toBe(ENGLAND);
  });

  it("never makes a power fight its own garrison", () => {
    let s = game();
    const { target, a, b } = convergence(s);
    s = set(s, a, { owner: ENGLAND, troops: 1_000 });
    s = set(s, target, { troops: 1_000 });
    s = set(s, b, { owner: FRANCE, troops: 1_000, fleets: 0 });
    // England takes the area with a land army; England's sea landing arrives afterwards.
    s = {
      ...s,
      pending: [
        { power: ENGLAND, from: a, to: target, troops: 80_000, fleets: 0, bySea: false },
        { power: ENGLAND, from: a, to: target, troops: 5_000, fleets: 0, bySea: true },
      ],
    };
    const { state, events } = resolveCombat(s, R, W);
    expect(events.filter((e) => e.type === "BATTLE")).toHaveLength(1);
    const held = getAreaState(state, target);
    expect(held.owner).toBe(ENGLAND);
    // The second wave joined the garrison instead of replacing it.
    expect(held.troops).toBeGreaterThan(5_000);
  });

  it("calls off an attack on a power it is not at war with, and starts no war", () => {
    let s = game();
    const target = W.areas.find((x) => getAreaState(s, x.id).owner === FRANCE)!.id;
    const from = neighborsOf(W, target)[0]!;
    s = set(s, from, { owner: GERMANY, troops: 1_000 });
    s = { ...s, pending: [{ power: GERMANY, from, to: target, troops: 10_000, fleets: 0, bySea: false }] };
    const { state, events } = resolveCombat(s, R, W);
    expect(events).toContainEqual({ type: "ATTACK_CALLED_OFF", power: GERMANY, area: target, owner: FRANCE });
    expect(events.some((e) => e.type === "WAR_DECLARED" || e.type === "BATTLE")).toBe(false);
    expect(getAreaState(state, from).troops).toBe(11_000);
  });
});

describe("turn advance", () => {
  it("eliminates a power that holds no land and skips it afterwards", () => {
    let s = game();
    for (const a of allAreas(s)) if (a.owner === FRANCE) s = set(s, a.id, { owner: null });
    s = { ...s, stage: "COMBAT", activePower: null };
    const { state, events } = advanceAfterCombat(s, R, W);
    expect(events).toContainEqual({ type: "POWER_ELIMINATED", power: FRANCE });
    expect(state.powers[String(FRANCE)]!.eliminated).toBe(true);
    // France never gets a turn again.
    let t = state;
    for (let i = 0; i < 6; i += 1) {
      expect(t.activePower).not.toBe(FRANCE);
      t = reduce(t, { type: "END_TURN" }, R, W).state;
      if (t.stage === "COMBAT") break;
    }
  });

  it("declares the last power standing the winner", () => {
    let s = game();
    for (const a of allAreas(s)) if (a.owner !== null && a.owner !== ENGLAND) s = set(s, a.id, { owner: null });
    s = { ...s, stage: "COMBAT", activePower: null };
    const { state, events } = advanceAfterCombat(s, R, W);
    expect(state.winner).toBe(ENGLAND);
    expect(events).toContainEqual({ type: "GAME_WON", power: ENGLAND });
  });

  it("pays income with an event at the start of each year", () => {
    let s = game();
    s = { ...s, season: "WINTER", stage: "COMBAT", activePower: null, pending: [] };
    const { state, events } = advanceAfterCombat(s, R, W);
    expect(state.season).toBe("SPRING");
    expect(events.some((e) => e.type === "INCOME" && e.power === ENGLAND)).toBe(true);
  });

  it("treats a winning score of 0 as no limit", () => {
    let s = { ...game(), winningScore: 0 };
    s = { ...s, powers: { ...s.powers, [String(ENGLAND)]: { ...s.powers[String(ENGLAND)]!, score: 99_999 } } };
    s = { ...s, stage: "COMBAT", activePower: null };
    expect(advanceAfterCombat(s, R, W).state.winner).toBeNull();
  });
});

describe("rules", () => {
  it("shows calendar years from the scenario", () => {
    expect(calendarYear(game())).toBe(1880);
    expect(calendarYear(game(SCENARIO_1914))).toBe(1914);
  });

  it("refuses spying on your own area", () => {
    const s = game();
    const own = allAreas(s).find((a) => a.owner === ENGLAND)!;
    expect(() => reduce(s, { type: "SPY", area: own.id }, R, W)).toThrow(IllegalActionError);
  });

  it("refuses zero or negative aid", () => {
    let s = game();
    s = { ...s, year: 2 };
    const minor = allAreas(s).find((a) => a.owner === null)!;
    expect(() => reduce(s, { type: "LOAN_MINOR", area: minor.id, amount: 0 }, R, W)).toThrow(IllegalActionError);
    expect(() => reduce(s, { type: "LOAN_POWER", target: GERMANY, amount: -5 }, R, W)).toThrow(IllegalActionError);
  });

  it("loads version 4 saves", () => {
    const s = game();
    const { startYear: _drop, ...old } = s;
    void _drop;
    const json = JSON.stringify({ version: 4, state: { ...old, scenarioId: "1914", winningScore: null } });
    const loaded = deserializeGame(json);
    expect(loaded.startYear).toBe(1914);
    expect(loaded.winningScore).toBe(0);
  });
});
