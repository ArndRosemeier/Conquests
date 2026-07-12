import { AIController } from "../controllers/ai/aiController.ts";
import type { PersonaKnobs } from "../controllers/ai/persona.ts";
import { CLASSIC_RULESET } from "../engine/ruleset/classic.ts";
import { resolveCombat } from "../engine/state/combat.ts";
import { allAreas } from "../engine/state/helpers.ts";
import { beginNextTurn } from "../engine/state/phases.ts";
import { reduce } from "../engine/state/reducer.ts";
import { Rng } from "../engine/state/rng.ts";
import { annualIncomeFor, applyAnnualEconomy, checkWinner } from "../engine/state/scoring.ts";
import { createGame } from "../engine/state/setup.ts";
import type { PowerControlConfig } from "../engine/state/setup.ts";
import type { PowerId } from "../engine/types.ts";
import { CLASSIC_WORLD } from "../engine/world/classic.ts";
import { CLASSIC_HOME, SCENARIO_STANDARD } from "../engine/world/scenarios.ts";

/**
 * Headless game simulation, shared by the CLI stress-test script and the in-app
 * persona crash-tester. It drives the exact engine loop the live GameRunner uses
 * - turns, combat, annual economy, victory check - with no UI, so results match
 * real play. Everything here is pure/browser-safe (no Node, no console).
 */

/** A persona occupying one seat in a simulated game. */
export interface SeatPersona {
  readonly id: string;
  readonly name: string;
  readonly knobs: PersonaKnobs;
}

export interface SimPowerResult {
  readonly power: PowerId;
  readonly personaId: string;
  readonly personaName: string;
  readonly score: number;
  readonly areas: number;
  readonly treasury: number;
  readonly income: number;
}

export interface SimGameResult {
  readonly winner: PowerId | null;
  readonly winnerPersonaId: string | null;
  readonly year: number;
  readonly turns: number;
  readonly ms: number;
  readonly timedOut: boolean;
  /** Set when the game threw - the whole point of a "crash test". */
  readonly error?: string;
  readonly powers: readonly SimPowerResult[];
}

export interface SimGameOptions {
  readonly winningScore: number;
  readonly maxYears: number;
  readonly seed: number;
}

/** Deterministic Fisher-Yates shuffle (seeded), so runs are reproducible. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const rng = new Rng((seed ^ 0x5f3759df) >>> 0);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Play one full all-AI game to a winner or the year cap. */
export async function playSimGame(
  assignments: ReadonlyMap<PowerId, SeatPersona>,
  opts: SimGameOptions,
  ai: AIController = new AIController(CLASSIC_RULESET, CLASSIC_WORLD),
): Promise<SimGameResult> {
  const controls = new Map<PowerId, PowerControlConfig>();
  for (const power of CLASSIC_RULESET.playOrder) {
    const seat = assignments.get(power);
    controls.set(power, { control: "ai", persona: seat?.knobs ?? null });
  }

  let state = createGame({
    ruleSet: CLASSIC_RULESET,
    world: CLASSIC_WORLD,
    home: CLASSIC_HOME,
    scenario: SCENARIO_STANDARD,
    controls,
    winningScore: opts.winningScore,
    seed: opts.seed,
  });

  const start = Date.now();
  let turns = 0;
  let error: string | undefined;

  try {
    while (state.winner === null && state.year <= opts.maxYears) {
      if (state.stage === "COMBAT") {
        state = resolveCombat(state, CLASSIC_RULESET, CLASSIC_WORLD).state;
        state = beginNextTurn(state, CLASSIC_RULESET);
        if (state.season === "SPRING") {
          state = applyAnnualEconomy(state, CLASSIC_RULESET, CLASSIC_WORLD).state;
        }
        const winner = checkWinner(state);
        if (winner !== null) state = { ...state, winner };
        continue;
      }

      const power = state.activePower!;
      const actions = await ai.requestActions({
        view: { power, state, ruleSet: CLASSIC_RULESET, world: CLASSIC_WORLD },
      });
      for (const action of actions) {
        state = reduce(state, action, CLASSIC_RULESET, CLASSIC_WORLD).state;
      }
      state = reduce(state, { type: "END_TURN" }, CLASSIC_RULESET, CLASSIC_WORLD).state;
      turns += 1;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  const powers: SimPowerResult[] = CLASSIC_RULESET.playOrder.map((power) => {
    const p = state.powers[String(power)]!;
    const seat = assignments.get(power);
    return {
      power,
      personaId: seat?.id ?? "?",
      personaName: seat?.name ?? "?",
      score: p.score,
      areas: allAreas(state).filter((a) => a.owner === power).length,
      treasury: p.treasury,
      income: annualIncomeFor(state, CLASSIC_RULESET, CLASSIC_WORLD, power),
    };
  });

  const winner = error === undefined ? state.winner : null;
  return {
    winner,
    winnerPersonaId: winner !== null ? (assignments.get(winner)?.id ?? null) : null,
    year: state.year,
    turns,
    ms: Date.now() - start,
    timedOut: error === undefined && state.winner === null,
    powers,
    ...(error !== undefined ? { error } : {}),
  };
}

export interface PersonaAggregate {
  readonly id: string;
  readonly name: string;
  games: number;
  wins: number;
  scoreSum: number;
  areaSum: number;
}

/** Roll up per-persona performance across a batch of games (keyed by persona id). */
export function aggregatePersonas(results: readonly SimGameResult[]): PersonaAggregate[] {
  const agg = new Map<string, PersonaAggregate>();
  for (const r of results) {
    for (const p of r.powers) {
      const a =
        agg.get(p.personaId) ??
        { id: p.personaId, name: p.personaName, games: 0, wins: 0, scoreSum: 0, areaSum: 0 };
      a.games += 1;
      a.scoreSum += p.score;
      a.areaSum += p.areas;
      if (r.winner === p.power) a.wins += 1;
      agg.set(p.personaId, a);
    }
  }
  return [...agg.values()].sort((a, b) => b.wins / b.games - a.wins / a.games);
}

export interface BatchSummary {
  readonly games: number;
  readonly decisive: number;
  readonly timeouts: number;
  readonly errors: number;
  /** Average finish year among decisive games (0 if none). */
  readonly avgYear: number;
}

export function summarize(results: readonly SimGameResult[]): BatchSummary {
  let decisive = 0;
  let timeouts = 0;
  let errors = 0;
  let yearSum = 0;
  for (const r of results) {
    if (r.error !== undefined) errors += 1;
    else if (r.winner !== null) {
      decisive += 1;
      yearSum += r.year;
    } else timeouts += 1;
  }
  return {
    games: results.length,
    decisive,
    timeouts,
    errors,
    avgYear: decisive > 0 ? yearSum / decisive : 0,
  };
}

/**
 * Build a seat assignment that pits one persona under test against a field of
 * opponents. The tested persona rotates through a different seat each game (for
 * seat fairness), and the remaining seats are filled from a seeded shuffle of the
 * opponent pool.
 */
export function crashTestAssignment(
  tested: SeatPersona,
  opponents: readonly SeatPersona[],
  gameIndex: number,
  seed: number,
): Map<PowerId, SeatPersona> {
  const powers = CLASSIC_RULESET.playOrder;
  const seat = gameIndex % powers.length;
  const pool = seededShuffle(
    opponents.filter((o) => o.id !== tested.id),
    seed + gameIndex,
  );
  const map = new Map<PowerId, SeatPersona>();
  let oi = 0;
  powers.forEach((power, idx) => {
    if (idx === seat || pool.length === 0) map.set(power, tested);
    else map.set(power, pool[oi++ % pool.length]!);
  });
  return map;
}
