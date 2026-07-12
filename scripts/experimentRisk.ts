/**
 * Controlled experiment: isolate the effect of ONE knob on winning. Six personas
 * are identical (all knobs 50) except the chosen knob in {0,20,40,60,80,100}. One
 * sits in each seat; the assignment rotates each game so every level plays every
 * seat equally. Reports win rate by knob level.
 *
 *   npm run exp:knob -- --knob aggression --games 120
 */
import { knobs } from "../src/controllers/ai/persona.ts";
import type { PersonaKnobs } from "../src/controllers/ai/persona.ts";
import { CLASSIC_RULESET } from "../src/engine/ruleset/classic.ts";
import type { PowerId } from "../src/engine/types.ts";
import { aggregatePersonas, playSimGame, summarize } from "../src/game/simulation.ts";
import type { SeatPersona, SimGameResult } from "../src/game/simulation.ts";

const LEVELS = [0, 20, 40, 60, 80, 100] as const;

function parseGames(argv: readonly string[]): number {
  const i = argv.indexOf("--games");
  return i >= 0 ? Number(argv[i + 1]) : 120;
}

function parseKnob(argv: readonly string[]): keyof PersonaKnobs {
  const i = argv.indexOf("--knob");
  return (i >= 0 ? (argv[i + 1] as keyof PersonaKnobs) : "risk");
}

const KNOB = parseKnob(process.argv.slice(2));

const variants: SeatPersona[] = LEVELS.map((v) => ({
  id: `${KNOB}${v}`,
  name: `${KNOB} ${String(v).padStart(3)}`,
  knobs: knobs({ [KNOB]: v }),
}));

function assign(gameIndex: number): Map<PowerId, SeatPersona> {
  const powers = CLASSIC_RULESET.playOrder;
  const map = new Map<PowerId, SeatPersona>();
  powers.forEach((power, seat) => {
    map.set(power, variants[(seat + gameIndex) % variants.length]!);
  });
  return map;
}

async function main(): Promise<void> {
  const games = parseGames(process.argv.slice(2));
  console.log(`Isolating "${KNOB}": ${games} games (all knobs 50 except ${KNOB})\n`);

  const results: SimGameResult[] = [];
  for (let i = 0; i < games; i += 1) {
    results.push(await playSimGame(assign(i), { winningScore: 1000, maxYears: 80, seed: 1000 + i }));
    process.stdout.write(".");
  }
  process.stdout.write("\n\n");

  const s = summarize(results);
  console.log(`${s.decisive} decisive, ${s.timeouts} timeouts, ${s.errors} errors, avg year ${s.avgYear.toFixed(1)}\n`);

  console.log(`  ${"level".padStart(5)}${"wins".padStart(6)}${"win%".padStart(7)}${"avgScore".padStart(10)}${"avgAreas".padStart(10)}`);
  const rows = aggregatePersonas(results).sort((a, b) => a.name.localeCompare(b.name));
  for (const a of rows) {
    console.log(
      `  ${a.name.replace(KNOB, "").trim().padStart(5)}${String(a.wins).padStart(6)}` +
        `${((a.wins / a.games) * 100).toFixed(0).padStart(6)}%` +
        `${(a.scoreSum / a.games).toFixed(0).padStart(10)}${(a.areaSum / a.games).toFixed(1).padStart(10)}`,
    );
  }
}

void main();
