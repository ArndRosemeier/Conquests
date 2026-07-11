import { EngineError } from "../types.ts";
import type { GameState } from "./gameState.ts";

/**
 * Save/load support. GameState is deliberately plain, serializable data (no
 * class instances, no functions, RNG stored as a single number), so persistence
 * and future networking are a straight JSON round-trip.
 */
export const SAVE_VERSION = 1 as const;

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
