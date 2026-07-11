import type { RuleSet } from "../engine/ruleset/types.ts";

/** Human-readable names for the terrain factor (0..4). Index = terrain value. */
export const TERRAIN_NAMES: readonly string[] = [
  "Open",
  "Light",
  "Rough",
  "Hard",
  "Extreme",
];

/** The terrain's name, e.g. "Rough" for factor 2. */
export function terrainName(terrain: number): string {
  return TERRAIN_NAMES[terrain] ?? `T${terrain}`;
}

/**
 * A descriptive terrain label including its defensive bonus, e.g.
 * "Rough (+50% defense)". Open ground (0) has no bonus.
 */
export function terrainLabel(ruleSet: RuleSet, terrain: number): string {
  const name = terrainName(terrain);
  if (terrain <= 0) return name;
  const pct = Math.round(terrain * ruleSet.combat.terrainDefensePerPoint * 100);
  return `${name} (+${pct}% defense)`;
}

/** How old an espionage snapshot is, in human terms (0 seasons = "just now"). */
export function intelAgeLabel(ageSeasons: number): string {
  if (ageSeasons <= 0) return "just now";
  if (ageSeasons === 1) return "1 season ago";
  if (ageSeasons < 4) return `${ageSeasons} seasons ago`;
  const years = Math.floor(ageSeasons / 4);
  const rem = ageSeasons % 4;
  const y = years === 1 ? "1 year" : `${years} years`;
  if (rem === 0) return `${y} ago`;
  const s = rem === 1 ? "1 season" : `${rem} seasons`;
  return `${y}, ${s} ago`;
}
