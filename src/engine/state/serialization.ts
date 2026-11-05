import { EngineError } from "../types.ts";
import type { GameState } from "./gameState.ts";

/**
 * Save/load support. GameState is deliberately plain, serializable data (no
 * class instances, no functions, RNG stored as a single number), so persistence
 * and future networking are a straight JSON round-trip.
 */
export const SAVE_VERSION = 5 as const;

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

export function deserializeGame(json: string): GameState {
  const parsed = JSON.parse(json) as Partial<SaveFile>;
  if (parsed.version === 4 && parsed.state !== undefined) {
    // v4 had no start year and stored "no score limit" as Infinity (JSON null).
    const old = parsed.state as GameState & { startYear?: number };
    return {
      ...old,
      startYear: old.startYear ?? LEGACY_START_YEAR[old.scenarioId] ?? 1880,
      winningScore: typeof old.winningScore === "number" ? old.winningScore : 0,
    };
  }
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
