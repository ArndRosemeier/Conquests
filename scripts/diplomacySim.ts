/**
 * War-and-peace statistics from headless all-AI games, for tuning the
 * diplomatic AI (src/controllers/ai/diplomat.ts).
 *
 *   npx vite-node scripts/diplomacySim.ts -- --games 10 --seed 1
 */
import { createAI } from "../src/controllers/ai/factory.ts";
import { BUILTIN_PERSONAS } from "../src/controllers/ai/persona.ts";
import { CLASSIC_RULESET as R } from "../src/engine/ruleset/classic.ts";
import type { GameEvent } from "../src/engine/state/events.ts";
import { reduce } from "../src/engine/state/reducer.ts";
import { createGame } from "../src/engine/state/setup.ts";
import type { PowerControlConfig } from "../src/engine/state/setup.ts";
import { advanceAfterCombat } from "../src/engine/state/turn.ts";
import type { PowerId } from "../src/engine/types.ts";
import { CLASSIC_WORLD as W } from "../src/engine/world/classic.ts";
import { CLASSIC_HOME, SCENARIO_STANDARD } from "../src/engine/world/scenarios.ts";
import { seededShuffle } from "../src/game/simulation.ts";

const argv = process.argv.slice(2);
const get = (f: string, d: number): number => {
  const i = argv.indexOf(f);
  return i >= 0 ? Number(argv[i + 1]) : d;
};
const games = get("--games", 10);
const seed0 = get("--seed", 1);
const maxYears = get("--years", 60);

const ai = createAI("v2", R, W);
const buckets = [2, 5, 10, 20, 999];
const decl = new Array(buckets.length).fill(0);
const totals = { decl: 0, peace: 0, offers: 0, declined: 0, calledOff: 0, years: 0, won: 0 };
const firstWar: number[] = [];
const byPersona = new Map<string, number>();

for (let g = 0; g < games; g += 1) {
  const seed = seed0 + g;
  const personas = seededShuffle(BUILTIN_PERSONAS, seed);
  const controls = new Map<PowerId, PowerControlConfig>();
  const personaOf = new Map<string, string>();
  R.playOrder.forEach((p, i) => {
    controls.set(p, { control: "ai", persona: personas[i]!.knobs });
    personaOf.set(String(p), personas[i]!.id);
  });
  let s = createGame({ ruleSet: R, world: W, home: CLASSIC_HOME, scenario: SCENARIO_STANDARD, controls, winningScore: 1000, seed });
  let first: number | null = null;
  const seen = (events: readonly GameEvent[], year: number): void => {
    for (const e of events) {
      if (e.type === "WAR_DECLARED") {
        totals.decl += 1;
        decl[buckets.findIndex((b) => year <= b)] += 1;
        first ??= year;
        byPersona.set(personaOf.get(String(e.by))!, (byPersona.get(personaOf.get(String(e.by))!) ?? 0) + 1);
      } else if (e.type === "WAR_ENDED") totals.peace += 1;
      else if (e.type === "PEACE_OFFERED") totals.offers += 1;
      else if (e.type === "PEACE_DECLINED") totals.declined += 1;
      else if (e.type === "ATTACK_CALLED_OFF") totals.calledOff += 1;
    }
  };
  while (s.winner === null && s.year <= maxYears) {
    if (s.stage === "COMBAT") {
      const r = advanceAfterCombat(s, R, W);
      seen(r.events, s.year);
      s = r.state;
      continue;
    }
    const power = s.activePower!;
    const actions = await ai.requestActions({ view: { power, state: s, ruleSet: R, world: W } });
    for (const a of actions) {
      const r = reduce(s, a, R, W);
      seen(r.events, s.year);
      s = r.state;
    }
    s = reduce(s, { type: "END_TURN" }, R, W).state;
  }
  const wars = Object.values(s.war).reduce((n, l) => n + l.length, 0) / 2;
  console.log(`game ${seed}: ended year ${s.year}, winner ${s.winner ?? "none"}, first war year ${first ?? "-"}, wars open at end ${wars}`);
  if (first !== null) firstWar.push(first);
  totals.years += s.year;
  if (s.winner !== null) totals.won += 1;
}
console.log("\nDeclarations by year:", buckets.map((b, i) => `<=${b}: ${decl[i]}`).join("  "));
console.log("Totals:", totals);
console.log("Declarations per game-year:", (totals.decl / totals.years).toFixed(2));
console.log("First war year (median):", firstWar.sort((a, b) => a - b)[Math.floor(firstWar.length / 2)]);
console.log("Declarations by persona:", Object.fromEntries(byPersona));
