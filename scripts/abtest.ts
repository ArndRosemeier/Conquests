/**
 * A/B test two AI implementations head-to-head. Each game seats some powers with
 * the challenger controller (default "v3") and the rest with the baseline (default
 * the frozen "v2"); the same personas and map positions are shared, and which
 * seats are the challenger rotates each game, so the only difference measured is
 * the AI implementation itself.
 *
 * The winner-more-often variant is the better AI. Keep this as the standard gate
 * for any future AI change: freeze the current AI, evolve a new version, and prove
 * it wins here before making it the default.
 *
 * The most sensitive skill test puts a single challenger against a full baseline
 * field (`--challenger-seats 1`, many games): if its per-seat win rate beats the
 * 16.7% fair share, it is genuinely stronger. A symmetric 3v3 is dominated by
 * positional luck and tends toward 50/50 even when one AI is better.
 *
 * Usage (via vite-node):
 *   npm run ab                            # 120 games, 3 v3 vs 3 v2
 *   npm run ab -- --games 240 --challenger-seats 1
 *   npm run ab -- --challenger v3 --baseline v2 --seed 7
 */
import { BUILTIN_PERSONAS } from "../src/controllers/ai/persona.ts";
import type { AiVersion } from "../src/controllers/ai/factory.ts";
import {
  abAssignment,
  aggregateVariants,
  playSimGame,
  summarize,
} from "../src/game/simulation.ts";
import type { SeatPersona, SimGameResult } from "../src/game/simulation.ts";

interface Options {
  readonly games: number;
  readonly seed: number;
  readonly maxYears: number;
  readonly winningScore: number;
  readonly challengerSeats: number;
  readonly challenger: AiVersion;
  readonly baseline: AiVersion;
}

function parseVersion(v: string | null, fallback: AiVersion): AiVersion {
  if (v === "v2" || v === "v3") return v;
  return fallback;
}

function parseArgs(argv: readonly string[]): Options {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1]! : null;
  };
  return {
    games: Number(get("--games") ?? 120),
    seed: Number(get("--seed") ?? 1),
    maxYears: Number(get("--years") ?? 80),
    winningScore: Number(get("--score") ?? 1000),
    challengerSeats: Number(get("--challenger-seats") ?? 3),
    challenger: parseVersion(get("--challenger"), "v3"),
    baseline: parseVersion(get("--baseline"), "v2"),
  };
}

const POOL: readonly SeatPersona[] = BUILTIN_PERSONAS.map((p) => ({
  id: p.id,
  name: p.name,
  knobs: p.knobs,
}));

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const baselineSeats = 6 - opts.challengerSeats;
  console.log(
    `A/B: ${opts.games} games | ${opts.challengerSeats} ${opts.challenger} (challenger) vs ` +
      `${baselineSeats} ${opts.baseline} (baseline) | seed ${opts.seed} | to ${opts.winningScore} VP ` +
      `| cap ${opts.maxYears}y | shuffled built-in personas\n`,
  );

  const results: SimGameResult[] = [];
  let challengerWins = 0;
  let baselineWins = 0;
  for (let i = 0; i < opts.games; i += 1) {
    const assignment = abAssignment(POOL, i, opts.seed, opts.challengerSeats, opts.challenger, opts.baseline);
    const r = await playSimGame(assignment, {
      winningScore: opts.winningScore,
      maxYears: opts.maxYears,
      seed: opts.seed + i,
    });
    results.push(r);
    if (r.winner !== null) {
      const w = r.powers.find((p) => p.power === r.winner)!;
      if (w.variant === opts.challenger) challengerWins += 1;
      else baselineWins += 1;
    }
    process.stdout.write(r.error !== undefined ? "!" : r.winner !== null ? "." : "o");
  }
  process.stdout.write("\n\n");

  const s = summarize(results);
  console.log(`${s.decisive} decisive, ${s.timeouts} timeouts, ${s.errors} errors, avg finish year ${s.avgYear.toFixed(1)}\n`);

  // Per-variant scoreboard, normalized to win rate per seat (the seat split may
  // be uneven).
  console.log(
    `  ${"variant".padEnd(8)}${"seats".padStart(7)}${"wins".padStart(6)}${"win/seat".padStart(10)}` +
      `${"avgScore".padStart(10)}${"avgAreas".padStart(10)}`,
  );
  for (const a of aggregateVariants(results)) {
    console.log(
      `  ${a.variant.padEnd(8)}${String(a.seats).padStart(7)}${String(a.wins).padStart(6)}` +
        `${((a.wins / a.seats) * 100).toFixed(1).padStart(9)}%` +
        `${(a.scoreSum / a.seats).toFixed(0).padStart(10)}${(a.areaSum / a.seats).toFixed(1).padStart(10)}`,
    );
  }

  const decided = challengerWins + baselineWins;
  const pct = (n: number): string => (decided > 0 ? ((n / decided) * 100).toFixed(0) : "0");
  console.log(
    `\nHead-to-head wins: ${opts.challenger} ${challengerWins} (${pct(challengerWins)}%) ` +
      `vs ${opts.baseline} ${baselineWins} (${pct(baselineWins)}%)`,
  );
}

void main();
