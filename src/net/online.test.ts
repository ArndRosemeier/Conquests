import { describe, expect, it } from "vitest";
import { createAI, DEFAULT_AI_VERSION } from "../controllers/ai/factory.ts";
import { HumanController } from "../controllers/humanController.ts";
import type { PlayerController } from "../controllers/types.ts";
import { CLASSIC_RULESET } from "../engine/ruleset/classic.ts";
import type { GameState } from "../engine/state/gameState.ts";
import { createGame } from "../engine/state/setup.ts";
import type { PowerControlConfig } from "../engine/state/setup.ts";
import type { PowerId } from "../engine/types.ts";
import { CLASSIC_WORLD } from "../engine/world/classic.ts";
import { CLASSIC_HOME, SCENARIO_STANDARD } from "../engine/world/scenarios.ts";
import { GameRunner } from "../game/gameRunner.ts";
import { FakeRelay } from "./fakeHub.ts";
import type { Hub, Intent } from "./online.ts";
import { OnlineRoom } from "./online.ts";
import { SeatController } from "./seatController.ts";

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (cond()) return;
    await tick(5);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const SETTINGS = { scenarioId: "standard", winningScore: 1000, seed: 7 };

function newGameFor(seated: readonly string[]): GameState {
  const controls = new Map<PowerId, PowerControlConfig>();
  for (const p of CLASSIC_RULESET.playOrder) controls.set(p, { control: seated.includes(String(p)) ? "human" : "ai", persona: null });
  return createGame({ ruleSet: CLASSIC_RULESET, world: CLASSIC_WORLD, home: CLASSIC_HOME, scenario: SCENARIO_STANDARD, controls, winningScore: 1000, seed: 7 });
}

describe("online rooms", () => {
  it("runs a lobby, seats players, relays intents and states, and survives the host leaving", async () => {
    const relay = new FakeRelay();
    const host = new OnlineRoom({ name: "Ada", hub: relay.connect("Ada") as unknown as Hub });
    const guest = new OnlineRoom({ name: "Bo", hub: relay.connect("Bo") as unknown as Hub });

    const order = CLASSIC_RULESET.playOrder.map(String);
    const hostPower = order[0]!;
    const guestPower = order[1]!;

    const code = await host.host(SETTINGS, hostPower);
    await guest.join(code);
    await until(() => guest.room !== null, "guest sees the lobby");
    expect(host.seat).toBe(hostPower);
    expect(guest.seat).toBeNull();

    // A seat that is taken cannot be claimed; a free one can.
    guest.claim(hostPower);
    guest.claim(guestPower);
    await until(() => guest.seat === guestPower, "guest seated");
    expect(Object.keys(host.room!.seats).sort()).toEqual([hostPower, guestPower].sort());

    // The host drives the game: a runner with a seat controller for the guest.
    const initial = newGameFor([hostPower, guestPower]);
    let runner: GameRunner | null = null;
    const me = new HumanController();
    const seat = new SeatController(() => host.seatOnline(guestPower), createAI(DEFAULT_AI_VERSION, CLASSIC_RULESET, CLASSIC_WORLD), () => runner!.state);
    const controllers = new Map<PowerId, PlayerController>();
    for (const p of CLASSIC_RULESET.playOrder) {
      const id = String(p);
      controllers.set(p, id === hostPower ? me : id === guestPower ? seat : createAI(DEFAULT_AI_VERSION, CLASSIC_RULESET, CLASSIC_WORLD));
    }
    const intents: { power: string; intent: Intent }[] = [];
    host.onIntent = (power, intent) => {
      intents.push({ power, intent });
      if (power !== String(runner!.state.activePower)) return;
      if (intent.k === "end") seat.finishTurn();
      else if (intent.k === "act") runner!.apply(intent.action);
    };
    runner = new GameRunner(CLASSIC_RULESET, CLASSIC_WORLD, initial, controllers, {
      onUpdate: (s, events) => host.publish(s, events, null),
    });
    host.start(initial);
    void runner.run();

    const seen: GameState[] = [];
    guest.onGame = (s) => seen.push(s);
    await until(() => guest.game !== null && guest.room?.phase === "playing", "guest gets the game");

    // Host ends its turn; the guest is next and its turn waits on its intents.
    expect(String(runner.state.activePower)).toBe(hostPower);
    me.finishTurn();
    await until(() => String(guest.game?.activePower) === guestPower, "guest's turn reaches the guest");
    expect(seat.isWaiting).toBe(true);

    guest.endTurn();
    await until(() => intents.length > 0, "host receives the intent");
    expect(intents[0]).toEqual({ power: guestPower, intent: { k: "end" } });
    await until(() => String(guest.game?.activePower) !== guestPower, "turn moves on");
    expect(seen.length).toBeGreaterThan(1);

    // The host leaves: the guest takes over and keeps the game.
    let tookOver = false;
    guest.onBecomeHost = () => {
      tookOver = true;
    };
    runner.stop();
    host.close();
    await until(() => tookOver, "guest becomes host");
    expect(guest.isHost).toBe(true);
    expect(guest.room?.seats[hostPower]?.pid).toBeNull();
    expect(guest.seatOnline(hostPower)).toBe(false);
    expect(guest.game).not.toBeNull();
    guest.close();
  });

  it("lets the computer stand in when a seated player leaves mid-turn", async () => {
    let online = true;
    const initial = newGameFor([]);
    const seat = new SeatController(() => online, createAI(DEFAULT_AI_VERSION, CLASSIC_RULESET, CLASSIC_WORLD), () => initial);
    const pending = seat.requestActions({ view: { power: initial.activePower!, state: initial, ruleSet: CLASSIC_RULESET, world: CLASSIC_WORLD } });
    expect(seat.isWaiting).toBe(true);
    online = false;
    await seat.takeOver();
    const actions = await pending;
    expect(Array.isArray(actions)).toBe(true);
    expect(seat.isWaiting).toBe(false);
  });
});
