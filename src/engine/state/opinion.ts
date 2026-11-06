import type { RuleSet } from "../ruleset/types.ts";
import type { PowerId } from "../types.ts";
import { neighborsOf } from "../world/classic.ts";
import type { WorldDefinition } from "../world/types.ts";
import { enemiesOf, isAtWar } from "./helpers.ts";
import { goodwillOf, reputationOf, treatyBetween, truceUntil } from "./diplomacy.ts";
import type { GameState } from "./gameState.ts";

/**
 * What one power thinks of another, from -100 to 100, with the reasons. It is
 * computed from the board (borders, wars, treaties, reputation, goodwill), so
 * the player sees exactly what the computer powers weigh.
 */
export const OPINION = {
  perBorder: -3,
  borderCap: -24,
  atWar: -50,
  recentWar: -20,
  leader: -15,
  /** Opinion per reputation point above or below the start value. */
  perReputation: 0.5,
  sharedEnemy: 25,
  pact: 15,
  alliance: 35,
  perGoodwill: 1,
} as const;

export interface OpinionReason {
  readonly label: string;
  readonly value: number;
}

export interface Opinion {
  readonly value: number;
  readonly reasons: readonly OpinionReason[];
}

/** Land borders between the two powers' territories. */
export function sharedBorders(state: GameState, world: WorldDefinition, a: PowerId, b: PowerId): number {
  let n = 0;
  for (const area of Object.values(state.areas)) {
    if (area.owner !== a) continue;
    for (const nb of neighborsOf(world, area.id)) if (state.areas[String(nb)]?.owner === b) n += 1;
  }
  return n;
}

export function opinionOf(
  state: GameState,
  ruleSet: RuleSet,
  world: WorldDefinition,
  observer: PowerId,
  subject: PowerId,
): Opinion {
  const o = OPINION;
  const reasons: OpinionReason[] = [];
  const add = (label: string, value: number): void => {
    const v = Math.round(value);
    if (v !== 0) reasons.push({ label, value: v });
  };

  const borders = sharedBorders(state, world, observer, subject);
  if (borders > 0) add(`Shared borders (${borders})`, Math.max(o.borderCap, borders * o.perBorder));
  if (isAtWar(state, observer, subject)) add("At war", o.atWar);
  else if (truceUntil(state, observer, subject) !== null) add("Fought a recent war", o.recentWar);

  const treaty = treatyBetween(state, observer, subject);
  if (treaty?.kind === "alliance") add("Allies", o.alliance);
  else if (treaty?.kind === "pact") add("Non-aggression pact", o.pact);

  const mine = enemiesOf(state, observer);
  const common = enemiesOf(state, subject).filter((e) => mine.includes(e) && e !== observer && e !== subject);
  if (common.length > 0) add("Common enemy", o.sharedEnemy);

  const live = Object.values(state.powers).filter((p) => !p.eliminated && p.control !== "neutral");
  const sorted = [...live].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  if (top !== undefined && top.id === subject && top.score > 50 && top.score >= 1.25 * (sorted[1]?.score ?? 0)) {
    add("Leads the race", o.leader);
  }

  const rep = reputationOf(state, ruleSet, subject) - ruleSet.diplomacy.reputationStart;
  add(rep >= 0 ? "Good reputation" : "Bad reputation", rep * o.perReputation);
  add("Gifts and favours", goodwillOf(state, subject, observer) * o.perGoodwill);

  const value = Math.max(-100, Math.min(100, reasons.reduce((s, r) => s + r.value, 0)));
  return { value, reasons };
}
