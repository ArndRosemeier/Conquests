import type { PowerDef } from "../../engine/ruleset/types.ts";

/** Presentation data for each great power: crest, difficulty and how to read it. */
export interface PowerLook {
  readonly crest: string;
  readonly emblem: string;
  readonly difficulty: "Easy" | "Medium" | "Hard";
  readonly blurb: string;
  readonly strengths: readonly string[];
}

const BASE = import.meta.env.BASE_URL;

export const POWER_LOOK: Readonly<Record<string, PowerLook>> = {
  england: {
    crest: `${BASE}art/crest-england.webp`,
    emblem: "Lion",
    difficulty: "Hard",
    blurb: "The finest troops and ships man for man, but few of them, and an island with no room to grow. Every conquest starts with a fleet.",
    strengths: ["Best army and navy quality", "Largest starting fleet", "Expensive troops"],
  },
  germany: {
    crest: `${BASE}art/crest-germany.webp`,
    emblem: "Eagle",
    difficulty: "Hard",
    blurb: "A well-drilled army in the middle of Europe, squeezed between France and Russia. Win the first war quickly or fight on two fronts.",
    strengths: ["Strong defence", "Central position", "Hemmed in by rivals"],
  },
  france: {
    crest: `${BASE}art/crest-france.webp`,
    emblem: "Rooster",
    difficulty: "Medium",
    blurb: "A large, affordable army with Africa just across the sea. Guard the Rhine and the Mediterranean is yours.",
    strengths: ["Cheap, large army", "Short hop to Africa", "Weak fleet defence"],
  },
  usa: {
    crest: `${BASE}art/crest-usa.webp`,
    emblem: "Eagle",
    difficulty: "Easy",
    blurb: "Rich, safe and an ocean away from Europe's quarrels, with a whole hemisphere next door. Its neighbours do fight back.",
    strengths: ["Highest income", "No rival next door", "Small standing army"],
  },
  japan: {
    crest: `${BASE}art/crest-japan.webp`,
    emblem: "Crane",
    difficulty: "Medium",
    blurb: "An island nation on the edge of a vast continent. A capable navy makes all of Asia reachable.",
    strengths: ["Good navy", "Asia within reach", "Weak army quality"],
  },
  russia: {
    crest: `${BASE}art/crest-russia.webp`,
    emblem: "Bear",
    difficulty: "Medium",
    blurb: "Endless land and the cheapest army in the world, led by generals who learn slowly. Its navy is barely afloat.",
    strengths: ["Cheapest troops", "Huge army", "Weakest navy"],
  },
};

export function lookOf(id: string): PowerLook {
  return POWER_LOOK[id] ?? POWER_LOOK.england!;
}

/** 0..1 quality from a factor where 1 is best and 5 is worst. */
export function quality(factor: number): number {
  return Math.max(0, Math.min(1, (5 - factor) / 4));
}

export function powerName(powers: readonly PowerDef[], id: string | null): string {
  if (id === null) return "Neutral";
  return powers.find((p) => p.id === id)?.name ?? id;
}

export function powerColor(powers: readonly PowerDef[], id: string | null): string {
  if (id === null) return "#cbb68a";
  return powers.find((p) => p.id === id)?.color ?? "#888";
}

/** Short money label: $850k, $3.2M. */
export function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  if (v < 1_000_000) return `${sign}$${Math.round(v / 1000)}k`;
  return `${sign}$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
}

/** Short troop label: 950, 12k, 1.2M. */
export function troops(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}k`;
}
