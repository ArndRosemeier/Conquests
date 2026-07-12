/**
 * Headless all-AI game simulator (CLI). Runs full games with no UI to stress-test
 * the persona AI, reusing the same engine loop as the in-app crash tester
 * (src/game/simulation.ts). Reports per-game results and a persona scoreboard.
 *
 * Usage (via vite-node):
 *   npm run sim                       # 20 games, shuffled personas, to 1000 VP
 *   npm run sim -- --games 50 --seed 7
 *   npm run sim -- --years 120 --score 1500
 *   npm run sim -- --persona conqueror   # all six AIs share one persona
 *   npm run sim -- --quiet            # aggregate only, no per-game lines
 */
import { BUILTIN_PERSONAS } from "../src/controllers/ai/persona.ts";
import { getPowerDef, CLASSIC_RULESET } from "../src/engine/ruleset/classic.ts";
import type { PowerId } from "../src/engine/types.ts";
import {
  aggregatePersonas,
  playSimGame,
  seededShuffle,
  summarize,
} from "../src/game/simulation.ts";
import type { SeatPersona, SimGameResult } from "../src/game/simulation.ts";

interface Options {
  readonly games: number;
  readonly seed: number;
  readonly maxYears: number;
  readonly winningScore: number;
  readonly persona: string | null;
  readonly quiet: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
  };
  return {
    games: Number(get("--games") ?? 20),
    seed: Number(get("--seed") ?? 1),
    maxYears: Number(get("--years") ?? 100),
    winningScore: Number(get("--score") ?? 1000),
    persona: get("--persona"),
    quiet: argv.includes("--quiet"),
  };
}

const seat = (p: (typeof BUILTIN_PERSONAS)[number]): SeatPersona => ({
  id: p.id,
  name: p.name,
  knobs: p.knobs,
});

/** Deal a persona to each power: all-one when forced, else a 1:1 seeded shuffle. */
function assign(seed: number, forced: string | null): Map<PowerId, SeatPersona> {
  const powers = CLASSIC_RULESET.playOrder;
  const map = new Map<PowerId, SeatPersona>();
  if (forced !== null) {
    const chosen = BUILTIN_PERSONAS.find(
      (p) => p.id === forced || p.name.toLowerCase() === forced.toLowerCase(),
    );
    if (chosen === undefined) {
      throw new Error(`Unknown persona '${forced}'. Options: ${BUILTIN_PERSONAS.map((p) => p.id).join(", ")}`);
    }
    for (const p of powers) map.set(p, seat(chosen));
    return map;
  }
  const shuffled = seededShuffle(BUILTIN_PERSONAS.map(seat), seed);
  powers.forEach((p, i) => map.set(p, shuffled[i % shuffled.length]!));
  return map;
}

function powerName(id: PowerId): string {
  return getPowerDef(CLASSIC_RULESET, id).name;
}

function fmtMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n}`;
}

function printGame(index: number, seed: number, r: SimGameResult): void {
  const winner = r.powers.find((p) => p.power === r.winner);
  const header =
    r.error !== undefined
      ? `ERROR: ${r.error}`
      : winner !== undefined
        ? `winner ${powerName(winner.power)} [${winner.personaName}]`
        : "no winner (timeout)";
  console.log(`\nGame ${index + 1} (seed ${seed}) - year ${r.year}, ${r.turns} turns, ${r.ms}ms - ${header}`);
  for (const p of [...r.powers].sort((a, b) => b.score - a.score)) {
    const marker = p.power === r.winner ? "*" : " ";
    console.log(
      `  ${marker} ${powerName(p.power).padEnd(9)} ${p.personaName.padEnd(13)}` +
        ` score ${String(p.score).padStart(5)}  areas ${String(p.areas).padStart(3)}` +
        `  income ${fmtMoney(p.income).padStart(7)}/yr  cash ${fmtMoney(p.treasury).padStart(7)}`,
    );
  }
}

function printAggregate(results: readonly SimGameResult[]): void {
  const s = summarize(results);
  const msSum = results.reduce((sum, r) => sum + r.ms, 0);

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Summary: ${s.games} games - ${s.decisive} decisive, ${s.timeouts} timeouts, ${s.errors} errors`);
  if (s.decisive > 0) console.log(`Average decisive finish: year ${s.avgYear.toFixed(1)}`);
  console.log(`Average game time: ${(msSum / results.length).toFixed(0)}ms`);

  console.log(`\nPersona performance (across all seats):`);
  console.log(
    `  ${"persona".padEnd(14)}${"games".padStart(6)}${"wins".padStart(6)}${"win%".padStart(7)}` +
      `${"avgScore".padStart(10)}${"avgAreas".padStart(10)}`,
  );
  for (const a of aggregatePersonas(results)) {
    const winPct = ((a.wins / a.games) * 100).toFixed(0);
    console.log(
      `  ${a.name.padEnd(14)}${String(a.games).padStart(6)}${String(a.wins).padStart(6)}` +
        `${(winPct + "%").padStart(7)}${(a.scoreSum / a.games).toFixed(0).padStart(10)}` +
        `${(a.areaSum / a.games).toFixed(1).padStart(10)}`,
    );
  }
  console.log(`${"=".repeat(72)}`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `Simulating ${opts.games} all-AI games | seed ${opts.seed} | to ${opts.winningScore} VP ` +
      `| cap ${opts.maxYears}y | personas: ${opts.persona ?? "shuffled"}`,
  );

  const results: SimGameResult[] = [];
  for (let i = 0; i < opts.games; i += 1) {
    const seed = opts.seed + i;
    const r = await playSimGame(assign(seed, opts.persona), {
      winningScore: opts.winningScore,
      maxYears: opts.maxYears,
      seed,
    });
    results.push(r);
    if (!opts.quiet) printGame(i, seed, r);
    else process.stdout.write(r.error !== undefined ? "!" : r.winner !== null ? "." : "o");
  }
  if (opts.quiet) process.stdout.write("\n");

  printAggregate(results);
}

void main();
