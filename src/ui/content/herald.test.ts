import { describe, expect, it } from "vitest";
import { knobs } from "../../controllers/ai/persona.ts";
import { CLASSIC_RULESET, ENGLAND, FRANCE } from "../../engine/ruleset/classic.ts";
import { resolveCombat } from "../../engine/state/combat.ts";
import type { GameState } from "../../engine/state/gameState.ts";
import { getAreaState, withArea } from "../../engine/state/helpers.ts";
import { createGame } from "../../engine/state/setup.ts";
import type { PowerControlConfig } from "../../engine/state/setup.ts";
import type { AreaId, PowerId } from "../../engine/types.ts";
import { CLASSIC_WORLD } from "../../engine/world/classic.ts";
import { CLASSIC_HOME, SCENARIO_STANDARD } from "../../engine/world/scenarios.ts";
import { storyFor } from "./herald.ts";

const R = CLASSIC_RULESET;
const W = CLASSIC_WORLD;
const NORMANDY = W.areas.find((a) => a.name === "Normandy")!.id;

function game(): GameState {
  const controls = new Map<PowerId, PowerControlConfig>();
  for (const p of R.playOrder) controls.set(p, { control: "ai", persona: knobs({}) });
  return createGame({ ruleSet: R, world: W, home: CLASSIC_HOME, scenario: SCENARIO_STANDARD, controls, winningScore: 1000, seed: 7 });
}

/** England sails at French-held Normandy from one of its own areas. */
function seaAttack(troops: number, fleets: number): ReturnType<typeof resolveCombat> {
  let s = game();
  const from: AreaId = W.areas.find((a) => a.isPort && a.id !== NORMANDY && getAreaState(s, a.id).owner === ENGLAND)!.id;
  s = withArea(s, { ...getAreaState(s, NORMANDY), owner: FRANCE, troops: 2_000, fleets: 1, fortified: false });
  s = withArea(s, { ...getAreaState(s, from), fleets });
  s = { ...s, pending: [{ power: ENGLAND, from, to: NORMANDY, troops, fleets, bySea: true }] };
  return resolveCombat(s, R, W);
}

function stories(events: ReturnType<typeof resolveCombat>["events"]) {
  return events.flatMap((e) => {
    const s = storyFor(e, R, W, "seed", ENGLAND);
    return s ? [s] : [];
  });
}

describe("herald", () => {
  it("reports a ships-only sortie as a sea battle, not a capture", () => {
    const { state, events } = seaAttack(0, 40);
    expect(getAreaState(state, NORMANDY).owner).toBe(FRANCE);
    const battle = events.find((e) => e.type === "BATTLE");
    expect(battle).toMatchObject({ attackerWon: true, captured: false });
    const kinds = stories(events).map((s) => s.kind);
    expect(kinds).toContain("naval");
    expect(kinds).not.toContain("capture_power");
    expect(kinds).not.toContain("capture_minor");
  });

  it("reports a landing that takes the area as a capture", () => {
    const { state, events } = seaAttack(200_000, 40);
    expect(getAreaState(state, NORMANDY).owner).toBe(ENGLAND);
    expect(events.find((e) => e.type === "BATTLE")).toMatchObject({ attackerWon: true, captured: true });
    expect(stories(events).map((s) => s.kind)).toContain("capture_power");
  });
});
