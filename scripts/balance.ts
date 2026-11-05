/**
 * Balance check: plays all-AI games with shuffled personas and reports how
 * often each great power wins, so a geography or starting-force advantage
 * shows up at a glance. A fair setup lands every power near 1 in 6.
 *
 *   npm run balance                      # 60 games, standard scenario
 *   npm run balance -- --games 120 --scenario 1880
 */
import { BUILTIN_PERSONAS } from "../src/controllers/ai/persona.ts";
import { CLASSIC_RULESET } from "../src/engine/ruleset/classic.ts";
import type { PowerId } from "../src/engine/types.ts";
import { getScenario } from "../src/engine/world/scenarios.ts";
import { playSimGame, seededShuffle } from "../src/game/simulation.ts";
import type { SeatPersona } from "../src/game/simulation.ts";

const argv = process.argv.slice(2);
const arg = (flag: string, fallback: string): string => {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : fallback;
};
const games = Number(arg("--games", "60"));
const scenario = getScenario(arg("--scenario", "standard"));
const seed0 = Number(arg("--seed", "1"));

async function main(): Promise<void> {
  const wins = new Map<string, number>();
  const score = new Map<string, number>();
  let years = 0;
  let decisive = 0;
  for (let g = 0; g < games; g += 1) {
    const seed = seed0 + g;
    const personas = seededShuffle(BUILTIN_PERSONAS, seed);
    const seats = new Map<PowerId, SeatPersona>();
    CLASSIC_RULESET.playOrder.forEach((p, i) => {
      const persona = personas[i % personas.length]!;
      seats.set(p, { id: persona.id, name: persona.name, knobs: persona.knobs });
    });
    const r = await playSimGame(seats, { winningScore: 1000, maxYears: 60, seed, scenario });
    if (r.winner !== null) {
      decisive += 1;
      years += r.year;
      wins.set(String(r.winner), (wins.get(String(r.winner)) ?? 0) + 1);
    }
    for (const p of r.powers) score.set(String(p.power), (score.get(String(p.power)) ?? 0) + p.score);
    process.stdout.write(r.error ? "E" : r.winner === null ? "-" : String(r.winner)[0]!.toUpperCase());
  }
  console.log(`\n\n${scenario.name}: ${games} games, ${decisive} decisive, avg end year ${(years / Math.max(1, decisive)).toFixed(1)}`);
  for (const p of CLASSIC_RULESET.playOrder) {
    const w = wins.get(String(p)) ?? 0;
    const bar = "#".repeat(Math.round((w / games) * 60));
    console.log(`  ${String(p).padEnd(8)} ${String(w).padStart(4)} wins ${((100 * w) / games).toFixed(0).padStart(3)}%  avg score ${Math.round((score.get(String(p)) ?? 0) / games).toString().padStart(5)}  ${bar}`);
  }
}

void main();
