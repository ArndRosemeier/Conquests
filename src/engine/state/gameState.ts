import type { AreaId, ControlKind, PhaseId, PowerId, Season } from "../types.ts";

/** Dynamic state of a single map area. */
export interface AreaState {
  readonly id: AreaId;
  /** Controlling power, or null for a neutral/uncontrolled minor. */
  readonly owner: PowerId | null;
  /** Number of troops garrisoned (men). */
  readonly troops: number;
  /** Number of fleets stationed. */
  readonly fleets: number;
  readonly fortified: boolean;
  /** The power for whom this area is a home area (static), else null. */
  readonly homeOf: PowerId | null;
  /** The power for whom this area is a home supply center (static), else null. */
  readonly supplyCenterOf: PowerId | null;
  /** Annual income this area contributes to its owner (dollars). */
  readonly income: number;
  /**
   * Defense factor for a neutral minor's garrison (lower is better), mirroring
   * the manual's per-country defensive rating. Ignored when owner is a power.
   */
  readonly minorDefense: number;
  /** Victory points awarded for controlling this area. */
  readonly victoryValue: number;
}

/** Dynamic state of a single major power. */
export interface PowerState {
  readonly id: PowerId;
  readonly control: ControlKind;
  /** AI difficulty 0-9 (only meaningful when control === "ai"). */
  readonly aiLevel: number;
  readonly treasury: number;
  readonly score: number;
  /** Areas this power controlled at game start (losing them deducts points). */
  readonly startingAreas: readonly AreaId[];
  /** Whether this power has been eliminated / is out. */
  readonly eliminated: boolean;
}

/**
 * A force placed in "limbo" after a movement order, resolved during combat.
 * Mirrors the manual: moved units leave their origin immediately and only
 * arrive (or fight) in the Combat Phase.
 */
export interface PendingMove {
  readonly power: PowerId;
  readonly from: AreaId;
  readonly to: AreaId;
  readonly troops: number;
  readonly fleets: number;
  /** True for a naval movement (fleets carrying troops or sortie). */
  readonly bySea: boolean;
}

/** War relationships: warTable[a] contains every power a considers itself at war with. */
export type WarTable = Readonly<Record<string, readonly PowerId[]>>;

/**
 * The complete, serializable game state. Pure data - no functions, no class
 * instances - so it can be saved, replayed, diffed, or sent over a network.
 */
export interface GameState {
  readonly rulesetId: string;
  readonly worldId: string;
  readonly scenarioId: string;
  readonly year: number;
  readonly season: Season;
  /** Index into the current turn's phase list. */
  readonly phaseIndex: number;
  readonly phase: PhaseId;
  /** Which power is currently acting (undefined during COMBAT). */
  readonly activePower: PowerId | null;
  /** Remaining moves in the active movement phase. */
  readonly movesRemaining: number;
  readonly powers: Readonly<Record<string, PowerState>>;
  readonly areas: Readonly<Record<string, AreaState>>;
  readonly pending: readonly PendingMove[];
  readonly war: WarTable;
  readonly rngState: number;
  readonly winningScore: number;
  readonly winner: PowerId | null;
  /** Monotonic counter, useful for UI keys and replay ordering. */
  readonly tick: number;
}
