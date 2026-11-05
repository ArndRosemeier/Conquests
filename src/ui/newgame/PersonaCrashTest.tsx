import { useEffect, useRef, useState } from "react";
import type React from "react";
import { BUILTIN_PERSONAS } from "../../controllers/ai/persona.ts";
import {
  aggregatePersonas,
  crashTestAssignment,
  playSimGame,
  summarize,
} from "../../game/simulation.ts";
import type { SeatPersona, SimGameResult } from "../../game/simulation.ts";

const WINNING_SCORE = 1000;
const MAX_YEARS = 80;
const MIN_GAMES = 4;
const MAX_GAMES = 60;

const OPPONENTS: readonly SeatPersona[] = BUILTIN_PERSONAS.map((p) => ({
  id: p.id,
  name: p.name,
  knobs: p.knobs,
}));

interface Props {
  readonly persona: SeatPersona;
  readonly onBack: () => void;
}

/**
 * Crash-tests a persona by playing it, across many seeds and rotating seats,
 * against a field of the built-in personas. Reports how it fares - and surfaces
 * any engine errors it triggers, the literal "crash" in crash test. Games run on
 * the main thread, yielding between each so progress paints.
 */
export function PersonaCrashTest({ persona, onBack }: Props): React.JSX.Element {
  const [games, setGames] = useState(16);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<readonly SimGameResult[]>([]);
  const cancelled = useRef(false);

  useEffect(() => () => void (cancelled.current = true), []);

  const run = async (): Promise<void> => {
    cancelled.current = false;
    setRunning(true);
    setResults([]);
    setDone(0);
    const acc: SimGameResult[] = [];
    for (let i = 0; i < games; i += 1) {
      if (cancelled.current) break;
      const assignment = crashTestAssignment(persona, OPPONENTS, i, seed);
      const r = await playSimGame(assignment, {
        winningScore: WINNING_SCORE,
        maxYears: MAX_YEARS,
        seed: seed + i,
      });
      acc.push(r);
      setResults([...acc]);
      setDone(acc.length);
      // Yield so React can repaint the progress bar between games.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    setRunning(false);
  };

  const stop = (): void => {
    cancelled.current = true;
  };

  const summary = summarize(results);
  const aggregates = aggregatePersonas(results);
  const tested = aggregates.find((a) => a.id === persona.id);
  const testedWinPct = tested !== undefined && tested.games > 0 ? (tested.wins / tested.games) * 100 : 0;

  return (
    <div className="crash-test">
      <div className="modal-head">
        <h2>Crash test: {persona.name}</h2>
        <button className="btn" onClick={onBack} disabled={running}>
          Back
        </button>
      </div>

      <div className="modal-body">
        <p className="persona-hint">
          Plays {persona.name} against the six built-in personas across many seeds (rotating
          seats), to {WINNING_SCORE} VP or {MAX_YEARS} years per game.
        </p>

        <div className="crash-controls">
          <label>
            Games
            <input
              type="number"
              min={MIN_GAMES}
              max={MAX_GAMES}
              value={games}
              disabled={running}
              onChange={(e) =>
                setGames(Math.max(MIN_GAMES, Math.min(MAX_GAMES, Number(e.target.value))))
              }
            />
          </label>
          <label>
            Seed
            <input
              type="number"
              value={seed}
              disabled={running}
              onChange={(e) => setSeed(Number(e.target.value))}
            />
          </label>
          {running ? (
            <button className="btn danger" onClick={stop}>
              Stop
            </button>
          ) : (
            <button className="btn primary" onClick={() => void run()}>
              Run
            </button>
          )}
        </div>

        {(running || results.length > 0) && (
          <div className="crash-progress">
            <div className="crash-bar">
              <div className="crash-bar-fill" style={{ width: `${(done / games) * 100}%` }} />
            </div>
            <span className="crash-progress-label">
              {done}/{games} games
            </span>
          </div>
        )}

        {results.length > 0 && (
          <>
            <div className="crash-summary">
              <div className="crash-stat headline">
                <span className="crash-stat-value">{testedWinPct.toFixed(0)}%</span>
                <span className="crash-stat-label">{persona.name} win rate</span>
              </div>
              <div className="crash-stat">
                <span className="crash-stat-value">{summary.decisive}</span>
                <span className="crash-stat-label">decisive</span>
              </div>
              <div className="crash-stat">
                <span className="crash-stat-value">{summary.timeouts}</span>
                <span className="crash-stat-label">timeouts</span>
              </div>
              <div className={`crash-stat ${summary.errors > 0 ? "bad" : ""}`}>
                <span className="crash-stat-value">{summary.errors}</span>
                <span className="crash-stat-label">errors</span>
              </div>
              <div className="crash-stat">
                <span className="crash-stat-value">
                  {summary.avgYear > 0 ? summary.avgYear.toFixed(0) : "-"}
                </span>
                <span className="crash-stat-label">avg finish yr</span>
              </div>
            </div>

            {summary.errors > 0 && (
              <p className="crash-error">
                {summary.errors} game(s) threw an engine error - this persona (or the engine)
                has a bug worth investigating:
                <br />
                <code>{results.find((r) => r.error !== undefined)?.error}</code>
              </p>
            )}

            <table className="sim-table">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>Games</th>
                  <th>Wins</th>
                  <th>Win%</th>
                  <th>Avg score</th>
                  <th>Avg areas</th>
                </tr>
              </thead>
              <tbody>
                {aggregates.map((a) => (
                  <tr key={a.id} className={a.id === persona.id ? "tested" : ""}>
                    <td>
                      {a.name}
                      {a.id === persona.id ? " (tested)" : ""}
                    </td>
                    <td>{a.games}</td>
                    <td>{a.wins}</td>
                    <td>{((a.wins / a.games) * 100).toFixed(0)}%</td>
                    <td>{(a.scoreSum / a.games).toFixed(0)}</td>
                    <td>{(a.areaSum / a.games).toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
