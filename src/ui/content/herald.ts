import type { GameEvent } from "../../engine/state/events.ts";
import type { RuleSet } from "../../engine/ruleset/types.ts";
import type { WorldDefinition } from "../../engine/world/types.ts";
import { getArea } from "../../engine/world/classic.ts";
import copy from "./herald.json";
import { powerName } from "./powers.ts";

/**
 * The World Herald: newspaper copy for game events. The headline bank was
 * written once with an LLM through OpenRouter (see docs/ASSETS.md) and ships
 * as data, so the game needs no network or API key at run time.
 */
export type HeadlineKind = keyof typeof copy;

export const TICKER: readonly string[] = copy.ticker;
export const TIPS: readonly string[] = copy.tips;

export const BASE = import.meta.env.BASE_URL;

/** Paintings that illustrate each kind of story. */
export const ART = {
  naval: `${BASE}art/ev-naval.webp`,
  land: `${BASE}art/ev-land.webp`,
  capture: `${BASE}art/ev-capture.webp`,
  coup: `${BASE}art/ev-coup.webp`,
  spy: `${BASE}art/ev-spy.webp`,
  peace: `${BASE}art/ev-peace.webp`,
  war: `${BASE}art/ev-war.webp`,
  victory: `${BASE}art/ev-victory.webp`,
  defeat: `${BASE}art/ev-defeat.webp`,
  newyear: `${BASE}art/ev-newyear.webp`,
} as const;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A headline of the given kind, chosen stably from `seed` so re-renders keep it. */
export function headline(kind: HeadlineKind, fields: Readonly<Record<string, string>>, seed: string): string {
  const list = copy[kind];
  const raw = list[hash(seed + kind) % list.length]!;
  return raw.replace(/\{(\w+)\}/g, (_, k: string) => fields[k] ?? k);
}

export interface Story {
  readonly headline: string;
  readonly art: string;
  /** Higher = more newsworthy; the top story leads the paper. */
  readonly weight: number;
  readonly kind: HeadlineKind;
}

/** Turn one engine event into a newspaper story, or null if it is not news. */
export function storyFor(
  e: GameEvent,
  ruleSet: RuleSet,
  world: WorldDefinition,
  seed: string,
  involves: string | null,
): Story | null {
  const pn = (id: string | null): string => powerName(ruleSet.powers, id);
  const mine = (...ids: (string | null)[]): number => (involves !== null && ids.includes(involves) ? 30 : 0);
  switch (e.type) {
    case "BATTLE": {
      const area = getArea(world, e.area).name;
      const f = { attacker: pn(e.attacker), defender: e.defender === null ? "the local garrison" : pn(e.defender), area };
      if (!e.attackerWon) {
        return { kind: "repelled", headline: headline("repelled", f, seed), art: ART.land, weight: 20 + mine(e.attacker, e.defender) };
      }
      if (!e.captured) {
        // A won sea battle that took no land (a ships-only sortie): only news if ships sank.
        if (e.defenderLosses === 0 || e.defender === null) return null;
        return { kind: "naval", headline: headline("naval", f, seed), art: ART.naval, weight: 45 + mine(e.attacker, e.defender) };
      }
      if (e.defender !== null) {
        return { kind: "capture_power", headline: headline("capture_power", f, seed), art: ART.capture, weight: 50 + mine(e.attacker, e.defender) };
      }
      return { kind: "capture_minor", headline: headline("capture_minor", f, seed), art: e.bySea ? ART.naval : ART.land, weight: 25 + mine(e.attacker) };
    }
    case "WAR_DECLARED":
      return { kind: "war", headline: headline("war", { attacker: pn(e.by), defender: pn(e.against) }, seed), art: ART.war, weight: 60 + mine(e.by, e.against) };
    case "WAR_ENDED":
      return { kind: "peace", headline: headline("peace", { attacker: pn(e.by), defender: pn(e.against) }, seed), art: ART.peace, weight: 55 + mine(e.by, e.against) };
    case "PEACE_LOAN_FAILED":
      return { kind: "peace_failed", headline: headline("peace_failed", { attacker: pn(e.by), defender: pn(e.target) }, seed), art: ART.war, weight: 30 + mine(e.by, e.target) };
    case "SUBVERSION":
      if (!e.coup) return null;
      return { kind: "coup", headline: headline("coup", { attacker: pn(e.by), area: getArea(world, e.area).name }, seed), art: ART.coup, weight: 35 + mine(e.by) };
    case "POWER_ELIMINATED":
      return { kind: "eliminated", headline: headline("eliminated", { defender: pn(e.power) }, seed), art: ART.defeat, weight: 90 + mine(e.power) };
    default:
      return null;
  }
}
