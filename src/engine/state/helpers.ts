import { NotFoundError, powerId } from "../types.ts";
import type { AreaId, PowerId } from "../types.ts";
import type { AreaState, GameState, PowerState } from "./gameState.ts";

export function getAreaState(state: GameState, id: AreaId): AreaState {
  const area = state.areas[String(id)];
  if (area === undefined) {
    throw new NotFoundError(`Area state ${id} not found`);
  }
  return area;
}

export function getPowerState(state: GameState, id: PowerId): PowerState {
  const power = state.powers[String(id)];
  if (power === undefined) {
    throw new NotFoundError(`Power state '${id}' not found`);
  }
  return power;
}

export function allAreas(state: GameState): readonly AreaState[] {
  return Object.values(state.areas);
}

export function allPowers(state: GameState): readonly PowerState[] {
  return Object.values(state.powers);
}

/** Immutably replace one area's state. */
export function withArea(state: GameState, area: AreaState): GameState {
  return {
    ...state,
    areas: { ...state.areas, [String(area.id)]: area },
    tick: state.tick + 1,
  };
}

/** Immutably replace several areas' state at once. */
export function withAreas(state: GameState, updates: readonly AreaState[]): GameState {
  const areas = { ...state.areas };
  for (const a of updates) {
    areas[String(a.id)] = a;
  }
  return { ...state, areas, tick: state.tick + 1 };
}

/** Immutably replace one power's state. */
export function withPower(state: GameState, power: PowerState): GameState {
  return {
    ...state,
    powers: { ...state.powers, [String(power.id)]: power },
    tick: state.tick + 1,
  };
}

export function isAtWar(state: GameState, a: PowerId, b: PowerId): boolean {
  const list = state.war[String(a)];
  return list !== undefined && list.includes(b);
}

/** Returns a new WarTable with a<->b at war (symmetric). */
export function declareWar(
  war: GameState["war"],
  a: PowerId,
  b: PowerId,
): GameState["war"] {
  const next: Record<string, readonly PowerId[]> = { ...war };
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    const cur = next[String(x)] ?? [];
    if (!cur.includes(y)) {
      next[String(x)] = [...cur, y];
    }
  }
  return next;
}

/** Returns a new WarTable with a<->b no longer at war (symmetric). */
export function endWar(
  war: GameState["war"],
  a: PowerId,
  b: PowerId,
): GameState["war"] {
  const next: Record<string, readonly PowerId[]> = { ...war };
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    const cur = next[String(x)];
    if (cur !== undefined) {
      next[String(x)] = cur.filter((p) => p !== y);
    }
  }
  return next;
}

/** Powers that `power` is currently at war with. */
export function enemiesOf(state: GameState, power: PowerId): readonly PowerId[] {
  return state.war[String(power)] ?? [];
}

export const asPowerId = powerId;
