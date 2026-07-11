import type { AreaId, ControlKind, PowerId, Season, TurnStage } from "../types.ts";

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
 * A single espionage snapshot: what a power learned about an area at the moment
 * it spied. This is deliberately a frozen point-in-time observation, never a live
 * mirror of the area - it goes stale as the game advances, and actions like
 * bribing do NOT refresh it. Consumers must display/reason about its age.
 */
export interface IntelReport {
  readonly troops: number;
  readonly fleets: number;
  readonly owner: PowerId | null;
  readonly fortified: boolean;
  /** Game time when the snapshot was taken, for staleness. */
  readonly observedYear: number;
  readonly observedSeason: Season;
}

/**
 * Per-power intelligence: the latest espionage snapshot each power holds for the
 * areas it has scouted. Keyed [powerId][areaId]. A power always knows its own
 * areas exactly (live), so those never appear here.
 */
export type IntelTable = Readonly<Record<string, Readonly<Record<string, IntelReport>>>>;

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
  /** Whether a power is acting freely (PLAYER) or combat is resolving (COMBAT). */
  readonly stage: TurnStage;
  /** Which power is currently acting (null during COMBAT). */
  readonly activePower: PowerId | null;
  /** Moves the acting power has left this turn (reset at the start of its turn). */
  readonly armyMovesRemaining: number;
  readonly fleetMovesRemaining: number;
  readonly powers: Readonly<Record<string, PowerState>>;
  readonly areas: Readonly<Record<string, AreaState>>;
  readonly pending: readonly PendingMove[];
  readonly war: WarTable;
  /** What each power has learned about foreign garrisons through spying. */
  readonly intel: IntelTable;
  readonly rngState: number;
  readonly winningScore: number;
  readonly winner: PowerId | null;
  /** Monotonic counter, useful for UI keys and replay ordering. */
  readonly tick: number;
}
