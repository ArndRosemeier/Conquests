import { EngineError } from "../types.ts";
import type { GameState } from "./gameState.ts";

/**
 * Save/load support. GameState is deliberately plain, serializable data (no
 * class instances, no functions, RNG stored as a single number), so persistence
 * and future networking are a straight JSON round-trip.
 */
export const SAVE_VERSION = 7 as const;

/** Calendar start years of the scenarios that existed before saves stored one. */
const LEGACY_START_YEAR: Readonly<Record<string, number>> = { standard: 1880, "1880": 1880, "1914": 1914 };

interface SaveFile {
  readonly version: number;
  readonly state: GameState;
}

export function serializeGame(state: GameState): string {
  const file: SaveFile = { version: SAVE_VERSION, state };
  return JSON.stringify(file);
}

/** v5 and older had no diplomacy: no truces, reputation or peace offers. */
function withDiplomacyDefaults(old: GameState): GameState {
  const o = old as Partial<GameState> & GameState;
  return {
    ...o,
    truces: o.truces ?? {},
    warSince: o.warSince ?? {},
    warGains: o.warGains ?? {},
    reputation: o.reputation ?? {},
    peaceOffers: o.peaceOffers ?? [],
    treaties: o.treaties ?? [],
    proposals: o.proposals ?? [],
    callsToArms: o.callsToArms ?? [],
    goodwill: o.goodwill ?? {},
  };
}

/** Troop unit of the classic rules; saves from before it existed are snapped to it on load. */
const SAVE_TROOP_UNIT = 1_000;

function snapTroops(n: number, keepOne: boolean): number {
  const snapped = Math.round(n / SAVE_TROOP_UNIT) * SAVE_TROOP_UNIT;
  return keepOne && n > 0 ? Math.max(SAVE_TROOP_UNIT, snapped) : snapped;
}

/** Older saves could hold odd troop counts (e.g. 12,345); round them to whole thousands. */
function withWholeTroops(state: GameState): GameState {
  const areas: Record<string, GameState["areas"][string]> = {};
  for (const [id, a] of Object.entries(state.areas)) areas[id] = { ...a, troops: snapTroops(a.troops, true) };
  const intel: Record<string, Record<string, GameState["intel"][string][string]>> = {};
  for (const [p, reports] of Object.entries(state.intel ?? {})) {
    intel[p] = {};
    for (const [id, r] of Object.entries(reports)) intel[p][id] = { ...r, troops: snapTroops(r.troops, true) };
  }
  const pending = (state.pending ?? []).map((m) => ({ ...m, troops: snapTroops(m.troops, false) }));
  return { ...state, areas, intel, pending };
}

export function deserializeGame(json: string): GameState {
  return withWholeTroops(readSave(json));
}

function readSave(json: string): GameState {
  const parsed = JSON.parse(json) as Partial<SaveFile>;
  if (parsed.version === 4 && parsed.state !== undefined) {
    // v4 had no start year and stored "no score limit" as Infinity (JSON null).
    const old = parsed.state as GameState & { startYear?: number };
    return withDiplomacyDefaults({
      ...old,
      startYear: old.startYear ?? LEGACY_START_YEAR[old.scenarioId] ?? 1880,
      winningScore: typeof old.winningScore === "number" ? old.winningScore : 0,
    });
  }
  if ((parsed.version === 5 || parsed.version === 6) && parsed.state !== undefined) return withDiplomacyDefaults(parsed.state);
  if (parsed.version !== SAVE_VERSION) {
    throw new EngineError(
      `Unsupported save version ${String(parsed.version)} (expected ${SAVE_VERSION})`,
    );
  }
  if (parsed.state === undefined) {
    throw new EngineError("Save file is missing game state");
  }
  return parsed.state;
}
