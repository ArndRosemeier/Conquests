import type { PersonaKnobs } from "../../engine/state/gameState.ts";

export type { PersonaKnobs };

/**
 * A named persona: an identity wrapped around a {@link PersonaKnobs} weight
 * vector. Built-in personas ship with the game; players may author custom ones
 * (persisted locally) that also flow through this same shape.
 */
export interface Persona {
  readonly id: string;
  readonly name: string;
  /** Short flavor line shown in the setup UI. */
  readonly blurb: string;
  readonly knobs: PersonaKnobs;
  readonly builtIn: boolean;
}

/** The neutral baseline value for every knob. */
export const NEUTRAL_KNOB = 50;

/** The ordered list of knob keys, for building slider UIs generically. */
export const KNOB_KEYS = [
  "expansion",
  "aggression",
  "fortification",
  "intelligence",
  "corrupt",
  "risk",
  "reserves",
  "naval",
  "honor",
  "opportunism",
] as const satisfies readonly (keyof PersonaKnobs)[];

/** Human-readable labels for each knob. */
export const KNOB_LABELS: Readonly<Record<keyof PersonaKnobs, string>> = {
  expansion: "Expansion",
  aggression: "Aggression",
  fortification: "Fortification",
  intelligence: "Intelligence",
  corrupt: "Corruption",
  risk: "Risk-taking",
  reserves: "Reserves",
  naval: "Naval reach",
  honor: "Honor",
  opportunism: "Opportunism",
};

const BASELINE: PersonaKnobs = {
  expansion: NEUTRAL_KNOB,
  aggression: NEUTRAL_KNOB,
  fortification: NEUTRAL_KNOB,
  intelligence: NEUTRAL_KNOB,
  corrupt: NEUTRAL_KNOB,
  risk: NEUTRAL_KNOB,
  reserves: NEUTRAL_KNOB,
  naval: NEUTRAL_KNOB,
  honor: NEUTRAL_KNOB,
  opportunism: NEUTRAL_KNOB,
};

/** Clamp a knob to a valid integer in [0, 100]. */
export function clampKnob(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Build a full knob vector from a partial override of the neutral baseline. */
export function knobs(partial: Partial<PersonaKnobs>): PersonaKnobs {
  return { ...BASELINE, ...partial };
}

/**
 * Built-in personas. Spreads are deliberately moderate (roughly 25-80): every
 * persona still does everything, only the emphasis differs, so none is a pure
 * one-trick strategy. A hoarder-style persona is naturally the "easy" opponent.
 */
export const BUILTIN_PERSONAS: readonly Persona[] = [
  {
    id: "statesman",
    name: "Statesman",
    blurb: "Balanced on every front.",
    builtIn: true,
    knobs: knobs({ honor: 65, opportunism: 45 }),
  },
  {
    id: "conqueror",
    name: "Conqueror",
    blurb: "Wars on rivals, commits reserves boldly.",
    builtIn: true,
    knobs: knobs({
      expansion: 58,
      aggression: 80,
      fortification: 35,
      corrupt: 35,
      risk: 70,
      reserves: 28,
      honor: 35,
      opportunism: 60,
    }),
  },
  {
    id: "colonialist",
    name: "Colonialist",
    blurb: "Grabs neutrals far and wide, by sea.",
    builtIn: true,
    knobs: knobs({
      expansion: 80,
      aggression: 38,
      intelligence: 62,
      naval: 78,
      reserves: 45,
      honor: 55,
      opportunism: 40,
    }),
  },
  {
    id: "industrialist",
    name: "Industrialist",
    blurb: "Buys influence; bribes rather than fights.",
    builtIn: true,
    knobs: knobs({
      expansion: 52,
      aggression: 33,
      corrupt: 78,
      intelligence: 60,
      risk: 38,
      reserves: 60,
      honor: 60,
      opportunism: 45,
    }),
  },
  {
    id: "fortress",
    name: "Fortress",
    blurb: "Digs in, defends, keeps its word.",
    builtIn: true,
    knobs: knobs({
      expansion: 40,
      aggression: 30,
      fortification: 80,
      risk: 26,
      reserves: 78,
      naval: 38,
      honor: 75,
      opportunism: 25,
    }),
  },
  {
    id: "jackal",
    name: "Jackal",
    blurb: "Watches closely, strikes the weakened. Not to be trusted.",
    builtIn: true,
    knobs: knobs({
      aggression: 66,
      intelligence: 76,
      corrupt: 55,
      risk: 64,
      reserves: 35,
      honor: 20,
      opportunism: 85,
    }),
  },
];

export function getBuiltinPersona(id: string): Persona | undefined {
  return BUILTIN_PERSONAS.find((p) => p.id === id);
}

// --- Knob -> parameter mappings ---------------------------------------------
//
// These translate the abstract 0-100 knobs into the concrete multipliers and
// thresholds the utility AI reasons with. Keeping them here (not scattered in
// the controller) makes a persona's "meaning" a single, tunable place.

function unit(v: number): number {
  return Math.max(0, Math.min(1, v / 100));
}

/**
 * Appetite multiplier for a value class: 0.5x at knob 0, 1.0x at 50, 1.5x at
 * 100. Applied to the raw worth of the corresponding kind of play.
 */
export function appetite(v: number): number {
  return 0.5 + unit(v);
}

/**
 * Minimum win probability the AI insists on before pressing an attack. Cautious
 * personas (low risk) need ~0.75; daring ones (high risk) accept ~0.40.
 */
export function riskThreshold(v: number): number {
  return 0.75 - unit(v) * 0.35;
}

/**
 * Safety factor applied to a border's expected threat when deciding how many
 * troops to hold back on defense: ~1.2x for offense-minded personas, ~2.5x for
 * hunker-down ones. Only troops are reserved; cash is always spent.
 */
export function defenseSafety(v: number): number {
  return 1.2 + unit(v) * 1.3;
}

/**
 * Weight applied to overseas (sea-borne) conquests. Continental personas (low
 * naval) barely value them (~0.4x) and so build almost no fleets; maritime ones
 * (~1.5x) willingly ship troops abroad and buy just enough transport.
 */
export function navalWeight(v: number): number {
  return 0.4 + unit(v) * 1.1;
}

/**
 * Caution multiplier on the "whole army lost" downside of a cross-region
 * amphibious assault (the engine gives no survivors when such a landing fails).
 * Driven by `risk`: a cautious persona (~1.5x) inflates the downside and so only
 * lands when near-certain - it prefers bridgeheads and overland expansion - while
 * a bold one (~0.3x) discounts it and will gamble armies on invasions. This is
 * what makes a high-naval + high-risk persona play as an "invader" without a
 * dedicated knob.
 */
export function invasionCaution(v: number): number {
  return 1.5 - unit(v) * 1.2;
}
