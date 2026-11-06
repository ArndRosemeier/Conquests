/**
 * Where does the AI's money go? Headless all-AI games that log every purchase,
 * for checking that computer rivals size their navies to what they actually use.
 *
 *   npx vite-node scripts/navySim.ts -- --games 20 --seed 1 --years 40
 *
 * Fleet purchases are split into "lift" (bought in a turn that also sails a
 * fleet out of that port: an invasion) and "idle" (bought with nothing to carry).
 */
import { createAI } from "../src/controllers/ai/factory.ts";
import { BUILTIN_PERSONAS } from "../src/controllers/ai/persona.ts";
import { CLASSIC_RULESET as R } from "../src/engine/ruleset/classic.ts";
import type { Action } from "../src/engine/state/actions.ts";
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
const games = get("--games", 20);
const seed0 = get("--seed", 1);
const maxYears = get("--years", 40);

const ai = createAI("v2", R, W);
const spend = { army: 0, fleetLift: 0, fleetIdle: 0, fortify: 0, subvert: 0, other: 0 };
let fleetsBuilt = 0;
let fleetsSailed = 0;
let seaInvasions = 0;
let landAttacks = 0;
let fleetsAtEnd = 0;
let troopsAtEnd = 0;
let decisive = 0;
let yearSum = 0;
let areasTop = 0;
const navalShareByPersona = new Map<string, { navy: number; total: number }>();

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
  while (s.winner === null && s.year <= maxYears) {
    if (s.stage === "COMBAT") {
      s = advanceAfterCombat(s, R, W).state;
      continue;
    }
    const power = s.activePower!;
    const actions: readonly Action[] = await ai.requestActions({ view: { power, state: s, ruleSet: R, world: W } });
    const sailsFrom = new Set<number>();
    for (const a of actions) if (a.type === "MOVE_FLEET") sailsFrom.add(a.from);
    const tally = navalShareByPersona.get(personaOf.get(String(power))!) ?? { navy: 0, total: 0 };
    for (const a of actions) {
      const before = s.powers[String(power)]!.treasury;
      s = reduce(s, a, R, W).state;
      const cost = Math.max(0, before - s.powers[String(power)]!.treasury);
      if (a.type === "BUILD_ARMY") spend.army += cost;
      else if (a.type === "BUILD_FLEET") {
        if (cost > 0) fleetsBuilt += a.fleets;
        if (sailsFrom.has(a.area)) spend.fleetLift += cost;
        else spend.fleetIdle += cost;
        tally.navy += cost;
      } else if (a.type === "FORTIFY") spend.fortify += cost;
      else if (a.type === "SUBVERT") spend.subvert += cost;
      else spend.other += cost;
      if (a.type === "BUILD_ARMY" || a.type === "BUILD_FLEET") tally.total += cost;
      if (a.type === "MOVE_FLEET") {
        fleetsSailed += a.fleets;
        if (a.troops > 0) seaInvasions += 1;
      }
      if (a.type === "MOVE_ARMY") landAttacks += 1;
    }
    navalShareByPersona.set(personaOf.get(String(power))!, tally);
    s = reduce(s, { type: "END_TURN" }, R, W).state;
  }
  for (const a of Object.values(s.areas)) {
    if (a.owner === null) continue;
    fleetsAtEnd += a.fleets;
    troopsAtEnd += a.troops;
  }
  const counts = new Map<string, number>();
  for (const a of Object.values(s.areas)) if (a.owner !== null) counts.set(String(a.owner), (counts.get(String(a.owner)) ?? 0) + 1);
  areasTop += Math.max(...counts.values());
  if (s.winner !== null) {
    decisive += 1;
    yearSum += s.year;
  }
}

const m = (n: number): string => `$${(n / 1e6).toFixed(1)}M`;
const military = spend.army + spend.fleetLift + spend.fleetIdle;
const navy = spend.fleetLift + spend.fleetIdle;
console.log(`games ${games}, seeds ${seed0}..${seed0 + games - 1}, up to year ${maxYears}`);
console.log(`spend per game: army ${m(spend.army / games)}, fleets ${m(navy / games)} (lift ${m(spend.fleetLift / games)}, idle ${m(spend.fleetIdle / games)}), fortify ${m(spend.fortify / games)}, bribes ${m(spend.subvert / games)}`);
console.log(`navy share of army+navy spend: ${((100 * navy) / military).toFixed(1)}%  (idle-built fleets ${((100 * spend.fleetIdle) / Math.max(1, navy)).toFixed(0)}% of navy)`);
console.log(`fleets built ${(fleetsBuilt / games).toFixed(0)}/game, fleet sorties ${(fleetsSailed / games).toFixed(0)} fleet-moves/game, sea invasions ${(seaInvasions / games).toFixed(1)}, land attacks ${(landAttacks / games).toFixed(1)}`);
console.log(`at end: ${(fleetsAtEnd / games).toFixed(0)} fleets (lift ${((fleetsAtEnd * R.limits.troopsPerFleet) / games / 1000).toFixed(0)}k) vs ${(troopsAtEnd / games / 1000).toFixed(0)}k troops on the map`);
console.log(`decisive ${decisive}/${games}${decisive ? `, avg win year ${(yearSum / decisive).toFixed(1)}` : ""}, biggest empire avg ${(areasTop / games).toFixed(0)} areas`);
console.log("navy share by persona:", [...navalShareByPersona].map(([k, v]) => `${k} ${((100 * v.navy) / Math.max(1, v.total)).toFixed(0)}%`).join(", "));
