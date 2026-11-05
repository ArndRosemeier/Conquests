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

/**
 * A persona: the AI's priorities as a vector of weights. Each knob is an integer
 * 0-100 with 50 as the neutral baseline. Two axes exist:
 * - Appetite knobs bias how much a class of play is *worth* (expansion,
 *   aggression, fortification, intelligence, corrupt, naval).
 * - Behavior knobs shift *thresholds* rather than appetite (risk, reserves).
 *
 * Personas fully replace the old numeric difficulty level: a passive weighting
 * simply produces a weaker opponent, so challenge emerges from opponent style.
 */
export interface PersonaKnobs {
  /** Value of seizing neutral minors (VP + income). */
  readonly expansion: number;
  /** Value of attacking rival great powers (VP + income + denying the leader). */
  readonly aggression: number;
  /** Value of fortifying and garrisoning threatened borders. */
  readonly fortification: number;
  /** Propensity to spend on espionage for fresh intel. */
  readonly intelligence: number;
  /** Value of subversion / bribery (income only, grants no VP). */
  readonly corrupt: number;
  /** Attack win-probability bar: low = cautious (~75%), high = daring (~40%). */
  readonly risk: number;
  /** Troops held back for defense vs. committed to offense (cash is always spent). */
  readonly reserves: number;
  /** Bias toward overseas projection: low = continental, high = ships troops abroad. */
  readonly naval: number;
  /** Cares about reputation: high = rarely starts wars, keeps its word. */
  readonly honor: number;
  /** Pounces on weak or distracted neighbours. */
  readonly opportunism: number;
}

/** Dynamic state of a single major power. */
export interface PowerState {
  readonly id: PowerId;
  readonly control: ControlKind;
  /**
   * The AI persona driving this power (null for human- or neutral-controlled
   * powers). Embedded in state so a saved game restores its opponents' styles.
   */
  readonly persona: PersonaKnobs | null;
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
 * An offer to end a war, waiting for the other side's answer. `payment` is what
 * the offerer pays on acceptance; a negative payment is a demand for tribute.
 * It lapses when the offerer's next turn begins.
 */
export interface PeaceOffer {
  readonly from: PowerId;
  readonly to: PowerId;
  readonly payment: number;
}

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
  /** Turn year counted from 1; see `calendarYear` for the date shown to players. */
  readonly year: number;
  /** Calendar year of year 1 (from the scenario). */
  readonly startYear: number;
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
  /** Truces after peace treaties, keyed by pairKey: the first absolute season war is allowed again. */
  readonly truces: Readonly<Record<string, number>>;
  /** Absolute season each current war started, keyed by pairKey. */
  readonly warSince: Readonly<Record<string, number>>;
  /** War balance: points `a` has won against `b` in their current war, keyed "a>b". */
  readonly warGains: Readonly<Record<string, number>>;
  /** Each power's standing in the eyes of the world (see DiplomacyRules). */
  readonly reputation: Readonly<Record<string, number>>;
  readonly peaceOffers: readonly PeaceOffer[];
  /** What each power has learned about foreign garrisons through spying. */
  readonly intel: IntelTable;
  readonly rngState: number;
  readonly winningScore: number;
  readonly winner: PowerId | null;
  /** Monotonic counter, useful for UI keys and replay ordering. */
  readonly tick: number;
}

/** The calendar year players see (e.g. 1880), from the engine's 1-based year. */
export function calendarYear(state: Pick<GameState, "year" | "startYear">): number {
  return state.startYear + state.year - 1;
}
